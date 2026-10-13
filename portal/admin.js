// ===== لوحة الإدارة =====
let me;
const db = { classes: [], students: [], codes: {}, guardians: [], teachers: [], classTeachers: [], invites: [] };
let filterClass = '';

const PORTAL_URL = new URL('login.html', location.href.split('#')[0]).href;

async function load() {
  const [classes, students, codes, guardians, teachers, classTeachers, invites] = await Promise.all([
    sb.from('classes').select('*').order('name_ar'),
    sb.from('students').select('id, full_name, class_id').order('full_name'),
    sb.from('student_codes').select('student_id, code'),
    sb.from('student_guardians').select('student_id, parent_id, parent:profiles(full_name, phone)'),
    sb.from('profiles').select('id, full_name, phone, role').in('role', ['teacher', 'admin']).order('full_name'),
    sb.from('class_teachers').select('class_id, teacher_id'),
    sb.from('teacher_invites').select('*').order('created_at', { ascending: false }),
  ].map(p => p.then(must)));
  Object.assign(db, { classes, students, guardians, teachers, classTeachers, invites });
  db.codes = Object.fromEntries(codes.map(c => [c.student_id, c.code]));
  render();
}

const classById = id => db.classes.find(c => c.id === id);
const classOptions = (selected, withEmpty) =>
  (withEmpty ? `<option value="">${esc(withEmpty)}</option>` : '') +
  db.classes.map(c => `<option value="${c.id}" ${c.id === selected ? 'selected' : ''}>${esc(className(c))}</option>`).join('');

function render() {
  renderClasses();
  renderStudents();
  renderTeachers();
}

// ===== الفصول =====
function renderClasses() {
  $('#classList').innerHTML = db.classes.length ? db.classes.map(c => {
    const n = db.students.filter(s => s.class_id === c.id).length;
    const ts = db.classTeachers.filter(ct => ct.class_id === c.id)
      .map(ct => db.teachers.find(t => t.id === ct.teacher_id)?.full_name).filter(Boolean);
    return `<div class="item">
      <div class="item-main">
        <span class="item-title">${esc(c.name_ar)}${c.name_en ? ` <span class="muted">/ ${esc(c.name_en)}</span>` : ''}</span>
        <span class="muted">${n} ${L('طالب', 'students')} · ${ts.length ? esc(ts.join('، ')) : L('بدون مدرس', 'No teacher')}</span>
      </div>
      <div class="item-actions"><button class="btn btn-danger btn-sm" data-del-class="${c.id}">${L('حذف', 'Delete')}</button></div>
    </div>`;
  }).join('') : `<p class="empty">${L('ابدأ بإضافة فصل.', 'Start by adding a class.')}</p>`;

  $('#studentClass').innerHTML = classOptions(filterClass || db.classes[0]?.id);
  $('#inviteClass').innerHTML = classOptions(null, t('بدون فصل الحين', 'No class yet'));
  $('#studentFilter').innerHTML = `<option value="">${esc(t('كل الفصول', 'All classes'))}</option>` + classOptions(filterClass);
}

$('#classForm').addEventListener('submit', e => {
  e.preventDefault();
  const f = e.target;
  withBusy(f.querySelector('[type=submit]'), async () => {
    must(await sb.from('classes').insert({ name_ar: f.name_ar.value.trim(), name_en: f.name_en.value.trim() }));
    f.reset();
    toast(t('تمت إضافة الفصل ✅', 'Class added ✅'));
    await load();
  });
});

$('#classList').addEventListener('click', e => {
  const b = e.target.closest('[data-del-class]');
  if (!b) return;
  const c = classById(b.dataset.delClass);
  if (db.students.some(s => s.class_id === c.id)) {
    toast(t('انقل أو احذف طلاب هذا الفصل أول.', 'Move or delete this class’s students first.'), 'err');
    return;
  }
  if (!confirm(t(`حذف فصل "${c.name_ar}" وكل دروسه؟`, `Delete class “${c.name_ar}” and all its lessons?`))) return;
  withBusy(b, async () => {
    must(await sb.from('classes').delete().eq('id', c.id));
    await load();
  });
});

// ===== الطلاب =====
function visibleStudents() {
  return db.students.filter(s => !filterClass || s.class_id === filterClass);
}

