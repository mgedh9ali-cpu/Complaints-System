/* Background polling cannot extend the user's idle period. */
(()=>{
 let owner=null,lastActivity=Date.now(),lastPing=0,pending=false,locking=false;
 window.sessionIdleMinutes=()=>{try{const n=Number(localStorage.getItem('complaints-idle-minutes'));return [15,30,60].includes(n)?n:30;}catch(_){return 30;}};
 function syncUser(){
  const id=authenticatedUser?.id||null;
  if(owner!==id){owner=id;lastActivity=Date.now();lastPing=0;locking=false;}
  return Boolean(id);
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
  if($('#newComplaintForm'))saveComplaintDraft();
  closeModal();
  const content=$('#content');if(content)content.innerHTML='';
  showLogin();await logout();
  $('#idleSessionWarning')?.remove();
  toast('قُفل التطبيق بسبب الخمول. سجّل الدخول للمتابعة.');
 }
 function activity(){
  if(!syncUser())return;
  // Expiry cannot be undone by the first click after a long absence.
  if(Date.now()-lastActivity>=window.sessionIdleMinutes()*60000){void lock();return;}
  lastActivity=Date.now();$('#idleSessionWarning')?.remove();
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
  if(!syncUser())return;
  const remaining=window.sessionIdleMinutes()*60000-(Date.now()-lastActivity);
  if(remaining<=0){void lock();return;}
  if(remaining<=60000&&!$('#idleSessionWarning')){
   const warning=document.createElement('div');
   warning.id='idleSessionWarning';
   warning.className='idle-session-warning';
   warning.setAttribute('role','status');
   warning.innerHTML='<strong>تنبيه الخمول</strong><span>سيُقفل التطبيق خلال دقيقة. اضغط أي مفتاح أو تفاعل مع الصفحة للمتابعة.</span>';
   document.body.append(warning);
  }
 },5000);
})();
