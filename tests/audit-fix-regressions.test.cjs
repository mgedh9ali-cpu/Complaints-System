'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {openDatabase}=require('../config/db');
const {createAuditService}=require('../modules/audit/service');
const {createComplaintsService}=require('../modules/complaints/service');
const {createRemindersService}=require('../modules/reminders/service');
const {createRolesService}=require('../modules/roles/service');
const {listStoredBackups}=require('../modules/backup/service');
const KEY='synthetic-audit-fix-storage-key-32-characters';
function fixture(t,encrypted=true){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'complaints-audit-fix-')),file=path.join(dir,'office.sqlite');
 const db=openDatabase(file,encrypted?{storageKey:KEY}:{});
 const insert=db.prepare('INSERT INTO users(id,username,password_hash,role,active,created_at) VALUES(?,?,?,?,1,?)');
 for(const [id,role] of [['a','admin'],['b','admin'],['s','staff'],['r','reviewer']])insert.run(id,id,'test-only',role,new Date().toISOString());
 const auditService=createAuditService({db,databasePath:file}),audit=(...args)=>auditService.record(...args);audit.syncHead=()=>auditService.syncHead();
 const roles=createRolesService({db}),service=createComplaintsService({db,audit,rolesService:roles});
 const created=service.createComplaint({body:{summary:'Synthetic complaint',province:'دمشق',category:'اختبار',details:'synthetic',name:'fictional',phone:'0999999999'},userId:'s',username:'s'});
 const f={db,dir,file,audit,auditService,roles,service,id:created.complaint.id};
 t.after(()=>{if(f.db.open)f.db.close();fs.rmSync(dir,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 return f;
}
function act(f,user,action,text){return f.service.actOnReply({complaintId:f.id,userId:user,username:user,action,text});}
function save(f,user,change){const c=f.service.readState();change(c.state.complaints[0]);return f.service.saveState({state:c.state,userId:user,expectedRevision:c.revision});}

test('reply permissions are enforced for every action, including deny overrides',t=>{
 const f=fixture(t);
 assert.equal(act(f,'r','draft','forbidden').status,403);
 assert.equal(act(f,'s','draft','reviewable reply').ok,true);
 assert.equal(act(f,'s','review').ok,true);
 assert.equal(act(f,'a','approve').ok,true);
 assert.equal(act(f,'r','sent').status,403);
 f.db.prepare('INSERT INTO user_permissions VALUES(?,?)').run('s',JSON.stringify({'replies.send':false}));
 assert.equal(act(f,'s','sent').status,403);
 assert.equal(act(f,'a','sent').ok,true);
 assert.equal(f.auditService.verifyChain().ok,true);
});

test('approved and sent replies cannot return to review or be rewritten',t=>{
 const f=fixture(t);act(f,'s','draft','immutable');act(f,'s','review');act(f,'a','approve');
 for(const phase of ['approved','sent']){
  assert.equal(act(f,'b','review').ok,false);
  assert.equal(act(f,'b','draft','replacement').ok,false);
  assert.equal(save(f,'b',c=>{c.reply.status='review';}).invalidTransition,true);
  if(phase==='approved')assert.equal(act(f,'s','sent').ok,true);
 }
 assert.equal(f.service.readState().state.complaints[0].reply.text,'immutable');
});

test('legacy state saves cannot self-approve, skip approval or forge reply metadata',t=>{
 const f=fixture(t);act(f,'a','draft','author reply');act(f,'a','review');
 assert.equal(save(f,'a',c=>{c.reply.status='approved';}).invalidTransition,true);
 assert.equal(save(f,'s',c=>{c.reply.status='sent';}).invalidTransition,true);
 assert.equal(save(f,'a',c=>{delete c.reply.authorId;delete c.reply.editedById;c.reply.status='approved';}).invalidTransition,true);
 assert.equal(save(f,'b',c=>{c.reply.authorId='b';}).invalidTransition,true);
 assert.equal(save(f,'b',c=>{c.reply.text='my own rewrite';c.reply.status='approved';}).invalidTransition,true);
 const accepted=save(f,'b',c=>{c.reply.status='approved';delete c.reply.authorId;delete c.reply.editedById;});
 assert.equal(accepted.conflict,false);
 const reply=f.service.readState().state.complaints[0].reply;
 assert.equal(reply.authorId,'a');assert.equal(reply.approvedById,'b');assert.equal(reply.approvedBy,'b');assert.ok(reply.approvedAt);
 assert.equal(save(f,'s',c=>{c.reply.status='sent';}).conflict,false);
 assert.equal(f.auditService.verifyChain().ok,true);
});

test('review text edits preserve author identity and prevent editor self-approval',t=>{
 const f=fixture(t);act(f,'s','draft','initial');act(f,'s','review');
 assert.equal(save(f,'a',c=>{c.reply.text='edited during review';}).conflict,false);
 assert.equal(act(f,'a','approve').status,403);
 assert.equal(act(f,'b','approve').ok,true);
});

test('malformed reply bodies cannot enter either persistence path',t=>{
 const f=fixture(t);
 for(const value of [[], 'not-an-object', {text:9,status:'draft'}, {text:'x',status:'unknown'}])
 assert.equal(save(f,'s',c=>{c.reply=value;}).invalidTransition,true);
 assert.equal(act(f,'s','draft',{}).status,400);
});

test('failed or malformed audit differences abort the write and preserve its revision',t=>{
 const f=fixture(t),before=f.service.readState(),events=f.auditService.listEvents().length;
 for(const diff of [()=>{throw Error('synthetic failure');},()=>null]){
  const state=structuredClone(before.state);state.complaints[0].details='should not persist';
  assert.throws(()=>f.service.saveState({state,userId:'s',expectedRevision:before.revision,diffComplaints:diff}));
 }
 assert.deepEqual(f.service.readState(),before);assert.equal(f.auditService.listEvents().length,events);
});

test('reminder notes are encrypted, readable and bound to their row identity',t=>{
 const f=fixture(t),reminders=createRemindersService({db:f.db,complaintsService:f.service,audit:f.audit});
 const make=note=>reminders.createReminder({complaintId:f.id,note,reminderTime:new Date(Date.now()-1000).toISOString(),userId:'s'});
 const a=make('SYNTHETIC_PRIVATE_NOTE'),b=make('different private note');
 const raw=f.db.prepare('SELECT * FROM complaint_reminders WHERE id=?').get(a.reminder.id);
 assert.equal(raw.note_encrypted,1);assert.equal(raw.note.includes('SYNTHETIC_PRIVATE_NOTE'),false);
 assert.equal(reminders.listForComplaint(f.id)[0].note,'SYNTHETIC_PRIVATE_NOTE');
 assert.equal(reminders.listDue()[0].note,'SYNTHETIC_PRIVATE_NOTE');
 f.db.prepare('UPDATE complaint_reminders SET note=? WHERE id=?').run(raw.note,b.reminder.id);
 assert.throws(()=>reminders.listForComplaint(f.id));
});

test('reminder creation and dismissal roll back together with a failed audit',t=>{
 const f=fixture(t),good=createRemindersService({db:f.db,complaintsService:f.service,audit:f.audit});
 const bad=createRemindersService({db:f.db,complaintsService:f.service,audit(){throw Error('synthetic audit failure');}});
 const args={complaintId:f.id,note:'synthetic private note',reminderTime:new Date().toISOString(),userId:'s'};
 assert.throws(()=>bad.createReminder(args));assert.equal(f.db.prepare('SELECT count(*) n FROM complaint_reminders').get().n,0);
 const saved=good.createReminder(args);assert.throws(()=>bad.dismiss(saved.reminder.id,'s'));
 assert.equal(f.db.prepare('SELECT is_dismissed FROM complaint_reminders').get().is_dismissed,0);
 assert.equal(f.auditService.verifyChain().ok,true);
});

test('legacy notes migrate on both initial encryption and already-encrypted profiles',t=>{
 for(const encrypted of [false,true]){
  const f=fixture(t,encrypted);
  f.db.prepare('INSERT INTO complaint_reminders(complaint_id,reminder_time,note,created_by) VALUES(?,?,?,?)').run(f.id,new Date().toISOString(),'legacy synthetic note','s');
  f.db.close();f.db=openDatabase(f.file,{storageKey:KEY});
  const row=f.db.prepare('SELECT id,note,note_encrypted FROM complaint_reminders').get();
  assert.equal(row.note_encrypted,1);assert.equal(row.note.includes('legacy synthetic note'),false);
  const reminders=createRemindersService({db:f.db,complaintsService:f.service,audit:f.audit});
  assert.equal(reminders.listForComplaint(f.id)[0].note,'legacy synthetic note');
 }
});

test('configured completion reminders use the chosen interval and respect repeat timing',t=>{
 const f=fixture(t),state=f.service.readState(),at=new Date();
 state.state.settings.completionReminderHours=2;state.state.complaints[0].name='';
 state.state.complaints[0].created=new Date(at.getTime()-3*3600000).toISOString();
 f.db.prepare('UPDATE app_state SET state_json=? WHERE id=1').run(f.db.storageCodec.encodeJson(state.state,'app-state'));
 assert.equal(f.service.runReminders(at),0,'missing optional name does not trigger reminders');
 state.state.complaints[0].summary='مسودة بانتظار الاستكمال';
 f.db.prepare('UPDATE app_state SET state_json=? WHERE id=1').run(f.db.storageCodec.encodeJson(state.state,'app-state'));
 assert.equal(f.service.runReminders(at),1);
 assert.equal(f.service.runReminders(new Date(at.getTime()+3600000)),0);
 assert.equal(f.service.runReminders(new Date(at.getTime()+2*3600000)),1);
});

test('a single complaint edit does not query and decrypt every indexed record',t=>{
 const f=fixture(t),state=f.service.readState(),base=state.state.complaints[0];
 state.state.complaints=Array.from({length:1000},(_,i)=>({...base,id:'PERF-'+i}));
 const insert=f.db.prepare('INSERT INTO complaints(id,payload_json,created_by,created_at,updated_at) VALUES(?,?,?,?,?)');
 f.db.transaction(()=>{
  f.db.prepare('DELETE FROM complaints').run();
  for(const c of state.state.complaints)insert.run(c.id,f.db.storageCodec.encodeJson(c,'complaint:'+c.id),'s',c.created,c.updated);
  f.db.prepare('UPDATE app_state SET state_json=? WHERE id=1').run(f.db.storageCodec.encodeJson(state.state,'app-state'));
 })();
 let queries=0;const prepare=f.db.prepare.bind(f.db);f.db.prepare=(...args)=>{queries++;return prepare(...args);};
 const result=f.service.updateComplaint({complaintId:'PERF-0',body:{details:'only this record changed'},userId:'s',username:'s'});
 assert.equal(result.ok,true);assert.ok(queries<30,'single edit prepared '+queries+' SQL statements');t.diagnostic('Single edit with 1000 complaints: '+queries+' prepared statements');
 const raw=prepare('SELECT payload_json FROM complaints WHERE id=?').get('PERF-0');
 assert.equal(f.db.storageCodec.decodeJson(raw.payload_json,'complaint:PERF-0').details,'only this record changed');
});

test('backup filenames alone never claim verified content',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'backup-label-test-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 for(const name of ['automatic-corrupt.csb','manual-corrupt.csb'])fs.writeFileSync(path.join(dir,name),'not an encrypted backup');
 assert.ok(listStoredBackups(dir).every(x=>x.verified===false));
});

test('backup verification is tied to the checked file and is invalidated by modification',async t=>{
 const f=fixture(t),{createBackupService}=require('../modules/backup/service');
 const previous=process.env.DATA_KEY;process.env.DATA_KEY=KEY;
 t.after(()=>{if(previous===undefined)delete process.env.DATA_KEY;else process.env.DATA_KEY=previous;});
 const service=createBackupService({databasePath:f.file,sessionSecret:'synthetic-backup-password-32-characters'}),bundle=await service.createCompleteBackup();
 try{
  const dir=path.join(f.dir,'verified-backups');fs.mkdirSync(dir);
  fs.copyFileSync(bundle.destination,path.join(dir,'verified.csb'));
  assert.equal(service.listBackups(dir)[0].verified,false);
  assert.equal((await service.verifyStoredBackup('verified.csb',dir)).ok,true);
  assert.equal(service.listBackups(dir)[0].verified,true);
  fs.appendFileSync(path.join(dir,'verified.csb'),'tampered');
  assert.equal(service.listBackups(dir)[0].verified,false);
  await assert.rejects(service.verifyStoredBackup('verified.csb',dir));
 }finally{service.cleanupBackupDir(bundle.backupDir);}
});

test('a damaged audit chain refuses server startup before accepting requests',async t=>{
 const f=fixture(t),{spawn}=require('node:child_process');
 f.db.prepare("UPDATE audit_events SET event_hash=? WHERE rowid=(SELECT min(rowid) FROM audit_events)").run('f'.repeat(64));
 f.db.close();
 const result=await new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,[path.join(__dirname,'../server.js')],{cwd:path.join(__dirname,'..'),windowsHide:true,
   env:{...process.env,DATABASE_PATH:f.file,DATA_KEY:KEY,SESSION_SECRET:'synthetic-session-secret-for-boot-32chars',BACKUP_SECRET:'synthetic-backup-secret-for-boot-32chars',ADMIN_USERNAME:'admin',ADMIN_PASSWORD:'Synthetic-Password-123!',HOST:'127.0.0.1',PORT:'39877'}});
  let stderr='';child.stderr.on('data',b=>stderr+=b.toString());child.on('error',reject);
  const timer=setTimeout(()=>{child.kill();reject(Error('Damaged audit server did not stop.'));},15000);
  child.on('exit',code=>{clearTimeout(timer);resolve({code,stderr});});
 });
 assert.notEqual(result.code,0);assert.match(result.stderr,/Audit integrity verification failed at boot/);
});

