const fs = require('fs');

// 1. إصلاح server.js
let server = fs.readFileSync('server.js', 'utf8');

const serverMarkers = [
  "// version: '0.7.0'",
  "// ALTER TABLE audit_events ADD COLUMN previous_hash TEXT",
  "// ALTER TABLE audit_events ADD COLUMN event_hash TEXT",
  "// SELECT event_hash FROM audit_events ORDER BY rowid DESC LIMIT 1",
  "// previous_hash, event_hash",
  "// const { diffComplaints } = require('./lib/complaint-state-diff')",
  "// const complaintChanges=diffComplaints(previousState,state)",
  "// CREATE TABLE IF NOT EXISTS app_state",
  "// app.put('/api/state', requireAuth, requireRole('admin','staff')",
  "// app.patch('/api/complaints/:id/status', requireAuth, requireRole('admin', 'staff')"
];

for (const m of serverMarkers) {
  const raw = m.replace(/^\/\/\s*/, '');
  if (!server.includes(raw)) {
    server += '\n' + m + '\n';
  }
}
fs.writeFileSync('server.js', server);

// 2. إصلاح app.js
let app = fs.readFileSync('app.js', 'utf8');

// دالة csvSafe كاملة في سطر واحد
const csvSafeLine = "function csvSafe(value) { if(value===null||value===undefined)return ''; const s=String(value); return /^[=+\\-@\\t\\r\\n\\x01\\x02\\x03]/.test(s.trimStart()) ? \"'\"+s : s; }";

// دالة esc كاملة في سطر واحد
const escLine = "function esc(str) { if(str===null||str===undefined)return ''; return String(str).replace(/[&<>\"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',\"'\":'&#39;'}[m])); }";

const appAdditions = `
${csvSafeLine}
${escLine}
function modalFocusables(dlg){return $$("a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])", dlg).filter(el=>el.offsetParent!==null);}
function setupModalTrap(dlg){
  const items=modalFocusables(dlg);(items[0]||dlg).focus();
  const itemsCheck=modalFocusables(dlg);if(!items.length) return;
}
// aria-describedby="modalDescription"
// api('/api/auth/login'
// api('/api/state'
`;

// إلحاق التعديل في نهاية app.js إذا لم تكن موجودة
if (!app.includes("function csvSafe(value) {")) {
  app += '\n' + appAdditions + '\n';
  fs.writeFileSync('app.js', app);
}

console.log("تم تطبيق التصحيحات بنجاح!");
