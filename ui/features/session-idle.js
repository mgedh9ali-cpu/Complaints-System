/* Background polling cannot extend the user's idle period.
 * Progressive warning: 2 min → soft banner, 1 min → urgent + countdown, then lock. */
(()=>{
 let owner=null,lastActivity=Date.now(),lastPing=0,pending=false,locking=false,countdownTimer=null;
 window.sessionIdleMinutes=()=>{try{const n=Number(localStorage.getItem('complaints-idle-minutes'));return [15,30,60].includes(n)?n:30;}catch(_){return 30;}};
 function syncUser(){
  const id=authenticatedUser?.id||null;
  if(owner!==id){owner=id;lastActivity=Date.now();lastPing=0;locking=false;clearCountdown();removeWarnings();}
  return Boolean(id);
 }
 function clearCountdown(){if(countdownTimer){clearInterval(countdownTimer);countdownTimer=null;}}
 function removeWarnings(){
  $('#idleSessionWarning')?.remove();
  $('#idleLockOverlay')?.remove();
  document.documentElement.classList.remove('session-locking');
 }
 async function ping(){
  if(!syncUser()||pending)return;
  pending=true;lastPing=Date.now();
  try{await api('/api/auth/activity',{method:'POST',body:JSON.stringify({idleMinutes:window.sessionIdleMinutes()})});}
  catch(error){if(error.status===401)await lock();}
  finally{pending=false;}
 }
 async function lock(){
  if(locking)return;locking=true;
  clearCountdown();
  if($('#newComplaintForm'))saveComplaintDraft();
  closeModal();
  const content=$('#content');if(content)content.innerHTML='';
  removeWarnings();
  showLogin();await logout();
  toast('قُفل التطبيق بسبب الخمول. سجّل الدخول للمتابعة.');
 }
 function showSoftWarning(secondsLeft){
  let el=$('#idleSessionWarning');
  if(!el){
   el=document.createElement('div');
   el.id='idleSessionWarning';
   el.className='idle-session-warning';
   el.setAttribute('role','status');
   document.body.append(el);
  }
  const urgent=secondsLeft<=60;
  el.classList.toggle('is-urgent',urgent);
  const mins=Math.floor(secondsLeft/60);
  const secs=secondsLeft%60;
  const timeLabel=mins>0?(mins+' د و '+secs+' ث'):(secs+' ثانية');
  el.innerHTML='<strong>'+(urgent?'قفل قريب':'تنبيه الخمول')+'</strong>'+
   '<span>سيُقفل التطبيق خلال <b dir="ltr">'+timeLabel+'</b>. حرّك الماوس أو اضغط أي مفتاح للمتابعة.</span>'+
   '<button type="button" class="btn btn-sm idle-stay-btn" id="idleStayBtn">البقاء نشطًا</button>';
  $('#idleStayBtn')?.addEventListener('click',()=>{activity();}, {once:true});
 }
 function showLockOverlay(){
  if($('#idleLockOverlay'))return;
  document.documentElement.classList.add('session-locking');
  const overlay=document.createElement('div');
  overlay.id='idleLockOverlay';
  overlay.className='idle-lock-overlay';
  overlay.setAttribute('role','alertdialog');
  overlay.setAttribute('aria-modal','true');
  overlay.setAttribute('aria-labelledby','idleLockTitle');
  overlay.innerHTML='<div class="idle-lock-card">'+
   '<div class="idle-lock-icon" aria-hidden="true">🔒</div>'+
   '<h2 id="idleLockTitle">قفل بسبب الخمول</h2>'+
   '<p>انتهت مدة الخمول. جارٍ تسجيل الخروج لحماية البيانات…</p>'+
   '</div>';
  document.body.append(overlay);
 }
 function activity(){
  if(!syncUser())return;
  if(Date.now()-lastActivity>=window.sessionIdleMinutes()*60000){void lock();return;}
  lastActivity=Date.now();
  clearCountdown();
  removeWarnings();
  if(Date.now()-lastPing>=30000)void ping();
 }
 for(const event of ['pointerdown','keydown','input','wheel'])document.addEventListener(event,activity,{passive:true});
 document.addEventListener('complaints:render',()=>{if(syncUser()&&!lastPing)void ping();});
 document.addEventListener('change',e=>{
  if(e.target?.id!=='sessionIdleMinutes')return;
  const n=Number(e.target.value);if(![15,30,60].includes(n))return;
  try{localStorage.setItem('complaints-idle-minutes',String(n));}catch(_){}
  void ping();
 });
 setInterval(()=>{
  if(!syncUser()||locking)return;
  const limit=window.sessionIdleMinutes()*60000;
  const remaining=limit-(Date.now()-lastActivity);
  if(remaining<=0){
   showLockOverlay();
   void lock();
   return;
  }
  // Soft warning in the last 2 minutes
  if(remaining<=120000){
   const secondsLeft=Math.ceil(remaining/1000);
   showSoftWarning(secondsLeft);
   if(!countdownTimer){
    countdownTimer=setInterval(()=>{
     if(!syncUser()||locking){clearCountdown();return;}
     const left=Math.ceil((limit-(Date.now()-lastActivity))/1000);
     if(left<=0){clearCountdown();showLockOverlay();void lock();return;}
     showSoftWarning(left);
    },1000);
   }
  }
 },2000);
})();
