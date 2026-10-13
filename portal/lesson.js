// ===== صفحة حل الدرس =====
const params = new URLSearchParams(location.search);
const lessonId = params.get('id');
const studentId = params.get('student');   // بدون طالب = معاينة المدرس
const preview = !studentId;

let me, lesson, student, questions = [], keys = {}, sub = null, imgUrls = {}, photoUrl = null;
let quiz = { mode: 'intro', idx: 0, answers: {}, result: null };

const SPEAKER = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>';

async function load() {
  lesson = must(await sb.from('lessons').select('*, class:classes(name_ar, name_en)').eq('id', lessonId).single());
  questions = must(await sb.from('questions').select('id, sort, prompt, image_path, options').eq('lesson_id', lessonId).order('sort'));

  if (preview) {
    const k = must(await sb.from('question_keys').select('question_id, correct_index').in('question_id', questions.map(q => q.id)));
    k.forEach(x => (keys[x.question_id] = x.correct_index));
  } else {
    student = must(await sb.from('students').select('id, full_name').eq('id', studentId).single());
    sub = must(await sb.from('submissions').select('*').eq('lesson_id', lessonId).eq('student_id', studentId).maybeSingle());
  }

  imgUrls = await signedUrls('lesson-media', questions.map(q => q.image_path));
  if (sub && sub.photo_path) photoUrl = (await signedUrls('submissions', [sub.photo_path]))[sub.photo_path];

  renderHead();
  renderQuiz();
  renderPhoto();
}

function renderHead() {
  const back = preview ? 'teacher.html' : 'parent.html';
  const video = lesson.video_url && /^https?:\/\//i.test(lesson.video_url)
    ? (youtubeEmbed(lesson.video_url)
        ? `<div class="video"><iframe src="${esc(youtubeEmbed(lesson.video_url))}" allowfullscreen title="video"></iframe></div>`
        : `<p><a class="btn btn-ghost btn-sm" href="${esc(lesson.video_url)}" target="_blank" rel="noopener">▶ ${L('شاهد الفيديو', 'Watch the video')}</a></p>`)
    : '';
  const comment = sub && sub.teacher_comment
    ? `<div class="comment">💬 ${L('تعليق المدرس:', 'Teacher’s note:')} ${esc(sub.teacher_comment)}</div>` : '';

  $('#lessonHead').innerHTML = `
    <p style="margin-bottom:1rem"><a href="${back}" class="muted">← ${L('رجوع', 'Back')}</a></p>
    ${preview ? `<div class="notice warn" style="margin-bottom:1rem">👀 ${L('معاينة المدرس — الإجابات ما تنحفظ.', 'Teacher preview — answers are not saved.')}</div>` : ''}
    <section class="panel">
      <p class="muted">${esc(className(lesson.class))}${student ? ' · ' + esc(student.full_name) : ''}${lesson.due_date ? ' · ' + L('التسليم:', 'Due:') + ' ' + esc(fmtDate(lesson.due_date)) : ''}</p>
      <h1 style="margin:.3rem 0 1rem">${esc(lesson.title)}</h1>
      ${lesson.body ? `<div class="lesson-body">${multiline(lesson.body)}</div>` : ''}
      ${video}
      ${comment}
    </section>`;
}

