'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {openDatabase}=require('../config/db');
const {createComplaintsService}=require('../modules/complaints/service');

function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'complaint-boundary-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const db=openDatabase(path.join(dir,'office.sqlite'));
 t.after(()=>db.close());
 const user=db.prepare('INSERT INTO users(id,username,password_hash,role,active,created_at) VALUES(?,?,?,?,1,?)');
 const now=new Date().toISOString();
 user.run('admin-id','director','test-only','admin',now);
 user.run('staff-id','employee','test-only','staff',now);
 const service=createComplaintsService({db,audit(){},logger:null});
 const original={complaints:[{id:'SY-TEST-0001',status:'new',summary:'بلاغ تجريبي',
  province:'دمشق',category:'خدمات',created:now,updated:now,statusHistory:[],
  reply:{author:'employee',status:'review',text:'نص تجريبي للمراجعة'}}],
  notifications:[],templates:[],settings:{}};
 const init=service.saveState({state:original,userId:'staff-id',expectedRevision:0});
 assert.equal(init.invalidTransition,undefined);
 return {service,init,original};
}
test('state endpoint refuses new complaint IDs after initialization',t=>{
 const f=fixture(t);
 const forged=structuredClone(f.original);
 forged.complaints.push({...forged.complaints[0],id:'FORGED-0002'});
 const res=f.service.saveState({state:forged,userId:'staff-id',expectedRevision:f.init.revision});
 assert.equal(res.invalidTransition,true);
 assert.equal(f.service.readState().state.complaints.length,1);
});
test('state endpoint preserves complaint creation time and status history',t=>{
 const f=fixture(t);
 for(const key of ['created','statusHistory']){
  const forged=structuredClone(f.original);
  if(key==='created')forged.complaints[0].created='2020-01-01T00:00:00Z';
  else forged.complaints[0].statusHistory.push({from:'new',to:'closed'});
  const res=f.service.saveState({state:forged,userId:'admin-id',expectedRevision:f.init.revision});
  assert.equal(res.invalidTransition,true,key);
 }
});
test('approved reply is immutable, but can be marked sent with same author and text',t=>{
 const f=fixture(t);
 const approved=structuredClone(f.original);approved.complaints[0].reply.status='approved';
 const pass=f.service.saveState({state:approved,userId:'admin-id',expectedRevision:f.init.revision});
 assert.equal(pass.invalidTransition,undefined);
 for(const modification of ['text','author','rollback']){
  const edited=structuredClone(approved);
  if(modification==='text')edited.complaints[0].reply.text='رد معدّل';
  if(modification==='author')edited.complaints[0].reply.author='director';
  if(modification==='rollback')edited.complaints[0].reply.status='draft';
  const blocked=f.service.saveState({state:edited,userId:'admin-id',expectedRevision:pass.revision});
  assert.equal(blocked.invalidTransition,true,modification);
 }
 const sent=structuredClone(approved);sent.complaints[0].reply.status='sent';
 const sentResult=f.service.saveState({state:sent,userId:'admin-id',expectedRevision:pass.revision});
 assert.equal(sentResult.invalidTransition,undefined);
 const rollback=structuredClone(approved);
 const denied=f.service.saveState({state:rollback,userId:'admin-id',expectedRevision:sentResult.revision});
 assert.equal(denied.invalidTransition,true);
});
test('closed complaint cannot be silently changed through state endpoint',t=>{
 const f=fixture(t);
 // Dedicated status workflow is the only route allowed to close.
 const started=f.service.changeStatus({complaintId:'SY-TEST-0001',toStatus:'in_progress',reason:'بدء',
  userId:'admin-id',username:'director'});
 assert.equal(started.ok,true);
 const closed=f.service.changeStatus({complaintId:'SY-TEST-0001',toStatus:'closed',reason:'تم الإنجاز',
  userId:'admin-id',username:'director'});
 assert.equal(closed.ok,true);
 const current=f.service.readState();
 const changed=structuredClone(current.state);
 changed.complaints[0].summary='تعديل غير مصرح';
 const denied=f.service.saveState({state:changed,userId:'admin-id',expectedRevision:current.revision});
 assert.equal(denied.invalidTransition,true);
});
