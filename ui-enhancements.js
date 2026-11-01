(() => {
  'use strict';
  const THEME_KEY = 'complaints-ui-theme-v1';
  const $ = (selector, root = document) => root.querySelector(selector);
  let csrfToken = null;

  function notify(message, kind = 'success') {
    let region = $('#toastRegion') || $('#uiEnhancementToasts');
    if (!region) {
      region = document.createElement('div');
      region.id = 'uiEnhancementToasts';
      region.setAttribute('aria-live', 'polite');
      region.style.cssText =
        'position:fixed;z-index:12000;inset-inline-start:18px;bottom:18px;display:grid;gap:8px;max-width:min(420px,calc(100vw - 36px))';
      document.body.append(region);
    }
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    toast.style.cssText =
      'padding:12px 15px;border-radius:12px;background:' +
      (kind === 'error' ? '#8f2929' : '#153d34') +
      ';color:#fff;box-shadow:0 8px 28px #0002;font-size:13px;line-height:1.6';
    region.append(toast);
    window.setTimeout(() => toast.remove(), 4000);
  }

  async function fetchCsrf() {
    try {
      const res = await fetch('/api/csrf', { credentials: 'same-origin' });
      if (!res.ok) return null;
      const data = await res.json();
      csrfToken = data.csrfToken;
      return csrfToken;
    } catch (_) {
      return null;
    }
  }

  window.__complaintsCsrf = {
    getToken: () => csrfToken,
    refresh: fetchCsrf,
    headers: () => (csrfToken ? { 'X-CSRF-Token': csrfToken } : {})
  };

  // Patch fetch so app.full.js PUT /api/state and other writes send CSRF
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async function patchedFetch(input, init) {
    const opts = init ? { ...init } : {};
    const method = String(opts.method || 'GET').toUpperCase();
    let url = typeof input === 'string' ? input : input && input.url;
    if (
      url &&
      String(url).indexOf('/api/') !== -1 &&
      method !== 'GET' &&
      method !== 'HEAD'
    ) {
      if (!csrfToken) await fetchCsrf();
      const headers = new Headers(opts.headers || (input && input.headers) || {});
      if (csrfToken && !headers.has('X-CSRF-Token')) {
        headers.set('X-CSRF-Token', csrfToken);
      }
      opts.headers = headers;
      if (!opts.credentials) opts.credentials = 'same-origin';
    }
    return nativeFetch(input, opts);
  };

  window.__uploadAttachments = async function (complaintId, fileList) {
    if (!complaintId || !fileList || fileList.length === 0) {
      notify('اختر ملفاً واحداً على الأقل.', 'error');
      return null;
    }
    await fetchCsrf();
    const form = new FormData();
    for (const f of fileList) form.append('files', f);
    const res = await nativeFetch('/api/attachments/' + encodeURIComponent(complaintId), {
      method: 'POST',
      credentials: 'same-origin',
      headers: window.__complaintsCsrf.headers(),
      body: form
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      notify(data.error || 'فشل رفع المرفقات', 'error');
      return null;
    }
    notify('تم رفع ' + (data.attachments?.length || 0) + ' مرفق بنجاح.');
    return data.attachments;
  };

  async function apiJson(url, options = {}) {
    await fetchCsrf();
    const headers = {
      'Content-Type': 'application/json',
      ...(window.__complaintsCsrf.headers() || {}),
      ...(options.headers || {})
    };
    const res = await nativeFetch(url, {
      credentials: 'same-origin',
      ...options,
      headers
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'فشل الطلب');
    return data;
  }

  window.__complaintActions = {
    async saveDraft(body) {
      return apiJson('/api/complaints', {
        method: 'POST',
        body: JSON.stringify({ ...body, asDraft: true })
      });
    },
    async update(id, body) {
      return apiJson('/api/complaints/' + encodeURIComponent(id), {
        method: 'PATCH',
        body: JSON.stringify(body)
      });
    },
    async remove(id) {
      return apiJson('/api/complaints/' + encodeURIComponent(id), { method: 'DELETE' });
    },
    async setStatus(id, status, reason) {
      return apiJson('/api/complaints/' + encodeURIComponent(id) + '/status', {
        method: 'PATCH',
        body: JSON.stringify({ status, reason })
      });
    }
  };

  // Intercept status changes so UI uses server machine (not local-only persist)
  document.addEventListener(
    'click',
    async (ev) => {
      const btn = ev.target.closest('[data-action="change-status"]');
      if (!btn) return;
      const id =
        btn.getAttribute('data-id') ||
        document.querySelector('.ticket-id')?.textContent?.trim();
      const next = document.querySelector('#detailStatus')?.value;
      const reason = document.querySelector('#statusReason')?.value?.trim() || '';
      if (!id || !next) return;
      ev.preventDefault();
      ev.stopPropagation();
      try {
        await window.__complaintActions.setStatus(id, next, reason);
        notify('تم تحديث الحالة على الخادم');
        setTimeout(() => location.reload(), 500);
      } catch (err) {
        notify(err.message || 'تعذر تغيير الحالة', 'error');
      }
    },
    true
  );

  function applyTheme(theme, announce = false) {
    const selected = theme === 'dark' ? 'dark' : 'light';
    document.documentElement.dataset.theme = selected;
    try {
      localStorage.setItem(THEME_KEY, selected);
    } catch (_) {}
    const button = $('#themeToggle');
    if (button) {
      button.setAttribute('aria-pressed', String(selected === 'dark'));
      button.textContent = selected === 'dark' ? 'الوضع الفاتح' : 'الوضع الداكن';
    }
    if (announce) notify(selected === 'dark' ? 'تم تفعيل الوضع الداكن.' : 'تم تفعيل الوضع الفاتح.');
  }

  async function exportXlsx() {
    try {
      notify('جاري تجهيز ملف Excel...');
      const res = await nativeFetch('/api/export/xlsx', { credentials: 'same-origin' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'تعذر التصدير');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'تقرير-الشكاوى-' + new Date().toISOString().slice(0, 10) + '.xlsx';
      link.hidden = true;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      notify('تم تصدير تقرير Excel بنجاح.');
    } catch (err) {
      notify(err.message || 'فشل تصدير Excel', 'error');
    }
  }

  function enhanceActionCells() {
    document.querySelectorAll('table tbody tr').forEach((row) => {
      if (row.dataset.actionsBound) return;
      const idCell = row.querySelector('.ticket-id, [data-id]');
      let id = idCell?.getAttribute('data-id') || idCell?.textContent?.trim();
      if (!id || !/^SY-/i.test(id)) {
        const text = row.innerText || '';
        const m = text.match(/SY-\d{4}-[0-9a-f-]{8}/i);
        id = m ? m[0] : null;
      }
      if (!id) return;
      row.dataset.actionsBound = '1';
      let cell = row.querySelector('.action-cell');
      if (!cell) {
        cell = document.createElement('td');
        cell.className = 'action-cell';
        row.append(cell);
      }
      if (cell.querySelector('[data-act]')) return;
      const wrap = document.createElement('div');
      wrap.className = 'row-actions';
      wrap.innerHTML =
        '<button type="button" class="btn btn-sm" data-act="edit">تعديل</button>' +
        '<button type="button" class="btn btn-sm" data-act="draft">مسودة</button>' +
        '<button type="button" class="btn btn-sm btn-danger" data-act="delete">حذف</button>';
      cell.append(wrap);
      wrap.addEventListener('click', async (ev) => {
        const btn = ev.target.closest('[data-act]');
        if (!btn) return;
        const act = btn.getAttribute('data-act');
        try {
          if (act === 'delete') {
            if (!confirm('حذف الشكوى ' + id + '؟')) return;
            await window.__complaintActions.remove(id);
            notify('تم الحذف');
            row.remove();
          } else if (act === 'draft') {
            await window.__complaintActions.setStatus(id, 'draft');
            notify('أُعيدت كمسودة');
          } else if (act === 'edit') {
            const summary = prompt('تعديل الملخص (اتركه فارغاً للإلغاء):');
            if (summary == null) return;
            if (!summary.trim()) return;
            await window.__complaintActions.update(id, { summary: summary.trim() });
            notify('تم التعديل');
          }
        } catch (err) {
          notify(err.message || 'فشلت العملية', 'error');
        }
      });
    });
  }

  function addTools() {
    const host = $('.top-actions');
    if (!host) return;
    if (!$('#themeToggle')) {
      const theme = document.createElement('button');
      theme.type = 'button';
      theme.id = 'themeToggle';
      theme.className = 'ui-tool-button';
      theme.addEventListener('click', () =>
        applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark', true)
      );
      host.insertBefore(theme, host.firstChild);
      let saved = 'light';
      try {
        saved = localStorage.getItem(THEME_KEY) || 'light';
      } catch (_) {}
      applyTheme(saved);
    }
    if (!$('#excelExportBtn')) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.id = 'excelExportBtn';
      btn.className = 'ui-tool-button';
      btn.textContent = 'Excel';
      btn.addEventListener('click', exportXlsx);
      host.insertBefore(btn, host.firstChild);
    }
  }

  // Non-destructive enhancements for dynamically rendered complaint tables and forms.
  function enhanceWorkspace() {
    document.querySelectorAll('.table-wrap').forEach((wrap) => {
      if (!wrap.hasAttribute('tabindex')) wrap.tabIndex = 0;
      if (!wrap.hasAttribute('role')) wrap.setAttribute('role', 'region');
      if (!wrap.hasAttribute('aria-label')) wrap.setAttribute('aria-label', 'جدول قابل للتمرير أفقياً');
    });
    document.querySelectorAll('table').forEach((table) => {
      if (!table.querySelector('thead')) return;
      const heads = Array.from(table.querySelectorAll('thead th'));
      heads.forEach((head) => { if (!head.hasAttribute('scope')) head.setAttribute('scope', 'col'); });
      table.querySelectorAll('tbody tr').forEach((row) => {
        Array.from(row.children).forEach((cell, index) => {
          if (cell.tagName !== 'TD' || cell.hasAttribute('data-label')) return;
          const heading = heads[index]?.textContent?.trim();
          if (heading) cell.setAttribute('data-label', heading);
        });
      });
    });
    document.querySelectorAll('input, select, textarea').forEach((field) => {
      if (field.hasAttribute('aria-label') || field.hasAttribute('aria-labelledby')) return;
      if (field.labels && field.labels.length) return;
      const label = field.closest('.form-field')?.querySelector('label');
      const name = label?.textContent?.trim();
      if (name) field.setAttribute('aria-label', name);
    });
    document.querySelectorAll('.modal').forEach((modal) => {
      if (modal.hasAttribute('aria-label') || modal.hasAttribute('aria-labelledby')) return;
      const heading = modal.querySelector('.modal-header h2, h2');
      if (!heading) return;
      if (!heading.id) heading.id = 'ui-modal-title-' + Math.random().toString(36).slice(2, 10);
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      modal.setAttribute('aria-labelledby', heading.id);
    });
  }

  function enhanceRegistry() {
    const search = $('#complaintSearch');
    if (!search) return;
    search.setAttribute('autocomplete', 'off');
    search.setAttribute('aria-keyshortcuts', 'Control+k');
    const tools = search.closest('.table-tools');
    if (!tools) return;
    if (!tools.querySelector('#uiRegistryHint')) {
      const hint = document.createElement('span');
      hint.id = 'uiRegistryHint';
      hint.className = 'ui-registry-hint';
      hint.textContent = 'بحث مباشر · Ctrl + K';
      tools.append(hint);
    }
    if (!tools.querySelector('#uiClearSearch')) {
      const clear = document.createElement('button');
      clear.id = 'uiClearSearch';
      clear.type = 'button';
      clear.className = 'btn btn-sm ui-clear-search';
      clear.textContent = 'مسح البحث';
      clear.setAttribute('aria-label', 'مسح نص البحث');
      clear.addEventListener('click', () => {
        const current = $('#complaintSearch');
        if (!current) return;
        current.value = '';
        current.dispatchEvent(new Event('input', { bubbles: true }));
        $('#complaintSearch')?.focus();
      });
      tools.append(clear);
    }
    const clear = tools.querySelector('#uiClearSearch');
    if (clear) clear.hidden = !search.value;
    const footer = document.querySelector('.table-panel .table-footer');
    if (footer && !footer.hasAttribute('aria-live')) {
      footer.setAttribute('aria-live', 'polite');
      footer.setAttribute('aria-atomic', 'true');
    }
  }

  function wireShell() {
    const toggle = $('#menuToggle');
    const sidebar = $('#sidebar');
    const backdrop = $('#navBackdrop');
    if (!toggle || !sidebar || !backdrop) return;
    function closeMenu(restoreFocus = false) {
      if (!sidebar.classList.contains('open')) return;
      sidebar.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
      if (restoreFocus) toggle.focus();
    }
    backdrop.addEventListener('click', () => closeMenu(true));
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && sidebar.classList.contains('open')) {
        event.preventDefault();
        closeMenu(true);
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k' &&
          document.body.dataset.signedIn === 'true') {
        event.preventDefault();
        const complaintPage = document.querySelector('[data-page="complaints"]');
        if (complaintPage) complaintPage.click();
        document.querySelector('#complaintSearch')?.focus();
      }
    });
  }

  function start() {
    wireShell();
    addTools();
    fetchCsrf();
    enhanceActionCells();
    enhanceWorkspace();
    enhanceRegistry();
    const observer = new MutationObserver(() => {
      addTools();
      enhanceActionCells();
      enhanceWorkspace();
      enhanceRegistry();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
