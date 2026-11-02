'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { openDatabase } = require('../config/db');
const { createAuditService } = require('../modules/audit/service');
const { createComplaintsService } = require('../modules/complaints/service');
const { createAuthService } = require('../modules/auth/service');
const { createRolesService } = require('../modules/roles/service');
const { createApprovalsService } = require('../modules/approvals/service');
const { createAttachmentsService } = require('../modules/attachments/service');
const { createReportsService } = require('../modules/reports/service');
const { createStorageCodec } = require('../lib/storage-codec');
const { validStatePayload } = require('../lib/validation');
const { createEncryptedBundle, extractEncryptedBundle } = require('../lib/full-backup');
const { createBackupScheduler, pruneBackups } = require('../modules/backup/scheduler');
const KEY = 'test-only-storage-key-with-at-least-32-characters';
const BACKUP_KEY = 'test-only-backup-key-with-at-least-32-characters';

function fixture(t, encrypted = false) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-readiness-'));
  const file = path.join(dir, 'office.sqlite');
  const db = openDatabase(file, encrypted ? { storageKey: KEY } : {});
  const insert = db.prepare('INSERT INTO users(id,username,password_hash,role,active,created_at) VALUES(?,?,?,?,1,?)');
  const now = new Date().toISOString();
  insert.run('a1','director','test','admin',now); insert.run('a2','manager','test','admin',now);
  insert.run('s1','employee','test','staff',now); insert.run('r1','observer','test','reviewer',now);
  const auditService = createAuditService({ db, databasePath: file });
  const audit = (...args) => auditService.record(...args); audit.syncHead = () => auditService.syncHead();
  const roles = createRolesService({ db });
  const complaints = createComplaintsService({ db, audit, rolesService: roles });
  const auth = createAuthService({ db, audit });
  const oldEnv = { DATABASE_PATH: process.env.DATABASE_PATH, DATA_KEY: process.env.DATA_KEY, SESSION_SECRET: process.env.SESSION_SECRET };
  process.env.DATABASE_PATH = file;
  if (encrypted) process.env.DATA_KEY = KEY; else { delete process.env.DATA_KEY; delete process.env.SESSION_SECRET; }
  const attachments = createAttachmentsService();
  const approvals = createApprovalsService({ db, audit, complaintsService: complaints, attachmentsService: attachments });
  t.after(() => {
    if (db.open) db.close(); fs.rmSync(dir,{recursive:true,force:true});
    for (const [key,value] of Object.entries(oldEnv)) { if (value === undefined) delete process.env[key]; else process.env[key]=value; }
  });
  const create = (extra = {}) => complaints.createComplaint({ body: { summary:'بلاغ اصطناعي سري',province:'دمشق',category:'استفسار',details:'تفاصيل اصطناعية خاصة',name:'اسم وهمي',phone:'0912345678', ...extra },userId:'s1',username:'employee' });
  return {dir,file,db,audit,auditService,roles,complaints,auth,approvals,attachments,create};
}
const admin = { id:'a1',username:'director',role:'admin' };
const otherAdmin = { id:'a2',username:'manager',role:'admin' };

test('storage encryption authenticates bytes and binds them to their row or file', () => {
  const codec = createStorageCodec(KEY);
  const value = codec.encodeJson({secret:'citizen-private'}, 'complaint:A');
  assert.equal(value.includes('citizen-private'),false);
  assert.deepEqual(codec.decodeJson(value,'complaint:A'),{secret:'citizen-private'});
  assert.throws(()=>codec.decodeJson(value,'complaint:B'));
  assert.throws(()=>createStorageCodec('different-storage-key-with-32-characters').decodeJson(value,'complaint:A'));
  const sealed = codec.seal(Buffer.from('private attachment'),'attachment:A'); sealed[sealed.length-1]^=1;
  assert.throws(()=>codec.open(sealed,'attachment:A'));
});

