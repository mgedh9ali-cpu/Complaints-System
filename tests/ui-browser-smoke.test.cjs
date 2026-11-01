'use strict';
const assert=require('node:assert/strict');
const test=require('node:test');
const vm=require('node:vm');
const {assembleUiBundle}=require('../lib/ui-bundle');

function createFakeBrowser(role='admin',initialReply=null){
 const events=new Map(),windowEvents=new Map(),nodes=new Map(),historyEntries=[];
 function node(key){
  if(!nodes.has(key))nodes.set(key,{
   id:key,innerHTML:'',textContent:'',value:'',hidden:false,style:{},dataset:{},
   classList:{add(){},remove(){},toggle(){return true},contains(){return false}},
   setAttribute(){},removeAttribute(){},focus(){},addEventListener(){},
   querySelector(){return node('mock-dialog')},querySelectorAll(){return []},reportValidity(){return true}
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
  notes:[],timeline:[],referrals:[],reply:initialReply
 }],notifications:[],templates:[],settings:{slaDays:7,slaApproved:false}};
 let revision=1;
 const calls=[];
 const fetch=async (url,options={})=>{
  calls.push({url,method:options.method||'GET',headers:options.headers||{}});
  let response;
  if(url==='/api/auth/me')response={user:{id:'u1',username:role,role}};
  else if(url==='/api/state'){
   if(options.method==='PUT')revision+=1;
   response=options.method==='PUT'?{saved:true,revision}:{state,revision};
  }
  else if(url==='/api/csrf')response={csrfToken:'token-from-session'};
  else if(url==='/api/complaints'&&options.method==='POST'){
   const data=JSON.parse(options.body);
   const complaint={...data,id:'SY-2026-10002',status:'new',
    created:new Date().toISOString(),updated:new Date().toISOString(),
    notes:[],timeline:[],referrals:[],reply:null};
   state.complaints.push(complaint);
   revision+=1;
   response={complaint,revision};
  }
  else if(url.includes('/status')&&options.method==='PATCH'){
   state.complaints[0].status=JSON.parse(options.body).status;
   revision+=1;
   response={ok:true,revision};
  }else response={users:[]};
  return {ok:true,status:200,json:async()=>response};
 };
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
 function navigate(page){
  const target={closest(selector){
   if(selector==='[data-page]')return{dataset:{page}};
   return null;
  }};
  events.get('click')({target,preventDefault(){},stopPropagation(){}});
 }
 return {node,events,windowEvents,location,historyEntries,click,navigate,calls};
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

test('status change uses authenticated CSRF-protected API and refreshes authoritative page',async()=>{
 const ui=createFakeBrowser();
 for(let i=0;i<20;i++)await Promise.resolve();
 ui.click('detail','SY-2026-10001');
 ui.node('#detailStatus').value='in_progress';
 ui.node('#statusReason').value='باشرت المعالجة';
 ui.click('change-status','SY-2026-10001');
 for(let i=0;i<40;i++)await Promise.resolve();
 const request=ui.calls.find(x=>x.url.includes('/status')&&x.method==='PATCH');
 assert.ok(request,'status change must use the status API');
 assert.equal(request.headers['X-CSRF-Token'],'token-from-session');
 assert.match(ui.node('#content').innerHTML,/قيد المعالجة/);
 assert.equal(ui.location.hash,'#complaint/SY-2026-10001');
});

test('reviewer cannot call state transition endpoint from UI',async()=>{
 const ui=createFakeBrowser('reviewer');
 for(let i=0;i<20;i++)await Promise.resolve();
 ui.click('detail','SY-2026-10001');
 ui.node('#detailStatus').value='in_progress';
 ui.click('change-status','SY-2026-10001');
 for(let i=0;i<15;i++)await Promise.resolve();
 assert.equal(ui.calls.filter(x=>x.url.includes('/status')).length,0);
});

test('all seven working pages render from the modular bundle without errors',async()=>{
 const ui=createFakeBrowser();
 for(let i=0;i<20;i++)await Promise.resolve();
 for(const page of ['dashboard','complaints','referrals','replies','notifications','reports','settings']){
  assert.doesNotThrow(()=>ui.navigate(page),'failed route '+page);
  assert.ok(ui.node('#content').innerHTML.length>100,'empty route '+page);
  assert.equal(ui.location.hash,'#'+page);
 }
});

test('new complaint uses the authenticated creation endpoint and CSRF token',async()=>{
 const ui=createFakeBrowser();
 for(let i=0;i<20;i++)await Promise.resolve();
 ui.click('new-complaint');
 const form=ui.node('#modalRoot').innerHTML;
 assert.match(form,/id="newComplaintForm"/);
 const values={cName:'مواطن اختباري',cPhone:'0912345678',cProvince:'دمشق',
  cCategory:'خدمات عامة',cEntity:'مديرية الخدمات العامة',cPriority:'normal',
  cOwner:'admin',cSummary:'بلاغ جديد للاختبار',cDetails:'بيانات وهمية'};
 for(const [key,val] of Object.entries(values))ui.node('#'+key).value=val;
 ui.click('save-complaint');
 for(let i=0;i<50;i++)await Promise.resolve();
 const request=ui.calls.find(x=>x.url==='/api/complaints'&&x.method==='POST');
 assert.ok(request,'creation request not sent');
 assert.equal(request.headers['X-CSRF-Token'],'token-from-session');
 assert.match(ui.node('#content').innerHTML,/بلاغ جديد للاختبار/);
 assert.equal(ui.location.hash,'#complaints');
});

test('reviewer cannot open creation form',async()=>{
 const ui=createFakeBrowser('reviewer');
 for(let i=0;i<20;i++)await Promise.resolve();
 ui.click('new-complaint');
 assert.doesNotMatch(ui.node('#modalRoot').innerHTML,/id="newComplaintForm"/);
});

test('manager approval is confirmed by the server with CSRF and different author',async()=>{
 const ui=createFakeBrowser('admin',{status:'review',author:'staff-user',text:'رد تجريبي'});
 for(let i=0;i<20;i++)await Promise.resolve();
 ui.click('detail','SY-2026-10001');
 ui.click('reply-approve','SY-2026-10001');
 for(let i=0;i<40;i++)await Promise.resolve();
 const request=ui.calls.find(x=>x.url==='/api/state'&&x.method==='PUT');
 assert.ok(request,'approval must be committed by API, not just local state');
 assert.equal(request.headers['X-CSRF-Token'],'token-from-session');
 assert.match(ui.node('#content').innerHTML,/معتمد/);
});

test('author or non-manager cannot approve a reply',async()=>{
 for(const [role,author] of [['admin','admin'],['staff','different-author'],['reviewer','different-author']]){
  const ui=createFakeBrowser(role,{status:'review',author,text:'رد'});
  for(let i=0;i<20;i++)await Promise.resolve();
  ui.click('detail','SY-2026-10001');
  ui.click('reply-approve','SY-2026-10001');
  for(let i=0;i<20;i++)await Promise.resolve();
  assert.equal(ui.calls.filter(x=>x.url==='/api/state'&&x.method==='PUT').length,0,role+' must be denied');
 }
});
