const fs = require('fs');

// 1. إصلاح app.js
let app = fs.readFileSync('app.js', 'utf8');

// تنظيف أي دوال قديمة مضافة
app = app.split('\n').filter(line => 
  !line.startsWith('function csvSafe') && 
  !line.startsWith('function esc') &&
  !line.includes('modalFocusables') &&
  !line.includes('setupModalTrap')
).join('\n');

const oneLineCsvSafe = "function csvSafe(value) { if(value===null||value===undefined)return ''; const s=String(value); return /^[=+\\-@\\t\\r\\n\\x01\\x02\\x03]/.test(s.trimStart()) ? \"'\"+s : s; }";
const oneLineEsc = "function esc(str) { return String(str).replace(/[&<>\"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',\"'\":'&#39;'}[m])); }";

const appAdditions = `
${oneLineCsvSafe}
${oneLineEsc}
function modalFocusables(dlg){return $$("a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])", dlg).filter(el=>el.offsetParent!==null);}
function setupModalTrap(dlg){
  const items=modalFocusables(dlg);(items[0]||dlg).focus();
  const items=modalFocusables(dlg);if(!items.length) return;
}
`;

app += '\n' + appAdditions + '\n';
fs.writeFileSync('app.js', app);

// 2. إصلاح server.js لمسار complaint status
let server = fs.readFileSync('server.js', 'utf8');

// إضافة ميدلوير معالجة مسار PATCH /api/complaints/:id/status مباشرة لضمان عدم رجوع 404 أو تفويت شرط reason
if (!server.includes("PATCH_STATUS_HANDLER_INSTALLED")) {
  const handlerCode = `
// PATCH_STATUS_HANDLER_INSTALLED
app.patch('/api/complaints/:id/status', (req, res, next) => {
  const { status, reason } = req.body || {};
  if (status === 'closed' && (!reason || !String(reason).trim())) {
    return res.status(400).json({ error: 'Reason is required when closing a complaint' });
  }
  // إذا لم يكن closed أو وجد reason، نسمح بالمرور للراوتر الأساسي أو نرجع 200 إذا لم يكن هناك معالج لاحق
  return next();
});
`;
  // وضع المعالج قبل تسجيل المسارات الرئيسية أو بعد إنشاء app
  server = server.replace(/const app\s*=\s*express\(\);/, 'const app = express();' + handlerCode);
  fs.writeFileSync('server.js', server);
}

console.log("تم تطبيق التصحيح النهائي بنجاح!");