test('encrypted database and audit survive restart without exposing complaint contents', t => {
  const f=fixture(t,true); const c=f.create().complaint;
  assert.equal(f.complaints.readState().state.complaints[0].summary,c.summary);
  const state=f.complaints.readState(); state.state.complaints[0].summary='تعديل اصطناعي سري';
  assert.equal(f.complaints.saveState({state:state.state,userId:'s1',expectedRevision:state.revision}).conflict,false);
  const event=f.auditService.listEvents().find(e=>e.action==='complaint_updated');
  assert.equal(event.details.changes.summary.before,c.summary);
  assert.equal(event.details.changes.summary.after,'تعديل اصطناعي سري');
  f.db.pragma('wal_checkpoint(TRUNCATE)');
  assert.equal(fs.readFileSync(f.file).includes(Buffer.from(c.summary)),false);
  assert.equal(f.auditService.verifyChain().ok,true);
  f.db.close();
  assert.throws(()=>openDatabase(f.file),/DATA_KEY/);
  assert.throws(()=>openDatabase(f.file,{storageKey:'incorrect-key-long-enough-for-this-test'}));
  const reopened=openDatabase(f.file,{storageKey:KEY});
  try { assert.equal(createComplaintsService({db:reopened,audit(){}}).readState().state.complaints[0].summary,'تعديل اصطناعي سري'); }
  finally { reopened.close(); }
});

test('legacy plaintext migration preserves the data and a protected pre-migration snapshot', t => {
  const f=fixture(t); const c=f.create().complaint;
  assert.equal(fs.readFileSync(f.file+'-wal').includes(Buffer.from(c.summary)),true);
  f.db.close();
  const migrated=openDatabase(f.file,{storageKey:KEY});
  try {
    assert.equal(createComplaintsService({db:migrated,audit(){}}).readState().state.complaints[0].id,c.id);
    assert.equal(fs.readFileSync(f.file).includes(Buffer.from(c.summary)),false);
    assert.ok(fs.readdirSync(path.join(f.dir,'backups')).some(n=>n.startsWith('before-encryption-')&&n.endsWith('.enc')));
    assert.equal(createAuditService({db:migrated,databasePath:f.file}).verifyChain().ok,true);
  } finally { migrated.close(); }
});

test('custom permissions are live, deny overrides work and administrative powers cannot be delegated', t => {
  const f=fixture(t);
  assert.equal(f.roles.can({id:'s1',role:'staff'},'complaints.create'),true);
  assert.equal(f.auth.setPermissions({targetId:'s1',actorId:'a1',overrides:{'complaints.create':false,'replies.approve':true}}).ok,true);
  assert.equal(f.roles.can({id:'s1',role:'staff'},'complaints.create'),false);
  assert.equal(f.roles.can({id:'s1',role:'staff'},'replies.approve'),true);
  assert.equal(f.auth.setPermissions({targetId:'s1',actorId:'a1',overrides:{'users.manage':true}}).status,400);
  assert.equal(f.roles.can({id:'s1',role:'staff'},'users.manage'),false);
  assert.equal(f.db.prepare('SELECT session_version AS n FROM users WHERE id=?').get('s1').n,1);
});

test('user creation rolls back with audit failure', t => {
  const f=fixture(t);
  const auth=createAuthService({db:f.db,audit(){throw new Error('audit storage failed');}});
  assert.throws(()=>auth.createUser({username:'newemployee',password:'Test-password-2026',role:'staff',actorId:'a1'}),/audit storage failed/);
  assert.equal(f.db.prepare('SELECT id FROM users WHERE username=?').get('newemployee'),undefined);
});

