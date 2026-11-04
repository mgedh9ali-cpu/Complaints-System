/**
 * Compact attachments UI for intake + detail (no oversized native file controls).
 */
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);

  function notify(msg, kind) {
    if (typeof toast === 'function') toast(msg, kind);
    else if (window.__complaintsNotify) window.__complaintsNotify(msg, kind);
    else console.log(msg);
  }

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
    wrap.className = 'form-field full attach-field';
    wrap.innerHTML = `
      <label>مرفقات (اختياري)</label>
      <div class="attach-dropzone" id="cAttachZone">
        <input type="file" id="cAttachments" class="attach-input-hidden" multiple
          accept=".pdf,.jpg,.jpeg,.png,.webp,.gif,.doc,.docx,.xls,.xlsx,.txt,.csv">
        <button type="button" class="btn btn-sm" id="cAttachPick">اختيار ملفات</button>
        <span class="attach-hint">PDF · صور · Word · Excel · نص — حتى 5 ملفات × 5MB</span>
      </div>
      <div id="cAttachPreview" class="attach-preview" hidden></div>
    `;
    form.querySelector('.form-grid')?.appendChild(wrap);

    const input = $('#cAttachments');
    $('#cAttachPick')?.addEventListener('click', () => input?.click());
    input?.addEventListener('change', () => {
      const pendingFiles = input.files && input.files.length ? input.files : null;
      const box = $('#cAttachPreview');
      if (!box) return;
      if (!pendingFiles) {
        box.hidden = true;
        box.innerHTML = '';
        return;
      }
      box.hidden = false;
      box.innerHTML = [...pendingFiles]
        .map((f) => `<span class="attach-chip">${escapeHtml(f.name)} <small>(${Math.round(f.size / 1024)} ك.ب)</small></span>`)
        .join('');
    });
  }

  window.addEventListener('complaints:created', async (event) => {
    const id = event.detail && event.detail.id;
    const files = Array.isArray(event.detail?.files) ? event.detail.files : [];
    if (!id || !files.length || !window.__uploadAttachments) return;
    try {
      const saved = await window.__uploadAttachments(id, files);
      if (saved && saved.length) notify('تم رفع ' + saved.length + ' مرفق للشكوى ' + id);
      else notify('تم إنشاء الشكوى لكن لم تكتمل المرفقات. افتح تفاصيلها لإعادة الرفع.', 'error');
    } catch (error) {
      notify('تعذر رفع مرفقات الشكوى ' + id + ': ' + error.message, 'error');
    }
  });

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  async function injectIntoDetail() {
    const host = document.querySelector('#complaint-attachments');
    if (!host || $('#detailAttachPanel')) return;

    const idEl =
      document.querySelector('.complaint-page .ticket-id bdi') ||
      document.querySelector('.complaint-page .ticket-id') ||
      document.querySelector('.detail-pane .ticket-id');
    const complaintId = idEl ? idEl.textContent.trim() : null;

    const box = document.createElement('div');
    box.id = 'detailAttachPanel';
    box.className = 'attach-panel';
    box.innerHTML = `
      <div class="attach-panel-head">
        <span class="attach-panel-title">الملفات المرفقة</span>
        <button type="button" class="btn btn-sm" id="detailExcelBtn" title="تصدير Excel">Excel</button>
      </div>
      <div id="detailAttachList" class="attach-list"><span class="small-copy">جاري التحميل…</span></div>
      <div class="attach-dropzone compact">
        <input type="file" id="detailAttachInput" class="attach-input-hidden" multiple
          accept=".pdf,.jpg,.jpeg,.png,.webp,.gif,.doc,.docx,.xls,.xlsx,.txt,.csv">
        <button type="button" class="btn btn-sm" id="detailAttachPick">اختيار ملفات</button>
        <button type="button" class="btn btn-sm btn-primary" id="detailAttachBtn">رفع</button>
      </div>
    `;
    host.appendChild(box);

    if (complaintId) {
      await refreshAttachmentList(complaintId);
      $('#detailExcelBtn')?.addEventListener('click', () => exportSingle(complaintId));
    } else {
      const list = $('#detailAttachList');
      if (list) list.innerHTML = '<span class="small-copy">تعذر تحديد رقم الشكوى.</span>';
    }

    const input = $('#detailAttachInput');
    $('#detailAttachPick')?.addEventListener('click', () => input?.click());
    $('#detailAttachBtn')?.addEventListener('click', async () => {
      if (!input || !input.files || !input.files.length) {
        notify('اختر ملفاً واحداً على الأقل.', 'error');
        return;
      }
      const id = (
        document.querySelector('.complaint-page .ticket-id bdi') ||
        document.querySelector('.complaint-page .ticket-id') ||
        {}
      ).textContent?.trim();
      if (!id || !window.__uploadAttachments) {
        notify('تعذر تحديد رقم الشكوى.', 'error');
        return;
      }
      const btn = $('#detailAttachBtn');
      if (btn) {
        btn.disabled = true;
        btn.classList.add('is-loading');
      }
      try {
        const saved = await window.__uploadAttachments(id, input.files);
        if (saved && saved.length) {
          input.value = '';
          await refreshAttachmentList(id);
        }
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.classList.remove('is-loading');
        }
      }
    });
  }

  async function refreshAttachmentList(complaintId) {
    const list = $('#detailAttachList');
    if (!list) return;
    try {
      const res = await fetch('/api/attachments/by-complaint/' + encodeURIComponent(complaintId), {
        credentials: 'same-origin'
      });
      if (!res.ok) {
        list.innerHTML = '<span class="small-copy">لا توجد مرفقات أو تعذر التحميل.</span>';
        return;
      }
      const data = await res.json();
      const items = data.attachments || [];
      if (!items.length) {
        list.innerHTML = '<span class="small-copy">لا توجد مرفقات بعد.</span>';
        return;
      }
      list.innerHTML = items
        .map((a) => {
          const name = a.originalName || a.storedName;
          const size = a.size ? Math.round(a.size / 1024) + ' ك.ب' : '';
          if (/^image\/(jpeg|png|webp|gif)$/.test(a.mime || '')) {
            return `<button type="button" class="attach-chip" data-action="attachment-preview" data-file="${escapeHtml(a.storedName)}" data-name="${escapeHtml(name)}"><img class="attach-thumbnail" loading="lazy" src="/api/attachments/${encodeURIComponent(a.storedName)}" alt="">${escapeHtml(name)}</button>`;
          }
          return `<a class="attach-chip link" href="/api/attachments/${encodeURIComponent(a.storedName)}" target="_blank" rel="noopener">${escapeHtml(name)} <small>${size}</small></a> <button class="btn btn-sm" type="button" data-request-delete="${escapeHtml(a.storedName)}">طلب حذف</button>`;
        })
        .join('');
      list.querySelectorAll('[data-request-delete]').forEach((button) =>
        button.addEventListener('click', () => {
          window.dispatchEvent(
            new CustomEvent('complaints:request-attachment-deletion', {
              detail: { complaintId, storedName: button.dataset.requestDelete }
            })
          );
        })
      );
    } catch {
      list.innerHTML = '<span class="small-copy">تعذر تحميل قائمة المرفقات.</span>';
    }
  }

  async function exportSingle(complaintId) {
    try {
      notify('جاري تصدير الشكوى…');
      const res = await fetch('/api/export/xlsx/' + encodeURIComponent(complaintId), {
        credentials: 'same-origin'
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'تعذر التصدير');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'شكوى-' + complaintId + '.xlsx';
      link.hidden = true;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      notify('تم تصدير تفاصيل الشكوى Excel.');
    } catch (err) {
      notify(err.message || 'فشل التصدير', 'error');
    }
  }

  console.info('[attachments-ui-bridge] compact dropzone ready');
})();
