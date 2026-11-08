'use strict';
/* The interface is served from one design system.
 *
 * Six stylesheets used to be shipped next to the active ones without being
 * loaded, and the components they styled rendered unstyled. This file guards
 * the consolidation: the retired sheets stay retired, every sheet the page
 * loads exists and is served, the service worker keeps the same set offline,
 * and the components that were orphaned keep their rules. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const exists = name => fs.existsSync(path.join(root, name));

const RETIRED_SHEETS = ['styles.css', 'redesign.css', 'palette.css', 'ui-prod.css', 'ui-enhancements.css', 'ui-compat.css'];

function linkedStylesheets() {
  return [...read('index.html').matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)].map(match => match[1]);
}

function activeStylesheetText() {
  return linkedStylesheets().map(sheet => read(sheet)).join('\n');
}

test('the retired stylesheets stay retired', () => {
  for (const sheet of RETIRED_SHEETS) {
    assert.equal(exists(sheet), false, sheet + ' must not return to the repository');
    assert.doesNotMatch(read('index.html'), new RegExp(sheet.replace('.', '\\.')), sheet + ' must not be linked by the page');
    assert.doesNotMatch(read('server.js'), new RegExp(sheet.replace('.', '\\.')), sheet + ' must not be served');
  }
});

test('every stylesheet the page loads exists and is served locally', () => {
  const sheets = linkedStylesheets();
  assert.ok(sheets.length >= 5, 'the page must load the design system sheets');
  for (const sheet of sheets) {
    assert.equal(exists(sheet), true, sheet + ' must exist on disk');
    assert.ok(read('server.js').includes("'" + '/' + sheet + "': '" + sheet + "'"), sheet + ' must be served by the local server');
  }
});

test('the offline cache covers every stylesheet the page loads', () => {
  const worker = read('sw.js');
  for (const sheet of linkedStylesheets()) {
    assert.ok(worker.includes("'" + '/' + sheet + "'"), sheet + ' must be cached for offline use');
  }
  assert.ok(worker.includes("'/app.js'"));
  assert.ok(worker.includes("'/ui-enhancements.js'"));
});

test('the components that lost their stylesheet keep their rules', () => {
  const css = activeStylesheetText();
  const components = [
    '.task-list', '.task-row', '.task-symbol', '.task-copy', '.task-value',
    '.approval-stamp', '.command-list', '.conflict-diff', '.glass-inline-menu',
    '.permission-list', '.permission-option', '.dp-progress-title', '.dp-actions',
    '.dp-error-note', '.dp-step-mark', '.attach-hint', '.attach-panel-title',
    '.notice-item.is-read', '.backup-panel', '.update-steps', '.restore-steps',
    '.ui-login-password-wrap', '.login-eye-slash', '.ui-registry-hint',
    '.ui-clear-search', '.detail-title', '.setting-value', '.danger-text',
    '.report-trend', '.modal.wide', '.toast.warn', '.pill.draft', '.top-create-button',
    '.sidebar-bottom', '.reason-sheet', '.login-password-toggle'
  ];
  for (const component of components) {
    assert.ok(css.includes(component), component + ' must be styled by the active design system');
  }
});

test('the active design system keeps its own contracts', () => {
  const css = read('ui-system.css');
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /prefers-reduced-transparency/);
  assert.match(css, /html\[data-theme="dark"\]/);
  assert.match(css, /@media print/);
  assert.doesNotMatch(css, /https?:\/\//, 'the design system must not reference a remote resource');
  // !important stays reserved for print, reduced-motion and [hidden] handling.
  let context = '';
  for (const line of css.split('\n')) {
    const media = line.match(/@media([^{]+)\{/);
    if (media) context = media[1];
    if (!line.includes('!important') || /^\s*\*/.test(line)) {
      if (line.includes('}') && !line.includes('{')) context = '';
      continue;
    }
    assert.ok(
      /print|reduced-motion|reduced-transparency/.test(context) || /\[hidden\]/.test(line),
      '!important is reserved for print, reduced motion and hidden handling: ' + line.trim(),
    );
    if (line.includes('}') && !line.includes('{')) context = '';
  }
  assert.match(css, /--focus:/, 'the design system must publish a focus colour');
  assert.match(css, /:focus-visible/, 'the design system must publish a visible focus ring');
});

test('the stylesheet layer stays a single system', () => {
  const sheets = linkedStylesheets().filter(sheet => sheet.endsWith('.css'));
  const sizes = sheets.map(sheet => ({ sheet, size: fs.statSync(path.join(root, sheet)).size }));
  const total = sizes.reduce((sum, entry) => sum + entry.size, 0);
  assert.ok(total < 200000, 'the loaded stylesheets must stay below 200 KB, found ' + total);
  assert.equal(exists('ui-system.css'), true);
});