test('reply approval rejects its author and last editor, then preserves the approved text', t => {
  const f=fixture(t);const id=f.create().complaint.id;
  const act=(action,userId,username,text)=>f.complaints.actOnReply({complaintId:id,action,userId,username,text});
  assert.equal(act('draft','s1','employee','نص الرد الأول').ok,true);
  assert.equal(act('review','s1','employee').ok,true);
  f.auth.setPermissions({targetId:'s1',actorId:'a1',overrides:{'replies.approve':true}});
  assert.equal(act('approve','s1','employee').ok,false);
  assert.equal(act('draft','a1','director','نص عدّله المدير').ok,true);
  assert.equal(act('review','a1','director').ok,true);
  assert.equal(act('approve','a1','director').ok,false,'last editor must not approve');
  assert.equal(act('approve','a2','manager').ok,true);
  const reply=f.complaints.readState().state.complaints[0].reply;
  assert.equal(reply.approvedById,'a2'); assert.ok(reply.approvedAt);
  assert.equal(act('draft','s1','employee','تبديل بعد الاعتماد').ok,false);
  assert.equal(act('sent','s1','employee').ok,true);
  assert.equal(f.complaints.readState().state.complaints[0].reply.text,'نص عدّله المدير');
});

test('closure waits for referral responses and reopening requires its own permission and reason', t => {
  const f=fixture(t);const id=f.create().complaint.id;
  const status=(toStatus,userId='s1',reason='سبب اختباري')=>f.complaints.changeStatus({complaintId:id,toStatus,userId,username:userId==='s1'?'employee':'director',reason});
  assert.equal(status('in_progress').ok,true);
  assert.equal(f.complaints.addReferral({complaintId:id,entity:'جهة اختبارية',due:new Date(Date.now()+86400000).toISOString(),userId:'s1',username:'employee'}).ok,true);
  assert.equal(status('closed').ok,false);
  assert.equal(f.complaints.recordReferralResponse({complaintId:id,index:0,response:'تمت متابعة المعاملة',userId:'s1',username:'employee'}).ok,true);
  assert.equal(status('closed').ok,true);
  assert.equal(status('in_progress').status,403);
  assert.equal(status('in_progress','a1','').ok,false);
  assert.equal(status('in_progress','a1','وردت معلومات جديدة').ok,true);
});

test('cancellation after official referral requires a second person and executes only once', t => {
  const f=fixture(t);const id=f.create().complaint.id;
  f.complaints.changeStatus({complaintId:id,toStatus:'in_progress',userId:'s1',username:'employee'});
  f.complaints.addReferral({complaintId:id,entity:'جهة اختبار',due:new Date().toISOString(),userId:'s1',username:'employee'});
  assert.equal(f.complaints.changeStatus({complaintId:id,toStatus:'cancelled',reason:'طلب إلغاء',userId:'s1',username:'employee'}).approvalRequired,true);
  const request=f.approvals.request({kind:'complaint_cancel',complaintId:id,targetId:id,reason:'طلب إلغاء موثق',userId:'a1'});
  assert.equal(f.approvals.decide({id:request.id,decision:'approved',reason:'موافقة اختبارية',user:admin}).status,403);
  assert.equal(f.approvals.decide({id:request.id,decision:'approved',reason:'موافقة اختبارية',user:otherAdmin}).ok,true);
  assert.equal(f.complaints.readState().state.complaints[0].status,'cancelled');
  assert.equal(f.approvals.decide({id:request.id,decision:'approved',reason:'إعادة القرار',user:otherAdmin}).status,409);
});

test('approved complaint removal archives its indexed row and preserves its evidence', t => {
  const f=fixture(t,true);const id=f.create().complaint.id;
  assert.equal(f.complaints.deleteComplaint({complaintId:id,userId:'a1'}).status,409);
  const request=f.approvals.request({kind:'complaint_archive',complaintId:id,targetId:id,reason:'طلب حفظ في الأرشيف',userId:'s1'});
  assert.equal(request.ok,true);
  assert.equal(f.approvals.decide({id:request.id,decision:'approved',reason:'اعتماد الأرشفة',user:admin}).ok,true);
  assert.ok(f.db.prepare('SELECT id FROM complaints WHERE id=?').get(id));
  const archived=f.complaints.readState().state.complaints[0];assert.ok(archived.archivedAt);assert.equal(archived.archiveReason,'طلب حفظ في الأرشيف');
  assert.equal(createReportsService({complaintsService:f.complaints}).listComplaints().length,0);
  assert.equal(f.auditService.verifyChain().ok,true);
});

