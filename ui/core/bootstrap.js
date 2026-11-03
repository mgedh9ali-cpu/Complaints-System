'use strict';
const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];
const STORAGE_KEY = 'complaints-demo-v1';
const DRAFT_KEY = 'complaints-draft-v1';
const seed = {
  complaints: [],
  notifications: [],
  templates: [
    {name:'إفادة باستلام الشكوى',version:1,text:'تم استلام الشكوى رقم {{رقم_الشكوى}}، وستتم مراجعتها وإحالتها إلى الجهة المختصة عند الحاجة.'},
    {name:'طلب استكمال معلومات',version:1,text:'يرجى استكمال المعلومات اللازمة للشكوى رقم {{رقم_الشكوى}} المتعلقة بـ {{التصنيف}}.'},
    {name:'إشعار بإحالة',version:1,text:'نحيطكم علماً بأنه تمت إحالة الشكوى رقم {{رقم_الشكوى}} إلى {{الجهة}} للمتابعة.'}
  ],
  settings:{slaDays:7,slaApproved:false,categoryDescriptions:{},entityDescriptions:{},provinces:['دمشق','ريف دمشق','حلب','حمص','حماة','اللاذقية','طرطوس','إدلب','دير الزور','الرقة','الحسكة','درعا','السويداء','القنيطرة'],entities:['مديرية الخدمات العامة','مديرية النقل','مديرية الشؤون الاجتماعية','مديرية التجارة الداخلية','مديرية التربية','مديرية المياه'],categories:['خدمات عامة','نقل ومواصلات','شؤون اجتماعية','أسعار وأسواق','تعليم','مياه وصرف صحي','استفسار عام'],natures:['سوق معاملة','عصبية','إهمال خدمة','تأخير معاملة','سوء معاملة','استفسار','أخرى'],natureDescriptions:{},priorities:[{value:'normal',label:'عادية'},{value:'high',label:'عالية'},{value:'urgent',label:'عاجلة'}]}
};
function cleanState(){return {complaints:[...seed.complaints],notifications:[...seed.notifications],templates:seed.templates.map(t=>({...t})),settings:{...seed.settings,provinces:[...seed.settings.provinces],entities:[...seed.settings.entities],categories:[...seed.settings.categories],natures:[...(seed.settings.natures||[])],priorities:seed.settings.priorities.map(p=>({...p})),categoryDescriptions:{...(seed.settings.categoryDescriptions||{})},entityDescriptions:{...(seed.settings.entityDescriptions||{})},natureDescriptions:{...(seed.settings.natureDescriptions||{})}}};}
let db = cleanState(), page='dashboard', searchText='', statusFilter='all', priorityFilter='all', categoryFilter='all', natureFilter='all', quickView='all', selectedIds=new Set(), currentId=null, toastTimer=null;
let authenticatedUser=null, persistTimer=null, persistQueue=Promise.resolve(), stateLoaded=false, stateRevision=0, stateConflict=false, stateBase=null, conflictDraft=null;
let recentComplaintIds=[], intakeDefaults={}, managedUsers=[], assignees=[], customizablePermissions=[], detailReturnPage='complaints';
function uiCan(action){if(!authenticatedUser)return false;if(authenticatedUser.role==='admin')return true;const map={staff:['complaints.read','complaints.create','complaints.update','complaints.status','complaints.assign','attachments.read','attachments.upload','export.csv','export.xlsx','dashboard.view','settings.read','replies.draft','replies.send','approvals.request','sync.export'],reviewer:['complaints.read','attachments.read','export.csv','dashboard.view','settings.read']};const list=map[authenticatedUser.role]||[];return list.includes(action)||(authenticatedUser.permissions||[]).includes(action);}
async function getWriteCsrf(){const r=await fetch('/api/csrf',{credentials:'same-origin'});const j=await r.json().catch(()=>({}));return j.csrfToken||j.token||'';}
async function api(url,opts={}){const headers=Object.assign({'Content-Type':'application/json'},opts.headers||{});if(opts.method&&opts.method!=='GET')headers['X-CSRF-Token']=await getWriteCsrf();const res=await fetch(url,Object.assign({credentials:'same-origin'},opts,{headers}));const data=await res.json().catch(()=>({}));if(!res.ok)throw new Error(data.error||('HTTP '+res.status));return data;}
async function loadDb(){const stored=await api('/api/state');db=stored.state||cleanState();stateRevision=Number.isSafeInteger(stored.revision)?stored.revision:0;stateLoaded=true;stateConflict=false;}
async function persistUiNow(){if(!stateLoaded)return;const saved=await api('/api/state',{method:'PUT',headers:{'X-State-Revision':String(stateRevision)},body:JSON.stringify(db)});stateRevision=saved.revision;}
function persist(){if(persistTimer)clearTimeout(persistTimer);persistTimer=setTimeout(()=>{persistTimer=null;persistQueue=persistQueue.then(()=>persistUiNow()).catch(e=>toast(e.message,'error'));},400);}
function updateSignedInUi(){const name=authenticatedUser?.username||'';const el=$('#signedInUser');if(el)el.textContent=name;const top=$('#topUserName');if(top)top.textContent=name||'غير مسجل';const headerCreate=$('#headerCreateButton');if(headerCreate)headerCreate.hidden=!uiCan('complaints.create');document.body.dataset.signedIn=authenticatedUser?'true':'false';const overlay=$('#loginOverlay');if(overlay)overlay.hidden=!!authenticatedUser;const shell=$('#appShell');if(shell)shell.hidden=!authenticatedUser;}
function showLogin(){const overlay=$('#loginOverlay');if(overlay)overlay.hidden=false;$('#appShell')&&($('#appShell').hidden=true);document.body.dataset.signedIn='false';}
function logout(){authenticatedUser=null;stateLoaded=false;db=cleanState();try{sessionStorage.removeItem(DRAFT_KEY);}catch(_){}updateSignedInUi();showLogin();}
async function refreshAssignees(){try{const r=await api('/api/users');managedUsers=r.users||[];assignees=(r.users||[]).filter(u=>u.active&&u.role!=='reviewer');}catch(_){}}
/* UI modules continue; IIFE closed by events.js */
