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
    const mount = form.querySelector('#intakeAttachmentsMount');
    if (!mount) return;
    form.dataset.attachInjected = '1';

    const wrap = document.createElement('div');
    wrap.className = 'form-field full attach-field';
    wrap.innerHTML = `
      <label for="cAttachments">مرفقات (اختياري)</label>
      <div class="attach-dropzone" id="cAttachZone">
        <input type="file" id="cAttachments" class="attach-input-hidden" multiple
          accept=".pdf,.jpg,.jpeg,.png,.webp,.gif,.doc,.docx,.xls,.xlsx,.txt,.csv,.opus,.ogg">
        <button type="button" class="btn btn-sm" id="cAttachPick">اختيار ملفات</button>
        <span class="attach-hint">PDF · صور · Word · Excel · نص · صوت واتساب — حتى 5 ملفات × 5MB</span>
      </div>
      <div id="cAttachPreview" class="attach-preview" hidden></div>
    `;
    mount.appendChild(wrap);
    mountWhatsAppImport(form);

    const input = $('#cAttachments');
    $('#cAttachPick')?.addEventListener('click', () => input?.click());
    const selectedFiles = () => typeof intakeWizard === 'object' ? intakeWizard.files || [] : [];
    function showSelected(files) {
      const box = $('#cAttachPreview');
      if (!box) return;
      box.hidden = !files.length;
      box.innerHTML = files.map((f,index) => `<span class="attach-chip">${escapeHtml(f.name)} <small>(${Math.round(f.size / 1024)} ك.ب)</small><button type="button" class="btn btn-sm" data-remove-intake-file="${index}" aria-label="إزالة ${escapeHtml(f.name)}">إزالة</button></span>`).join('');
    }
    $('#cAttachPreview')?.addEventListener('click', event => {
      const button=event.target.closest('[data-remove-intake-file]');
      if(!button||typeof intakeWizard!=='object')return;
      const index=Number(button.dataset.removeIntakeFile);
      if(!Number.isInteger(index)||index<0||index>=intakeWizard.files.length)return;
      intakeWizard.files=intakeWizard.files.filter((_,i)=>i!==index);
      if(input)input.value='';
      showSelected(intakeWizard.files);
    });
    showSelected(selectedFiles());
    input?.addEventListener('change', () => {
      const files = Array.from(input.files || []);
      if (typeof intakeWizard === 'object') intakeWizard.files = files;
      showSelected(files);
    });
  }

  function mountWhatsAppImport(form) {
    const panel = document.createElement('details');
    panel.innerHTML = `
      <summary>وارد واتساب</summary>
      <p class="small-copy">صدّر المحادثة مع الوسائط. فك ضغط التصدير إن لزم، ثم اختر ملف النص وأرفق التسجيلات من قسم المرفقات.</p>
      <label>ملف المحادثة <input type="file" accept=".txt,text/plain" data-chat></label>
      <label>ترتيب التاريخ <select data-order><option value="dmy">يوم / شهر / سنة</option><option value="mdy">شهر / يوم / سنة</option></select></label>
      <button type="button" class="btn btn-sm" data-read-chat>قراءة المحادثة</button>
      <p role="status" data-chat-status></p>
      <div data-chat-review hidden>
        <label>مرسل الشكوى أو الاستفسار <select data-sender></select></label>
        <div data-transcripts></div>
        <button type="button" class="btn btn-sm" data-apply-chat>نقل الملخص إلى النموذج</button>
      </div>`;
    form.prepend(panel);
    const status = $('[data-chat-status]', panel);
    const review = $('[data-chat-review]', panel);
    const sender = $('[data-sender]', panel);
    const transcriptFields = $('[data-transcripts]', panel);
    let parsed;
    function clearPreview() {
      parsed = null;
      review.hidden = true;
      status.textContent = '';
      transcriptFields.replaceChildren();
    }
    panel.addEventListener('change', event => {
      if (event.target.matches('[data-chat], [data-order]')) clearPreview();
    });
    $('[data-read-chat]', panel).addEventListener('click', async event => {
      const button = event.currentTarget;
      clearPreview();
      const file = $('[data-chat]', panel).files[0];
      const order = $('[data-order]', panel).value;
      if (!file || file.size > 2_000_000) {
        status.textContent = 'اختر ملف نص حجمه لا يتجاوز 2 ميغابايت.';
        return;
      }
      button.disabled = true;
      try {
        const raw = await file.text();
        if (!form.isConnected || file !== $('[data-chat]', panel).files[0] ||
            order !== $('[data-order]', panel).value) return;
        parsed = parseWhatsAppExport(raw, { dateOrder: order });
        sender.replaceChildren(new Option('اختر المرسل', ''));
        for (const name of new Set(parsed.messages.map(message => message.sender).filter(Boolean))) {
          sender.add(new Option(name, name));
        }
        for (const message of parsed.messages.filter(message => message.audio)) {
          const label = document.createElement('label');
          label.className = 'form-field';
          label.textContent = message.sender + ' · ' + message.attachmentName + ' — تفريغ يدوي اختياري';
          const input = document.createElement('textarea');
          input.className = 'textarea-field';
          input.dataset.messageId = message.id;
          input.maxLength = 2000;
          label.append(input);
          transcriptFields.append(label);
        }
        const omitted = parsed.messages.filter(message => message.mediaOmitted).length;
        status.textContent = 'عدد الرسائل ' + parsed.messages.length + ' · وسائط غير مضمّنة ' + omitted;
        review.hidden = false;
      } catch (error) {
        status.textContent = error.message;
      } finally {
        button.disabled = false;
      }
    });
    $('[data-apply-chat]', panel).addEventListener('click', () => {
      if (!parsed || intakeSavePending) return;
      try {
        const transcripts = Object.fromEntries(Array.from(
          transcriptFields.querySelectorAll('textarea'),
          input => [input.dataset.messageId, input.value]
        ));
        const result = summarizeWhatsAppExport(parsed, { citizenSender: sender.value, transcripts });
        intakeCollectVisible();
        const data = intakeWizard.data;
        const summary = result.summary.replace(/\s+/g, ' ').trim();
        if (result.suggestedType && !data.cSummary) intakeWizard.recordType = result.suggestedType;
        data.cSummary ||= summary.slice(0, 180);
        data.cDetails ||= result.summary;
        data.cSource = 'whatsapp';
        data.cPhone ||= result.phone || '';
        if (result.firstVisibleDate) data.cFirstContactDate = result.firstVisibleDate;
        renderIntakeWizard();
        $('#intakeAdditional')?.setAttribute('open', '');
        notify('راجع الملخص والتاريخ وأرفق الملفات قبل الحفظ.' +
          (result.untranscribedAudio.length ? ' تسجيلات دون تفريغ: ' + result.untranscribedAudio.length : ''));
      } catch (error) {
        status.textContent = error.message;
      }
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
          accept=".pdf,.jpg,.jpeg,.png,.webp,.gif,.doc,.docx,.xls,.xlsx,.txt,.csv,.opus,.ogg">
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
          const preview=/^image\/(jpeg|png|webp|gif)$/.test(a.mime||'')||a.mime==='application/pdf';
          return (preview?`<button type="button" class="attach-chip" data-action="attachment-preview" data-file="${escapeHtml(a.storedName)}" data-name="${escapeHtml(name)}" data-mime="${escapeHtml(a.mime)}">معاينة ${escapeHtml(name)} <small>${size}</small></button>`:'')+
            `<a class="attach-chip link" href="/api/attachments/${encodeURIComponent(a.storedName)}" target="_blank" rel="noopener">تنزيل ${escapeHtml(name)} <small>${size}</small></a> <button class="btn btn-sm" type="button" data-action="owner-attachment-delete" data-id="${escapeHtml(complaintId)}" data-file="${escapeHtml(a.storedName)}">حذف</button>`;
        })
        .join('');
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
