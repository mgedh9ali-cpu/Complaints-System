(() => {
'use strict';
const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];
const STORAGE_KEY = 'complaints-demo-v1';
const DRAFT_KEY = 'complaints-draft-v1';
const TODAY = new Date();
const isoDaysAgo = n => { const d = new Date(); d.setDate(d.getDate()-n); return d.toISOString(); };
const seed = {
  complaints: [
    {id:'SY-2026-10452',name:'أحمد الحسن',phone:'0944 123 456',province:'دمشق',entity:'مديرية الخدمات العامة',category:'خدمات عامة',priority:'urgent',status:'new',owner:'مها العلي',created:isoDaysAgo(9),updated:isoDaysAgo(1),due:isoDaysAgo(2),summary:'تأخر معالجة طلب صيانة إنارة في الحي السكني.',details:'أفاد المشتكي بوجود عطل في الإنارة العامة منذ عدة أيام، ويطلب متابعة البلاغ.',notes:[],timeline:[{event:'تسجيل الشكوى',by:'مها العلي',at:isoDaysAgo(9),detail:'تم إنشاء السجل وإصدار الرقم المرجعي.'}],referrals:[],reply:null,confidentiality:'normal',survey:null}
  ],
  notifications: [],
  templates:[],
  settings:{slaDays:7,slaApproved:false,categoryDescriptions:{},entityDescriptions:{},provinces:['دمشق','ريف دمشق','حلب','حمص','حماة','اللاذقية','طرطوس','إدلب','دير الزور','الرقة','الحسكة','درعا','السويداء','القنيطرة'],entities:['مديرية الخدمات العامة','مديرية النقل','مديرية الشؤون الاجتماعية','مديرية التجارة الداخلية','مديرية التربية','مديرية المياه'],categories:['خدمات عامة','نقل ومواصلات','شؤون اجتماعية','أسعار وأسواق','تعليم','مياه وصرف صحي','استفسار عام'],priorities:[{value:'normal',label:'عادية'},{value:'high',label:'عالية'},{value:'urgent',label:'عاجلة'}]}
};
let db = cleanState(), page='dashboard', searchText='', statusFilter='all', priorityFilter='all', selectedIds=new Set(), currentId=null, toastTimer=null;
let authenticatedUser=null, persistTimer=null, persistQueue=Promise.resolve(), stateLoaded=false;
let stateRevision=0, stateConflict=false;
function cleanState(){const x=structuredClone(seed);x.complaints=[];x.notifications=[];return x;}
function loadDb(){return cleanState();}
async function api(url, options={}) {
  const response=await fetch(url,{...options,credentials:'same-origin',headers:{'Content-Type':'application/json',...(options.headers||{})}});
  if(response.status===204)return null;
  const body=await response.json().catch(()=>({}));
  if(!response.ok){const error=new Error(body.error||'تعذر تنفيذ الطلب.');error.status=response.status;throw error;}
  return body;
}
function persist(){
  if(!authenticatedUser||!stateLoaded||stateConflict)return;
  clearTimeout(persistTimer);
  const snapshot=JSON.stringify(db);
  persistTimer=setTimeout(()=>{
    persistQueue=persistQueue.then(async()=>{
      if(stateConflict)return;
      try{
        const saved=await api('/api/state',{
          method:'PUT',
          headers:{'X-State-Revision':String(stateRevision)},
          body:snapshot
        });
        stateRevision=saved.revision;
      }catch(error){
        if(error.status===409||error.status===428){
          stateConflict=true;
          toast(error.message+' لم تُحذف تعديلات هذه الصفحة؛ لا تُعد التحميل قبل حفظ ما تحتاج إليه.','error');
        }else{
          toast('لم يُحفظ التغيير في قاعدة البيانات: '+error.message,'error');
        }
      }
    });
  },250);
}
function updateSignedInUi(){
  const name=authenticatedUser?.username||'غير مسجل';
  ['#sideUserName','#topUserName'].forEach(sel=>{const el=$(sel);if(el)el.textContent=name;});
  const role=authenticatedUser?.role||'';
  const sideRole=$('#sideUserRole');if(sideRole)sideRole.textContent=({admin:'مدير النظام',staff:'موظف',reviewer:'مراجع'})[role]||role;
  const logout=$('#logoutButton');if(logout)logout.hidden=!authenticatedUser;
  const backup=$('#databaseBackupButton');if(backup)backup.hidden=authenticatedUser?.role!=='admin';
}
