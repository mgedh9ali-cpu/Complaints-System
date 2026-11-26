'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const Database=require('better-sqlite3');
const {openDatabase}=require('../config/db');
const {createStorageCodec}=require('../lib/storage-codec');
const {hashAuditEvent}=require('../lib/audit-integrity');
const {createAuditService}=require('../modules/audit/service');
const {createComplaintsService}=require('../modules/complaints/service');
const {createRemindersService}=require('../modules/reminders/service');
const {createEncryptedBundle,extractEncryptedBundle,verifyEncryptedBundle}=require('../lib/full-backup');
const {createBackupService}=require('../modules/backup/service');
const {verifyRestoredData}=require('../lib/restored-data');
const recovery=require('../desktop/recovery');
const KEY='synthetic-inner-storage-key-with-at-least-32-chars';
const SECRET='synthetic-outer-backup-secret-is-a-different-key';
const codec=createStorageCodec(KEY);

async function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'restored-content-test-')),data=path.join(root,'live');fs.mkdirSync(data);
 t.after(()=>fs.rmSync(root,{recursive:true,force:true,maxRetries:10,retryDelay:100}));
 const previous=process.env.DATA_KEY;process.env.DATA_KEY=KEY;
 t.after(()=>{if(previous===undefined)delete process.env.DATA_KEY;else process.env.DATA_KEY=previous;});
 const file=path.join(data,'complaints.sqlite'),db=openDatabase(file,{storageKey:KEY});
 db.prepare('INSERT INTO users(id,username,password_hash,role,active,created_at) VALUES(?,?,?,?,1,?)').run('owner','owner','synthetic','admin',new Date().toISOString());
 const log=createAuditService({db,databasePath:file}),audit=(...args)=>log.record(...args);audit.syncHead=()=>log.syncHead();
 const complaints=createComplaintsService({db,audit});
 const id=complaints.createComplaint({body:{summary:'سجل اصطناعي',name:'اختبار',phone:'0999999999',details:'بيانات اصطناعية',province:'دمشق',category:'اختبار'},userId:'owner',username:'owner'}).complaint.id;
 const reminders=createRemindersService({db,complaintsService:complaints,audit});
 const reminder=reminders.createReminder({complaintId:id,reminderTime:new Date().toISOString(),note:'ملاحظة اصطناعية',userId:'owner'});
 assert.equal(reminder.ok,true);
 db.prepare('UPDATE complaint_reminders SET is_dismissed=1 WHERE id=?').run(reminder.reminder.id);
 db.exec('CREATE TABLE attachment_records(stored_name TEXT PRIMARY KEY,metadata_json TEXT); CREATE TABLE approval_requests(id TEXT PRIMARY KEY,reason TEXT,decision_reason TEXT)');
 db.prepare('INSERT INTO attachment_records VALUES(?,?)').run('synthetic.txt',codec.encodeJson({originalName:'test'},'attachment-meta:synthetic.txt'));
 db.prepare('INSERT INTO approval_requests VALUES(?,?,?)').run('approval',codec.encodeJson('سبب','approval-reason:approval'),codec.encodeJson('قرار','approval-decision:approval'));
 if(!db.prepare('PRAGMA table_info(users)').all().some(c=>c.name==='totp_secret'))db.exec('ALTER TABLE users ADD COLUMN totp_secret TEXT');
 db.prepare('UPDATE users SET totp_secret=?').run(codec.encodeJson('JBSWY3DPEHPK3PXP','totp:owner'));
 db.close();
 for(const folder of ['attachments','retired-attachments']){
  fs.mkdirSync(path.join(data,folder),{recursive:true});
  fs.writeFileSync(path.join(data,folder,'synthetic.txt'),codec.seal(Buffer.from(folder),'attachment:synthetic.txt'));
 }
 const original=await createEncryptedBundle({databasePath:file,secret:SECRET,backupDir:path.join(root,'original'),includeStorageKey:true});
 const extracted=path.join(root,'extracted');await extractEncryptedBundle({bundlePath:original.destination,secret:SECRET,outputDir:extracted});
 const activeProfile='recovered-'+crypto.randomUUID();fs.mkdirSync(path.join(root,activeProfile));fs.writeFileSync(path.join(root,activeProfile,'sentinel'),'original profile');
 recovery.saveOptions(root,{activeProfile,backupDirectory:path.join(root,'original')});
 return {root,file,original,extracted,id,activeProfile};
}

