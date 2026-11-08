/* أيقونة تبديل الثيم (فاتح/داكن) في الشريط العلوي */
(function(){
  const KEY='complaints-ui-theme-v1';
  function currentTheme(){
    const d=document.documentElement.dataset.theme;
    if(d==='dark'||d==='light') return d;
    try{return localStorage.getItem(KEY)||'light';}catch(_){return 'light';}
  }
  function moonSvg(){
    return '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 14.5A8.5 8.5 0 0 1 9.5 3 7 7 0 1 0 21 14.5Z"/></svg>';
  }
  function sunSvg(){
    return '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  }
  window.applyUiTheme=function(theme, announce){
    const selected=theme==='dark'?'dark':'light';
    document.documentElement.dataset.theme=selected;
    try{localStorage.setItem(KEY,selected);}catch(_){}
    const btn=$('#themeIconToggle');
    if(btn){
      const dark=selected==='dark';
      btn.setAttribute('aria-pressed',String(dark));
      btn.setAttribute('aria-label',dark?'التبديل إلى الوضع الفاتح':'التبديل إلى الوضع الداكن');
      btn.title=dark?'الوضع الفاتح':'الوضع الداكن';
      btn.innerHTML=dark?sunSvg():moonSvg();
      btn.classList.toggle('is-dark',dark);
    }
    const legacy=$('#themeToggle');
    if(legacy){
      legacy.setAttribute('aria-pressed',String(selected==='dark'));
      legacy.textContent=selected==='dark'?'الوضع الفاتح':'الوضع الداكن';
    }
    if(announce&&typeof toast==='function') toast(selected==='dark'?'تم تفعيل الوضع الداكن.':'تم تفعيل الوضع الفاتح.');
  };
  window.toggleUiTheme=function(){
    applyUiTheme(currentTheme()==='dark'?'light':'dark', true);
  };
  window.mountThemeIcon=function(){
    if($('#themeIconToggle')) { applyUiTheme(currentTheme()); return; }
    const host=$('.top-actions');
    if(!host) return;
    const b=document.createElement('button');
    b.type='button';
    b.id='themeIconToggle';
    b.className='theme-icon-toggle';
    b.dataset.action='toggle-theme';
    host.insertBefore(b, host.firstChild);
    applyUiTheme(currentTheme());
  };
  function startTheme(){
    try{window.mountThemeIcon();}catch(_){}
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',startTheme,{once:true});
  else startTheme();
})();
