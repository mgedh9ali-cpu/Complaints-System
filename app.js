(() => {
  'use strict';
  const script = document.createElement('script');
  script.src = '/app.bundle.js';
  script.async = false;
  script.onerror = () => {
    const panel = document.createElement('div');
    panel.dir = 'rtl';
    panel.setAttribute('role', 'alert');
    panel.style.cssText =
      'padding:16px;background:#8f2929;color:#fff;font-family:Tahoma,sans-serif;margin:12px;border-radius:8px';
    panel.textContent =
      'تعذر تحميل واجهة النظام. تحقق من ملفات الواجهة (ملفات ui/*) ثم أعد تشغيل النظام.';
    document.body.prepend(panel);
  };
  document.head.append(script);
})();
