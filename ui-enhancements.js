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
      region.style.cssText = 'position:fixed;z-index:12000;inset-inline-start:18px;bottom:18px;display:grid;gap:8px;max-width:min(420px,calc(100vw - 36px))';
      document.body.append(region);
    }
    const toast = document.createElement('div');
    toast.textContent = message;
    toast.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    toast.style.cssText = 'padding:12px 15px;border-radius:10px;background:' + (kind === 'error' ? '#8f2929' : '#153d34') + ';color:#fff;box-shadow:0 8px 28px #0002;font-size:13px;line-height:1.6';
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
    } catch (_) { return null; }
  }

  window.__complaintsCsrf = {
    getToken: () => csrfToken,
    refresh: fetchCsrf,
    headers: () => (csrfToken ? { 'X-CSRF-Token': csrfToken } : {})
  };

  /** Upload files for a complaint */
  window.__uploadAttachments = async function(complaintId, fileList) {
    if (!complaintId || !fileList || fileList.length === 0) {
      notify('اختر ملفاً واحداً على الأقل.', 'error');
      return null;
    }
    await fetchCsrf();
    const form = new FormData();
    for (const f of fileList) form.append('files', f);
    const res = await fetch('/api/attachments/' + encodeURIComponent(complaintId), {
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

  function applyTheme(theme, announce = false) {
    const selected = theme === 'dark' ? 'dark' : 'light';
    document.documentElement.dataset.theme = selected;
    try { localStorage.setItem(THEME_KEY, selected); } catch (_) {}
    const button = $('#themeToggle');
    if (button) {
      button.setAttribute('aria-pressed', String(selected === 'dark'));
      button.textContent = selected === 'dark' ? '☀ الوضع الفاتح' : '☾ الوضع الداكن';
    }
    if (announce) notify(selected === 'dark' ? 'تم تفعيل الوضع الداكن.' : 'تم تفعيل الوضع الفاتح.');
  }

  async function exportXlsx() {
    try {
      notify('جاري تجهيز ملف Excel...');
      const res = await fetch('/api/export/xlsx', { credentials: 'same-origin' });
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

  async function exportFromApi() {
    try {
      const res = await fetch('/api/export/csv', { credentials: 'same-origin' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'تعذر التصدير');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'complaints-export-' + new Date().toISOString().slice(0, 10) + '.csv';
      link.hidden = true;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      notify('تم تصدير CSV بنجاح.');
    } catch (err) {
      notify(err.message || 'فشل التصدير', 'error');
    }
  }

  function requestNotificationPermission() {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'default') {
      Notification.requestPermission().then(p => {
        if (p === 'granted') notify('تم تفعيل إشعارات المتصفح.');
      });
    }
  }

  function checkSlaNotifications() {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const lateBadges = document.querySelectorAll('[data-late="true"], .status-late, .late');
    if (lateBadges.length > 0) {
      new Notification('تنبيه SLA', {
        body: `يوجد ${lateBadges.length} شكوى متأخرة أو قاربت على الانتهاء.`,
        dir: 'rtl', lang: 'ar'
      });
    }
  }

  function setupAdvancedSearch() {
    if ($('#advancedSearchBox')) return;
    const content = $('#content');
    if (!content) return;
    const box = document.createElement('div');
    box.id = 'advancedSearchBox';
    box.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin:12px 0;align-items:center';
    box.innerHTML = `
      <input id="advSearchText" placeholder="بحث برقم / هاتف / اسم / ملخص..." style="flex:1;min-width:180px;padding:8px 12px;border-radius:8px;border:1px solid #cbd7d2">
      <select id="advSearchStatus" style="padding:8px;border-radius:8px;border:1px solid #cbd7d2">
        <option value="">كل الحالات</option>
        <option value="new">جديدة</option>
        <option value="in_progress">قيد المعالجة</option>
        <option value="awaiting_reply">بانتظار رد</option>
        <option value="awaiting_approval">بانتظار اعتماد</option>
        <option value="closed">مغلقة</option>
      </select>
      <button type="button" id="advSearchBtn" class="btn btn-primary">بحث</button>
      <button type="button" id="advSearchClear" class="btn">مسح</button>
    `;
    content.prepend(box);

    const runFilter = () => {
      const q = ($('#advSearchText')?.value || '').trim().toLowerCase();
      const st = $('#advSearchStatus')?.value || '';
      const rows = content.querySelectorAll('table tbody tr');
      let visible = 0;
      rows.forEach(row => {
        const text = row.innerText.toLowerCase();
        const statusMatch = !st || text.includes(st);
        const textMatch = !q || text.includes(q);
        const show = statusMatch && textMatch;
        row.style.display = show ? '' : 'none';
        if (show) visible++;
      });
      notify('عدد النتائج: ' + visible);
    };

    $('#advSearchBtn')?.addEventListener('click', runFilter);
    $('#advSearchClear')?.addEventListener('click', () => {
      if ($('#advSearchText')) $('#advSearchText').value = '';
      if ($('#advSearchStatus')) $('#advSearchStatus').value = '';
      content.querySelectorAll('table tbody tr').forEach(r => r.style.display = '');
    });
    $('#advSearchText')?.addEventListener('keydown', e => { if (e.key === 'Enter') runFilter(); });
  }

  function addTools() {
    const host = $('.top-actions');
    if (!host) return;

    if (!$('#themeToggle')) {
      const theme = document.createElement('button');
      theme.type = 'button';
      theme.id = 'themeToggle';
      theme.className = 'ui-tool-button';
      theme.addEventListener('click', () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark', true));
      host.insertBefore(theme, host.firstChild);
      let saved = 'light';
      try { saved = localStorage.getItem(THEME_KEY) || 'light'; } catch (_) {}
      applyTheme(saved);
    }

    // Excel export button
    if (!$('#excelExportBtn')) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.id = 'excelExportBtn';
      btn.className = 'ui-tool-button';
      btn.textContent = '📊 Excel';
      btn.title = 'تصدير تقرير Excel كامل';
      btn.addEventListener('click', exportXlsx);
      host.insertBefore(btn, host.firstChild);
    }

    const csvApiBtn = $('#csvExportButton');
    if (csvApiBtn && !csvApiBtn.dataset.bound) {
      csvApiBtn.dataset.bound = '1';
      csvApiBtn.hidden = false;
      csvApiBtn.addEventListener('click', exportFromApi);
    }
  }

  function addPasswordToggle() {
    const input = $('#loginPassword');
    if (!input || $('#toggleLoginPassword')) return;
    const wrapper = document.createElement('div');
    wrapper.className = 'ui-login-password-wrap';
    input.parentNode.insertBefore(wrapper, input);
    wrapper.append(input);
    const button = document.createElement('button');
    button.type = 'button';
    button.id = 'toggleLoginPassword';
    button.className = 'ui-password-toggle';
    button.textContent = 'إظهار';
    button.addEventListener('click', () => {
      const visible = input.type === 'password';
      input.type = visible ? 'text' : 'password';
      button.textContent = visible ? 'إخفاء' : 'إظهار';
      input.focus();
    });
    wrapper.append(button);
  }

  function start() {
    addTools();
    addPasswordToggle();
    fetchCsrf();
    requestNotificationPermission();
    setInterval(fetchCsrf, 10 * 60 * 1000);
    setInterval(checkSlaNotifications, 5 * 60 * 1000);

    const observer = new MutationObserver(() => {
      addTools();
      addPasswordToggle();
      if ($('#content table') && !$('#advancedSearchBox')) setupAdvancedSearch();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
