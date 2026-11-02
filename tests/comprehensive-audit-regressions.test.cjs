'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const {openDatabase}=require('../config/db');
const {createAuditService}=require('../modules/audit/service');
const {createComplaintsService}=require('../modules/complaints/service');
const {sealPackage,openPackage}=require('../lib/sync-envelope');
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'audit-regression-')),file=path.join(dir,'test.sqlite');
 const db=openDatabase(file,{storageKey:'synthetic-regression-storage-key-32chars'});
 db.prepare('INSERT INTO users(id,username,password_hash,role,active,created_at) VALUES(?,?,?,?,1,?)').run('a','director','test','admin',new Date().toISOString());
 const auditService=createAuditService({db,databasePath:file}),audit=(...args)=>auditService.record(...args);audit.syncHead=()=>auditService.syncHead();
 const service=createComplaintsService({db,audit});
 const created=service.createComplaint({body:{summary:'شكوى اصطناعية',province:'دمشق',category:'خدمات'},userId:'a',username:'director'});
 assert.equal(created.ok,true);
 t.after(()=>{db.close();fs.rmSync(dir,{recursive:true,force:true});});
 return {db,service,auditService,id:created.complaint.id};
}
test('field update returns success consistent with durable encrypted state and audit',t=>{
 const {db,service,auditService,id}=fixture(t);
 const result=service.updateComplaint({complaintId:id,body:{summary:'تعديل اختبار'},userId:'a',username:'director'});
 assert.equal(result.ok,true);assert.equal(service.readState().state.complaints[0].summary,'تعديل اختبار');
 assert.equal(auditService.listEvents()[0].details.changes.summary.after,'تعديل اختبار');
 assert.equal(db.prepare('SELECT state_json FROM app_state').get().state_json.includes('تعديل اختبار'),false);
});
test('generic state writes reject forged notes and audit legitimate notes with before and after',t=>{
 const {service,auditService}=fixture(t);let current=service.readState();
 current.state.complaints[0].notes=[{text:'اختبار',by:'another_manager',at:new Date().toISOString()}];
 assert.equal(service.saveState({state:current.state,userId:'a',expectedRevision:current.revision}).invalidTransition,true);
 current=service.readState();current.state.complaints[0].notes=[{text:'اختبار',by:'director',at:new Date().toISOString()}];
 assert.equal(service.saveState({state:current.state,userId:'a',expectedRevision:current.revision}).conflict,false);
 assert.ok(auditService.listEvents().some(e=>e.details.changes?.notes));
});
test('document proofs read encrypted audit details',t=>{
 const {auditService,id}=fixture(t);const event=auditService.record('a','reply_document_issued','complaint',id,{digest:'synthetic-digest'});
 assert.equal(auditService.findDocumentProof(event.eventHash).digest,'synthetic-digest');assert.equal(auditService.verifyChain().ok,true);
});
test('sync encryption authenticates the entire package and rejects plaintext and wrong passwords',()=>{
 const payload={state:{complaints:[{name:'fictional-private-marker'}]},attachmentFiles:[{data:'synthetic'}]},password='synthetic-transfer-password';
 const envelope=sealPackage(payload,password);
 assert.equal(JSON.stringify(envelope).includes('fictional-private-marker'),false);
 assert.deepEqual(openPackage(envelope,password),payload);
 assert.throws(()=>openPackage(payload,password));assert.throws(()=>openPackage(envelope,'different-test-password'));
 const tampered=structuredClone(envelope);const bytes=Buffer.from(tampered.data,'base64');bytes[0]^=1;tampered.data=bytes.toString('base64');assert.throws(()=>openPackage(tampered,password));
});
test('cancelled form files never leak into a later complaint; only submission snapshot uploads',async()=>{
 let mutation,createdHandler,currentForm,currentInput,currentPreview;const uploads=[];
 function newForm(){currentForm={dataset:{},querySelector:()=>({appendChild(){}})};currentInput={files:[],handlers:{},addEventListener(t,f){this.handlers[t]=f;}};currentPreview={hidden:true,innerHTML:''};}
 const document={body:{},querySelector(s){if(s==='#newComplaintForm')return currentForm;if(s==='#cAttachments')return currentInput;if(s==='#cAttachPreview')return currentPreview;return null;},querySelectorAll:()=>[],createElement:()=>({})};
 const context={document,window:{addEventListener(t,f){if(t==='complaints:created')createdHandler=f;},__uploadAttachments:async(id,files)=>{uploads.push({id,files});return files;}},MutationObserver:class{constructor(f){mutation=f;}observe(){}},console:{log(){},info(){}}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../attachments-ui-bridge.js'),'utf8'),context);
 newForm();mutation();currentInput.files=[{name:'cancelled.txt',size:12}];currentInput.handlers.change();currentForm=null;mutation();newForm();mutation();
 await createdHandler({detail:{id:'SY-NEXT'}});assert.equal(uploads.length,0);
 await createdHandler({detail:{id:'SY-CURRENT',files:[{name:'correct.txt',size:4}]}});assert.equal(uploads.length,1);assert.equal(uploads[0].id,'SY-CURRENT');assert.equal(uploads[0].files[0].name,'correct.txt');
});