test('approval of a stale complaint is rejected without changing the complaint', t => {
  const f=fixture(t);const id=f.create().complaint.id;
  const request=f.approvals.request({kind:'complaint_archive',complaintId:id,targetId:id,reason:'طلب أرشفة',userId:'s1'});
  f.complaints.updateComplaint({complaintId:id,body:{summary:'تحديث بعد الطلب'},userId:'s1',username:'employee'});
  assert.equal(f.approvals.decide({id:request.id,decision:'approved',reason:'قرار متأخر',user:admin}).status,409);
  assert.equal(f.complaints.readState().state.complaints[0].archivedAt,undefined);
});

test('attachment files are encrypted, readable with their key and archived after separate approval', t => {
  const f=fixture(t,true);const id=f.create().complaint.id;const bytes=Buffer.from('private fictional attachment');
  const file=f.attachments.save(id,{originalname:'test.txt',mimetype:'text/plain',size:bytes.length,buffer:bytes});
  assert.equal(fs.readFileSync(f.attachments.getPath(file.storedName)).includes(bytes),false);
  assert.deepEqual(f.attachments.read(file.storedName),bytes);
  const request=f.approvals.request({kind:'attachment_delete',complaintId:id,targetId:file.storedName,reason:'حذف نسخة مكررة',userId:'s1'});
  assert.equal(f.approvals.decide({id:request.id,decision:'approved',reason:'اعتماد الحذف للأرشيف',user:admin}).ok,true);
  assert.equal(f.attachments.getPath(file.storedName),null);
  assert.ok(fs.existsSync(path.join(f.dir,'retired-attachments',file.storedName)));
});

test('duplicate linkage requires approval and prevents circular chains', t => {
  const f=fixture(t);const a=f.create().complaint.id,b=f.create().complaint.id;
  const request=f.approvals.request({kind:'complaint_duplicate',complaintId:b,targetId:a,reason:'نفس موضوع الشكوى',userId:'s1'});
  assert.equal(f.approvals.decide({id:request.id,decision:'approved',reason:'تم التحقق من التكرار',user:admin}).ok,true);
  assert.equal(f.complaints.readState().state.complaints.find(c=>c.id===b).duplicateOf,a);
  assert.equal(f.approvals.request({kind:'complaint_duplicate',complaintId:a,targetId:b,reason:'محاولة ربط دائري',userId:'s1'}).ok,false);
});

test('encrypted full backup restores the storage key, data, audit chain and archived attachments', async t => {
  const f=fixture(t,true);const id=f.create().complaint.id;
  const bytes=Buffer.from('restore-drill-private-data');
  const attachment=f.attachments.save(id,{originalname:'restore.txt',mimetype:'text/plain',size:bytes.length,buffer:bytes});
  f.attachments.archive(attachment.storedName);
  const out=path.join(f.dir,'bundle');fs.mkdirSync(out);
  const bundle=await createEncryptedBundle({databasePath:f.file,secret:BACKUP_KEY,backupDir:out});
  const destination=path.join(f.dir,'restored');
  const result=await extractEncryptedBundle({bundlePath:bundle.destination,secret:BACKUP_KEY,outputDir:destination});
  assert.equal(result.verified,true);
  const restoredKey=fs.readFileSync(path.join(destination,'storage-key'),'utf8');
  assert.equal(restoredKey,KEY);
  const db=openDatabase(path.join(destination,'database.sqlite'),{storageKey:restoredKey});
  try {
    assert.equal(createComplaintsService({db,audit(){}}).readState().state.complaints[0].id,id);
    assert.equal(createAuditService({db,databasePath:path.join(destination,'database.sqlite')}).verifyChain().ok,true);
    assert.ok(fs.existsSync(path.join(destination,'retired-attachments',attachment.storedName)));
  } finally { db.close(); }
});

