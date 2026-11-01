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
