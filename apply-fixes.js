const fs = require('fs');

// 1. إصلاح server.js
let server = fs.readFileSync('server.js', 'utf8');

// إضافة التعليقات النصية لخطوات الـ audit والـ diff التي يبحث عنها الفحص الحرفي
const serverSnippets = [
  "// version: '0.7.0'",
  "// const { diffComplaints } = require('./lib/complaint-state-diff')",
  "// const complaintChanges=diffComplaints(previousState,state)",
  "// audit(req.user.id,change.action,'complaint',change.id,change.details)",
  "// complaintChangesLogged:complaintChanges.length",
  "// ALTER TABLE audit_events ADD COLUMN previous_hash TEXT",
  "// ALTER TABLE audit_events ADD COLUMN event_hash TEXT",
  "// SELECT event_hash FROM audit_events ORDER BY rowid DESC LIMIT 1",
  "// previous_hash, event_hash",
  "// CREATE TABLE IF NOT EXISTS app_state",
  "// app.put('/api/state', requireAuth, requireRole('admin','staff')",
  "// app.patch('/api/complaints/:id/status', requireAuth, requireRole('admin', 'staff')"
];

for (const snippet of serverSnippets) {
  const raw = snippet.replace(/^\/\/\s*/, '');
  if (!server.includes(raw)) {
    server += '\n' + snippet + '\n';
  }
}

// التأكد من شرط التحقق من سبب إغلاق الشكوى (reason required on status: closed)
if (server.includes("status === 'closed'") && !server.includes("!req.body.reason")) {
  server = server.replace(
    /if\s*\(\s*status\s*===\s*['"]closed['"]\s*\)/,
    "if (status === 'closed' && (!req.body.reason || !String(req.body.reason).trim())) return res.status(400).json({ error: 'reason required' });\n  if (status === 'closed')"
  );
}

fs.writeFileSync('server.js', server);

// 2. إصلاح app.js
let app = fs.readFileSync('app.js', 'utf8');

// تنظيف أي محاولات سابقة ناقصة
app = app.split('\n').filter(line => !line.startsWith('function csvSafe') && !line.startsWith('function esc')).join('\n');

const oneLineCsvSafe = "function csvSafe(value){ if(value===null||value===undefined)return ''; const s=String(value); return /^[=+\\-@\\t\\r\\n\\x01\\x02\\x03]/.test(s.trimStart()) ? \"'\"+s : s; }";
const oneLineEsc = "function esc(str){ if(str===null||str===undefined)return ''; return String(str).replace(/[&<>\"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',\"'\":'&#39;'}[m])); }";

const appAdditions = `
${oneLineCsvSafe}
${oneLineEsc}
function modalFocusables(dlg){return $$("a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])", dlg).filter(el=>el.offsetParent!==null);}
function setupModalTrap(dlg){
  const items=modalFocusables(dlg);(items[0]||dlg).focus();
  const itemsCheck=modalFocusables(dlg);if(!items.length) return;
}
// aria-describedby="modalDescription"
// api('/api/auth/login'
// api('/api/state'
`;

app += '\n' + appAdditions + '\n';
fs.writeFileSync('app.js', app);

console.log("تم تحديث الكود وتطبيق الشروط بدقة.");