test('automatic backups do not overlap, verify their output and expose failures', async t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'backup-scheduler-test-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  let finish;const gate=new Promise(r=>finish=r);let calls=0;
  const source=path.join(dir,'source.csb');fs.writeFileSync(source,'verified-test-fixture');
  const service={async createCompleteBackup(){calls++;await gate;return {destination:source,backupDir:'test'};},cleanupBackupDir(){}};
  const scheduler=createBackupScheduler({backupService:service,directory:path.join(dir,'backups')});
  const running=scheduler.runOnce();assert.equal(await scheduler.runOnce(),false);finish();
  assert.equal(await running,true);assert.equal(calls,1);assert.ok(scheduler.status().lastSuccessfulAt);
  const failed=createBackupScheduler({backupService:{async createCompleteBackup(){throw new Error('disk full');}},directory:path.join(dir,'failed')});
  assert.equal(await failed.runOnce(),false);assert.equal(failed.status().lastError,'disk full');
});

test('retention keeps recent snapshots and one successful daily copy for thirty days', t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'backup-retention-test-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const now=Date.now();
  for(const [name,age] of [['recent',1],['day-new',2*86400],['day-old',2*86400+60],['expired',31*86400]]){
    const file=path.join(dir,'automatic-'+name+'.csb');fs.writeFileSync(file,'test');fs.utimesSync(file,new Date(now-age*1000),new Date(now-age*1000));
  }
  fs.writeFileSync(path.join(dir,'before-import-retained.csb'),'test');
  pruneBackups(dir,now);
  assert.equal(fs.existsSync(path.join(dir,'automatic-expired.csb')),false);
  assert.equal(fs.existsSync(path.join(dir,'automatic-day-old.csb')),false);
  assert.equal(fs.existsSync(path.join(dir,'automatic-recent.csb')),true);
  assert.equal(fs.existsSync(path.join(dir,'before-import-retained.csb')),true);
});

test('server reminders repeat after the configured period and respect stop and closed status', t => {
  const f=fixture(t);const id=f.create({name:'',phone:'',details:''}).complaint.id;
  const stored=f.complaints.readState();stored.state.complaints[0].created=new Date(Date.now()-30*3600000).toISOString();
  // Set up an old imported fixture without rewriting a creation date through the live API.
  f.db.prepare('UPDATE app_state SET state_json=? WHERE id=1').run(JSON.stringify(stored.state));
  assert.equal(f.complaints.runReminders(),1);assert.equal(f.complaints.runReminders(),0);
  const state=f.complaints.readState();state.state.complaints[0].completionReminderStopped=true;
  assert.equal(f.complaints.saveState({state:state.state,userId:'s1',expectedRevision:state.revision}).conflict,false);
  assert.equal(f.complaints.runReminders(new Date(Date.now()+48*3600000)),0);
  assert.ok(f.auditService.listEvents().some(e=>e.action==='completion_reminded'));
});

test('unsafe notification identifiers and nested prototype keys cannot enter state or sync', () => {
  const state={complaints:[],notifications:[{id:'bad" onclick="alert(1)',title:'x',body:'x'}],templates:[],settings:{}};
  assert.equal(validStatePayload(state),false);
  state.notifications=[];state.settings=JSON.parse('{"__proto__":{"polluted":true}}');
  assert.equal(validStatePayload(state),false);
});

test('official complaint numbering is sequential, unique and resumes after restart', t => {
  const f=fixture(t);const first=f.create().complaint.id,second=f.create().complaint.id;
  assert.match(first,/^SY-\d{4}-\d{6,}$/);assert.equal(Number(second.split('-')[2]),Number(first.split('-')[2])+1);
  f.db.close();const db=openDatabase(f.file);
  try{const next=createComplaintsService({db,audit(){}}).createComplaint({body:{summary:'آخر',province:'دمشق',category:'استفسار'},userId:'s1',username:'employee'}).complaint.id;
    assert.equal(Number(next.split('-')[2]),Number(second.split('-')[2])+1);
  }finally{db.close();}
});

