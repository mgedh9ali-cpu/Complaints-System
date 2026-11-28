/**
 * Compact attachments UI for intake + detail (no oversized native file controls).
 */
(() => {
  'use strict';
  if (typeof MutationObserver !== 'function' || !document.body) return;
  const $ = (s, r = document) => r.querySelector(s);

  function notify(msg, kind) {
    if (typeof toast === 'function') toast(msg, kind);
    else if (window.__complaintsNotify) window.__complaintsNotify(msg, kind);
    else console.log(msg);
  }

  const audioUrls = new Map();
  const transcriptionJobs = new Map();
  const supportedAttachments = /\.(pdf|jpe?g|png|webp|gif|docx?|xlsx?|txt|csv|opus|ogg)$/i;

  function isAttachableFile(file) {
    return file.size > 0 && file.size <= 5 * 1024 * 1024 && supportedAttachments.test(file.name);
  }

  function mergeIntakeFiles(existing, added) {
    const files = new Map(existing.map(file => [file.name + ':' + file.size + ':' + file.lastModified, file]));
    for (const file of added) files.set(file.name + ':' + file.size + ':' + file.lastModified, file);
    return Array.from(files.values());
  }

  function showAudioPlayer(button, bytes) {
    if (!button.isConnected) return;
    const player = document.createElement('audio');
    player.controls = true;
    player.setAttribute('aria-label', button.textContent);
    const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/ogg' }));
    audioUrls.set(player, url);
    player.src = url;
    button.replaceWith(player);
    player.addEventListener('error', () => notify('تعذّر تشغيل هذا التسجيل.', 'error'), { once: true });
    player.play().catch(() => {});
  }

  const observer = new MutationObserver(() => {
    for (const [audio, url] of audioUrls) {
      if (audio.isConnected) continue;
      audio.pause();
      URL.revokeObjectURL(url);
      audioUrls.delete(audio);
    }
    for (const [button, controller] of transcriptionJobs) {
      if (!button.isConnected) controller.abort();
    }
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
      const files = mergeIntakeFiles(selectedFiles(), Array.from(input.files || []));
      input.value = '';
      if (files.length > 5) {
        notify('يسمح السجل بخمسة مرفقات. أزل مرفقًا قبل إضافة المزيد.', 'error');
        return;
      }
      if (typeof intakeWizard === 'object') intakeWizard.files = files;
      showSelected(files);
    });
  }

  function mountWhatsAppImport(form) {
    if (typeof parseWhatsAppExport !== 'function' || typeof summarizeWhatsAppExport !== 'function') return;
    const panel = document.createElement('details');
    panel.className = 'intake-additional';
    panel.innerHTML = '<summary>وارد واتساب</summary>' +
      '<div class="form-grid">' +
      '<p class="form-field full small-copy">صدّر المحادثة من واتساب أعمال مع الوسائط. فك ضغط التصدير إن لزم، ثم اختر ملف النص وملفات الوسائط التي تريد مراجعتها.</p>' +
      '<label class="form-field">ملف المحادثة <input type="file" accept=".txt,text/plain" data-chat></label>' +
      '<label class="form-field">ترتيب التاريخ <select class="select-field" data-order><option value="dmy">يوم / شهر / سنة</option><option value="mdy">شهر / يوم / سنة</option></select></label>' +
      '<div class="form-field full"><button type="button" class="btn btn-sm" data-read-chat>قراءة المحادثة</button></div>' +
      '<p class="form-field full small-copy" role="status" data-chat-status></p></div>' +
      '<div data-chat-review hidden>' +
      '<label class="form-field">مرسل الشكوى أو الاستفسار <select class="select-field" data-sender></select></label>' +
      '<label class="form-field">وسائط التصدير <input type="file" multiple data-media></label>' +
      '<label><input type="checkbox" data-archive> إرفاق ملف المحادثة الأصلي بالسجل</label>' +
      '<div data-media-chosen></div><div data-transcripts></div>' +
      '<p class="small-copy" data-transcription-mode></p>' +
      '<button type="button" class="btn btn-sm" data-preview-chat>معاينة الملخص</button>' +
      '<div data-summary-review hidden><label class="form-field">الملخص المقترح <textarea class="textarea-field" rows="5" maxlength="10000" data-summary></textarea></label>' +
      '<p class="small-copy" data-summary-meta></p>' +
      '<label class="form-field" hidden data-transcript-archive-label><span><input type="checkbox" data-transcript-archive> إرفاق النص الكامل للتفريغ</span></label>' +
      '<button type="button" class="btn btn-primary btn-sm" data-apply-chat>نقل المعلومات إلى النموذج</button></div></div>';
    form.prepend(panel);
    const find = selector => $(selector, panel);
    const chatInput = find('[data-chat]');
    const mediaInput = find('[data-media]');
    const status = find('[data-chat-status]');
    const review = find('[data-chat-review]');
    const summaryReview = find('[data-summary-review]');
    const sender = find('[data-sender]');
    const transcripts = find('[data-transcripts]');
    const mediaChosen = find('[data-media-chosen]');
    const mode = find('[data-transcription-mode]');
    let parsed;
    let proposal;
    let canTranscribe = false;

    requestApi('/api/whatsapp/transcription').then(response => {
      canTranscribe = response.available;
      mode.textContent = canTranscribe ? 'راجع نص التفريغ الآلي قبل اعتماده.' :
        'التفريغ اليدوي متاح. لتفعيل التفريغ الآلي المحلي راجع إعداد Whisper في دليل المستودع.';
      refreshTranscriptionButtons();
    }).catch(() => {
      mode.textContent = 'يمكن كتابة التفريغ يدويًا أثناء الاستماع.';
    });

    function invalidateSummary() {
      proposal = null;
      summaryReview.hidden = true;
    }
    function refreshTranscriptionButtons() {
      for (const button of transcripts.querySelectorAll('[data-transcribe]')) button.hidden = !canTranscribe;
    }
    function clearPreview() {
      parsed = null;
      invalidateSummary();
      review.hidden = true;
      status.textContent = '';
      sender.replaceChildren();
      transcripts.replaceChildren();
      mediaChosen.replaceChildren();
      mediaInput.value = '';
      find('[data-archive]').checked = false;
    }
    function showAudioChoices() {
      // Preserve typed transcripts while replacing selected media.
      const previous = new Map(Array.from(transcripts.querySelectorAll('textarea'), field =>
        [field.dataset.messageId, field.value]));
      transcripts.replaceChildren();
      mediaChosen.replaceChildren();
      const files = Array.from(mediaInput.files);
      const attachmentNameKey = name => name.normalize('NFC').toLowerCase();
      const audioFilesByName = new Map();
      for (const [index, file] of files.entries()) {
        const row = document.createElement('label');
        row.className = 'form-field';
        const include = document.createElement('input');
        include.type = 'checkbox';
        include.dataset.mediaIndex = index;
        include.disabled = !isAttachableFile(file);
        include.checked = !include.disabled;
        row.append(include, file.name + (include.disabled ? ' — غير مدعوم أو يتجاوز 5 ميغابايت' : ''));
        mediaChosen.append(row);
        if (!include.disabled && /\.(opus|ogg)$/i.test(file.name)) {
          const key = attachmentNameKey(file.name);
          audioFilesByName.set(key, audioFilesByName.has(key) ? null : file);
        }
      }

      for (const message of parsed.messages.filter(message => message.audio)) {
        const row = document.createElement('div');
        row.className = 'form-field';
        const label = document.createElement('label');
        label.textContent = message.sender + ' · ' + (message.attachmentName || 'تسجيل غير مضمّن') + ' — تفريغ اختياري';
        const input = document.createElement('textarea');
        input.className = 'textarea-field';
        input.dataset.messageId = message.id;
        input.maxLength = 10000;
        input.rows = 2;
        input.value = previous.get(String(message.id)) || '';
        label.append(input);
        row.append(label);
        const file = message.attachmentName && audioFilesByName.get(attachmentNameKey(message.attachmentName));
        if (file) {
          const play = document.createElement('button');
          play.type = 'button';
          play.className = 'btn btn-sm';
          play.textContent = 'تشغيل التسجيل';
          play.addEventListener('click', () => showAudioPlayer(play, file));
          row.append(play);
          const transcribe = document.createElement('button');
          transcribe.type = 'button';
          transcribe.className = 'btn btn-sm';
          transcribe.textContent = 'تفريغ آلي بالعربية';
          transcribe.dataset.transcribe = '';
          const feedback = document.createElement('p');
          feedback.className = 'small-copy';
          feedback.setAttribute('role', 'status');
          transcribe.addEventListener('click', async () => {
            if (transcriptionJobs.size || (input.value.trim() && !window.confirm('استبدال التفريغ الحالي؟'))) return;
            const controller = new AbortController();
            transcriptionJobs.set(transcribe, controller);
            transcribe.disabled = true;
            input.readOnly = true;
            invalidateSummary();
            feedback.textContent = 'جارٍ التفريغ على هذا الجهاز…';
            try {
              const result = await requestApi('/api/whatsapp/transcription', {
                method: 'POST',
                headers: { 'Content-Type': 'audio/ogg' },
                body: file,
                signal: controller.signal
              });
              if (!row.isConnected) return;
              input.value = result.transcript.slice(0, input.maxLength);
              feedback.textContent = 'راجع النص قبل اعتماده.' +
                (result.transcript.length > input.maxLength ? ' بلغ النص الحد الأقصى للحقل.' : '');
              invalidateSummary();
            } catch (error) {
              if (!controller.signal.aborted) feedback.textContent = error.message;
            } finally {
              transcriptionJobs.delete(transcribe);
              transcribe.disabled = false;
              input.readOnly = false;
            }
          });
          row.append(transcribe, feedback);
        } else if (message.attachmentName) {
          const hint = document.createElement('small');
          hint.textContent = 'اختر ملف Opus/Ogg المطابق للاسم لتشغيله هنا.';
          row.append(hint);
        }
        transcripts.append(row);
      }
      refreshTranscriptionButtons();
    }

    panel.addEventListener('change', event => {
      if (event.target.matches('[data-chat], [data-order]')) clearPreview();
      if (event.target === mediaInput && parsed) showAudioChoices();
      if (event.target === sender || event.target === mediaInput) invalidateSummary();
    });
    transcripts.addEventListener('input', invalidateSummary);

    find('[data-read-chat]').addEventListener('click', async event => {
      const button = event.currentTarget;
      clearPreview();
      const file = chatInput.files[0];
      const order = find('[data-order]').value;
      if (!file || file.size > 2_000_000) {
        status.textContent = 'اختر ملف نص حجمه لا يتجاوز 2 ميغابايت.';
        return;
      }
      button.disabled = true;
      try {
        const raw = await file.text();
        if (!form.isConnected || file !== chatInput.files[0] || order !== find('[data-order]').value) return;
        parsed = parseWhatsAppExport(raw, { dateOrder: order });
        sender.replaceChildren(new Option('اختر المرسل', ''));
        for (const name of new Set(parsed.messages.map(message => message.sender).filter(Boolean))) {
          sender.add(new Option(name, name));
        }
        showAudioChoices();
        status.textContent = 'عدد الرسائل ' + parsed.messages.length +
          ' · وسائط لم تدخل في التصدير ' + parsed.messages.filter(message => message.mediaOmitted).length;
        review.hidden = false;
      } catch (error) {
        status.textContent = error.message;
      } finally {
        button.disabled = false;
      }
    });

    find('[data-preview-chat]').addEventListener('click', () => {
      if (!parsed || Array.from(transcriptionJobs.keys()).some(button => panel.contains(button))) {
        status.textContent = 'انتظر اكتمال التفريغ قبل معاينة الملخص.';
        return;
      }
      if (!sender.value) {
        status.textContent = 'اختر مرسل الشكوى أو الاستفسار.';
        sender.focus();
        return;
      }
      const textByMessage = Object.fromEntries(Array.from(transcripts.querySelectorAll('textarea'),
        input => [input.dataset.messageId, input.value]));
      proposal = summarizeWhatsAppExport(parsed, { citizenSender: sender.value, transcripts: textByMessage });
      find('[data-summary]').value = proposal.details;
      const hasTranscripts = Object.values(textByMessage).some(text => text.trim());
      find('[data-transcript-archive-label]').hidden = !hasTranscripts;
      find('[data-transcript-archive]').checked = false;
      const meta = [
        proposal.suggestedType && 'النوع المقترح: ' + intakeTypes[proposal.suggestedType],
        proposal.firstVisibleDate && 'أول رسالة ظاهرة للمرسل: ' + proposal.firstVisibleDate,
        proposal.untranscribedAudio.length && 'تسجيلات دون تفريغ: ' + proposal.untranscribedAudio.length,
        !proposal.summary && 'اكتب الملخص يدويًا إذا كان الطلب واردًا بالصوت فقط.'
      ].filter(Boolean);
      find('[data-summary-meta]').textContent = meta.join(' · ');
      summaryReview.hidden = false;
      status.textContent = '';
    });

    find('[data-apply-chat]').addEventListener('click', () => {
      if (!proposal || intakeSavePending) return;
      intakeCollectVisible();
      const data = intakeWizard.data;
      const edited = find('[data-summary]').value.trim();
      const titleText = edited === proposal.details ? proposal.summary : edited.replace(/^مقتطفات من رسائل مقدم الطلب\s*/, '');
      const title = titleText.trim().split(/\r?\n/, 1)[0].replace(/\s+/g, ' ').trim();
      if (!String(data.cSummary || '').trim() && !title) {
        status.textContent = 'اكتب ملخصًا للطلب قبل نقله إلى النموذج.';
        find('[data-summary]').focus();
        return;
      }
      const files = Array.from(mediaChosen.querySelectorAll('input:checked'),
        input => mediaInput.files[Number(input.dataset.mediaIndex)]);
      if (find('[data-archive]').checked) {
        const original = chatInput.files[0];
        files.push(new File([original], original.name, { type: 'text/plain', lastModified: original.lastModified }));
      }
      if (find('[data-transcript-archive]').checked) {
        const voices = new Map(parsed.messages.filter(message => message.audio).map(message => [message.id, message]));
        const fullText = Array.from(transcripts.querySelectorAll('textarea')).filter(field => field.value.trim())
          .map(field => {
            const message = voices.get(Number(field.dataset.messageId));
            return [message.date || message.dateRaw, message.timeRaw, message.sender,
              message.attachmentName || 'تسجيل', '\n' + field.value.trim()].join(' · ');
          }).join('\n\n');
        const transcriptFile = new File([fullText], 'تفريغ-واتساب.txt', { type: 'text/plain' });
        if (!isAttachableFile(transcriptFile)) {
          status.textContent = 'ملف التفريغ الكامل يتجاوز الحد المسموح. أزل تحديد إرفاقه أو اختصر النص.';
          return;
        }
        files.push(transcriptFile);
      }
      const allFiles = mergeIntakeFiles(intakeWizard.files, files);
      if (allFiles.length > 5) {
        status.textContent = 'يسمح السجل بخمسة مرفقات. أزل تحديد بعض الملفات ثم حاول مجددًا.';
        return;
      }
      const details = [data.cDetails?.trim(), edited].filter(Boolean);
      const combined = Array.from(new Set(details)).join('\n\n');
      if (combined.length > 10000) {
        status.textContent = 'التفاصيل تتجاوز 10000 حرف. اختصر الملخص قبل نقله.';
        return;
      }
      if (proposal.suggestedType && !String(data.cSummary || '').trim()) intakeWizard.recordType = proposal.suggestedType;
      if (!String(data.cSummary || '').trim()) data.cSummary = title.length > 180 ? title.slice(0, 179) + '…' : title;
      data.cDetails = combined;
      data.cSource = 'whatsapp';
      if (!data.cName && !proposal.phone) data.cName = sender.value.slice(0, 120);
      data.cPhone ||= proposal.phone || '';
      data.cFirstContactDate = proposal.firstVisibleDate || '';
      intakeWizard.whatsappImported = true;
      intakeWizard.files = allFiles;
      renderIntakeWizard();
      $('#intakeAdditional')?.setAttribute('open', '');
      saveComplaintDraft();
      notify('راجع معلومات واتساب والمرفقات ثم احفظ السجل.');
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
          const audio = /\.(opus|ogg)$/i.test(a.storedName);
          const audioButton = audio ? '<button type="button" class="btn btn-sm" data-play-attachment="' +
            escapeHtml(a.storedName) + '">تشغيل ' + escapeHtml(name) + '</button>' : '';
          return audioButton + (preview?`<button type="button" class="attach-chip" data-action="attachment-preview" data-file="${escapeHtml(a.storedName)}" data-name="${escapeHtml(name)}" data-mime="${escapeHtml(a.mime)}">معاينة ${escapeHtml(name)} <small>${size}</small></button>`:'')+
            `<a class="attach-chip link" href="/api/attachments/${encodeURIComponent(a.storedName)}" target="_blank" rel="noopener">تنزيل ${escapeHtml(name)} <small>${size}</small></a> <button class="btn btn-sm" type="button" data-action="owner-attachment-delete" data-id="${escapeHtml(complaintId)}" data-file="${escapeHtml(a.storedName)}">حذف</button>`;
        })
        .join('');
      for (const button of list.querySelectorAll('[data-play-attachment]')) {
        button.addEventListener('click', async () => {
          button.disabled = true;
          try {
            const response = await fetch('/api/attachments/' + encodeURIComponent(button.dataset.playAttachment));
            if (!response.ok) throw new Error();
            showAudioPlayer(button, await response.blob());
          } catch {
            notify('تعذر تشغيل التسجيل.', 'error');
            button.disabled = false;
          }
        });
      }
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
