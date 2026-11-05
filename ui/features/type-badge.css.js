/* Inject type badge styles for inquiry vs complaint pills */
(function(){
  if(document.getElementById('type-badge-styles')) return;
  const s=document.createElement('style');
  s.id='type-badge-styles';
  s.textContent=
    '.pill-inquiry{background:#e8f0fa!important;color:#1e4a7a!important;border:1px solid #b7c9e0;}'+
    '.pill-complaint{background:#eef3ea!important;color:#1E3A2E!important;border:1px solid #b8bda8;}'+
    'td .pill-inquiry,td .pill-complaint{font-size:11px;font-weight:700;white-space:nowrap;}';
  document.head.appendChild(s);
})();