// ===== الأسئلة =====
function renderQuiz() {
  const panel = $('#quizPanel');
  if (!lesson.has_quiz || !questions.length) { panel.hidden = true; return; }
  panel.hidden = false;

  if (quiz.mode === 'intro') {
    const prev = sub && sub.total
      ? `<p class="result-score">${sub.score}/${sub.total}</p><div class="stars">${stars(sub.score, sub.total)}</div>
         <p class="muted">${L('هذي نتيجة آخر محاولة.', 'This is the result of the last attempt.')}</p>` : '';
    panel.innerHTML = `
      <div class="quiz">
        <h2>🧩 ${L('الأسئلة', 'Questions')} (${questions.length})</h2>
        ${prev}
        <button class="btn btn-primary" id="startQuiz" style="font-size:1.3rem;padding:1rem 2.5rem;margin-top:1rem">
          ${sub && sub.total ? L('حل مرة ثانية', 'Try again') : L('يلّا نبدأ!', 'Let’s start!')}
        </button>
      </div>`;
    $('#startQuiz').onclick = () => { quiz = { mode: 'q', idx: 0, answers: {}, result: null }; renderQuiz(); };
    return;
  }

  if (quiz.mode === 'q') {
    const q = questions[quiz.idx];
    const picked = quiz.answers[q.id];
    const last = quiz.idx === questions.length - 1;
    panel.innerHTML = `
      <div class="quiz">
        <div class="progress">${questions.map((_, i) => `<span class="${i <= quiz.idx ? 'on' : ''}"></span>`).join('')}</div>
        <button class="speak" id="speakBtn" type="button" aria-label="${esc(t('اقرأ السؤال', 'Read aloud'))}">${SPEAKER}</button>
        <div class="q-prompt">${esc(q.prompt)}</div>
        ${q.image_path && imgUrls[q.image_path] ? `<img class="q-image" src="${esc(imgUrls[q.image_path])}" alt="">` : ''}
        <div class="options">
          ${q.options.map((o, i) => `<button class="option ${picked === i ? 'picked' : ''}" data-i="${i}" type="button">${esc(o)}</button>`).join('')}
        </div>
        <div class="quiz-nav">
          <button class="btn btn-ghost" id="prevQ" ${quiz.idx === 0 ? 'style="visibility:hidden"' : ''}>${L('السابق', 'Back')}</button>
          <button class="btn btn-primary" id="nextQ" ${picked === undefined ? 'disabled' : ''}>${last ? L('إرسال ✓', 'Submit ✓') : L('التالي', 'Next')}</button>
        </div>
      </div>`;
    $$('.option', panel).forEach(b => b.onclick = () => { quiz.answers[q.id] = +b.dataset.i; renderQuiz(); });
    $('#speakBtn').onclick = () => speak(q);
    $('#prevQ').onclick = () => { quiz.idx--; renderQuiz(); };
    $('#nextQ').onclick = e => {
      if (!last) { quiz.idx++; renderQuiz(); return; }
      submitQuiz(e.currentTarget);
    };
    return;
  }

  if (quiz.mode === 'result') {
    const r = quiz.result;
    const byId = Object.fromEntries(r.results.map(x => [x.id, x]));
    const cheer = r.score === r.total ? L('ممتاز! 🎉', 'Excellent! 🎉') : r.score / r.total >= 0.6 ? L('أحسنت! 👏', 'Well done! 👏') : L('محاولة حلوة، نحاول مرة ثانية؟ 💪', 'Nice try! Shall we try again? 💪');
    panel.innerHTML = `
      <div class="quiz">
        <h2>${cheer}</h2>
        <div class="stars">${stars(r.score, r.total)}</div>
        <p class="result-score">${r.score}/${r.total}</p>
        <div class="review">
          ${questions.map((q, i) => {
            const x = byId[q.id] || {};
            const mine = quiz.answers[q.id];
            return `<div class="item ${x.ok ? 'ok' : 'no'}">
              <div class="item-main">
                <span class="item-title">${i + 1}. ${esc(q.prompt)}</span>
                <span>${x.ok ? '✅' : '❌'} ${esc(q.options[mine] ?? '—')}${x.ok ? '' : ` · ${L('الصحيح:', 'Correct:')} <b>${esc(q.options[x.correct])}</b>`}</span>
              </div></div>`;
          }).join('')}
        </div>
        <button class="btn btn-ghost" id="againBtn" style="margin-top:1.5rem">${L('حل مرة ثانية', 'Try again')}</button>
      </div>`;
    $('#againBtn').onclick = () => { quiz = { mode: 'q', idx: 0, answers: {}, result: null }; renderQuiz(); };
  }
}

