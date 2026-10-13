// ===== أدوات مشتركة لصفحات البوابة =====
const sb = window.supabase.createClient(
  window.PORTAL_CONFIG.SUPABASE_URL,
  window.PORTAL_CONFIG.SUPABASE_ANON_KEY
);

const lang = () => (document.documentElement.lang === 'en' ? 'en' : 'ar');

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// نص ثابت ثنائي اللغة يتبدّل مع زر اللغة
function L(ar, en) {
  return `<span data-ar="${esc(ar)}" data-en="${esc(en)}">${esc(lang() === 'en' ? en : ar)}</span>`;
}

// نص عادي حسب اللغة الحالية (للتنبيهات والأزرار المؤقتة)
function t(ar, en) {
  return lang() === 'en' ? en : ar;
}

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// رسائل الأخطاء المعروفة
const ERRORS = {
  CODE_INVALID: ['الكود غير صحيح، تأكد منه وحاول مرة ثانية.', 'This code is not valid. Please check it and try again.'],
  CODE_USED: ['هذا الكود مستخدم من قبل.', 'This code has already been used.'],
  CODE_FULL: ['هذا الطالب مربوط بولييّ أمر مسبقاً. تواصل مع الروضة.', 'This student is already linked to two guardians. Please contact the kindergarten.'],
  FORBIDDEN: ['ما عندك صلاحية لهذا الإجراء.', 'You don’t have permission to do that.'],
  TITLE_REQUIRED: ['اكتب عنوان الدرس.', 'Please enter a lesson title.'],
  QUESTION_INVALID: ['فيه سؤال ناقص: لازم نص السؤال وخيارين على الأقل وتحديد الجواب الصحيح.', 'A question is incomplete: it needs text, at least two options, and a correct answer.'],
  'Invalid login credentials': ['الإيميل أو كلمة المرور غير صحيحة.', 'Incorrect email or password.'],
  'Email not confirmed': ['لازم تأكد إيميلك أول. شيّك صندوق الوارد.', 'Please confirm your email first. Check your inbox.'],
  'User already registered': ['هذا الإيميل مسجّل مسبقاً. سجّل دخول بدلاً من ذلك.', 'This email is already registered. Please log in instead.'],
  'violates foreign key constraint': ['ما ينفع تحذف هذا لأن فيه بيانات مربوطة فيه.', 'This can’t be deleted because other data depends on it.'],
};

function errText(error) {
  const msg = (error && (error.message || error.toString())) || '';
  for (const key of Object.keys(ERRORS)) {
    if (msg.includes(key)) return t(...ERRORS[key]);
  }
  console.error(error);
  return t('صار خطأ: ', 'Something went wrong: ') + msg;
}

// تنبيه صغير أسفل الشاشة
function toast(message, kind = 'ok') {
  let box = $('#toast');
  if (!box) {
    box = document.createElement('div');
    box.id = 'toast';
    box.setAttribute('role', 'status');
    document.body.appendChild(box);
  }
  box.textContent = message;
  box.className = 'show ' + kind;
  clearTimeout(box._timer);
  box._timer = setTimeout(() => (box.className = ''), 3500);
}

// تشغيل دالة مع تعطيل الزر وإظهار الخطأ
async function withBusy(btn, fn) {
  if (btn) btn.disabled = true;
  try {
    return await fn();
  } catch (e) {
    toast(errText(e), 'err');
  } finally {
    if (btn) btn.disabled = false;
  }
}

// يرمي الخطأ لو استعلام Supabase فشل
function must({ data, error }) {
  if (error) throw error;
  return data;
}

// الصفحة الرئيسية لكل دور
function homeFor(profile) {
  if (!profile) return 'login.html';
  if (profile.role === 'admin') return 'admin.html';
  if (profile.role === 'teacher') return 'teacher.html';
  return 'parent.html';
}

// حارس الصفحة: يتأكد إن المستخدم مسجّل ودوره مسموح
async function requireUser(allowedRoles) {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) {
    location.replace('login.html');
    return new Promise(() => {});
  }
  const profile = must(await sb.from('profiles').select('*').eq('id', session.user.id).single());
  if (allowedRoles && !allowedRoles.includes(profile.role)) {
    location.replace(homeFor(profile));
    return new Promise(() => {});
  }
  setupHeader(profile);
  return { user: session.user, profile };
}

// الهيدر: إظهار الروابط حسب الدور + الخروج
function setupHeader(profile) {
  $$('[data-roles]').forEach(el => {
    el.hidden = !el.dataset.roles.split(' ').includes(profile.role);
  });
  const who = $('#whoami');
  if (who) who.textContent = profile.full_name || '';
  const out = $('#logoutBtn');
  if (out) {
    out.addEventListener('click', async () => {
      await sb.auth.signOut();
      location.replace('login.html');
    });
  }
}

// روابط موقّتة للصور الخاصة
async function signedUrls(bucket, paths) {
  const list = [...new Set(paths.filter(Boolean))];
  if (!list.length) return {};
  const data = must(await sb.storage.from(bucket).createSignedUrls(list, 60 * 60));
  const map = {};
  data.forEach(d => { if (d.signedUrl) map[d.path] = d.signedUrl; });
  return map;
}

// تصغير الصورة قبل الرفع (صور الجوال كبيرة)
function compressImage(file, maxSide = 1600, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob(b => (b ? resolve(b) : reject(new Error('compress failed'))), 'image/jpeg', quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(t('الملف ليس صورة.', 'That file is not an image.'))); };
    img.src = url;
  });
}

// رابط تضمين يوتيوب، أو null لو رابط ثاني
function youtubeEmbed(url) {
  if (!url) return null;
  const m = url.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/);
  return m ? `https://www.youtube-nocookie.com/embed/${m[1]}` : null;
}

function fmtDate(d) {
  if (!d) return '';
  return new Date(d + (d.length === 10 ? 'T00:00:00' : '')).toLocaleDateString(lang() === 'en' ? 'en-GB' : 'ar-BH', { day: 'numeric', month: 'short' });
}

function className(c) {
  if (!c) return '';
  return lang() === 'en' && c.name_en ? c.name_en : c.name_ar;
}

// نص متعدد الأسطر بأمان
function multiline(s) {
  return esc(s).replace(/\n/g, '<br>');
}
