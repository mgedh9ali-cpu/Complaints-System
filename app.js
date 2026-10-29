(() => {
  'use strict';
  const script = document.createElement('script');
  script.src = '/app-full.js';
  script.async = false;
  script.onerror = () => {
    const panel = document.createElement('div');
    panel.dir = 'rtl';
    panel.setAttribute('role', 'alert');
    panel.style.cssText = 'padding:16px;background:#8f2929;color:#fff;font-family:Tahoma';
    panel.textContent = 'تعذر تحميل واجهة النظام. تحقق من ملف الواجهة ثم أعد تشغيل النظام.';
    document.body.prepend(panel);
  };
  document.head.append(script);
})();
