'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {saveAttachmentBatch}=require('../modules/attachments/upload-batch');
function fixture(existing=0,invalidAt=-1){
 const names=Array.from({length:existing},(_,i)=>'previous-'+i);
 const removed=[];const writes=[];
 return {
  service:{
   MAX_FILES_PER_COMPLAINT:5,
   listByComplaint(){return names.slice()},
   save(id,file){
    if(file.index===invalidAt)throw new Error('invalid file');
    const meta={storedName:id+'-file-'+file.index};
    writes.push(meta.storedName);
    return meta;
   },
   remove(name){removed.push(name);}
  },writes,removed
 };
}
test('attachment batch rejects cumulative quota before writing anything',()=>{
 const {service,writes}=fixture(4);
 assert.throws(()=>saveAttachmentBatch({attachmentsService:service,complaintId:'SY-2026-TEST',files:[{index:1},{index:2}]}),/الحد الأقصى/);
 assert.equal(writes.length,0);
});
test('attachment batch rolls back all new files when a later file is rejected',()=>{
 const {service,writes,removed}=fixture(0,3);
 assert.throws(()=>saveAttachmentBatch({attachmentsService:service,complaintId:'SY-2026-TEST',files:[{index:1},{index:2},{index:3}]}),/invalid file/);
 assert.deepEqual(writes,['SY-2026-TEST-file-1','SY-2026-TEST-file-2']);
 assert.deepEqual(removed,['SY-2026-TEST-file-2','SY-2026-TEST-file-1']);
});
test('successful batch returns only files from the current request',()=>{
 const {service,removed}=fixture(2);
 const out=saveAttachmentBatch({attachmentsService:service,complaintId:'SY-2026-TEST',files:[{index:1},{index:2}]});
 assert.deepEqual(out.map(x=>x.storedName),['SY-2026-TEST-file-1','SY-2026-TEST-file-2']);
 assert.equal(removed.length,0);
});


test('attachment upload removes written files if its audit transaction fails', { timeout: 15000 }, async t => {
 const express=require('express');
 const {createAttachmentsRouter}=require('../modules/attachments/routes');
 const complaintId='SY-2026-ATTACHMENT-TEST';
 const written=new Map();
 const service={
  MAX_FILE_SIZE:5*1024*1024,
  MAX_FILES_PER_COMPLAINT:5,
  listByComplaint(){return [...written.values()];},
  save(id,file){
   const storedName=id+'_550e8400-e29b-41d4-a716-446655440000.txt';
   const meta={id:'attachment-test',storedName,originalName:file.originalname,size:file.size};
   written.set(storedName,meta);
   return meta;
  },
  remove(name){written.delete(name);}
 };
 const allow=(req,res,next)=>{req.user={id:'staff-id'};next();};
 const router=createAttachmentsRouter({
  attachmentsService:service,
  middleware:{requireAuth:allow,requireCsrf:allow},
  rolesService:{requirePermission(){return allow;}},
  complaintsService:{readState(){return {state:{complaints:[{id:complaintId}]}};}},
  db:{transaction(fn){return ()=>fn();}},
  audit(){throw new Error('simulated audit failure');}
 });
 const app=express();
 app.use('/api',router);
 const server=await new Promise(resolve=>{
  const instance=app.listen(0,'127.0.0.1',()=>resolve(instance));
 });
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 const form=new FormData();
 form.append('files',new Blob(['test upload'],{type:'text/plain'}),'test.txt');
 const response=await fetch('http://127.0.0.1:'+server.address().port+
  '/api/attachments/'+encodeURIComponent(complaintId),{method:'POST',body:form});
 assert.equal(response.status,500);
 assert.equal(written.size,0,'files must be removed after unsuccessful audit');
});