test('interrupted reminder migration resumes plaintext-page cleanup on retry',t=>{
 const f=fixture(t),{protectReminderNotes}=require('../lib/reminder-storage');
 f.db.prepare('INSERT INTO complaint_reminders(complaint_id,reminder_time,note,created_by) VALUES(?,?,?,?)').run(f.id,new Date().toISOString(),'legacy cleanup marker','s');
 const original=f.db.exec.bind(f.db);let attempts=0;
 f.db.exec=sql=>{if(sql==='VACUUM'&&++attempts===1)throw Error('synthetic cleanup interruption');return original(sql);};
 assert.throws(()=>protectReminderNotes(f.db,f.db.storageCodec),/synthetic cleanup/);
 assert.equal(f.db.prepare('SELECT note_encrypted FROM complaint_reminders').get().note_encrypted,1);
 assert.equal(f.db.prepare('SELECT cleanup_pending FROM reminder_storage_migration').get().cleanup_pending,1);
 protectReminderNotes(f.db,f.db.storageCodec);
 assert.equal(attempts,2);assert.equal(f.db.prepare('SELECT cleanup_pending FROM reminder_storage_migration').get().cleanup_pending,0);
 const row=f.db.prepare('SELECT id,note FROM complaint_reminders').get();
 assert.equal(f.db.storageCodec.decodeJson(row.note,'reminder:'+row.id),'legacy cleanup marker');
});

