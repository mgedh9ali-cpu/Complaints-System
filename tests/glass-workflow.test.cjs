'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const vm=require('node:vm');
const {openDatabase}=require('../config/db');
const {createComplaintsService}=require('../modules/complaints/service');
const {createAuditService}=require('../modules/audit/service');

function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'glass-workflow-'));
 const databasePath=path.join(dir,'test.sqlite'),db=openDatabase(databasePath);
 db.prepare('INSERT INTO users(id,username,password_hash,role,active,created_at) VALUES (?,?,?,?,1,?)').run('u1','manager','test-only','admin',new Date().toISOString());
 const auditService=createAuditService({db,databasePath});
 const audit=(...args)=>auditService.record(...args);audit.syncHead=()=>auditService.syncHead();
 const service=createComplaintsService({db,audit});
 service.saveState({state:{complaints:[{id:'SY-TEST',status:'new',summary:'اختبار',province:'دمشق',category:'خدمات',created:new Date().toISOString(),timeline:[],statusHistory:[]}],notifications:[],templates:[],settings:{}},userId:'u1',expectedRevision:0});
 t.after(()=>{db.close();fs.rmSync(dir,{recursive:true,force:true});});
 return {service,auditService,db};
}

test('instant undo is author-bound, single use and appends an intact audit event',t=>{
 const {service,auditService}=fixture(t);
 const change=service.changeStatus({complaintId:'SY-TEST',toStatus:'in_progress',userId:'u1',username:'manager'});
 assert.ok(change.undoToken);assert.equal(service.undoStatus({complaintId:'SY-TEST',token:change.undoToken,userId:'other'}).ok,false);
 const undone=service.undoStatus({complaintId:'SY-TEST',token:change.undoToken,userId:'u1',username:'manager'});
 assert.equal(undone.ok,true);assert.equal(undone.complaint.status,'new');
 assert.equal(undone.complaint.statusHistory.length,2);
 assert.equal(service.undoStatus({complaintId:'SY-TEST',token:change.undoToken,userId:'u1'}).ok,false);
 assert.equal(auditService.listEvents().filter(e=>e.action==='complaint_status_undone').length,1);
 assert.equal(auditService.verifyChain().ok,true);
});

test('undo refuses a later revision and expired grants',t=>{
 const {service}=fixture(t);
 const change=service.changeStatus({complaintId:'SY-TEST',toStatus:'in_progress',userId:'u1'});
 const current=service.readState();current.state.complaints[0].owner='another';
 service.saveState({state:current.state,userId:'u1',expectedRevision:current.revision});
 assert.equal(service.undoStatus({complaintId:'SY-TEST',token:change.undoToken,userId:'u1'}).ok,false);
 const next=service.changeStatus({complaintId:'SY-TEST',toStatus:'awaiting_reply',userId:'u1'});
 const clock=t.mock.method(Date,'now',()=>next.undoExpiresAt+1);
 assert.equal(service.undoStatus({complaintId:'SY-TEST',token:next.undoToken,userId:'u1'}).ok,false);clock.mock.restore();
});

function merger(){
 const source=fs.readFileSync(path.join(__dirname,'../ui/core/navigation.js'),'utf8');
 const pure=source.slice(source.indexOf('function mergeStateVersions'),source.indexOf('async function openStateConflict'));
 return vm.runInNewContext(pure+';mergeStateVersions',{structuredClone});
}

test('three-way merge preserves a colleague addition and independent changes',()=>{
 const merge=merger(),base={complaints:[{id:'1',owner:'a',priority:'normal'}]},local=structuredClone(base),remote=structuredClone(base);
 local.complaints[0].owner='b';remote.complaints[0].priority='high';remote.complaints.push({id:'2',owner:'c'});
 const conflicts=[],result=merge(base,local,remote,{},[],conflicts);
 assert.equal(result.complaints[0].owner,'b');assert.equal(result.complaints[0].priority,'high');assert.equal(result.complaints[1].id,'2');assert.equal(conflicts.length,0);
});

test('three-way merge defaults conflicting fields to server and honors explicit field choices',()=>{
 const merge=merger(),base={complaints:[{id:'1',owner:'a'}]},local={complaints:[{id:'1',owner:'b'}]},remote={complaints:[{id:'1',owner:'c'}]};
 const conflicts=[],result=merge(base,local,remote,{},[],conflicts);
 assert.equal(result.complaints[0].owner,'c');assert.equal(conflicts.length,1);
 assert.equal(merge(base,local,remote,{[conflicts[0].key]:'local'}).complaints[0].owner,'b');
});

test('reply proof is recorded in the audit chain and is restricted to document events',t=>{
 const {auditService}=fixture(t);
 const event=auditService.record('u1','reply_document_issued','complaint','SY-TEST',{digest:'abc'});
 const proof=auditService.findDocumentProof(event.eventHash);
 assert.equal(proof.targetId,'SY-TEST');assert.equal(proof.digest,'abc');assert.equal(auditService.verifyChain().ok,true);
 const unrelated=auditService.record('u1','login','user','u1',{});
 assert.equal(auditService.findDocumentProof(unrelated.eventHash),null);
});

test('document proof routes require auth, CSRF and approved reply, and verify issued codes',async t=>{
 const {service,auditService,db}=fixture(t);
 const express=require('express'),app=express();app.use(express.json());
 const middleware={
  requireAuth(req,res,next){if(!req.get('X-Test-User'))return res.sendStatus(401);req.user={id:'u1',username:'manager',role:'admin'};next();},
  requireCsrf(req,res,next){if(req.get('X-CSRF-Token')!=='test')return res.sendStatus(403);next();}
 };
 app.use('/api',require('../modules/audit/routes').createAuditRouter({auditService,middleware,complaintsService:service,rolesService:require('../modules/roles/service').createRolesService()}));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 const base='http://127.0.0.1:'+server.address().port;
 const request=(url,options={})=>fetch(base+url,{...options,headers:{'X-Test-User':'manager','X-CSRF-Token':'test','Content-Type':'application/json',...(options.headers||{})}});
 assert.equal((await fetch(base+'/api/documents/verify/'+'a'.repeat(64))).status,401);
 assert.equal((await request('/api/documents/reply/SY-TEST',{method:'POST',headers:{'X-CSRF-Token':''},body:'{}'})).status,403);
 assert.equal((await request('/api/documents/reply/SY-TEST',{method:'POST',body:'{}'})).status,409);
 db.prepare('INSERT INTO users(id,username,password_hash,role,active,created_at) VALUES (?,?,?,?,1,?)').run('staff','author','test-only','staff',new Date().toISOString());
 let state=service.readState();state.state.complaints[0].reply={author:'author',status:'review',text:'رد اختبار معتمد'};
 assert.equal(service.saveState({state:state.state,userId:'staff',expectedRevision:state.revision}).conflict,false);
 state=service.readState();state.state.complaints[0].reply.status='approved';
 assert.equal(service.saveState({state:state.state,userId:'u1',expectedRevision:state.revision}).conflict,false);
 const issued=await request('/api/documents/reply/SY-TEST',{method:'POST',body:'{}'});assert.equal(issued.status,200);
 const proof=await issued.json();assert.match(proof.code,/^[a-f0-9]{64}$/);
 const verified=await request('/api/documents/verify/'+proof.code);const result=await verified.json();
 assert.equal(result.valid,true);assert.equal(result.text,'رد اختبار معتمد');assert.equal(result.chainValid,true);
 assert.equal((await request('/api/documents/verify/'+'b'.repeat(64))).status,404);
});
