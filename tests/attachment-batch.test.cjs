'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { saveAttachmentBatch } = require('../modules/attachments/upload-batch');

function fixture(existingCount = 0, failAt = -1) {
  const stored = Array.from({length:existingCount},(_,i)=>({storedName:'old-'+i}));
  const removed = [];
  let saves = 0;
  const attachmentsService = {
    MAX_FILES_PER_COMPLAINT: 5,
    listByComplaint(){ return stored.slice(); },
    save(id,file) {
      if (saves===failAt) throw new Error('invalid test file');
      const meta={storedName:id+'-'+saves, originalName:file.name, size:1};
      saves++; stored.push(meta); return meta;
    },
    remove(name) {
      removed.push(name);
      const i=stored.findIndex(x=>x.storedName===name);
      if(i>=0)stored.splice(i,1);
    }
  };
  return {attachmentsService,stored,removed};
}

test('successful multi-file upload retains all files',()=>{
  const f=fixture(2);
  const saved=saveAttachmentBatch({
    attachmentsService:f.attachmentsService, complaintId:'SY-2026-TEST',
    files:[{name:'a.pdf'},{name:'b.pdf'}]
  });
  assert.equal(saved.length,2);
  assert.equal(f.stored.length,4);
  assert.deepEqual(f.removed,[]);
});

test('a failed second file restores the previous attachment count',()=>{
  const f=fixture(1,1);
  assert.throws(()=>saveAttachmentBatch({
    attachmentsService:f.attachmentsService, complaintId:'SY-2026-TEST',
    files:[{name:'valid.pdf'},{name:'bad.pdf'}]
  }),/invalid test file/);
  assert.deepEqual(f.stored.map(x=>x.storedName),['old-0']);
  assert.deepEqual(f.removed,['SY-2026-TEST-0']);
});

test('quota is checked before any file is saved',()=>{
  const f=fixture(4);
  assert.throws(()=>saveAttachmentBatch({
    attachmentsService:f.attachmentsService, complaintId:'SY-2026-TEST',
    files:[{name:'a.pdf'},{name:'b.pdf'}]
  }),/الحد الأقصى/);
  assert.equal(f.stored.length,4);
  assert.deepEqual(f.removed,[]);
});

test('storage and empty request fail closed',()=>{
  assert.throws(()=>saveAttachmentBatch({
    attachmentsService:null, complaintId:'test', files:[{name:'x.pdf'}]
  }),/unavailable/);
  assert.throws(()=>saveAttachmentBatch({
    attachmentsService:fixture().attachmentsService, complaintId:'test', files:[]
  }),/لم يتم إرسال/);
});
