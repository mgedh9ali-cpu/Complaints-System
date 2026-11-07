/* إشعارات تنبيه للرسائل الجديدة — toast + صوت خفيف + نقطة الشريط */
(function(){
  const SEEN_KEY='complaints-notif-seen-id';
  let lastCount=0;
  function unreadList(){
    return (db?.notifications||[]).filter(n=>!n.read);
  }
  function maxId(list){
    let m=0;
    for(const n of list){
      const id=Number(n.id)||Date.parse(n.date||n.at)||0;
      if(id>m) m=id;
    }
    return m;
  }
  function softBeep(){
    try{
      const ctx=new (window.AudioContext||window.webkitAudioContext)();
      const o=ctx.createOscillator(); const g=ctx.createGain();
      o.type='sine'; o.frequency.value=880;
      g.gain.value=0.04; o.connect(g); g.connect(ctx.destination);
      o.start(); g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime+0.35);
      o.stop(ctx.currentTime+0.4);
      setTimeout(()=>ctx.close(),500);
    }catch(_){}
  }
  function showNewAlert(n){
    const node=document.createElement('div');
    node.className='alarm-toast notif-alert';
    node.setAttribute('role','status');
    node.innerHTML='<div class="alarm-toast-icon" aria-hidden="true">✉</div>'+
      '<div class="alarm-toast-body"><strong>'+esc(n.title||'إشعار جديد')+'</strong>'+
      '<p>'+esc((n.body||'').slice(0,140))+'</p>'+
      '<small>'+esc(typeof timeText==='function'?timeText(n.date||n.at):'')+'</small></div>'+
      '<div class="alarm-toast-actions">'+
      (n.complaintId?'<button type="button" class="btn btn-sm btn-primary" data-action="detail" data-id="'+esc(n.complaintId)+'">فتح</button>':'')+
      '<button type="button" class="btn btn-sm" data-action="goto-notifications">الإشعارات</button>'+
      '</div>';
    (document.getElementById('toastRegion')||document.body).appendChild(node);
    setTimeout(()=>node.remove(),8000);
  }
  window.pollNotificationAlerts=function(){
    if(!authenticatedUser||!db) return;
    const unread=unreadList();
    const top=$('#topUnread');
    if(top) top.hidden=unread.length===0;
    const countEl=$('#navNotificationsCount');
    if(countEl) countEl.textContent=String(unread.length||0);
    let seen=0;
    try{seen=Number(localStorage.getItem(SEEN_KEY)||0)||0;}catch(_){}
    const newest=maxId(db.notifications||[]);
    if(newest>seen){
      const fresh=(db.notifications||[]).filter(n=>{
        const id=Number(n.id)||Date.parse(n.date||n.at)||0;
        return id>seen && !n.read;
      }).slice(0,3);
      if(fresh.length){
        softBeep();
        fresh.forEach(showNewAlert);
      }
      try{localStorage.setItem(SEEN_KEY,String(newest));}catch(_){}
    }
    lastCount=unread.length;
  };
  const orig=window.loadDb;
  if(typeof orig==='function'){
    window.loadDb=async function(){
      const r=await orig.apply(this,arguments);
      try{pollNotificationAlerts();}catch(_){}
      return r;
    };
  }
  setInterval(()=>{ try{pollNotificationAlerts();}catch(_){} }, 45000);
  document.addEventListener('DOMContentLoaded',()=>setTimeout(()=>{try{pollNotificationAlerts();}catch(_){}},1200));
})();
