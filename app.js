(() => {
  'use strict';
  const partUrls = ['/app-b64-0.txt', '/app-b64-1.txt', '/app-b64-2.txt'];
  (async () => {
    try {
      const parts = await Promise.all(partUrls.map(u => fetch(u, {credentials:'same-origin',cache:'no-cache'}).then(r => {
        if (!r.ok) throw new Error('فشل ' + u + ' (' + r.status + ')');
        return r.text();
      })));
      const b64 = parts.join('').replace(/\s+/g, '');
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const ds = new DecompressionStream('gzip');
      const stream = new Blob([bytes]).stream().pipeThrough(ds);
      const ab = await new Response(stream).arrayBuffer();
      const code = new TextDecoder().decode(ab);
      (0, eval)(code);
    } catch (err) {
      console.error(err);
      document.body.insertAdjacentHTML('afterbegin',
        '<div dir="rtl" style="padding:16px;background:#8f2929;color:#fff;font-family:Tahoma">' +
        'تعذر تحميل الواجهة: ' + String(err && err.message ? err.message : err) + '</div>');
    }
  })();
})();