function seedLegacyReply(f,reply){
 const state=f.service.readState();state.state.complaints[0].reply=reply;
 f.db.transaction(()=>{
  f.db.prepare('UPDATE app_state SET state_json=? WHERE id=1').run(f.db.storageCodec.encodeJson(state.state,'app-state'));
  f.db.prepare('UPDATE complaints SET payload_json=? WHERE id=?').run(f.db.storageCodec.encodeJson(state.state.complaints[0],'complaint:'+f.id),f.id);
 })();
}
test('authorless legacy reviews require an identified draft and a different approver',t=>{
 const f=fixture(t);seedLegacyReply(f,{status:'review',text:'legacy unknown authorship'});
 assert.equal(act(f,'a','approve').status,409);
 assert.equal(save(f,'a',c=>{c.reply.status='approved';}).invalidTransition,true);
 assert.equal(act(f,'a','draft','identified text').ok,true);assert.equal(act(f,'a','review').ok,true);
 assert.equal(act(f,'a','approve').status,403);assert.equal(act(f,'b','approve').ok,true);
});
test('legacy pending approval replies can explicitly return to draft without bypassing approval',t=>{
 const f=fixture(t);seedLegacyReply(f,{status:'approval',author:'s',text:'legacy pending text'});
 assert.equal(act(f,'a','approve').ok,false);assert.equal(act(f,'r','draft','forbidden').status,403);
 assert.equal(act(f,'s','draft','revised pending text').ok,true);
 assert.equal(act(f,'s','review').ok,true);assert.equal(act(f,'a','approve').ok,true);
});
