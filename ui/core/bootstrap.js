(() => {
'use strict';
const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];
const STORAGE_KEY = 'complaints-demo-v1';
const DRAFT_KEY = 'complaints-draft-v1';
const TODAY = new Date();
const isoDaysAgo = n => { const d = new Date(); d.setDate(d.getDate()-n); return d.toISOString(); };
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
function cleanState(){return {complaints:[],notifications:[],templates:structuredClone(seed.templates),settings:structuredClone(seed.settings)};}
let db = cleanState(), page='dashboard', searchText='', statusFilter='all', priorityFilter='all', categoryFilter='all', natureFilter='all', quickView='all', selectedIds=new Set(), currentId=null, toastTimer=null;
let authenticatedUser=null, persistTimer=null, persistQueue=Promise.resolve(), stateLoaded=false;
let stateRevision=0, stateConflict=false, stateBase=null, conflictDraft=null;
let recentComplaintIds=[], intakeDefaults={}, managedUsers=[], assignees=[], customizablePermissions=[];
let detailReturnPage='complaints';
const ROLE_PERMISSIONS={
 admin:['*'],
 staff:['complaints.read','complaints.create','complaints.update','complaints.status','complaints.assign','attachments.read','attachments.upload','export.csv','export.xlsx','dashboard.view','settings.read','replies.draft','replies.send','approvals.request','sync.export'],
 reviewer:['complaints.read','attachments.read','export.csv','dashboard.view','settings.read','replies.approve']
};
function uiCan(action){if(!authenticatedUser)return false;const role=authenticatedUser.role||'staff';if(role==='admin')return true;const list=ROLE_PERMISSIONS[role]||[];return list.includes(action)||(authenticatedUser.permissions||[]).includes(action);}
/* Bootstrap continues in subsequent UI modules joined by assembleUiBundle; IIFE closed by events.js */
