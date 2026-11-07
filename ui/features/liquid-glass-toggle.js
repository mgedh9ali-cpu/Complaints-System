/* Liquid glass toggle — مرجع: 21st.dev liquid-glass-toggle (gughigug)
 * تبديل زجاج السطح مع حركة سائلة بسيطة (CSS) بدون تبعيات.
 */
(function(){
  const KEY='complaints-glass-enabled';
  function glassOn(){
    try{const v=localStorage.getItem(KEY); if(v===null) return true; return v==='true';}catch(_){return true;}
  }
  function applyGlass(on){
    document.documentElement.classList.toggle('glass-off', !on);
    document.documentElement.classList.toggle('reduce-transparency', !on);
    try{localStorage.setItem(KEY, String(!!on));}catch(_){}
    try{localStorage.setItem('complaints-reduce-transparency', String(!on));}catch(_){}
    const btn=$('#liquidGlassToggle');
    if(btn){
      btn.setAttribute('aria-pressed', on?'true':'false');
      btn.classList.toggle('is-on', on);
      const lab=$('.lgt-label', btn);
      if(lab) lab.textContent=on?'زجاج':'صلب';
    }
  }
  window.toggleLiquidGlass=function(){
    applyGlass(!glassOn());
    toast(glassOn()?'تم تفعيل الزجاج السائل.':'تم التحويل إلى سطح صلب.');
  };
  window.mountLiquidGlassToggle=function(){
    if($('#liquidGlassToggle')) return;
    const host=$('.top-actions')||$('.topbar');
    if(!host) return;
    const b=document.createElement('button');
    b.type='button';
    b.id='liquidGlassToggle';
    b.className='liquid-glass-toggle'+(glassOn()?' is-on':'');
    b.setAttribute('aria-pressed', glassOn()?'true':'false');
    b.setAttribute('aria-label','تبديل الزجاج السائل');
    b.title='زجاج السطح (مرجع Liquid Glass)';
    b.dataset.action='toggle-liquid-glass';
    b.innerHTML='<span class="lgt-track" aria-hidden="true"><span class="lgt-drop"></span></span><span class="lgt-label">'+(glassOn()?'زجاج':'صلب')+'</span>';
    host.insertBefore(b, host.firstChild);
    applyGlass(glassOn());
  };
  document.addEventListener('DOMContentLoaded', ()=>{
    applyGlass(glassOn());
    setTimeout(()=>{ try{mountLiquidGlassToggle();}catch(_){} }, 400);
  });
  const _obs=new MutationObserver(()=>{ if(authenticatedUser&&!$('#liquidGlassToggle')) try{mountLiquidGlassToggle();}catch(_){} });
  try{_obs.observe(document.documentElement,{childList:true,subtree:true});}catch(_){}
})();
