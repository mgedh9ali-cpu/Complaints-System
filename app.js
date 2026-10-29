(() => {
  'use strict';
  const parts = ['/app-p01.js', '/app-p02.js', '/app-p03.js', '/app-p04.js', '/app-p05.js', '/app-p06.js', '/app-p07.js', '/app-p08.js', '/app-p09.js'];
  (async () => {
    try {
      const texts = await Promise.all(parts.map((url) =>
        fetch(url, { credentials: 'same-origin', cache: 'no-cache' }).then((r) => {
          if (!r.ok) throw new Error('فشل تحميل ' + url + ' (' + r.status + ')');
          return r.text();
        })
      ));
      (0, eval)(texts.join(''));
    } catch (err) {
      console.error(err);
      document.body.insertAdjacentHTML('afterbegin',
        '<div dir="rtl" style="padding:16px;background:#8f2929;color:#fff;font-family:Tahoma">' +
        'تعذر تحميل واجهة النظام: ' + String(err && err.message ? err.message : err) + '</div>');
    }
  })();
})();