function renderStudents() {
  const list = visibleStudents();
  $('#studentTable').innerHTML = !list.length
    ? `<p class="empty">${L('ما فيه طلاب.', 'No students.')}</p>`
    : `<table class="table">
      <thead><tr>
        <th>${L('الطالب', 'Student')}</th><th>${L('الفصل', 'Class')}</th>
        <th>${L('كود التفعيل', 'Activation code')}</th><th>${L('أولياء الأمور', 'Guardians')}</th><th></th>
      </tr></thead>
      <tbody>${list.map(s => {
        const gs = db.guardians.filter(g => g.student_id === s.id);
        return `<tr>
          <td><b>${esc(s.full_name)}</b></td>
          <td><select data-move="${s.id}">${classOptions(s.class_id)}</select></td>
          <td style="white-space:nowrap">
            <span class="code">${esc(db.codes[s.id] || '')}</span>
            <button class="link-btn hint" data-copy="${esc(db.codes[s.id] || '')}" title="copy">📋</button>
            <button class="link-btn hint" data-regen="${s.id}" title="${esc(t('كود جديد', 'New code'))}">🔄</button>
          </td>
          <td>${gs.length ? gs.map(g => `<span class="chip">${esc(g.parent?.full_name || '—')}
              <span class="hint" dir="ltr">${esc(g.parent?.phone || '')}</span>
              <button data-unlink="${s.id}|${g.parent_id}" title="${esc(t('فك الربط', 'Unlink'))}">×</button></span>`).join('')
            : `<span class="badge new">${L('لم يُفعّل', 'Not activated')}</span>`}</td>
          <td><button class="btn btn-danger btn-sm" data-del-student="${s.id}">${L('حذف', 'Delete')}</button></td>
        </tr>`;
      }).join('')}</tbody></table>`;
}

$('#studentFilter').addEventListener('change', e => {
  filterClass = e.target.value;
  renderStudents();
  if (filterClass) $('#studentClass').value = filterClass;
});

$('#studentForm').addEventListener('submit', e => {
  e.preventDefault();
  const f = e.target;
  const names = f.names.value.split('\n').map(n => n.trim()).filter(Boolean);
  if (!names.length || !f.class_id.value) return;
  withBusy(f.querySelector('[type=submit]'), async () => {
    must(await sb.from('students').insert(names.map(full_name => ({ full_name, class_id: f.class_id.value }))));
    f.names.value = '';
    toast(t(`تمت إضافة ${names.length} طالب ✅`, `${names.length} student(s) added ✅`));
    await load();
  });
});

$('#studentTable').addEventListener('change', e => {
  const sel = e.target.closest('[data-move]');
  if (!sel) return;
  withBusy(sel, async () => {
    must(await sb.from('students').update({ class_id: sel.value }).eq('id', sel.dataset.move));
    toast(t('تم نقل الطالب ✅', 'Student moved ✅'));
    await load();
  });
});

$('#studentTable').addEventListener('click', async e => {
  const b = e.target.closest('button');
  if (!b) return;

  if (b.dataset.copy) {
    try { await navigator.clipboard.writeText(b.dataset.copy); toast(t('تم النسخ 📋', 'Copied 📋')); }
    catch (err) { toast(b.dataset.copy); }
  }

  if (b.dataset.regen) {
    if (!confirm(t('إنشاء كود جديد؟ الكود القديم بيوقف. أولياء الأمور المربوطين ما يتأثرون.', 'Create a new code? The old code will stop working. Already-linked guardians are not affected.'))) return;
    withBusy(b, async () => {
      db.codes[b.dataset.regen] = must(await sb.rpc('regenerate_code', { p_student: b.dataset.regen }));
      renderStudents();
    });
  }

  if (b.dataset.unlink) {
    const [sid, pid] = b.dataset.unlink.split('|');
    if (!confirm(t('فك ربط ولي الأمر عن هذا الطالب؟', 'Unlink this guardian from the student?'))) return;
    withBusy(b, async () => {
      must(await sb.from('student_guardians').delete().eq('student_id', sid).eq('parent_id', pid));
      await load();
    });
  }

  if (b.dataset.delStudent) {
    const s = db.students.find(x => x.id === b.dataset.delStudent);
    if (!confirm(t(`حذف الطالب "${s.full_name}" وكل حلوله؟`, `Delete “${s.full_name}” and all their submissions?`))) return;
    withBusy(b, async () => {
      must(await sb.from('students').delete().eq('id', s.id));
      await load();
    });
  }
});

// طباعة بطاقات الأكواد
$('#printBtn').addEventListener('click', () => {
  const list = visibleStudents();
  if (!list.length) { toast(t('ما فيه طلاب للطباعة.', 'No students to print.'), 'err'); return; }
  $('#printCards').innerHTML = list.map(s => `
    <div class="print-card">
      <img src="../images/logo.jpg" alt="">
      <b>روضة الجواهر · Aljawaher KG</b>
      <div style="margin-top:2mm">${esc(s.full_name)} — ${esc(className(classById(s.class_id)))}</div>
      <span class="code">${esc(db.codes[s.id] || '')}</span>
      <div style="font-size:10pt">
        ادخل على الرابط واختر "تسجيل جديد" ثم أدخل الكود<br>
        Open the link, choose “Sign up” and enter the code<br>
        <span dir="ltr">${esc(PORTAL_URL)}</span>
      </div>
    </div>`).join('');
  window.print();
});

