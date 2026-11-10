/* إشعارات تنبيه للرسائل الجديدة — toast + صوت خفيف + نقطة الشريط */
(function(){
  let activeUser=null, seen=new Set(), remoteList=null, pending=false;
  function notificationKey(n){
    return JSON.stringify([n.id,n.date||n.at,n.title,n.body,n.complaintId]);
  }
  function resetUser(){
    const user=authenticatedUser;
    if(user!==activeUser){
      activeUser=user;seen=new Set();remoteList=null;
      document.querySelectorAll('.notif-alert').forEach(node=>node.remove());
    }
  }
  window.updateNotificationIndicators=function(){
    resetUser();
    const unread=authenticatedUser?(remoteList||db?.notifications||[]).filter(n=>!n.read):[];
    const top=$('#topUnread');
    if(top){top.hidden=unread.length===0;top.style.display=unread.length?'block':'none';}
    const count=$('#navNotificationsCount');
    if(count)count.textContent=String(unread.length);
  };
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
      '<div class="alarm-toast-body"><strong>'+'إشعار جديد في النظام'+'</strong>'+
      '<p>'+'افتح مركز الإشعارات للاطلاع على التفاصيل.'+'</p>'+
      '<small>'+esc(typeof timeText==='function'?timeText(n.date||n.at):'')+'</small></div>'+
      '<div class="alarm-toast-actions">'+
      (n.complaintId?'<button type="button" class="btn btn-sm btn-primary" data-action="notification-open" data-id="'+esc(n.complaintId)+'">فتح الشكوى</button>':'')+
      '<button type="button" class="btn btn-sm" data-action="goto-notifications">مركز الإشعارات</button>'+
      '</div>';
    (document.getElementById('toastRegion')||document.body).appendChild(node);
    setTimeout(()=>node.remove(),8000);
  }
  function processNotifications(list, initial=false){
    resetUser();
    if(!authenticatedUser)return;
    remoteList=list;
    window.updateNotificationIndicators();
    if(document.visibilityState==='hidden'&&!initial)return;
    const fresh=list.filter(n=>!n.read&&!seen.has(notificationKey(n)));
    list.forEach(n=>seen.add(notificationKey(n)));
    if(!initial&&fresh.length){softBeep();fresh.slice(-1).forEach(showNewAlert);}
  }
  window.pollNotificationAlerts=async function(){
    resetUser();
    if(!authenticatedUser||!stateLoaded||pending)return;
    const user=authenticatedUser;
    pending=true;
    try{
      const response=await api('/api/notifications');
      // A response from an earlier session must never reach the current user.
      if(user===authenticatedUser&&Array.isArray(response.notifications)){
        processNotifications(response.notifications);
      }
    }catch(_){/* Retry at the next interval; keep edits and state revision intact. */}
    finally{pending=false;}
  };
  // loadDb is a lexical binding inside the assembled UI, not window.loadDb.
  const originalLoadDb=loadDb;
  loadDb=async function(){
    const result=await originalLoadDb.apply(this,arguments);
    processNotifications(db.notifications||[],true);
    return result;
  };
  setInterval(()=>{void window.pollNotificationAlerts();},45000);
  document.addEventListener('complaints:render',()=>{
    if(page==='notifications')remoteList=db.notifications||[];
    window.updateNotificationIndicators();
  });
})();
