// ===== صفحة الدخول والتسجيل =====
const LOGIN_URL = new URL('login.html', location.href.split('#')[0]).href;
const isRecovery = location.hash.includes('type=recovery');

function show(pane) {
  $$('[data-pane]').forEach(el => (el.hidden = el.dataset.pane !== pane));
  $$('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === pane));
  $('#tabs').hidden = !['login', 'signup'].includes(pane);
}

async function goHome() {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return;
  const profile = must(await sb.from('profiles').select('role').eq('id', user.id).single());
  location.replace(homeFor(profile));
}

$$('#tabs button').forEach(b => b.addEventListener('click', () => show(b.dataset.tab)));
$('#forgotLink').addEventListener('click', () => show('forgot'));
$$('[data-back]').forEach(b => b.addEventListener('click', () => show('login')));

// رابط "نسيت كلمة المرور" من الإيميل
sb.auth.onAuthStateChange(event => {
  if (event === 'PASSWORD_RECOVERY') show('reset');
});

(async () => {
  if (isRecovery) { show('reset'); return; }
  const { data: { session } } = await sb.auth.getSession();
  if (session) goHome();
})();

// دخول
$('#loginForm').addEventListener('submit', e => {
  e.preventDefault();
  const f = e.target;
  withBusy(f.querySelector('[type=submit]'), async () => {
    must(await sb.auth.signInWithPassword({ email: f.email.value.trim(), password: f.password.value }));
    await goHome();
  });
});

// تسجيل جديد بالكود
$('#signupForm').addEventListener('submit', e => {
  e.preventDefault();
  const f = e.target;
  withBusy(f.querySelector('[type=submit]'), async () => {
    const code = f.code.value.trim();
    const kind = must(await sb.rpc('check_code', { p_code: code }));
    if (!kind) throw new Error('CODE_INVALID');

    const data = must(await sb.auth.signUp({
      email: f.email.value.trim(),
      password: f.password.value,
      options: {
        emailRedirectTo: LOGIN_URL,
        data: { full_name: f.full_name.value.trim(), phone: f.phone.value.trim(), invite_code: code },
      },
    }));

    // Supabase يرجع مستخدم بدون identities لو الإيميل مسجّل مسبقاً
    if (data.user && data.user.identities && data.user.identities.length === 0) {
      throw new Error('User already registered');
    }
    if (data.session) {
      await goHome();
      return;
    }
    $('#doneMsg').innerHTML = L(
      '✅ تم إنشاء الحساب! أرسلنا لك إيميل تأكيد. افتح الرابط اللي فيه وبعدها سجّل دخول.',
      '✅ Account created! We sent you a confirmation email. Open the link inside, then log in.'
    );
    show('done');
  });
});

// نسيت كلمة المرور
$('#forgotForm').addEventListener('submit', e => {
  e.preventDefault();
  const f = e.target;
  withBusy(f.querySelector('[type=submit]'), async () => {
    must(await sb.auth.resetPasswordForEmail(f.email.value.trim(), { redirectTo: LOGIN_URL }));
    $('#doneMsg').innerHTML = L(
      '📧 لو الإيميل مسجّل عندنا، بيوصلك رابط لتغيير كلمة المرور خلال دقائق.',
      '📧 If that email is registered, you’ll receive a reset link within a few minutes.'
    );
    show('done');
  });
});

// كلمة مرور جديدة
$('#resetForm').addEventListener('submit', e => {
  e.preventDefault();
  const f = e.target;
  withBusy(f.querySelector('[type=submit]'), async () => {
    must(await sb.auth.updateUser({ password: f.password.value }));
    toast(t('تم تغيير كلمة المرور ✅', 'Password updated ✅'));
    history.replaceState(null, '', LOGIN_URL);
    await goHome();
  });
});