// ===== المدرسين =====
function renderTeachers() {
  $('#teacherTable').innerHTML = !db.teachers.length
    ? `<p class="empty">${L('ما فيه مدرسين مسجّلين لين الحين.', 'No teachers have signed up yet.')}</p>`
    : `<table class="table">
      <thead><tr><th>${L('المدرس', 'Teacher')}</th><th>${L('الفصول', 'Classes')}</th><th>${L('إضافة فصل', 'Add class')}</th></tr></thead>
      <tbody>${db.teachers.map(tc => {
        const cls = db.classTeachers.filter(ct => ct.teacher_id === tc.id);
        return `<tr>
          <td><b>${esc(tc.full_name || '—')}</b>${tc.role === 'admin' ? ` <span class="badge draft">${L('إدارة', 'Admin')}</span>` : ''}
            <div class="hint" dir="ltr">${esc(tc.phone || '')}</div></td>
          <td>${cls.map(ct => `<span class="chip">${esc(className(classById(ct.class_id)))}
              <button data-rm-ct="${ct.class_id}|${tc.id}">×</button></span>`).join('') || '—'}</td>
          <td><select data-add-ct="${tc.id}">${classOptions(null, t('— اختر —', '— choose —'))}</select></td>
        </tr>`;
      }).join('')}</tbody></table>`;

  $('#inviteTable').innerHTML = !db.invites.length
    ? `<p class="empty">${L('ما فيه أكواد دعوة.', 'No invite codes.')}</p>`
    : `<table class="table">
      <thead><tr><th>${L('الاسم', 'Name')}</th><th>${L('الفصل', 'Class')}</th><th>${L('الكود', 'Code')}</th><th>${L('الحالة', 'Status')}</th><th></th></tr></thead>
      <tbody>${db.invites.map(inv => `<tr>
        <td>${esc(inv.full_name)}</td>
        <td>${esc(className(classById(inv.class_id))) || '—'}</td>
        <td style="white-space:nowrap"><span class="code">${esc(inv.code)}</span>
          <button class="link-btn hint" data-copy="${esc(inv.code)}">📋</button></td>
        <td>${inv.used_by ? `<span class="badge done">${L('مستخدم ✓', 'Used ✓')}</span>` : `<span class="badge new">${L('بانتظار التسجيل', 'Waiting')}</span>`}</td>
        <td>${inv.used_by ? '' : `<button class="btn btn-danger btn-sm" data-del-inv="${inv.id}">${L('حذف', 'Delete')}</button>`}</td>
      </tr>`).join('')}</tbody></table>`;
}

$('#inviteForm').addEventListener('submit', e => {
  e.preventDefault();
  const f = e.target;
  withBusy(f.querySelector('[type=submit]'), async () => {
    const inv = must(await sb.from('teacher_invites')
      .insert({ full_name: f.full_name.value.trim(), class_id: f.class_id.value || null })
      .select().single());
    f.reset();
    await load();
    toast(t(`كود الدعوة: ${inv.code}`, `Invite code: ${inv.code}`));
  });
});

$('#teacherTable').addEventListener('change', e => {
  const sel = e.target.closest('[data-add-ct]');
  if (!sel || !sel.value) return;
  withBusy(sel, async () => {
    must(await sb.from('class_teachers').upsert({ class_id: sel.value, teacher_id: sel.dataset.addCt }));
    await load();
  });
});

document.querySelector('main').addEventListener('click', async e => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.rmCt) {
    const [cid, tid] = b.dataset.rmCt.split('|');
    withBusy(b, async () => {
      must(await sb.from('class_teachers').delete().eq('class_id', cid).eq('teacher_id', tid));
      await load();
    });
  }
  if (b.dataset.delInv) {
    withBusy(b, async () => {
      must(await sb.from('teacher_invites').delete().eq('id', b.dataset.delInv));
      await load();
    });
  }
  if (b.dataset.copy && b.closest('#inviteTable')) {
    try { await navigator.clipboard.writeText(b.dataset.copy); toast(t('تم النسخ 📋', 'Copied 📋')); }
    catch (err) { toast(b.dataset.copy); }
  }
});

document.addEventListener('langchange', render);

(async () => {
  me = await requireUser(['admin']);
  try { await load(); } catch (e) { toast(errText(e), 'err'); }
})();
