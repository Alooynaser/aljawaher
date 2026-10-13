// ===== صفحة المدرس =====
let me, classes = [], classId = null, lessons = [], students = [], subs = [];
let draft = null;   // الدرس اللي ينعدّل حالياً

const CLASS_KEY = 'teacherClass';

async function loadClasses() {
  if (me.profile.role === 'admin') {
    classes = must(await sb.from('classes').select('id, name_ar, name_en').order('name_ar'));
  } else {
    const rows = must(await sb.from('class_teachers').select('class:classes(id, name_ar, name_en)').eq('teacher_id', me.user.id));
    classes = rows.map(r => r.class).filter(Boolean);
  }
  let savedClass = null;
  try { savedClass = localStorage.getItem(CLASS_KEY); } catch (e) {}
  classId = classes.some(c => c.id === savedClass) ? savedClass : classes[0]?.id || null;
  renderClassSelect();
}

function renderClassSelect() {
  const sel = $('#classSelect');
  sel.innerHTML = classes.map(c => `<option value="${c.id}" ${c.id === classId ? 'selected' : ''}>${esc(className(c))}</option>`).join('');
  $('#newLessonBtn').disabled = !classId;
}

$('#newLessonBtn').addEventListener('click', e => {
  withBusy(e.currentTarget, () => openEditor(null));
});

$('#classSelect').addEventListener('change', e => {
  classId = e.target.value;
  try { localStorage.setItem(CLASS_KEY, classId); } catch (err) {}
  loadLessons().catch(err => toast(errText(err), 'err'));
});

async function loadLessons() {
  if (!classId) {
    $('#lessonList').innerHTML = `<p class="empty">${L('ما عندك فصول لين الحين. تواصل مع الإدارة.', 'You have no classes yet. Please contact the admin.')}</p>`;
    return;
  }
  lessons = must(await sb.from('lessons').select('*').eq('class_id', classId).order('created_at', { ascending: false }));
  students = must(await sb.from('students').select('id, full_name').eq('class_id', classId).order('full_name'));
  subs = lessons.length ? must(await sb.from('submissions')
    .select('id, lesson_id, student_id, score, total, photo_path, teacher_comment, submitted_at')
    .in('lesson_id', lessons.map(l => l.id))) : [];
  renderLessons();
}

function renderLessons() {
  const box = $('#lessonList');
  if (!lessons.length) {
    box.innerHTML = `<p class="empty">${L('ما فيه دروس في هذا الفصل. اضغط "درس جديد".', 'No lessons in this class yet. Click “New lesson”.')}</p>`;
    return;
  }
  box.innerHTML = lessons.map(l => {
    const done = subs.filter(s => s.lesson_id === l.id).length;
    return `
      <div class="item">
        <div class="item-main">
          <span class="item-title">${esc(l.title)}</span>
          <span class="muted">
            ${l.published ? `<span class="badge done">${L('منشور', 'Published')}</span>` : `<span class="badge draft">${L('مسودة', 'Draft')}</span>`}
            ${l.due_date ? ' · ' + L('التسليم:', 'Due:') + ' ' + esc(fmtDate(l.due_date)) : ''}
            · ${done}/${students.length} ${L('سلّموا', 'submitted')}
          </span>
        </div>
        <div class="item-actions">
          <button class="btn btn-teal btn-sm" data-act="subs" data-id="${l.id}">${L('التسليمات', 'Submissions')}</button>
          <a class="btn btn-ghost btn-sm" href="lesson.html?id=${l.id}">${L('معاينة', 'Preview')}</a>
          <button class="btn btn-ghost btn-sm" data-act="edit" data-id="${l.id}">${L('تعديل', 'Edit')}</button>
          <button class="btn btn-danger btn-sm" data-act="del" data-id="${l.id}">${L('حذف', 'Delete')}</button>
        </div>
      </div>`;
  }).join('');
}

