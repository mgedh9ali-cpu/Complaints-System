/**
 * attachments-ui-bridge.js
 * يضيف حقل المرفقات إلى نموذج الشكوى وصفحة التفاصيل وقت التشغيل.
 * يُحمَّل بعد app.js
 */
(() => {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);

  function notify(msg, kind) {
    if (typeof toast === 'function') toast(msg, kind);
    else if (window.__complaintsNotify) window.__complaintsNotify(msg, kind);
    else console.log(msg);
  }

  // اعتراض فتح نموذج الشكوى الجديدة
  const origNewComplaint = window.newComplaint;
  // app.js uses function declarations inside IIFE so they are not on window.
  // Instead we observe DOM for the form.

  const observer = new MutationObserver(() => {
    injectIntoNewForm();
    injectIntoDetail();
  });
  observer.observe(document.body, { childList: true, subtree: true });

  function injectIntoNewForm() {
    const form = $('#newComplaintForm');
    if (!form || form.dataset.attachInjected) return;
    form.dataset.attachInjected = '1';

    const wrap = document.createElement('div');
    wrap.className = 'form-field full';
    wrap.innerHTML = `
      <label for="cAttachments">مرفقات (اختياري)</label>
      <input type="file" id="cAttachments" class="field" multiple
        accept=".pdf,.jpg,.jpeg,.png,.webp,.gif,.doc,.docx,.xls,.xlsx,.txt,.csv"
        style="padding:8px">
      <span class="small-copy">PDF، صور، Word، Excel، نص — حتى 5 ملفات × 5MB</span>
    `;
    form.querySelector('.form-grid')?.appendChild(wrap);

    // اعتراض زر الحفظ
    document.addEventListener('click', async function onSave(e) {
      const btn = e.target.closest('[data-action="save-complaint"]');
      if (!btn) return;
      // انتظر قليلاً حتى ينشئ app.js الشكوى
      setTimeout(async () => {
        const input = $('#cAttachments');
        if (!input || !input.files || !input.files.length) return;
        if (!window.__uploadAttachments) return;
        // أحدث شكوى في القائمة
        // نعتمد على أن createComplaint يضيفها في البداية
        // نبحث عن أحدث id
        const rows = document.querySelectorAll('[data-id^="SY-"]');
        // بديل: من local state غير متاح؛ نستخدم آخر رقم ظاهر في toast أو الجدول
        const tableIds = [...document.querySelectorAll('.ticket-id, td')]
          .map(el => el.textContent.trim())
          .filter(t => /^SY-\d{4}-\d+$/.test(t));
        const id = tableIds[0];
        if (!id) return;
        const saved = await window.__uploadAttachments(id, input.files);
        if (saved && saved.length) {
          notify('تم رفع ' + saved.length + ' مرفق للشكوى ' + id);
        }
      }, 600);
    }, true);
  }

  function injectIntoDetail() {
    const sections = document.querySelectorAll('.detail-section');
    if (!sections.length) return;
    if ($('#detailAttachInput')) return;

    // أضف قسم المرفقات بعد قسم بيانات الشكوى
    const firstSection = sections[0];
    if (!firstSection || firstSection.dataset.attachInjected) return;
    firstSection.dataset.attachInjected = '1';

    const box = document.createElement('div');
    box.className = 'detail-field';
    box.style.marginTop = '12px';
    box.innerHTML = `
      <span style="font-weight:700">المرفقات</span>
      <div style="margin-top:6px">
        <input type="file" id="detailAttachInput" multiple
          accept=".pdf,.jpg,.jpeg,.png,.webp,.gif,.doc,.docx,.xls,.xlsx,.txt,.csv"
          style="padding:6px;max-width:100%">
        <button type="button" class="btn btn-sm" id="detailAttachBtn" style="margin-top:6px">رفع المرفقات</button>
      </div>
    `;
    firstSection.appendChild(box);

    $('#detailAttachBtn')?.addEventListener('click', async () => {
      const input = $('#detailAttachInput');
      if (!input || !input.files || !input.files.length) {
        notify('اختر ملفاً واحداً على الأقل.', 'error');
        return;
      }
      const idEl = document.querySelector('.ticket-id');
      const id = idEl ? idEl.textContent.trim() : null;
      if (!id || !window.__uploadAttachments) {
        notify('تعذر تحديد رقم الشكوى.', 'error');
        return;
      }
      const saved = await window.__uploadAttachments(id, input.files);
      if (saved && saved.length) {
        notify('تم رفع ' + saved.length + ' مرفق.');
        // عرض الروابط
        const links = saved.map(a =>
          `<a href="/api/attachments/${a.storedName}" target="_blank" style="color:#145b49;margin-left:8px">${a.originalName}</a>`
        ).join(' · ');
        const prev = box.querySelector('.att-links') || document.createElement('div');
        prev.className = 'att-links';
        prev.style.marginTop = '8px';
        prev.innerHTML = (prev.innerHTML ? prev.innerHTML + ' · ' : '') + links;
        box.appendChild(prev);
      }
    });
  }

  console.info('[attachments-ui-bridge] جاهز — حقل المرفقات سيظهر في نموذج الشكوى والتفاصيل.');
})();
