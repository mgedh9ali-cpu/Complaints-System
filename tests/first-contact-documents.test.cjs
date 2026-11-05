'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const JSZip=require('jszip'),{SaxesParser}=require('saxes');
const {validComplaint,validComplaintDraft,validStatePayload}=require('../lib/validation');
const {openDatabase}=require('../config/db'),{createComplaintsService}=require('../modules/complaints/service'),{createAuditService}=require('../modules/audit/service'),{createReportsService}=require('../modules/reports/service');
const {storageFor}=require('../lib/storage-codec');
function fixture(t){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'first-contact-')),file=path.join(directory,'office.sqlite'),db=openDatabase(file);
 for(const [id,role]of [['admin','admin'],['staff','staff'],['reviewer','reviewer']])db.prepare('INSERT INTO users(id,username,password_hash,role,active,created_at) VALUES(?,?,?,?,1,?)').run(id,id,'synthetic',role,new Date().toISOString());
 const auditService=createAuditService({db,databasePath:file});const audit=(...args)=>auditService.record(...args);audit.syncHead=()=>auditService.syncHead();
 const complaints=createComplaintsService({db,audit});const reports=createReportsService({complaintsService:complaints});
 t.after(()=>{db.close();fs.rmSync(directory,{recursive:true,force:true});});
 return {db,complaints,reports,audit,auditService};
}
const body={summary:'بلاغ اختباري',province:'دمشق',category:'استفسار',details:'تفاصيل اصطناعية',firstContactDate:'2026-10-19'};
test('first contact accepts only valid calendar dates and remains optional for older records and drafts',()=>{
 for(const date of ['2024-02-29','2026-10-19',null,'',undefined]){assert.equal(validComplaint({...body,firstContactDate:date}),true);assert.equal(validComplaintDraft({...body,firstContactDate:date}),true);}
 for(const date of ['2026-02-29','2026-02-30','19/10/2026','2026-10-19T12:00:00Z',42,{}])assert.equal(validComplaint({...body,firstContactDate:date}),false);
 assert.equal(validStatePayload({complaints:[{...body,id:'A',firstContactDate:'2026-02-30'}],notifications:[],templates:[],settings:{}}),false);
});
test('first contact persists in state and indexed records and edits are audited independently of creation time',t=>{
 const f=fixture(t),result=f.complaints.createComplaint({body,userId:'staff',username:'staff'}),id=result.complaint.id;
 assert.equal(result.complaint.firstContactDate,'2026-10-19');const created=result.complaint.created;
 const edited=f.complaints.updateComplaint({complaintId:id,body:{firstContactDate:'2026-10-20'},userId:'staff',username:'staff'});assert.equal(edited.ok,true);
 assert.equal(f.complaints.readState().state.complaints[0].firstContactDate,'2026-10-20');assert.equal(edited.complaint.created,created);
 const row=f.db.prepare('SELECT payload_json FROM complaints WHERE id=?').get(id);assert.equal(storageFor(f.db).decodeJson(row.payload_json,'complaint:'+id).firstContactDate,'2026-10-20');
 const event=f.auditService.listEvents().find(e=>e.action==='complaint_updated');assert.deepEqual(event.details.changes.firstContactDate,{before:'2026-10-19',after:'2026-10-20'});assert.equal(f.auditService.verifyChain().ok,true);
});
test('individual Word is a valid RTL OOXML package with escaped complaint content, full details and the contact date',async()=>{
 const c={...body,id:'SY-2026-000001',name:'<اسم>&"',details:'تفاصيل طويلة & <نص>\n'.repeat(200),created:'2026-11-05T00:00:00Z',notes:[{text:'ملاحظة داخلية',by:'staff'}],timeline:[{event:'تسجيل الشكوى',detail:'توثيق'}]};
 const reports=createReportsService({complaintsService:{readState:()=>({state:{complaints:[c]}})}});
 const result=await reports.buildSingleDocx(c.id,'admin');const zip=await JSZip.loadAsync(result.buffer);const xml=await zip.file('word/document.xml').async('string');
 assert.equal(result.filename.endsWith('.docx'),true);assert.match(xml,/2026-10-19/);assert.match(xml,/تاريخ أول تواصل/);assert.match(xml,/&lt;اسم&gt;&amp;&quot;/);assert.match(xml,/<w:bidi\/>/);assert.match(xml,/<w:rtl\/>/);assert.match(xml,/الملاحظات الداخلية/);assert.match(xml,/سجل الإجراءات/);
 for(const [name,file]of Object.entries(zip.files))if(!file.dir&&(name.endsWith('.xml')||name.endsWith('.rels'))){let error;const parser=new SaxesParser({xmlns:true});parser.on('error',e=>{error=e;});parser.write(await file.async('string')).close();assert.equal(error,undefined,name);}
 assert.equal((xml.match(/تفاصيل طويلة/g)||[]).length,200);assert.ok(zip.file('[Content_Types].xml'));assert.ok(zip.file('_rels/.rels'));
 const pdf=await reports.buildSinglePdf(c.id,'admin');assert.equal(pdf.buffer.subarray(0,5).toString(),'%PDF-');assert.equal(pdf.integrityHash,result.integrityHash);
 c.firstContactDate='2026-10-20';assert.notEqual((await reports.buildSingleDocx(c.id,'admin')).integrityHash,result.integrityHash);
});
test('HTTP creation and edits validate dates, and document exports enforce authentication, permissions and audit',async t=>{
 const f=fixture(t),express=require('express'),roles=require('../modules/roles/service').createRolesService({db:f.db});
 f.db.prepare('INSERT INTO user_permissions(user_id,overrides_json) VALUES(?,?)').run('reviewer',JSON.stringify({'export.xlsx':false}));
 const app=express();app.use(express.json());const middleware={requireAuth(req,res,next){const role=req.get('X-Test-Role');if(!role)return res.sendStatus(401);req.user={id:role,username:role,role};next();},requireCsrf(req,res,next){if(req.get('X-CSRF-Token')!=='synthetic')return res.sendStatus(403);next();}};
 app.use('/api',require('../modules/complaints/routes').createComplaintsRouter({complaintsService:f.complaints,middleware,validComplaint,db:f.db,rolesService:roles}));
 app.use('/api',require('../modules/reports/routes').createReportsRouter({reportsService:f.reports,middleware,audit:f.audit,rolesService:roles}));
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});t.after(()=>new Promise(resolve=>server.close(resolve)));
 const base='http://127.0.0.1:'+server.address().port;
 const request=(url,role='admin',method='GET',value)=>fetch(base+url,{method,headers:{...(role?{'X-Test-Role':role}:{}),'X-CSRF-Token':'synthetic','Content-Type':'application/json'},body:value?JSON.stringify(value):undefined});
 assert.equal((await request('/api/complaints','staff','POST',{...body,firstContactDate:'2026-02-30'})).status,400);
 const made=await request('/api/complaints','staff','POST',body);assert.equal(made.status,201);const id=(await made.json()).complaint.id;
 assert.equal((await request('/api/complaints/'+id,'staff','PATCH',{firstContactDate:'bad'})).status,400);
 assert.equal((await request('/api/complaints/'+id,'staff','PATCH',{firstContactDate:'2026-10-20'})).status,200);
 for(const format of ['docx','pdf']){
  assert.equal((await request('/api/export/'+format+'/'+id,null)).status,401);assert.equal((await request('/api/export/'+format+'/'+id,'reviewer')).status,403);
  const response=await request('/api/export/'+format+'/'+id);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.match(response.headers.get('content-disposition'),/attachment/);assert.ok((await response.arrayBuffer()).byteLength>500);
  assert.equal((await request('/api/export/'+format+'/MISSING')).status,404);
 }
 assert.ok(f.auditService.listEvents().some(e=>e.action==='docx_export_single'));assert.ok(f.auditService.listEvents().some(e=>e.action==='pdf_export_single'));
});