$('#lessonList').addEventListener('click', e => {
  const b = e.target.closest('button[data-act]');
  if (!b) return;
  const id = b.dataset.id;
  if (b.dataset.act === 'edit') withBusy(b, () => openEditor(id));
  if (b.dataset.act === 'subs') withBusy(b, () => openSubs(id));
  if (b.dataset.act === 'del') deleteLesson(id, b);
});

async function deleteLesson(id, btn) {
  const l = lessons.find(x => x.id === id);
  if (!confirm(t(`حذف درس "${l.title}"؟ بتنحذف معه كل حلول الطلاب.`, `Delete “${l.title}”? All student submissions for it will be deleted too.`))) return;
  await withBusy(btn, async () => {
    must(await sb.from('lessons').delete().eq('id', id));
    toast(t('تم الحذف', 'Deleted'));
    await loadLessons();
  });
}

// ===== محرر الدرس =====
const blankQuestion = () => ({ id: null, prompt: '', image_path: null, imgUrl: null, options: ['', ''], correct: 0 });

async function openEditor(id) {
  const f = $('#editorForm');
  f.reset();
  if (id) {
    const l = lessons.find(x => x.id === id);
    const qs = must(await sb.from('questions').select('id, sort, prompt, image_path, options').eq('lesson_id', id).order('sort'));
    const ks = qs.length ? must(await sb.from('question_keys').select('question_id, correct_index').in('question_id', qs.map(q => q.id))) : [];
    const urls = await signedUrls('lesson-media', qs.map(q => q.image_path));
    draft = {
      id: l.id,
      questions: qs.map(q => ({
        id: q.id, prompt: q.prompt, image_path: q.image_path, imgUrl: urls[q.image_path] || null,
        options: [...q.options], correct: ks.find(k => k.question_id === q.id)?.correct_index ?? 0,
      })),
    };
    f.title.value = l.title;
    f.body.value = l.body || '';
    f.video_url.value = l.video_url || '';
    f.due_date.value = l.due_date || '';
    f.has_quiz.checked = l.has_quiz;
    f.allow_photo.checked = l.allow_photo;
    f.published.checked = l.published;
  } else {
    draft = { id: null, questions: [blankQuestion()] };
    f.has_quiz.checked = true;
  }
  $('#editorTitle').innerHTML = id ? L('تعديل الدرس', 'Edit lesson') : L('درس جديد', 'New lesson');
  renderQuestions();
  $('#editor').showModal();
}

function renderQuestions() {
  const on = $('#editorForm').has_quiz.checked;
  $('#addQuestionBtn').hidden = !on;
  const box = $('#questionsBox');
  if (!on) { box.innerHTML = ''; return; }

  box.innerHTML = draft.questions.map((q, qi) => `
    <div class="q-edit" data-q="${qi}">
      <div class="q-edit-head">
        <span>${L('سؤال', 'Question')} ${qi + 1}</span>
        <button class="btn btn-danger btn-sm" type="button" data-act="rmq">${L('حذف السؤال', 'Remove')}</button>
      </div>
      <input type="text" data-f="prompt" value="${esc(q.prompt)}" maxlength="300"
             placeholder="${esc(t('مثال: كم تفاحة في الصورة؟', 'e.g. How many apples are in the picture?'))}">
      <div class="form-row" style="align-items:center">
        <label class="field"><span class="hint">${L('صورة للسؤال (اختياري)', 'Question image (optional)')}</span>
          <input type="file" accept="image/*" data-f="image">
        </label>
        ${q.imgUrl ? `<div><img class="q-img-preview" src="${esc(q.imgUrl)}" alt="">
          <button class="link-btn hint" type="button" data-act="rmimg">${L('إزالة الصورة', 'Remove image')}</button></div>` : ''}
      </div>
      <span class="hint">${L('الخيارات — حدّد الجواب الصحيح بالدائرة:', 'Options — mark the correct answer with the circle:')}</span>
      ${q.options.map((o, oi) => `
        <div class="opt-row">
          <input type="radio" name="correct-${qi}" data-oi="${oi}" ${q.correct === oi ? 'checked' : ''} aria-label="correct">
          <input type="text" data-f="opt" data-oi="${oi}" value="${esc(o)}" maxlength="80"
                 placeholder="${esc(t('خيار', 'Option') + ' ' + (oi + 1))}">
          ${q.options.length > 2 ? `<button class="btn btn-danger btn-sm" type="button" data-act="rmopt" data-oi="${oi}">✕</button>` : ''}
        </div>`).join('')}
      ${q.options.length < 4 ? `<button class="link-btn hint" type="button" data-act="addopt" style="justify-self:start">+ ${L('خيار', 'Option')}</button>` : ''}
    </div>`).join('');
}

