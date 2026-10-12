// ===== تبديل اللغة (عربي / English) =====
const langBtn = document.getElementById('langBtn');

function setLang(lang) {
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  document.querySelectorAll('[data-ar]').forEach(el => {
    el.innerHTML = el.dataset[lang];
  });
  langBtn.textContent = lang === 'ar' ? 'EN' : 'ع';
  try { localStorage.setItem('lang', lang); } catch (e) {}
}

langBtn.addEventListener('click', () => {
  setLang(document.documentElement.lang === 'ar' ? 'en' : 'ar');
});

let saved = 'ar';
try { saved = localStorage.getItem('lang') || 'ar'; } catch (e) {}
if (saved !== 'ar') setLang(saved);

// ===== قائمة الجوال =====
const menuBtn = document.getElementById('menuBtn');
const menu = document.getElementById('menu');
menuBtn.addEventListener('click', () => {
  const open = menu.classList.toggle('open');
  menuBtn.setAttribute('aria-expanded', open);
});
menu.querySelectorAll('a').forEach(a => a.addEventListener('click', () => menu.classList.remove('open')));

// ===== سنة الفوتر =====
document.getElementById('year').textContent = new Date().getFullYear();
