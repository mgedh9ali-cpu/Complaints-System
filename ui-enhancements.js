(() => {
  'use strict';
  const THEME_KEY = 'complaints-ui-theme-v1';
  const $ = (selector, root = document) => root.querySelector(selector);

  function notify(message, kind = 'success') {
    let region = $('#toastRegion');
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
    window.setTimeout(() => toast.remove(), 3600);
  }

  function applyTheme(theme, announce = false) {
    const selected = theme === 'dark' ? 'dark' : 'light';
    document.documentElement.dataset.theme = selected;
    try { localStorage.setItem(THEME_KEY, selected); } catch (_) {}
    const button = $('#themeToggle');
    if (button) {
      button.setAttribute('aria-pressed', String(selected === 'dark'));
      button.setAttribute('aria-label', selected === 'dark' ? 'تفعيل الوضع الفاتح' : 'تفعيل الوضع الداكن');
      button.textContent = selected === 'dark' ? '☀ الوضع الفاتح' : '☾ الوضع الداكن';
    }
    if (announce) notify(selected === 'dark' ? 'تم تفعيل الوضع الداكن.' : 'تم تفعيل الوضع الفاتح.');
  }

  function safeCsvCell(value) {
    let text = String(value ?? '').replace(/\r?\n/g, ' ').trim();
    if (/^[=+@\-\t]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  }

  function exportVisibleTable() {
    const table = $('#content table');
    if (!table) {
      notify('لا يوجد جدول في الصفحة الحالية لتصديره.', 'error');
      return;
    }
    const rows = [...table.querySelectorAll('tr')].filter(row => {
      const style = window.getComputedStyle(row);
      return style.display !== 'none' && style.visibility !== 'hidden' && row.getClientRects().length > 0;
    }).map(row => [...row.querySelectorAll('th,td')].map(cell => safeCsvCell(cell.innerText)));
    if (rows.length < 2) {
      notify('لا توجد سجلات ظاهرة قابلة للتصدير.', 'error');
      return;
    }
    const csv = '\uFEFF' + rows.map(row => row.join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'complaints-report-' + new Date().toISOString().slice(0, 10) + '.csv';
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify('تم تجهيز ملف CSV من الصفوف الظاهرة في الجدول.');
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
    if (!$('#exportVisibleCsv')) {
      const exportButton = document.createElement('button');
      exportButton.type = 'button';
      exportButton.id = 'exportVisibleCsv';
      exportButton.className = 'ui-tool-button';
      exportButton.textContent = 'تصدير CSV';
      exportButton.title = 'تصدير صفوف الجدول الظاهرة فقط';
      exportButton.addEventListener('click', exportVisibleTable);
      const theme = $('#themeToggle');
      host.insertBefore(exportButton, theme ? theme.nextSibling : host.firstChild);
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
    button.setAttribute('aria-label', 'إظهار كلمة المرور');
    button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', () => {
      const visible = input.type === 'password';
      input.type = visible ? 'text' : 'password';
      button.textContent = visible ? 'إخفاء' : 'إظهار';
      button.setAttribute('aria-label', visible ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور');
      button.setAttribute('aria-pressed', String(visible));
      input.focus();
    });
    wrapper.append(button);
  }

  function start() {
    addTools();
    addPasswordToggle();
    const observer = new MutationObserver(() => {
      addTools();
      addPasswordToggle();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('beforeprint', () => {
      document.documentElement.dataset.printTheme = document.documentElement.dataset.theme || 'light';
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();