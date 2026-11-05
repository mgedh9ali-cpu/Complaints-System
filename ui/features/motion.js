/* Supplied motion design, integrated with route rendering rather than DOM mutations. */
(() => {
  const root=document.documentElement,content=document.getElementById('content');
  if(!root||!content)return;
  const media=window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const still=()=>media?.matches===true;
  const palettes=new Set(['emerald','ocean','ember']);
  window.setPalette=name=>{
    const palette=palettes.has(name)?name:'emerald';
    root.dataset.palette=palette==='emerald'?'':palette;
    try{localStorage.setItem('palette',palette);}catch(_){}
  };
  try{window.setPalette(localStorage.getItem('palette')||'emerald');}catch(_){window.setPalette('emerald');}
  let previousRoute='',timer;
  const counters=new Map();
  function stop(){
    clearTimeout(timer);content.removeAttribute('data-enter');
    for(const [el,entry] of counters){window.cancelAnimationFrame?.(entry.frame);el.textContent=String(entry.end);}
    counters.clear();
  }
  function enter(route){
    stop();
    if(!route||route===previousRoute){return;}
    previousRoute=route;
    if(still())return;
    content.setAttribute('data-enter','');
    timer=setTimeout(()=>content.removeAttribute('data-enter'),1100);
    if(!window.requestAnimationFrame)return;
    content.querySelectorAll('.stat-item strong, .count-up').forEach(el=>{
      const end=Number(String(el.textContent).trim());
      if(!Number.isSafeInteger(end)||end<1)return;
      const entry={end,frame:null,start:null};counters.set(el,entry);
      const tick=time=>{
        if(!counters.has(el))return;
        if(still()||el.isConnected===false){el.textContent=String(end);counters.delete(el);return;}
        entry.start??=time;
        const progress=Math.min(1,(time-entry.start)/700);
        el.textContent=String(Math.round(end*(1-Math.pow(1-progress,3))));
        if(progress<1)entry.frame=window.requestAnimationFrame(tick);
        else{el.textContent=String(end);counters.delete(el);}
      };
      entry.frame=window.requestAnimationFrame(tick);
    });
  }
  document.addEventListener('complaints:render',event=>enter(event.detail?.route));
  media?.addEventListener?.('change',()=>{if(still())stop();});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')stop();});
})();
