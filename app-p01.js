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
    {id:'SY-2026-10452',name:'أحمد الحسن',phone:'0944 123 456',province:'دمشق',entity:'مديرية الخدمات العامة',category:'خدمات عامة',priority:'urgent',status:'new',owner:'مها العلي',created:isoDaysAgo(9),updated:isoDaysAgo(1),due:isoDaysAgo(2),summary:'تأخر معالجة طلب صيانة إنارة في الحي السكني.',details:'أفاد المشتكي بوجود عطل في الإنارة العامة منذ عدة أيام، ويطلب متابعة البلاغ.',notes:[],timeline:[{event:'تسجيل الشكوى',by:'مها العلي',at:isoDaysAgo(9),detail:'تم إنشاء السجل وإصدار الرقم المرجعي.'}],referrals:[],reply:null,confidentiality:'normal',survey:null},
    {id:'SY-2026-10451',name:'سمر محمود',phone:'0933 222 111',province:'ريف دمشق',entity:'مديرية النقل',category:'نقل ومواصلات',priority:'high',status:'in_progress',owner:'خالد منصور',created:isoDaysAgo(6),updated:isoDaysAgo(2),due:isoDaysAgo(-2),summary:'استفسار عن إجراءات معاملة نقل ملكية.',details:'طلب توضيح الأوراق المطلوبة والمدة المتوقعة للمعاملة.',notes:[],timeline:[{event:'تسجيل الشكوى',by:'خالد منصور',at:isoDaysAgo(6),detail:'تم تسجيل الاستفسار.'},{event:'بدء المعالجة',by:'خالد منصور',at:isoDaysAgo(4),detail:'مراجعة المتطلبات.'}],referrals:[],reply:{status:'draft',author:'خالد منصور',text:'نرجو مراجعة مديرية النقل مع الوثائق المطلوبة.'},confidentiality:'normal',survey:null},
    {id:'SY-2026-10450',name:'ليث درويش',phone:'0955 654 321',province:'حمص',entity:'مديرية الشؤون الاجتماعية',category:'شؤون اجتماعية',priority:'normal',status:'awaiting_reply',owner:'مها العلي',created:isoDaysAgo(14),updated:isoDaysAgo(5),due:isoDaysAgo(4),summary:'طلب متابعة معاملة دعم اجتماعي.',details:'يرغب بمعرفة حالة الطلب والوثائق الناقصة إن وجدت.',notes:[],timeline:[{event:'تسجيل الشكوى',by:'مها العلي',at:isoDaysAgo(14),detail:'تم التسجيل.'},{event:'إحالة إلى الجهة',by:'مها العلي',at:isoDaysAgo(10),detail:'إرسال طلب توضيح إلى الجهة.'}],referrals:[{entity:'مديرية الشؤون الاجتماعية',sent:isoDaysAgo(10),due:isoDaysAgo(3),status:'متأخرة',response:''}],reply:null,confidentiality:'normal',survey:null},
    {id:'SY-2026-10449',name:'نور إبراهيم',phone:'0991 345 678',province:'اللاذقية',entity:'مديرية الخدمات العامة',category:'خدمات عامة',priority:'urgent',status:'awaiting_approval',owner:'سليم عمر',created:isoDaysAgo(4),updated:isoDaysAgo(1),due:isoDaysAgo(-3),summary:'شكوى حول تراكم النفايات في منطقة سكنية.',details:'تم توثيق مواقع تراكم النفايات وطلب المعالجة.',notes:[],timeline:[{event:'تسجيل الشكوى',by:'سليم عمر',at:isoDaysAgo(4),detail:'تم التسجيل.'}],referrals:[],reply:{status:'review',author:'سليم عمر',text:'نحيطكم علماً بأنه تمت إحالة الملاحظة إلى الجهة المختصة للمتابعة.'},confidentiality:'normal',survey:null},
    {id:'SY-2026-10448',name:'مجهول تجريبي',phone:'',province:'حلب',entity:'مديرية التجارة الداخلية',category:'أسعار وأسواق',priority:'normal',status:'in_progress',owner:'خالد منصور',created:isoDaysAgo(3),updated:isoDaysAgo(1),due:isoDaysAgo(4),summary:'استفسار عن آلية تقديم بلاغ تجاري.',details:'سؤال تجريبي عن قناة تقديم البلاغ والوثائق المساندة.',notes:[],timeline:[{event:'تسجيل الشكوى',by:'خالد منصور',at:isoDaysAgo(3),detail:'تم التسجيل.'}],referrals:[],reply:null,confidentiality:'normal',survey:null},
    {id:'SY-2026-10447',name:'رنا خليل',phone:'0945 987 654',province:'طرطوس',entity:'مديرية التربية',category:'تعليم',priority:'high',status:'closed',owner:'مها العلي',created:isoDaysAgo(21),updated:isoDaysAgo(3),due:isoDaysAgo(12),summary:'استفسار عن نقل قيد مدرسي.',details:'تم تقديم الإجابة بعد التحقق من المتطلبات.',notes:[],timeline:[{event:'تسجيل الشكوى',by:'مها العلي',at:isoDaysAgo(21),detail:'تم التسجيل.'},{event:'اعتماد الرد',by:'مدير تجريبي',at:isoDaysAgo(3),detail:'اعتماد الرد وإغلاق السجل بسبب اكتمال المعالجة.'}],referrals:[],reply:{status:'sent',author:'مها العلي',text:'يرجى مراجعة المدرسة المعنية مع الوثائق الثبوتية.'},confidentiality:'normal',survey:{resolved:'yes',asked:true}},
    {id:'SY-2026-10446',name:'وسيم صالح',phone:'0988 333 222',province:'حماة',entity:'مديرية المياه',category:'مياه وصرف صحي',priority:'normal',status:'new',owner:'وسيم صالح',created:isoDaysAgo(1),updated:isoDaysAgo(1),due:isoDaysAgo(-6),summary:'بلاغ عن انقطاع المياه في شارع سكني.',details:'بلاغ أولي يحتاج إلى استكمال عنوان الموقع بدقة.',notes:[],timeline:[{event:'تسجيل الشكوى',by:'وسيم صالح',at:isoDaysAgo(1),detail:'تم إنشاء السجل.'}],referrals:[],reply:null,confidentiality:'normal',survey:null},
    {id:'SY-2026-10445',name:'هدى عيسى',phone:'0932 765 432',province:'إدلب',entity:'مديرية الخدمات العامة',category:'خدمات عامة',priority:'normal',status:'in_progress',owner:'سليم عمر',created:isoDaysAgo(12),updated:isoDaysAgo(4),due:isoDaysAgo(5),summary:'متابعة شكوى عن حفريات في الطريق.',details:'تم طلب تحديث من الجهة المعنية.',notes:[],timeline:[{event:'تسجيل الشكوى',by:'سليم عمر',at:isoDaysAgo(12),detail:'تم التسجيل.'}],referrals:[{entity:'مديرية الخدمات العامة',sent:isoDaysAgo(7),due:isoDaysAgo(1),status:'بانتظار الرد',response:''}],reply:null,confidentiality:'normal',survey:null}
  ],
  notifications: [
    {id:1,title:'شكوى عاجلة تجاوزت المهلة',body:'SY-2026-10452 · يلزم مراجعة المسؤول والمهلة.',date:isoDaysAgo(0),read:false},
    {id:2,title:'رد بانتظار الاعتماد',body:'SY-2026-10449 · الرد أعدّه سليم عمر.',date:isoDaysAgo(0),read:false},
    {id:3,title:'إحالة متأخرة',body:'SY-2026-10450 · لم يسجل رد الجهة حتى الآن.',date:isoDaysAgo(1),read:false},
    {id:4,title:'استكمال بيانات مطلوب',body:'SY-2026-10446 · يرجى استكمال موقع البلاغ.',date:isoDaysAgo(1),read:false}
  ],
  templates:[
    {name:'إفادة باستلام الشكوى',version:1,text:'تم استلام الشكوى رقم {{رقم_الشكوى}}، وستتم مراجعتها وإحالتها إلى الجهة المختصة عند الحاجة.'},
    {name:'طلب استكمال معلومات',version:1,text:'يرجى استكمال المعلومات اللازمة للشكوى رقم {{رقم_الشكوى}} المتعلقة بـ {{التصنيف}}.'},
    {name:'إشعار بإحالة',version:1,text:'نحيطكم علماً بأنه تمت إحالة الشكوى رقم {{رقم_الشكوى}} إلى {{الجهة}} للمتابعة.'}
  ],
  settings:{slaDays:7,slaApproved:false,categoryDescriptions:{},entityDescriptions:{},provinces:['دمشق','ريف دمشق','حلب','حمص','حماة','اللاذقية','طرطوس','إدلب','دير الزور','الرقة','الحسكة','درعا','السويداء','القنيطرة'],entities:['مديرية الخدمات العامة','مديرية النقل','مديرية الشؤون الاجتماعية','مديرية التجارة الداخلية','مديرية التربية','مديرية المياه'],categories:['خدمات عامة','نقل ومواصلات','شؤون اجتماعية','أسعار وأسواق','تعليم','مياه وصرف صحي','استفسار عام'],priorities:[{value:'normal',label:'عادية'},{value:'high',label:'عالية'},{value:'urgent',label:'عاجلة'}]}
};
let db = cleanState(), page='dashboard', searchText='', statusFilter='all', priorityFilter='all', selectedIds=new Set(), currentId=null, toastTimer=null;
let authenticatedUser=null, persistTimer=null, persistQueue=Promise.resolve(), stateLoaded=false;
let stateRevision=0, stateConflict=false;
function cleanState(){const x=structuredClone(seed);x.complaints=[];x.notifications=[];return x;}
function loadDb(){return cleanState();}
async function api(url, options={}) {
  const response=await fetch(url,{credentials:'same-origin',headers:{'Content-Type':'application/json',...(options.headers||{})},...options});
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
  const note=$('.prototype-note');if(note)note.innerHTML='<span class="status-dot"></span> قاعدة بيانات محلية · تسجيل دخول مفعل';
  const env=$('.env-chip');if(env)env.innerHTML='<span></span> تخزين محلي';
}
function showLogin(){
  let style=$('#loginStyles');
  if(!style){style=document.createElement('style');style.id='loginStyles';style.textContent=`
  .login-overlay{position:fixed;inset:0;z-index:10000;display:grid;place-items:center;padding:20px;background:rgba(9,30,26,.82);backdrop-filter:blur(5px)}
  .login-card{width:min(100%,440px);background:#fff;border-radius:18px;padding:28px;box-shadow:0 24px 90px #0005;color:#17372f}