// زر Enter داخل حقل ما يقفل المحرر — بس زر "إلغاء" يقفله
$('#editorForm').addEventListener('submit', e => {
  if (!e.submitter || e.submitter.value !== 'cancel') e.preventDefault();
});

$('#editorForm').has_quiz.addEventListener('change', () => {
  if ($('#editorForm').has_quiz.checked && !draft.questions.length) draft.questions.push(blankQuestion());
  renderQuestions();
});

$('#addQuestionBtn').addEventListener('click', () => {
  draft.questions.push(blankQuestion());
  renderQuestions();
  $('#questionsBox').lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'center' });
});

// الكتابة في الحقول تحدّث المسودة بدون إعادة رسم (عشان ما يضيع المؤشر)
$('#questionsBox').addEventListener('input', e => {
  const box = e.target.closest('[data-q]');
  if (!box) return;
  const q = draft.questions[+box.dataset.q];
  if (e.target.dataset.f === 'prompt') q.prompt = e.target.value;
  if (e.target.dataset.f === 'opt') q.options[+e.target.dataset.oi] = e.target.value;
});

$('#questionsBox').addEventListener('change', async e => {
  const box = e.target.closest('[data-q]');
  if (!box) return;
  const q = draft.questions[+box.dataset.q];
  if (e.target.type === 'radio') q.correct = +e.target.dataset.oi;
  if (e.target.dataset.f === 'image' && e.target.files[0]) {
    const input = e.target;
    await withBusy(input, async () => {
      const blob = await compressImage(input.files[0], 1000);
      const path = `${classId}/${crypto.randomUUID()}.jpg`;
      must(await sb.storage.from('lesson-media').upload(path, blob, { contentType: 'image/jpeg' }));
      q.image_path = path;
      q.imgUrl = URL.createObjectURL(blob);
      renderQuestions();
    });
  }
});

$('#questionsBox').addEventListener('click', e => {
  const b = e.target.closest('button[data-act]');
  if (!b) return;
  const qi = +b.closest('[data-q]').dataset.q;
  const q = draft.questions[qi];
  if (b.dataset.act === 'rmq') draft.questions.splice(qi, 1);
  if (b.dataset.act === 'rmimg') { q.image_path = null; q.imgUrl = null; }
  if (b.dataset.act === 'addopt') q.options.push('');
  if (b.dataset.act === 'rmopt') {
    const oi = +b.dataset.oi;
    q.options.splice(oi, 1);
    if (q.correct === oi) q.correct = 0;
    else if (q.correct > oi) q.correct--;
  }
  renderQuestions();
});

