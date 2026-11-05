/* Live duplicate override — name + phone + summary with toast */
(function(){
  function install(){
    if (typeof duplicateCheck !== 'function') return;
    window.duplicateCheck = function duplicateCheck() {
      const phone = phoneNorm(($('#cPhone') && $('#cPhone').value) || (intakeWizard && intakeWizard.data && intakeWizard.data.cPhone) || '');
      const name = norm(($('#cName') && $('#cName').value) || (intakeWizard && intakeWizard.data && intakeWizard.data.cName) || '');
      const text = norm(($('#cSummary') && $('#cSummary').value) || (intakeWizard && intakeWizard.data && intakeWizard.data.cSummary) || '');
      const matches = [];
      const seen = {};
      const reasons = [];
      (db.complaints || []).forEach(function(c){
        if (!c || c.archivedAt) return;
        const hits = [];
        if (phone && phone.length >= 7 && phoneNorm(c.phone) === phone) hits.push('رقم الهاتف');
        if (name && name.length >= 3 && norm(c.name) === name) hits.push('الاسم');
        if (text.length >= 9 && norm(c.summary).includes(text)) hits.push('الموضوع');
        if (!hits.length || seen[c.id]) return;
        seen[c.id] = true;
        matches.push({ c: c, hits: hits });
        hits.forEach(function(h){ if (reasons.indexOf(h) < 0) reasons.push(h); });
      });
      const phoneEl = $('#cPhone');
      const nameEl = $('#cName');
      if (phoneEl) phoneEl.classList.toggle('field-dup-warn', !!(phone && phone.length >= 7 && matches.some(function(m){ return m.hits.indexOf('رقم الهاتف') >= 0; })));
      if (nameEl) nameEl.classList.toggle('field-dup-warn', !!(name && name.length >= 3 && matches.some(function(m){ return m.hits.indexOf('الاسم') >= 0; })));
      let mount = $('#duplicateMount');
      if (!mount) {
        const form = $('#newComplaintForm');
        if (form) {
          mount = document.createElement('div');
          mount.id = 'duplicateMount';
          mount.className = 'form-field full';
          form.appendChild(mount);
        }
      }
      if (!mount) return;
      if (!matches.length) { mount.innerHTML = ''; return; }
      const reasonText = reasons.join(' و');
      mount.innerHTML = '<div class="risk-note intake-dup-alert" role="alert"><strong>تنبيه تكرار فوري:</strong> هذا ' + esc(reasonText) +
        ' موجود مسبقاً في ' + matches.length + ' سجل.<div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:6px">' +
        matches.slice(0, 6).map(function(m){
          return '<button class="btn btn-sm" type="button" data-action="detail" data-id="' + esc(m.c.id) + '">' +
            esc(m.c.id) + ' · ' + esc(m.c.summary || m.c.name || 'بدون موضوع') +
            ' <small>(' + esc(m.hits.join(' + ')) + ')</small></button>';
        }).join('') + '</div></div>';
      const sig = reasons.join('|') + ':' + matches.map(function(m){ return m.c.id; }).slice(0, 3).join(',');
      if (window.__lastDupSig !== sig) {
        window.__lastDupSig = sig;
        toast('تنبيه: ' + reasonText + ' مكرر — راجع السجلات المشابهة.', 'warn');
      }
    };
    if (!document.getElementById('intake-dup-styles')) {
      const s = document.createElement('style');
      s.id = 'intake-dup-styles';
      s.textContent = '.field-dup-warn{border-color:#8b3a3a!important;box-shadow:0 0 0 3px rgba(139,58,58,.18)!important;background:#fff8f8!important}.intake-dup-alert{border:1px solid #c98a8a;background:#fdf2f2;color:#5c2b2b}.intake-dup-alert strong{color:#8b3a3a}';
      document.head.appendChild(s);
    }
    document.addEventListener('input', function(e){
      if (!e.target || !e.target.id) return;
      if (['cName','cPhone','cSummary'].indexOf(e.target.id) >= 0) {
        if (window.intakeWizard && intakeWizard.data) intakeWizard.data[e.target.id] = e.target.value;
        if (typeof duplicateCheck === 'function') duplicateCheck();
      }
    }, true);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  else setTimeout(install, 0);
})();
