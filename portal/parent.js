// ===== صفحة ولي الأمر =====
let me, children = [], lessons = [], subs = [];

async function load() {
  const links = must(await sb.from('student_guardians')
    .select('student:students(id, full_name, class_id, class:classes(name_ar, name_en))')
    .eq('parent_id', me.user.id));
  children = links.map(l => l.student).filter(Boolean)
    .sort((a, b) => a.full_name.localeCompare(b.full_name, 'ar'));

  const classIds = [...new Set(children.map(c => c.class_id))];
  const studentIds = children.map(c => c.id);

  lessons = classIds.length ? must(await sb.from('lessons')
    .select('id, class_id, title, due_date, has_quiz, allow_photo, created_at')
    .in('class_id', classIds).eq('published', true)
    .order('created_at', { ascending: false })) : [];

  subs = studentIds.length ? must(await sb.from('submissions')
    .select('lesson_id, student_id, score, total, photo_path, teacher_comment')
    .in('student_id', studentIds)) : [];

  render();
}

function render() {
  const box = $('#children');
  if (!children.length) {
    box.innerHTML = `<div class="panel empty">${L(
      'ما فيه أطفال مربوطين بحسابك. أضف كود التفعيل تحت.',
      'No children are linked to your account yet. Add an activation code below.'
    )}</div>`;
    return;
  }

  box.innerHTML = children.map(child => {
    const list = lessons.filter(l => l.class_id === child.class_id);
    const items = list.map(l => {
      const s = subs.find(x => x.lesson_id === l.id && x.student_id === child.id);
      let badges = s
        ? `<span class="badge done">${L('تم الحل ✓', 'Done ✓')}</span>`
        : `<span class="badge new">${L('جديد', 'New')}</span>`;
      if (s && s.total) badges += ` <span class="badge score">${s.score}/${s.total} ⭐</span>`;
      const due = l.due_date ? `<span class="muted">${L('التسليم:', 'Due:')} ${esc(fmtDate(l.due_date))}</span>` : '';
      const comment = s && s.teacher_comment
        ? `<div class="comment">💬 ${L('تعليق المدرس:', 'Teacher’s note:')} ${esc(s.teacher_comment)}</div>` : '';
      return `
        <a class="item" href="lesson.html?id=${l.id}&student=${child.id}">
          <div class="item-main">
            <span class="item-title">${esc(l.title)}</span>
            ${due}
            ${comment}
          </div>
          <div class="item-actions">${badges}</div>
        </a>`;
    }).join('');

    return `
      <section class="panel child-card">
        <div class="child-head">
          <div class="avatar">${esc(child.full_name.trim().charAt(0))}</div>
          <div>
            <div class="item-title">${esc(child.full_name)}</div>
            <div class="muted">${esc(className(child.class))}</div>
          </div>
        </div>
        <div class="list">${items || `<p class="empty">${L('ما فيه دروس لين الحين.', 'No lessons yet.')}</p>`}</div>
      </section>`;
  }).join('');
}

$('#addChildForm').addEventListener('submit', e => {
  e.preventDefault();
  const f = e.target;
  withBusy(f.querySelector('[type=submit]'), async () => {
    const kind = must(await sb.rpc('claim_code', { p_code: f.code.value.trim() }));
    f.reset();
    if (kind === 'teacher') {
      toast(t('تم تفعيل حساب المدرس ✅', 'Teacher account activated ✅'));
      setTimeout(() => location.replace('teacher.html'), 800);
      return;
    }
    toast(t('تمت إضافة الطفل ✅', 'Child added ✅'));
    await load();
  });
});

document.addEventListener('langchange', render);

(async () => {
  me = await requireUser();
  try { await load(); } catch (e) { toast(errText(e), 'err'); }
})();
