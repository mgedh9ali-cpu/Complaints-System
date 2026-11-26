'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {openDatabase}=require('../config/db');
const {createComplaintsService}=require('../modules/complaints/service');

// A record that already carries a note written by another (historical) account must accept a
// new internal note from the acting account: the UI prepends the note (c.notes.unshift), so the
// identity check has to look at the notes that are actually new, never at the stored ones.
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'complaint-note-identity-'));
 const db=openDatabase(path.join(dir,'office.sqlite'));
 t.after(()=>{db.close();fs.rmSync(dir,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const user=db.prepare('INSERT INTO users(id,username,password_hash,role,active,created_at) VALUES(?,?,?,?,1,?)');
 const now=new Date().toISOString();
 user.run('admin-id','director','test-only','admin',now);
 user.run('staff-id','employee','test-only','staff',now);
 const service=createComplaintsService({db,audit(){},logger:null});
 const employeeNote={text:'ملاحظة الموظف السابقة',by:'employee',at:'2026-01-05T09:00:00.000Z'};
 const original={complaints:[{id:'SY-TEST-0001',status:'new',summary:'بلاغ تجريبي',
  province:'دمشق',category:'خدمات',created:now,updated:now,statusHistory:[],
  notes:[employeeNote],timeline:[]}],notifications:[],templates:[],settings:{}};
 const init=service.saveState({state:original,userId:'staff-id',expectedRevision:0});
 assert.equal(init.invalidTransition,undefined);
 return {service,init,original,employeeNote};
}

test('director can prepend an internal note to a record whose stored note belongs to another account',t=>{
 const f=fixture(t);
 const next=structuredClone(f.original);
 next.complaints[0].notes.unshift({text:'ملاحظة المدير الجديدة',by:'director',at:'2026-01-06T10:00:00.000Z'});
 const saved=f.service.saveState({state:next,userId:'admin-id',expectedRevision:f.init.revision});
 assert.equal(saved.invalidTransition,undefined,saved.error);
 assert.equal(saved.conflict,false);
 const notes=f.service.readState().state.complaints[0].notes;
 assert.equal(notes.length,2);
 assert.equal(notes[0].by,'director');
 assert.equal(notes[0].text,'ملاحظة المدير الجديدة');
 assert.deepEqual(notes[1],f.employeeNote);
});

test('director cannot prepend an internal note attributed to another account',t=>{
 const f=fixture(t);
 const next=structuredClone(f.original);
 next.complaints[0].notes.unshift({text:'ملاحظة منتحلة',by:'employee',at:'2026-01-06T10:00:00.000Z'});
 const saved=f.service.saveState({state:next,userId:'admin-id',expectedRevision:f.init.revision});
 assert.equal(saved.invalidTransition,true);
 assert.equal(saved.error,'لا يمكن إضافة ملاحظة باسم مستخدم آخر.');
 assert.deepEqual(f.service.readState().state.complaints[0].notes,[f.employeeNote]);
});