// Repack corrupted INNER data with correct outer GCM and correct file hashes.
// Extraction must still succeed, proving that rejection happens at content checks.
function repack(directory,output){
 const names=['database.sqlite',...['storage-key','audit-head.hash'].filter(n=>fs.existsSync(path.join(directory,n))),
  ...['attachments','retired-attachments'].flatMap(folder=>fs.readdirSync(path.join(directory,folder)).map(name=>folder+'/'+name))];
 const data=names.map(name=>({name,bytes:fs.readFileSync(path.join(directory,name))}));
 const metadata=Buffer.from(JSON.stringify({format:'complaints-complete-backup',version:2,files:data.map(({name,bytes})=>({name,size:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')}))}));
 const size=Buffer.alloc(4);size.writeUInt32BE(metadata.length);
 const salt=crypto.randomBytes(16),iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',crypto.scryptSync(SECRET,salt,32),iv);
 const encrypted=Buffer.concat([cipher.update(Buffer.concat([size,metadata,...data.map(f=>f.bytes)])),cipher.final()]);
 fs.writeFileSync(output,Buffer.concat([Buffer.from('COMPLBUNDLE2'),salt,iv,encrypted,cipher.getAuthTag()]));
}
function modifyDatabase(f,change){
 const db=new Database(path.join(f.extracted,'database.sqlite'));
 try{
  change(db);
  let head=null;
  for(const row of db.prepare('SELECT * FROM audit_events ORDER BY rowid').all()){
   const hash=hashAuditEvent(row,head);db.prepare('UPDATE audit_events SET previous_hash=?,event_hash=? WHERE id=?').run(head,hash,row.id);head=hash;
  }
  if(head)fs.writeFileSync(path.join(f.extracted,'audit-head.hash'),head+'\n');
 }finally{db.close();}
}

test('verification and restoration authenticate every content type without writing the extracted data',async t=>{
 const f=await fixture(t),database=path.join(f.extracted,'database.sqlite'),before=fs.readFileSync(database);
 const content=verifyRestoredData({directory:f.extracted});
 assert.deepEqual(content.contentCounts,{complaints:1,appState:1,auditEvents:2,reminders:1,attachments:1,retiredAttachments:1,attachmentMetadata:1,approvalReasons:2,twoFactorSecrets:1});
 assert.deepEqual(fs.readFileSync(database),before);
 const verified=await verifyEncryptedBundle({bundlePath:f.original.destination,secret:SECRET});
 assert.equal(verified.contentVerified,true);assert.equal(fs.existsSync(verified.outputDir),false);
 const restored=await recovery.prepareRestoredProfile({base:f.root,bundlePath:f.original.destination,secret:SECRET});
 assert.deepEqual(restored.contentCounts,content.contentCounts);
});

const faults=[
 ['wrong content key',f=>fs.writeFileSync(path.join(f.extracted,'storage-key'),'another-content-key-with-at-least-32-characters')],
 ['missing content key',f=>fs.unlinkSync(path.join(f.extracted,'storage-key'))],
 ['wrong key-check sentinel',f=>modifyDatabase(f,db=>db.prepare('UPDATE storage_metadata SET key_check=? WHERE id=1').run(codec.encodeJson('wrong-marker','key-check')))],
 ['complaint with wrong context',f=>modifyDatabase(f,db=>db.prepare('UPDATE complaints SET payload_json=?').run(codec.encodeJson({summary:'invalid-context'},'complaint:another-id')))],
 ['invalid app state',f=>modifyDatabase(f,db=>db.prepare('UPDATE app_state SET state_json=?').run(JSON.stringify({storage:'aes-256-gcm-v1',sealed:'broken'})))],
 ['audit with a valid chain but invalid ciphertext',f=>modifyDatabase(f,db=>db.prepare('UPDATE audit_events SET details_json=?').run(codec.encodeJson({},'audit:wrong-id')))],
 ['dismissed reminder with invalid ciphertext',f=>modifyDatabase(f,db=>db.prepare('UPDATE complaint_reminders SET note=?').run(codec.encodeJson('test','reminder:wrong-id')))],
 ['unencrypted reminder',f=>modifyDatabase(f,db=>db.prepare('UPDATE complaint_reminders SET note=?,note_encrypted=0').run('plaintext'))],
 ...['attachments','retired-attachments'].map(folder=>[folder+' invalid GCM tag',f=>{const file=path.join(f.extracted,folder,'synthetic.txt'),bytes=fs.readFileSync(file);bytes[25]^=1;fs.writeFileSync(file,bytes);}]),
 ['invalid attachment metadata',f=>modifyDatabase(f,db=>db.prepare('UPDATE attachment_records SET metadata_json=?').run(codec.encodeJson({},'attachment-meta:wrong')))],
 ['invalid approval reason',f=>modifyDatabase(f,db=>db.prepare('UPDATE approval_requests SET reason=?').run(codec.encodeJson('reason','approval-reason:wrong')))],
 ['invalid approval decision',f=>modifyDatabase(f,db=>db.prepare('UPDATE approval_requests SET decision_reason=?').run(codec.encodeJson('reason','approval-decision:wrong')))],
 ['invalid TOTP secret',f=>modifyDatabase(f,db=>db.prepare('UPDATE users SET totp_secret=?').run(codec.encodeJson('secret','totp:wrong')))],
 ['no active administrator',f=>modifyDatabase(f,db=>db.prepare('UPDATE users SET active=0').run())]
];
for(const [name,corrupt] of faults)test('outer-valid backup rejects '+name+' in both paths and preserves the active profile',async t=>{
 const f=await fixture(t);corrupt(f);
 const bundle=path.join(f.root,'corrupt.csb');repack(f.extracted,bundle);
 const outer=await extractEncryptedBundle({bundlePath:bundle,secret:SECRET,outputDir:path.join(f.root,'outer-check')});
 assert.equal(outer.verified,true,'outer GCM, checksums, SQLite and audit chain remain valid');
 const live=fs.readFileSync(f.file),settings=fs.readFileSync(path.join(f.root,'desktop-options.json'));
 const directories=[],mkdtemp=fs.mkdtempSync;
 t.mock.method(fs,'mkdtempSync',function(prefix,...args){const dir=mkdtemp(prefix,...args);if(String(prefix).includes('complaints-verify-complete-'))directories.push(dir);return dir;});
 const service=createBackupService({databasePath:f.file,sessionSecret:SECRET});
 await assert.rejects(service.verifyStoredBackup('corrupt.csb',f.root));
 assert.equal(service.listBackups(f.root).find(file=>file.name==='corrupt.csb').verified,false);
 assert.equal(directories.length,1);assert.ok(directories.every(dir=>!fs.existsSync(dir)));
 await assert.rejects(recovery.prepareRestoredProfile({base:f.root,bundlePath:bundle,secret:SECRET}));
 assert.deepEqual(fs.readFileSync(f.file),live);assert.deepEqual(fs.readFileSync(path.join(f.root,'desktop-options.json')),settings);
 assert.deepEqual(fs.readdirSync(f.root).filter(name=>name.startsWith('recovered-')),[f.activeProfile]);
 assert.equal(fs.readFileSync(path.join(f.root,f.activeProfile,'sentinel'),'utf8'),'original profile');
});