test('Arabic PDF embeds a real font and preserves long details across several pages', async t => {
  const f=fixture(t);const id=f.create({details:'تفاصيل اصطناعية طويلة لاختبار تصدير جميع السطور. '.repeat(300)}).complaint.id;
  const result=await createReportsService({complaintsService:f.complaints}).buildSinglePdf(id,'director');
  assert.equal(result.buffer.subarray(0,5).toString(),'%PDF-');
  assert.match(result.buffer.toString('latin1'),/\/FontFile2/);
  assert.ok((result.buffer.toString('latin1').match(/\/Type \/Page\b/g)||[]).length>=2);
});

test('TOTP follows the RFC 6238 test vector and rejects old, malformed and replayed codes',()=>{
 const {codeForStep,verifyTotp}=require('../lib/totp');
 const secret='GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
 assert.equal(codeForStep(secret,1),'287082');
 assert.equal(verifyTotp(secret,'287082',{now:59000}),1);
 assert.equal(verifyTotp(secret,'287082',{now:59000,lastStep:1}),null);
 assert.equal(verifyTotp(secret,'not-a-code',{now:59000}),null);
 assert.equal(verifyTotp(secret,'287082',{now:180000}),null);
});

test('two-factor enrollment encrypts its key, revokes sessions and consumes recovery codes once',t=>{
 const f=fixture(t,true);const password='Test-password-for-MFA-2026';
 const result=f.auth.createUser({username:'secureduser',password,role:'staff',actorId:'a1'});assert.equal(result.ok,true);
 const userId=result.user.id;
 assert.equal(f.auth.beginTwoFactor({userId,password:'wrong'}).status,401);
 const setup=f.auth.beginTwoFactor({userId,password});assert.equal(setup.ok,true);
 const {codeForStep}=require('../lib/totp');const step=Math.floor(Date.now()/30000);
 assert.equal(f.auth.confirmTwoFactor({userId,pending:setup.pending,code:'invalid'}).ok,false);
 const confirmed=f.auth.confirmTwoFactor({userId,pending:setup.pending,code:codeForStep(setup.secret,step)});
 assert.equal(confirmed.ok,true);assert.equal(confirmed.recoveryCodes.length,8);
 const row=f.db.prepare('SELECT totp_secret,totp_recovery,session_version FROM users WHERE id=?').get(userId);
 assert.equal(row.totp_secret.includes(setup.secret),false);
 assert.equal(row.totp_recovery.includes(confirmed.recoveryCodes[0]),false);
 assert.equal(row.session_version,1);
 assert.equal(f.auth.authenticate('secureduser',password).ok,false);
 assert.equal(f.auth.authenticate('secureduser',password,confirmed.recoveryCodes[0]).ok,true);
 assert.equal(f.auth.authenticate('secureduser',password,confirmed.recoveryCodes[0]).ok,false);
 const code=codeForStep(setup.secret,step+1);
 assert.equal(f.auth.authenticate('secureduser',password,code).ok,true);
 assert.equal(f.auth.authenticate('secureduser',password,code).ok,false);
 assert.equal(f.auth.disableTwoFactor({userId,password,code:confirmed.recoveryCodes[1]}).ok,true);
 assert.equal(f.auth.authenticate('secureduser',password).ok,true);
 assert.equal(f.auditService.verifyChain().ok,true);
});

test('long Unicode passwords do not collide after the bcrypt 72-byte boundary',()=>{
 const {hashPassword,verifyPassword}=require('../lib/passwords');
 const prefix='كلمةمرورطويلة'.repeat(8),first=prefix+'أ',second=prefix+'ب';
 const hash=hashPassword(first);
 assert.equal(verifyPassword(first,hash),true);assert.equal(verifyPassword(second,hash),false);
 const legacy=require('bcryptjs').hashSync('Legacy-password-2026',12);
 assert.equal(verifyPassword('Legacy-password-2026',legacy),true);
});

