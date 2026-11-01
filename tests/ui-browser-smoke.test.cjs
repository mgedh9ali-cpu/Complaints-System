'use strict';
const assert=require('node:assert/strict');
const test=require('node:test');
const vm=require('node:vm');
const {assembleUiBundle}=require('../lib/ui-bundle');

function createFakeBrowser(role='admin'){
 const events=new Map(),windowEvents=new Map(),nodes=new Map(),historyEntries=[];
 function node(key){
  if(!nodes.has(key))nodes.set(key,{
   id:key,innerHTML:'',textContent:'',value:'',hidden:false,style:{},dataset:{},
   classList:{add(){},remove(){},toggle(){return true},contains(){return false}},
   setAttribute(){},removeAttribute(){},focus(){},addEventListener(){},
   querySelector(){return null},querySelectorAll(){return []}
  });
  return nodes.get(key);
 }
 const document={
  body:{dataset:{},prepend(){},append(){},appendChild(){}},activeElement:null,
  querySelector(selector){if(selector.startsWith('#')||selector==='.env-chip'||selector==='.prototype-note')return node(selector);return null;},
  querySelectorAll(selector){return selector==='.nav-link'?[node('nav-dashboard'),node('nav-registry')]:[];},
  addEventListener(type,fn){events.set(type,fn);},
  getElementById(id){return node('#'+id);},
  createElement(){return node('created-node');},
  contains(){return true;}
 };
 const location={hash:''};
 const history={
  pushState(_state,_title,url){historyEntries.push(url);location.hash=url;},
  replaceState(_state,_title,url){historyEntries.push('replace:'+url);location.hash=url;}
 };
 const window={history,location,addEventListener(type,fn){windowEvents.set(type,fn);},dispatchEvent(){}};
 const state={complaints:[{
  id:'SY-2026-10001',name:'اختبار',phone:'0912345678',province:'دمشق',category:'استفسار',
  entity:'مديرية عامة',priority:'normal',status:'new',owner:'admin',
  summary:'شكوى اختبارية',details:'معلومات للاختبار فقط',created:'2026-10-30T00:00:00Z',
  updated:'2026-11-01T00:00:00Z',due:'2026-11-09T00:00:00Z',
  notes:[],timeline:[],referrals:[],reply:null
 }],notifications:[],templates:[],settings:{slaDays:7,slaApproved:false}};
 const fetch=async url=>({
  ok:true,status:200,
  json:async()=>url==='/api/auth/me'?{user:{id:'u1',username:role,role}}:
   url==='/api/state'?{state,revision:1}:{users:[]}
 });
 const context={
  document,window,history,location,fetch,
  sessionStorage:{getItem(){return null},setItem(){},removeItem(){}},
  localStorage:{getItem(){return null},setItem(){}},
  structuredClone,URL,Date,Intl,console:{log(){},warn(){},error(){}},
  setTimeout:()=>0,clearTimeout(){},confirm:()=>true,
  CustomEvent:class{constructor(type,options){this.type=type;this.detail=options?.detail;}}
 };
 vm.runInNewContext(assembleUiBundle(),context,{filename:'app.bundle.js',timeout:4000});
 function click(action,id){
  const target={closest(selector){
   if(selector==='[data-action]')return{dataset:{action,id}};
   return null;
  }};
  events.get('click')({target,preventDefault(){},stopPropagation(){}});
 }
 return {node,events,windowEvents,location,historyEntries,click};
}

test('UI loads server state then opens complaint as an independent accessible workspace',async()=>{
 const ui=createFakeBrowser();
 for(let i=0;i<20;i++)await Promise.resolve();
 assert.match(ui.node('#content').innerHTML,/صباح العمل/);
 ui.click('detail','SY-2026-10001');
 const page=ui.node('#content').innerHTML;
 assert.match(page,/class="complaint-page/);
 assert.match(page,/data-complaint-id="SY-2026-10001"/);
 assert.match(page,/id="complaint-summary"/);
 assert.match(page,/id="complaint-actions"/);
 assert.match(page,/id="complaint-reply"/);
 assert.match(page,/id="complaint-timeline"/);
 assert.match(page,/id="complaint-notes"/);
 assert.match(page,/data-action="detail-back"/);
 assert.equal(ui.location.hash,'#complaint/SY-2026-10001');
 ui.click('detail-back');
 assert.equal(ui.location.hash,'#dashboard');
 assert.doesNotMatch(ui.node('#content').innerHTML,/class="complaint-page/);
});

test('reviewer complaint page is marked readonly and URL restoration works',async()=>{
 const ui=createFakeBrowser('reviewer');
 for(let i=0;i<20;i++)await Promise.resolve();
 ui.click('detail','SY-2026-10001');
 assert.match(ui.node('#content').innerHTML,/class="complaint-page readonly/);
 ui.location.hash='#complaints';
 ui.windowEvents.get('popstate')();
 assert.match(ui.node('#content').innerHTML,/سجل الشكاوى والاستفسارات/);
});
