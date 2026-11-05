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
   getAttribute(){return null;},setAttribute(){},removeAttribute(){},focus(){},addEventListener(){},append(){},appendChild(){},remove(){},
   querySelector(){return node('mock-dialog')},querySelectorAll(){return []},reportValidity(){return true}
  });
  return nodes.get(key);
 }
 const document={
  body:{dataset:{},prepend(){},append(){},appendChild(){}},activeElement:null,
  querySelector(selector){if(['#syncImportFile','#syncPassword','#syncPasswordConfirm'].includes(selector)){const html=node(selector==='#syncImportFile'?'#content':'#modalRoot').innerHTML;if(!html.includes('id="'+selector.slice(1)+'"'))return null;}if(selector.startsWith('#')||selector==='.env-chip'||selector==='.prototype-note')return node(selector);return null;},
  querySelectorAll(selector){return selector==='.nav-link'?[node('nav-dashboard'),node('nav-registry')]:[];},
  addEventListener(type,fn){const previous=events.get(type);events.set(type,previous?event=>{previous(event);return fn(event);}:fn);},
  getElementById(id){return node('#'+id);},
  createElement(){return node('created-node');},
  contains(){return true;}
 };
 const location={hash:''};
 const history={
  pushState(_state,_title,url){historyEntries.push(url);location.hash=url;},
  replaceState(_state,_title,url){historyEntries.push('replace:'+url);location.hash=url;}
 };
 const window={setTimeout:()=>0,history,location,addEventListener(type,fn){windowEvents.set(type,fn);},dispatchEvent(){}};
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
  calls.push({url,method:options.method||'GET',headers:options.headers||{},body:options.body});
  let response;
  if(url==='/api/auth/me')response={user:{id:'u1',username:role,role}};
  else if(url==='/api/state'){
   if(options.method==='PUT')revision+=1;
   response=options.method==='PUT'?{saved:true,revision}:{state,revision};
  }
  else if(url==='/api/sync/preview')response={revision,incomingCount:1,added:1,removed:0,conflicts:[]};
  else if(url==='/api/sync/import')response={imported:true};
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
  else if(url==='/api/complaints/SY-2026-10001'&&options.method==='PATCH'){
   Object.assign(state.complaints[0],JSON.parse(options.body));revision+=1;response={ok:true,revision};
  }else if(url.includes('/status')&&options.method==='PATCH'){
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
   if(selector==='[data-action]'){const button=node('action-'+action);button.dataset={action,id};return button;}
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
 return {node,events,windowEvents,location,historyEntries,click,navigate,calls,state};
}

test('UI loads server state then opens complaint as an independent accessible workspace',async()=>{
 const ui=createFakeBrowser();
 for(let i=0;i<20;i++)await Promise.resolve();
 assert.match(ui.node('#content').innerHTML,/مكتب الفرز والمتابعة/);
 ui.click('detail','SY-2026-10001');
 const page=ui.node('#content').innerHTML;
 assert.match(page,/class="complaint-page/);
 assert.match(page,/detail-workspace/);
 assert.doesNotMatch(page,/triage-split|id="complaintSearch"/);
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
 const request=ui.calls.find(x=>x.url.endsWith('/reply')&&x.method==='PATCH');
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
  assert.equal(ui.calls.filter(x=>x.url.endsWith('/reply')&&x.method==='PATCH').length,0,role+' must be denied');
 }
});

test('assignment and priority are persisted with CSRF before success UI is shown',async()=>{
 const ui=createFakeBrowser('staff');
 for(let i=0;i<20;i++)await Promise.resolve();
 ui.click('detail','SY-2026-10001');
 ui.node('#assignOwner').value='staff-two';
 ui.click('assign-owner','SY-2026-10001');
 for(let i=0;i<35;i++)await Promise.resolve();
 const written=ui.calls.filter(x=>x.url==='/api/complaints/SY-2026-10001'&&x.method==='PATCH');
 assert.equal(written.length,1);
 assert.deepEqual(JSON.parse(written[0].body),{owner:'staff-two'});
 assert.equal(written[0].headers['X-State-Revision'],'1');
 assert.equal(written[0].headers['X-CSRF-Token'],'token-from-session');
 assert.match(ui.node('#content').innerHTML,/staff-two/);
 ui.node('#detailPriority').value='high';
 ui.click('change-priority','SY-2026-10001');
 for(let i=0;i<35;i++)await Promise.resolve();
 assert.ok(ui.calls.filter(x=>x.url==='/api/state'&&x.method==='PUT').length>=1);
});
test('a reviewer cannot persist assignment or priority changes',async()=>{
 const ui=createFakeBrowser('reviewer');
 for(let i=0;i<20;i++)await Promise.resolve();
 ui.click('detail','SY-2026-10001');
 ui.node('#assignOwner').value='other-user';
 ui.click('assign-owner','SY-2026-10001');
 ui.node('#detailPriority').value='high';
 ui.click('change-priority','SY-2026-10001');
 for(let i=0;i<25;i++)await Promise.resolve();
 assert.equal(ui.calls.filter(x=>x.url==='/api/state'&&x.method==='PUT').length,0);
});


test('settings import survives absent startup input and rerender; password is masked and preview revision is submitted',async()=>{
 const ui=createFakeBrowser();for(let i=0;i<20;i++)await Promise.resolve();
 for(let attempt=0;attempt<2;attempt++){
  ui.navigate('settings');
  const target={id:'syncImportFile',files:[{size:100,async text(){return '{"format":"synthetic-envelope"}';}}],value:'selected',classList:{contains(){return false;}}};
  const pending=ui.events.get('change')({target});
  for(let i=0;i<10;i++)await Promise.resolve();
  assert.match(ui.node('#modalRoot').innerHTML,/type="password"/);assert.doesNotMatch(ui.node('#modalRoot').innerHTML,/id="syncPasswordConfirm"/);
  ui.node('#syncPassword').value='test-transfer-password';ui.click('confirm-sync-password');await pending;
  assert.equal(target.value,'');ui.navigate('dashboard');
 }
 const imports=ui.calls.filter(c=>c.url==='/api/sync/import');assert.equal(imports.length,2);
 assert.equal(JSON.parse(imports[0].body).expectedRevision,1);
 const target={id:'syncImportFile',files:[{size:1,async text(){return '{}';}}],classList:{contains(){return false;}}};
 const pending=ui.events.get('change')({target});for(let i=0;i<10;i++)await Promise.resolve();
 ui.events.get('keydown')({key:'Escape',target:{},preventDefault(){}});await pending;
 assert.equal(ui.calls.filter(c=>c.url==='/api/sync/import').length,2,'cancel must not submit a transfer');
});


test('legacy empty intake lists display local defaults without rewriting synchronized settings',async()=>{
 const ui=createFakeBrowser();
 for(let i=0;i<20;i++)await Promise.resolve();
 ui.state.settings.provinces=[];ui.state.settings.categories=[];ui.state.settings.entities=[];
 const settings=structuredClone(ui.state.settings);
 ui.click('new-complaint');
 const html=ui.node('#modalRoot').innerHTML;
 assert.match(html,/<option value="دمشق"/);
 assert.match(html,/<option value="خدمات عامة"/);
 assert.match(html,/<option value="مديرية الخدمات العامة"/);
 assert.deepEqual(structuredClone(ui.state.settings),settings);
 assert.equal(ui.calls.filter(x=>x.method==='PUT').length,0);
});