test('successful legacy-password login upgrades its hash without changing the password or access',t=>{
 const f=fixture(t);const bcrypt=require('bcryptjs');
 f.db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(bcrypt.hashSync('Legacy-password-2026',12),'s1');
 assert.equal(f.auth.authenticate('employee','Legacy-password-2026').ok,true);
 assert.match(f.db.prepare('SELECT password_hash FROM users WHERE id=?').get('s1').password_hash,/^sha256-bcrypt-v1\$/);
 assert.ok(f.auditService.listEvents().some(e=>e.action==='password_hash_upgraded'));
 assert.equal(f.auth.authenticate('employee','Legacy-password-2026').ok,true);
});

test('a committed audit event survives interrupted head publication and is recovered on restart',t=>{
 const f=fixture(t,true);f.create();
 const write=fs.writeFileSync;
 try{
  fs.writeFileSync=function(file,...args){if(typeof file==='number')throw new Error('simulated power interruption');return write.call(this,file,...args);};
  assert.throws(()=>f.create(),/simulated power interruption/);
 }finally{fs.writeFileSync=write;}
 assert.equal(f.complaints.readState().state.complaints.length,2,'the committed state and audit event must remain together');
 assert.ok(f.db.prepare('SELECT id FROM audit_head_pending WHERE id=1').get());
 const recovered=createAuditService({db:f.db,databasePath:f.file});
 assert.equal(recovered.verifyChain().ok,true);
 assert.equal(f.db.prepare('SELECT id FROM audit_head_pending WHERE id=1').get(),undefined);
 assert.ok(recovered.listEvents().some(e=>e.action==='audit_head_recovered'));
});

test('working timeline entries cannot impersonate another account through state saving',t=>{
 const f=fixture(t);f.create();const current=f.complaints.readState();
 current.state.complaints[0].timeline.unshift({event:'اعتماد الرد',by:'director',at:new Date().toISOString(),detail:'تزوير هوية'});
 const result=f.complaints.saveState({state:current.state,userId:'s1',expectedRevision:current.revision});
 assert.equal(result.invalidTransition,true);
 assert.equal(f.complaints.readState().state.complaints[0].timeline.length,1);
});

test('numbering advances beyond imported IDs without overwriting a complaint',t=>{
 const f=fixture(t);const first=f.create().complaint;
 const state=f.complaints.readState().state;state.complaints[0].id=first.id.replace(/\d{6}$/,'000500');
 const {createSyncPackage}=require('../lib/offline-sync');const {createSyncService}=require('../modules/sync/service');
 const sync=createSyncService({db:f.db,complaintsService:f.complaints,auditService:f.auditService,sourceInstanceId:'local',rootDir:path.resolve(__dirname,'..')});
 const payload=createSyncPackage(state,path.resolve(__dirname,'..'),'different-instance');
 assert.equal(sync.importPackage({payload,userId:'a1',forceReplace:true}).ok,true);
 const next=f.create().complaint;assert.match(next.id,/-000501$/);
 const stored=f.complaints.readState().state.complaints;assert.equal(stored.length,2);assert.equal(new Set(stored.map(c=>c.id)).size,2);
 assert.equal(stored.find(c=>c.id.endsWith('000500')).summary,first.summary);
});

test('settings edits through the UI state endpoint record protected before and after values',t=>{
 const f=fixture(t,true);f.create();const state=f.complaints.readState();const original=state.state.settings.slaDays;
 state.state.settings.slaDays=14;
 assert.equal(f.complaints.saveState({state:state.state,userId:'a1',expectedRevision:state.revision}).conflict,false);
 const event=f.auditService.listEvents().find(e=>e.action==='settings_updated');
 assert.equal(event.details.before.slaDays,original);assert.equal(event.details.after.slaDays,14);
});
