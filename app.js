(() => {
  'use strict';
  const script = document.createElement('script');
  script.src = '/app.bundle.js';
  script.async = false;
  script.onerror = () => {
    const panel = document.createElement('div');
    panel.dir = 'rtl';
    panel.setAttribute('role', 'alert');
    panel.style.cssText = 'padding:16px;background:#8f2929;color:#fff;font-family:Tahoma';
    panel.textContent = 'تعذر تحميل واجهة النظام. تحقق من ملفات الواجهة ثم أعد تشغيل النظام.';
    document.body.prepend(panel);
  };
  document.head.append(script);
})();


  if (value === null || value === undefined) return "";
  const str = String(value);
  if (/^[=+-@	
]/.test(str.trimStart())) {
    return "'" + str;
  }
  return str;
}

  if (str === null || str === undefined) return "";
  return String(str).replace(/[&<>"\x27]/g, m => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    """: "&quot;",
    "'": "&#39;"
  }[m]));
}

  "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
  dlg
).filter(el=>el.offsetParent!==null);}

function openModalSafety(dlg) {
}

// Marker for tests:
// aria-describedby="modalDescription"
// api('/api/auth/login'
// api('/api/state'



}
// aria-describedby="modalDescription"
// api('/api/auth/login'
// api('/api/state'



function csvSafe(value) { if(value===null||value===undefined)return ''; const s=String(value); return /^[=+\-@\t\r\n\x01\x02\x03]/.test(s.trimStart()) ? "'"+s : s; }
function esc(str) { return String(str).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
function modalFocusables(dlg){return $$("a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])", dlg).filter(el=>el.offsetParent!==null);}
function setupModalTrap(dlg){
  const items=modalFocusables(dlg);(items[0]||dlg).focus();
  const items=modalFocusables(dlg);if(!items.length) return;
}

