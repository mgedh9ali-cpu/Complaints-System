'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {openDatabase}=require('../config/db');
const {createAuditService}=require('../modules/audit/service');
const {createComplaintsService}=require('../modules/complaints/service');
const {createRemindersService}=require('../modules/reminders/service');
const {dayKey,dayBoundary}=require('../lib/work-time');
function fixture(t){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'workday-tools-')),file=path.join(directory,'db.sqlite'),db=openDatabase(file,{storageKey:'test-workday-tools-encryption-key-long-enough'});
 db.prepare('INSERT INTO users(id,username,password_hash,role,active,created_at) VALUES(?,?,?,?,1,?)').run('a','director','test','admin',new Date().toISOString());
 const auditService=createAuditService({db,databasePath:file}),audit=(...args)=>auditService.record(...args);audit.syncHead=()=>auditService.syncHead();
 const service=createComplaintsService({db,audit}),reminders=createRemindersService({db,complaintsService:service,audit});
 const id=service.createComplaint({body:{summary:'بلاغ اختباري',province:'دمشق',category:'عام'},userId:'a',username:'director'}).complaint.id;
 t.after(()=>{db.close();fs.rmSync(directory,{recursive:true,force:true});});return {service,reminders,id,auditService};
}
test('edit undo restores data once, is bound to the actor and complaint, and retains a valid audit chain',t=>{
 const f=fixture(t),result=f.service.updateComplaint({complaintId:f.id,body:{summary:'تعديل جديد',name:'اسم تجريبي'},userId:'a',username:'director'});
 const args={complaintId:f.id,token:result.undoToken,userId:'a',username:'director'};
 assert.match(result.undoToken,/^[a-f0-9]{64}$/);
 assert.equal(f.service.undoEdit({...args,userId:'other'}).status,403);
 assert.equal(f.service.undoEdit({...args,complaintId:'other'}).status,409);
 assert.equal(f.service.undoEdit(args).ok,true);
 assert.equal(f.service.readState().state.complaints[0].summary,'بلاغ اختباري');
 assert.equal(f.service.undoEdit(args).status,409);assert.equal(f.auditService.verifyChain().ok,true);
 const event=f.auditService.listEvents().find(e=>e.action==='complaint_edit_undone');assert.equal(event.actorUserId,'a');
 assert.equal(event.details.changes.summary.after.redacted,true);
});
test('expired edit undo and any subsequent state revision leave the current state intact',t=>{
 const f=fixture(t),args={complaintId:f.id,userId:'a',username:'director'};
 let result=f.service.updateComplaint({...args,body:{summary:'الأول'}});
 f.service.updateComplaint({...args,body:{summary:'الأحدث'}});
 assert.equal(f.service.undoEdit({...args,token:result.undoToken}).status,409);
 result=f.service.updateComplaint({...args,body:{summary:'قبل انتهاء المهلة'}});
 const original=Date.now;Date.now=()=>result.undoExpiresAt+1;
 try{assert.equal(f.service.undoEdit({...args,token:result.undoToken}).status,409);}finally{Date.now=original;}
 assert.equal(f.service.readState().state.complaints[0].summary,'قبل انتهاء المهلة');
});
test('today feed includes all due-through-Damascus-midnight reminders and excludes later days and dismissed entries',t=>{
 const f=fixture(t),end=dayBoundary(dayKey(new Date()),true);
 for(let i=0;i<55;i++)f.reminders.createReminder({complaintId:f.id,reminderTime:new Date(end-1000).toISOString(),note:'متابعة',userId:'a'});
 const later=f.reminders.createReminder({complaintId:f.id,reminderTime:new Date(end+1000).toISOString(),note:'غدًا',userId:'a'});
 const today=f.reminders.listDue({today:true});assert.equal(today.length,55);assert.ok(!today.some(r=>r.id===later.reminder.id));
 f.reminders.dismiss(today[0].id,'a');assert.equal(f.reminders.listDue({today:true}).length,54);
});
function ui(extra={}){
 const events={},c={document:{addEventListener:(n,fn)=>events[n]=fn},window:{},setInterval(){},Date,workDayKey:dayKey,norm:s=>String(s).trim().toLowerCase(),isIncomplete:c=>!!c.missing,esc:s=>String(s).replace(/</g,'&lt;'),...extra};
 vm.createContext(c);vm.runInContext(fs.readFileSync('ui/features/workday.js','utf8'),c);return c;
}
test('today queue deduplicates reasons, excludes terminal records and respects SLA approval',()=>{
 const now=Date.now(),records=[{id:'one',status:'awaiting_reply',missing:true,due:new Date(now-1000).toISOString()},{id:'closed',status:'closed',missing:true},{id:'archived',archivedAt:'today',missing:true}];
 const c=ui(),reminders=[{complaintId:'one',reminderTime:new Date(now).toISOString()}];
 const result=c.workdayRecords(records,reminders,now,false);assert.equal(result.length,1);assert.equal(result[0].reasons.length,3);
 assert.equal(c.workdayRecords(records,reminders,now,true)[0].reasons.length,4);
});
test('report entity groups count unique active records per overdue entity and repeated topics remain exact matches',()=>{
 const now=Date.now(),c=ui(),refs=[{entity:'جهة أ',due:new Date(now-1000).toISOString()},{entity:'جهة أ',due:new Date(now-2000).toISOString()}];
 const rows=[{id:'a',status:'new',summary:'Same',referrals:refs},{id:'b',status:'new',summary:'same',referrals:[{entity:'جهة أ',due:new Date(now-1000).toISOString(),response:'تم الرد'}]},{id:'c',status:'closed',summary:'other',referrals:refs}];
 const entities=c.reportInsightGroups(rows,'entity',now);assert.equal(entities.length,1);assert.equal(entities[0].records.length,1);
 const topics=c.reportInsightGroups(rows,'topic',now);assert.equal(topics.length,1);assert.deepEqual(Array.from(topics[0].records,r=>r.id),['a','b']);
});
test('PDF previews verify bytes, require the same session and release blob URLs when closed',async()=>{
 const urls=[],revoked=[],user={id:'a'},frame={},c=ui({authenticatedUser:user,fetch:async()=>({ok:true,arrayBuffer:async()=>Buffer.from('%PDF-test')}),modal(){},$:()=>frame,Blob,URL:{createObjectURL:()=>{urls.push('blob:test');return 'blob:test'},revokeObjectURL:url=>revoked.push(url)}});
 await c.previewAttachment('private.pdf','خاص','application/pdf');assert.equal(frame.src,'blob:test');c.releaseAttachmentPreview();assert.deepEqual(revoked,['blob:test']);
 c.fetch=async()=>({ok:true,arrayBuffer:async()=>Buffer.from('<html>')});await assert.rejects(c.previewAttachment('bad','bad','application/pdf'),/PDF/);
 c.fetch=async()=>{c.authenticatedUser=null;return {ok:true,arrayBuffer:async()=>Buffer.from('%PDF-test')}};
 assert.equal(await c.previewAttachment('private','private','application/pdf'),false);assert.equal(urls.length,1);
});
test('save indicator tracks simultaneous writes, failures, queued edits and excludes auth activity',async()=>{
 const element={dataset:{},textContent:''},resolvers=[],c={$:()=>element,persistTimer:null,requestApi:()=>new Promise((resolve,reject)=>resolvers.push({resolve,reject}))};
 vm.createContext(c);const text=fs.readFileSync('ui/core/bootstrap.js','utf8'),start=text.indexOf('let pendingWrites=');
 vm.runInContext(text.slice(start,text.indexOf('async function loadDb()',start)),c);
 c.showSaveState('dirty');assert.equal(element.dataset.state,'dirty');
 const first=c.api('/api/state',{method:'PUT'}),second=c.api('/api/complaints',{method:'POST'});
 assert.equal(element.dataset.state,'saving');resolvers[0].resolve({});await first;assert.equal(element.dataset.state,'saving');
 resolvers[1].reject(new Error('failure'));await assert.rejects(second);assert.equal(element.dataset.state,'failed');
 const third=c.api('/api/state',{method:'PUT'});resolvers[2].resolve({});await third;assert.equal(element.dataset.state,'saved');
 c.persistTimer=1;const queued=c.api('/api/state',{method:'PUT'});resolvers[3].resolve({});await queued;assert.equal(element.dataset.state,'dirty');
 c.persistTimer=null;const editing=c.api('/api/state',{method:'PUT'});c.showSaveState('dirty');resolvers[4].resolve({});await editing;assert.equal(element.dataset.state,'dirty');
 const auth=c.api('/api/auth/activity',{method:'POST'});resolvers[5].resolve({});await auth;assert.equal(element.dataset.state,'dirty');
});
test('reply template substitution is single-pass and never reinterprets citizen data as placeholders',()=>{
 const c={db:{templates:[]},dateText:()=> 'today',priorityLabel:()=> 'عادية'};vm.createContext(c);vm.runInContext(fs.readFileSync('ui/features/replies.js','utf8'),c);
 const result=c.fillReplyTemplateText('{{اسم_المشتكي}} / {{الهاتف}}',{name:'{{الهاتف}}',phone:'123'});
 assert.equal(result,'{{الهاتف}} / 123');assert.equal(c.availableReplyTemplates().length,2);
});
test('undo-edit HTTP route requires authentication, update permission, CSRF and a valid token',async t=>{
 const f=fixture(t),express=require('express'),{createComplaintsRouter}=require('../modules/complaints/routes'),app=express();app.use(express.json());
 app.use((req,res,next)=>{req.user={id:'a',username:'director'};next();});
 app.use('/api',createComplaintsRouter({complaintsService:f.service,
  middleware:{requireAuth:(req,res,next)=>req.get('X-Auth')==='yes'?next():res.sendStatus(401),requireCsrf:(req,res,next)=>req.get('X-CSRF')==='yes'?next():res.sendStatus(403)},
  rolesService:{requirePermission:permission=>(req,res,next)=>req.get('X-Permission')===permission?next():res.sendStatus(403)}}));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const update=f.service.updateComplaint({complaintId:f.id,body:{summary:'تعديل'},userId:'a',username:'director'});
 async function call(headers,token=update.undoToken){return fetch('http://127.0.0.1:'+server.address().port+'/api/complaints/'+f.id+'/edit/undo',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify({token})});}
 const headers={'X-Auth':'yes','X-CSRF':'yes','X-Permission':'complaints.update'};
 assert.equal((await call({})).status,401);assert.equal((await call({'X-Auth':'yes'})).status,403);
 assert.equal((await call({...headers,'X-CSRF':'no'})).status,403);assert.equal((await call(headers,'invalid')).status,400);
 assert.equal((await call(headers)).status,200);assert.equal((await call(headers)).status,409);
});
test('home backup failure is explicit, last-success time remains visible, and background reads leave edits intact',async()=>{
 const mount={innerHTML:''},user={id:'a'},record={id:'one',status:'awaiting_reply',summary:'مسودة محلية'},c=ui({authenticatedUser:user,page:'dashboard',stateRevision:7,db:{complaints:[record],settings:{}},$:()=>mount,
 api:async()=>({reminders:[]}),loadProtectionStatus:async()=>({automaticBackups:{lastSuccessfulAt:'last-time',lastError:'disk failure'}}),protectionStateLabel:()=>({label:'فشلت آخر محاولة'}),formatProtectionTime:value=>value||'—'});
 await c.refreshWorkday();assert.match(mount.innerHTML,/فشلت آخر محاولة/);assert.match(mount.innerHTML,/last-time/);assert.match(mount.innerHTML,/معالجة السبب/);
 assert.equal(c.stateRevision,7);assert.equal(c.db.complaints[0],record);
});
test('late home reads never paint task or backup data after logout',async()=>{
 let resolve;const mount={innerHTML:'unchanged'},c=ui({authenticatedUser:{id:'a'},page:'dashboard',db:{complaints:[],settings:{}},$:()=>mount,api:()=>new Promise(r=>resolve=r)});
 const pending=c.refreshWorkday();c.authenticatedUser=null;resolve({reminders:[]});await pending;assert.equal(mount.innerHTML,'unchanged');
});