$('#saveLessonBtn').addEventListener('click', e => {
  const f = $('#editorForm');
  if (!f.title.value.trim()) { f.title.focus(); toast(t('اكتب عنوان الدرس.', 'Please enter a lesson title.'), 'err'); return; }
  if (f.has_quiz.checked && !draft.questions.length) { toast(t('أضف سؤال واحد على الأقل أو شيل علامة الأسئلة.', 'Add at least one question, or untick on-screen questions.'), 'err'); return; }
  if (!f.has_quiz.checked && !f.allow_photo.checked && !f.body.value.trim() && !f.video_url.value.trim()) {
    toast(t('الدرس فاضي: أضف شرح أو فيديو أو أسئلة أو رفع صورة.', 'The lesson is empty: add an explanation, video, questions or photo upload.'), 'err'); return;
  }
  withBusy(e.currentTarget, async () => {
    const payload = {
      id: draft.id,
      class_id: classId,
      title: f.title.value.trim(),
      body: f.body.value,
      video_url: f.video_url.value.trim(),
      due_date: f.due_date.value,
      has_quiz: f.has_quiz.checked,
      allow_photo: f.allow_photo.checked,
      published: f.published.checked,
      questions: f.has_quiz.checked ? draft.questions.map(q => ({
        id: q.id, prompt: q.prompt.trim(), image_path: q.image_path,
        options: q.options.map(o => o.trim()), correct: q.correct,
      })) : [],
    };
    const bad = payload.questions.findIndex(q => !q.prompt || q.options.some(o => !o));
    if (bad >= 0) {
      toast(t(`السؤال ${bad + 1} ناقص: اكتب السؤال وكل الخيارات.`, `Question ${bad + 1} is incomplete: fill in the question and every option.`), 'err');
      return;
    }
    must(await sb.rpc('save_lesson', { p: payload }));
    $('#editor').close();
    toast(t('تم الحفظ ✅', 'Saved ✅'));
    await loadLessons();
  });
});

// ===== التسليمات =====
async function openSubs(lessonId) {
  const l = lessons.find(x => x.id === lessonId);
  const list = subs.filter(s => s.lesson_id === lessonId);
  const urls = await signedUrls('submissions', list.map(s => s.photo_path));
  $('#subsTitle').innerHTML = `${L('تسليمات:', 'Submissions:')} ${esc(l.title)}`;
  $('#subsTable').innerHTML = !students.length
    ? `<p class="empty">${L('ما فيه طلاب في هذا الفصل.', 'There are no students in this class.')}</p>`
    : `<table class="table">
        <thead><tr>
          <th>${L('الطالب', 'Student')}</th><th>${L('الدرجة', 'Score')}</th>
          <th>${L('الصورة', 'Photo')}</th><th>${L('تعليقك', 'Your note')}</th>
        </tr></thead>
        <tbody>${students.map(st => {
          const s = list.find(x => x.student_id === st.id);
          if (!s) return `<tr><td>${esc(st.full_name)}</td><td colspan="3"><span class="badge new">${L('لم يسلّم', 'Not submitted')}</span></td></tr>`;
          const img = s.photo_path && urls[s.photo_path]
            ? `<a href="${esc(urls[s.photo_path])}" target="_blank" rel="noopener"><img class="thumb" src="${esc(urls[s.photo_path])}" alt=""></a>` : '—';
          return `<tr>
            <td>${esc(st.full_name)}<div class="hint">${esc(fmtDate(s.submitted_at.slice(0, 10)))}</div></td>
            <td>${s.total ? `<span class="badge score">${s.score}/${s.total}</span>` : '—'}</td>
            <td>${img}</td>
            <td style="min-width:200px">
              <textarea data-sub="${s.id}" maxlength="500" style="min-height:60px">${esc(s.teacher_comment || '')}</textarea>
              <button class="btn btn-teal btn-sm" type="button" data-save="${s.id}" style="margin-top:.3rem">${L('حفظ', 'Save')}</button>
            </td></tr>`;
        }).join('')}</tbody>
      </table>`;
  $('#subsDialog').showModal();
}

$('#subsTable').addEventListener('click', e => {
  const b = e.target.closest('button[data-save]');
  if (!b) return;
  const id = b.dataset.save;
  const text = $(`textarea[data-sub="${id}"]`).value.trim();
  withBusy(b, async () => {
    must(await sb.from('submissions').update({ teacher_comment: text || null }).eq('id', id));
    const s = subs.find(x => x.id === id);
    if (s) s.teacher_comment = text || null;
    toast(t('تم حفظ التعليق ✅', 'Note saved ✅'));
  });
});

document.addEventListener('langchange', () => { renderClassSelect(); renderLessons(); });

(async () => {
  me = await requireUser(['teacher', 'admin']);
  try {
    await loadClasses();
    await loadLessons();
  } catch (e) { toast(errText(e), 'err'); }
})();