function stars(score, total) {
  const n = !total ? 0 : score === total ? 3 : score / total >= 0.6 ? 2 : 1;
  return '⭐'.repeat(n) + '<span style="opacity:.25">' + '⭐'.repeat(3 - n) + '</span>';
}

function speak(q) {
  if (!('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const text = [q.prompt, ...q.options].join('. ');
  const u = new SpeechSynthesisUtterance(text);
  u.lang = /[؀-ۿ]/.test(text) ? 'ar-SA' : 'en-US';
  u.rate = 0.85;
  speechSynthesis.speak(u);
}

async function submitQuiz(btn) {
  await withBusy(btn, async () => {
    if (preview) {
      const results = questions.map(q => ({ id: q.id, correct: keys[q.id], ok: quiz.answers[q.id] === keys[q.id] }));
      quiz.result = { score: results.filter(r => r.ok).length, total: questions.length, results };
    } else {
      quiz.result = must(await sb.rpc('submit_quiz', { p_lesson: lessonId, p_student: studentId, p_answers: quiz.answers }));
      sub = { ...(sub || {}), score: quiz.result.score, total: quiz.result.total };
    }
    quiz.mode = 'result';
    renderQuiz();
  });
}

// ===== رفع صورة الحل =====
function renderPhoto() {
  const panel = $('#photoPanel');
  if (!lesson.allow_photo) { panel.hidden = true; return; }
  panel.hidden = false;
  panel.innerHTML = `
    <h2>📸 ${L('صورة الحل', 'Photo of the work')}</h2>
    <p class="muted">${L('صوّر ورقة العمل بعد ما يحلّها طفلك وارفعها هنا عشان يشوفها المدرس.', 'Take a photo of the worksheet after your child finishes it and upload it here for the teacher.')}</p>
    ${photoUrl ? `<img class="photo-preview" src="${esc(photoUrl)}" alt="">
                  <p class="center"><span class="badge done">${L('تم الرفع ✓', 'Uploaded ✓')}</span></p>` : ''}
    ${preview ? '' : `
      <div class="form-row" style="margin-top:1rem">
        <label class="field"><span>${photoUrl ? L('تغيير الصورة', 'Replace photo') : L('اختر صورة', 'Choose a photo')}</span>
          <input type="file" id="photoInput" accept="image/*">
        </label>
        <button class="btn btn-primary" id="uploadBtn" type="button">${L('رفع', 'Upload')}</button>
      </div>`}`;
  if (!preview) $('#uploadBtn').onclick = e => uploadPhoto(e.currentTarget);
}

async function uploadPhoto(btn) {
  const file = $('#photoInput').files[0];
  if (!file) { toast(t('اختر صورة أول.', 'Choose a photo first.'), 'err'); return; }
  await withBusy(btn, async () => {
    btn.textContent = t('جاري الرفع…', 'Uploading…');
    const blob = await compressImage(file);
    const path = `${studentId}/${lessonId}/${Date.now()}.jpg`;
    must(await sb.storage.from('submissions').upload(path, blob, { contentType: 'image/jpeg' }));
    must(await sb.rpc('attach_photo', { p_lesson: lessonId, p_student: studentId, p_path: path }));
    sub = { ...(sub || {}), photo_path: path };
    photoUrl = URL.createObjectURL(blob);
    toast(t('تم رفع الصورة ✅', 'Photo uploaded ✅'));
  });
  renderPhoto();
}

document.addEventListener('langchange', () => { if (lesson) { renderHead(); renderQuiz(); renderPhoto(); } });

(async () => {
  me = await requireUser();
  if (!lessonId) { location.replace('parent.html'); return; }
  try { await load(); } catch (e) {
    $('#lessonHead').innerHTML = `<div class="panel empty">${L('ما قدرنا نفتح هذا الدرس.', 'We couldn’t open this lesson.')}</div>`;
    toast(errText(e), 'err');
  }
})();
