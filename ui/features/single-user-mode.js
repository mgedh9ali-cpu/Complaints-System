/**
 * Single-operator mode: this installation is used by one person only.
 * Hides account creation, multi-user permissions UI, and collaborative wording.
 * Server APIs stay intact; only the operator UI is simplified.
 */
(function singleUserMode(){
  const NOTE = ''; // لوحة تشغيل فردي مخفية بطلب المستخدم

  function stripMultiUserFromSettingsHtml(html){
    if(typeof html !== 'string') return html;
    // Remove local accounts management panel
    html = html.replace(
      /<section class="panel"[^>]*>\s*<div class="panel-header"><div><h2>إدارة الحسابات المحلية[\s\S]*?<\/section>/,
      ''
    );
    // Remove permissions matrix panel (common titles)
    html = html.replace(
      /<section class="panel"[^>]*>\s*<div class="panel-header"><div><h2>[^<]*صلاحيات[^<]*<\/h2>[\s\S]*?<\/section>/,
      ''
    );
    // Soften manual sync between two installs (keep export for backup portability, reword)
    html = html.replace(
      /<h2>المزامنة اليدوية بين النسختين<\/h2><p>نقل يدوي فقط، دون اتصال بين الجهازين<\/p>/,
      '<h2>نقل البيانات لجهاز آخر</h2><p>اختياري — لنسخ العمل إلى جهازك الثاني فقط، وليس لمشاركة مع موظفين</p>'
    );
    html = html.replace(
      'الاستيراد يستبدل بيانات النسخة الحالية؛ احتفظ بنسخة احتياطية أولًا.',
      'استخدمه فقط إذا أردت نقل نسختك لجهاز آخر تملكه. احتفظ بنسخة احتياطية أولًا.'
    );
    // Insert single-user note once near top of settings content
    if(NOTE && html.indexOf('تشغيل فردي') < 0){
      const marker = '<section class="panel"';
      const idx = html.indexOf(marker);
      if(idx >= 0) html = html.slice(0, idx) + NOTE + html.slice(idx);
      else html = NOTE + html;
    }
    return html;
  }

  function wrapSettingsPage(){
    if(typeof settingsPage !== 'function' || settingsPage.__singleUserWrapped) return;
    const orig = settingsPage;
    function wrapped(){
      return stripMultiUserFromSettingsHtml(orig.apply(this, arguments));
    }
    wrapped.__singleUserWrapped = true;
    settingsPage = wrapped;
  }

  function wrapUserManagement(){
    if(typeof userManagementPanel === 'function'){
      userManagementPanel = function(){ return ''; };
    }
    if(typeof permissionsPanel === 'function'){
      const orig = permissionsPanel;
      permissionsPanel = function(){
        // Keep empty for single user — no matrix to assign others
        return '';
      };
      permissionsPanel.__orig = orig;
    }
  }

  function blockAccountActions(e){
    const el = e.target && e.target.closest && e.target.closest('[data-action]');
    if(!el) return;
    const action = el.getAttribute('data-action');
    const blocked = {
      'create-local-user': 'إنشاء الحسابات مُعطّل — النظام لمستخدم واحد فقط.',
      'toggle-local-user': 'إدارة الأعضاء مُعطّلة — لا يوجد مستخدمون آخرون.',
      'refresh-local-users': null
    };
    if(!(action in blocked)) return;
    e.preventDefault();
    e.stopPropagation();
    if(blocked[action] && typeof toast === 'function') toast(blocked[action], 'warn');
  }

  function softenConflictCopy(){
    // Soften multi-user conflict dialogs if they appear (same browser/session race)
    const origModal = typeof modal === 'function' ? modal : null;
    if(!origModal || origModal.__singleUserWrapped) return;
    function wrapped(title, subtitle, body, footer, wide){
      if(typeof title === 'string'){
        title = title.replace(/زميلك/g, 'نسخة أخرى');
      }
      if(typeof subtitle === 'string'){
        subtitle = subtitle.replace(/زميلك/g, 'نسخة أخرى من نفس الجلسة');
      }
      if(typeof body === 'string'){
        body = body
          .replace(/خذ نسخة زميلك/g, 'خذ النسخة الأخرى')
          .replace(/زميلك/g, 'النسخة الأخرى');
      }
      if(typeof footer === 'string'){
        footer = footer
          .replace(/خذ نسخة زميلك كاملة/g, 'اعتماد النسخة الأخرى')
          .replace(/زميلك/g, 'النسخة الأخرى');
      }
      return origModal(title, subtitle, body, footer, wide);
    }
    wrapped.__singleUserWrapped = true;
    modal = wrapped;
  }

  function install(){
    wrapUserManagement();
    wrapSettingsPage();
    softenConflictCopy();
    document.addEventListener('click', blockAccountActions, true);
  }

  install();
  setTimeout(install, 0);
  setTimeout(install, 100);
  document.addEventListener('DOMContentLoaded', install);
})();
