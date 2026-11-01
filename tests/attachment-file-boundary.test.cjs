'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {saveAttachment,listAttachmentsForComplaint,MAX_FILES_PER_COMPLAINT}=require('../lib/attachments');

test('attachment storage rejects path traversal IDs and enforces total per-complaint quota',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'complaint-attachment-policy-'));
 const old=process.env.DATABASE_PATH;
 process.env.DATABASE_PATH=path.join(dir,'office.sqlite');
 t.after(()=>{
  if(old===undefined)delete process.env.DATABASE_PATH;
  else process.env.DATABASE_PATH=old;
  fs.rmSync(dir,{recursive:true,force:true});
 });
 const file={originalname:'test.txt',mimetype:'text/plain',buffer:Buffer.from('اختبار مرفقات'),'size':Buffer.byteLength('اختبار مرفقات')};
 for(const unsafe of ['../other','..\\other','../../outside','ID/../evil','ID\\evil','']) {
  assert.throws(()=>saveAttachment(unsafe,file),/معرّف الشكوى/);
 }
 for(let i=0;i<MAX_FILES_PER_COMPLAINT;i++){
  const stored=saveAttachment('SY-2026-TEST',file);
  assert.equal(stored.size,file.size);
 }
 assert.equal(listAttachmentsForComplaint('SY-2026-TEST').length,MAX_FILES_PER_COMPLAINT);
 assert.throws(()=>saveAttachment('SY-2026-TEST',file),/الحد الأقصى/);
 assert.equal(listAttachmentsForComplaint('SY-2026-TEST').length,MAX_FILES_PER_COMPLAINT);
});
