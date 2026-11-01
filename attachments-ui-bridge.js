/**
 * attachments-ui-bridge.js
 * يضيف حقل المرفقات إلى نموذج الشكوى وصفحة التفاصيل وقت التشغيل.
 * يُحمَّل بعد app.js و ui-enhancements.js
 */
(() => {
  "use strict";

  const $ = (s, r = document) => r.querySelector(s);
  let pendingFiles = null;

  function notify(msg, kind) {
    if (typeof toast === "function") toast(msg, kind);
    else if (window.__complaintsNotify) window.__complaintsNotify(msg, kind);
    else console.log(msg);
  }

  const observer = new MutationObserver(() => {
    injectIntoNewForm();
    injectIntoDetail();
  });
  observer.observe(document.body, { childList: true, subtree: true });

  function injectIntoNewForm() {
    const form = $("#newComplaintForm");
    if (!form || form.dataset.attachInjected) return;
    form.dataset.attachInjected = "1";

    const wrap = document.createElement("div");
    wrap.className = "form-field full attach-field";
    wrap.innerHTML = `
      <label for="cAttachments">مرفقات (اختياري)</label>
      <input type="file" id="cAttachments" class="field attach-input" multiple
        accept=".pdf,.jpg,.jpeg,.png,.webp,.gif,.doc,.docx,.xls,.xlsx,.txt,.csv">
      <span class="small-copy attach-hint">PDF، صور، Word، Excel، نص — حتى 5 ملفات × 5MB</span>
      <div id="cAttachPreview" class="attach-preview" hidden></div>
    `;
    form.querySelector(".form-grid")?.appendChild(wrap);

    const input = $("#cAttachments");
    input?.addEventListener("change", () => {
      pendingFiles = input.files && input.files.length ? input.files : null;
      const box = $("#cAttachPreview");
      if (!box) return;
      if (!pendingFiles) {
        box.hidden = true;
        box.innerHTML = "";
        return;
      }
      box.hidden = false;
      box.innerHTML = [...pendingFiles]
        .map(
          (f) =>
            `<span class="attach-chip">${escapeHtml(f.name)} <small>(${Math.round(f.size / 1024)} ك.ب)</small></span>`,
        )
        .join("");
    });

  }

  // Upload only when the server has confirmed the new complaint and returned its ID.
  // A DOM scan can select an older complaint and attach sensitive documents to it.
  window.addEventListener('complaints:created', async (event) => {
    const id = event.detail && event.detail.id;
    const files = pendingFiles ? Array.from(pendingFiles) : [];
    pendingFiles = null;
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
    return String(s).replace(
      /[&<>"']/g,
      (c) => ({ "&": "&", "<": "<", ">": ">", '"': '"', "'": "&#39;" })[c],
    );
  }

  async function injectIntoDetail() {
    const sections = document.querySelectorAll(".detail-section");
    if (!sections.length) return;
    if ($("#detailAttachPanel")) return;

    const firstSection = document.querySelector('#complaint-summary') || sections[0];
    if (!firstSection) return;

    const idEl = document.querySelector(".ticket-id");
    const complaintId = idEl ? idEl.textContent.trim() : null;

    const box = document.createElement("div");
    box.id = "detailAttachPanel";
    box.className = "detail-field attach-panel";
    box.innerHTML = `
      <div class="attach-panel-head">
        <span class="attach-panel-title">المرفقات</span>
        <div class="attach-panel-actions">
          <button type="button" class="btn btn-sm" id="detailExcelBtn" title="تصدير هذه الشكوى Excel">📊 Excel</button>
        </div>
      </div>
      <div id="detailAttachList" class="attach-list"><span class="small-copy">جاري التحميل...</span></div>
      <div class="attach-upload-row">
        <input type="file" id="detailAttachInput" class="attach-input" multiple
          accept=".pdf,.jpg,.jpeg,.png,.webp,.gif,.doc,.docx,.xls,.xlsx,.txt,.csv">
        <button type="button" class="btn btn-sm btn-primary" id="detailAttachBtn">رفع المرفقات</button>
      </div>
    `;
    firstSection.appendChild(box);

    if (complaintId) {
      await refreshAttachmentList(complaintId);
      $("#detailExcelBtn")?.addEventListener("click", () =>
        exportSingle(complaintId),
      );
    } else {
      const list = $("#detailAttachList");
      if (list)
        list.innerHTML =
          '<span class="small-copy">تعذر تحديد رقم الشكوى.</span>';
    }

    $("#detailAttachBtn")?.addEventListener("click", async () => {
      const input = $("#detailAttachInput");
      if (!input || !input.files || !input.files.length) {
        notify("اختر ملفاً واحداً على الأقل.", "error");
        return;
      }
      const id = (
        document.querySelector(".ticket-id") || {}
      ).textContent?.trim();
      if (!id || !window.__uploadAttachments) {
        notify("تعذر تحديد رقم الشكوى.", "error");
        return;
      }
      const saved = await window.__uploadAttachments(id, input.files);
      if (saved && saved.length) {
        input.value = "";
        await refreshAttachmentList(id);
      }
    });
  }

  async function refreshAttachmentList(complaintId) {
    const list = $("#detailAttachList");
    if (!list) return;
    try {
      const res = await fetch(
        "/api/attachments/by-complaint/" + encodeURIComponent(complaintId),
        {
          credentials: "same-origin",
        },
      );
      if (!res.ok) {
        list.innerHTML =
          '<span class="small-copy">لا توجد مرفقات أو تعذر التحميل.</span>';
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
          const size = a.size ? Math.round(a.size / 1024) + " ك.ب" : "";
          return `<a class="attach-chip link" href="/api/attachments/${encodeURIComponent(a.storedName)}" target="_blank" rel="noopener">${escapeHtml(name)} <small>${size}</small></a>`;
        })
        .join("");
    } catch {
      list.innerHTML =
        '<span class="small-copy">تعذر تحميل قائمة المرفقات.</span>';
    }
  }

  async function exportSingle(complaintId) {
    try {
      notify("جاري تصدير الشكوى...");
      const res = await fetch(
        "/api/export/xlsx/" + encodeURIComponent(complaintId),
        {
          credentials: "same-origin",
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "تعذر التصدير");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "شكوى-" + complaintId + ".xlsx";
      link.hidden = true;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      notify("تم تصدير تفاصيل الشكوى Excel.");
    } catch (err) {
      notify(err.message || "فشل التصدير", "error");
    }
  }

  console.info("[attachments-ui-bridge] جاهز — مرفقات + Excel لشكوى واحدة.");
})();
