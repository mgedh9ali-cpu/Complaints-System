'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),vm=require('node:vm');
const {createBackupScheduler}=require('../modules/backup/scheduler');
const {openDatabase}=require('../config/db');
const {createComplaintsService}=require('../modules/complaints/service');
const {createAuditService}=require('../modules/audit/service');
const {createEncryptedBundle}=require('../lib/full-backup');
const recovery=require('../desktop/recovery');
function temporary(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'complaints-completion-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true,maxRetries:10,retryDelay:100}));return root;}

test('unavailable automatic backup destination does not stop startup and retries recover',async t=>{
 const root=temporary(t),block=path.join(root,'external');fs.writeFileSync(block,'unavailable drive');
 const source=path.join(root,'verified.csb');fs.writeFileSync(source,'fixture');let calls=0;
 const scheduler=createBackupScheduler({directory:path.join(block,'backups'),backupService:{async createCompleteBackup(){calls++;return {destination:source,backupDir:root};},cleanupBackupDir(){}}});
 assert.equal(await scheduler.runOnce(),false);assert.equal(calls,0);assert.ok(scheduler.status().lastError);assert.equal(scheduler.status().overdue,true);
 fs.unlinkSync(block);assert.equal(await scheduler.runOnce(),true);assert.equal(calls,1);assert.equal(scheduler.status().lastError,null);
});

test('restore prepares verified encrypted data separately and rejects wrong keys without changing the active profile',async t=>{
 const root=temporary(t),data=path.join(root,'data');fs.mkdirSync(data);
 const file=path.join(data,'complaints.sqlite'),secret='test-only-backup-secret-with-at-least-32-chars',storageKey='test-only-storage-key-with-at-least-32-chars';
 const oldKey=process.env.DATA_KEY;process.env.DATA_KEY=storageKey;t.after(()=>{if(oldKey===undefined)delete process.env.DATA_KEY;else process.env.DATA_KEY=oldKey;});
 const db=openDatabase(file,{storageKey});
 db.prepare('INSERT INTO users(id,username,password_hash,role,active,created_at) VALUES(?,?,?,?,1,?)').run('admin-id','director','test-only','admin',new Date().toISOString());
 const audit=createAuditService({db,databasePath:file});
 const service=createComplaintsService({db,audit:audit.record});
 const result=service.createComplaint({body:{summary:'اختبار استعادة',province:'دمشق',category:'خدمات'},userId:'admin-id',username:'director'});
 assert.ok(result.complaint?.id);db.close();
 const before=fs.readFileSync(file);
 const bundle=await createEncryptedBundle({databasePath:file,secret,backupDir:path.join(root,'bundle')});
 recovery.saveOptions(root,{backupDirectory:path.join(root,'bundle')});const originalOptions=fs.readFileSync(path.join(root,'desktop-options.json'));
 await assert.rejects(recovery.prepareRestoredProfile({base:root,bundlePath:bundle.destination,secret:'incorrect-secret-with-at-least-32-characters'}));
 assert.deepEqual(fs.readFileSync(path.join(root,'desktop-options.json')),originalOptions);
 assert.deepEqual(fs.readdirSync(root).filter(n=>n.startsWith('recovered-')),[]);
 const recoveryKeyPath=path.join(root,'recovery-key.json');recovery.writeRecoveryKey(recoveryKeyPath,secret);
 let menu,authCalls=0,quitCalls=0;
 require('../desktop/maintenance').installMaintenanceMenu({app:{quit(){quitCalls++;}},Menu:{buildFromTemplate:t=>(menu=t),setApplicationMenu(){}},
  dialog:{async showOpenDialog(_window,options){return {canceled:false,filePaths:[options.title.includes('مفتاح')?recoveryKeyPath:bundle.destination]};},async showMessageBox(){return {response:1};}},shell:{},
  window:{webContents:{session:{async fetch(){authCalls++;return {ok:true,async json(){return {user:{id:'admin-id',role:authCalls<3?'admin':'staff'}};}};}}}},
  origin:'http://127.0.0.1:3000',paths:{applicationBase:root},runtime:{audit(){throw new Error('revoked user must not activate restored data');}}});
 await menu[0].submenu[2].click();assert.equal(authCalls,3);assert.equal(quitCalls,0);
 assert.deepEqual(fs.readFileSync(path.join(root,'desktop-options.json')),originalOptions);assert.deepEqual(fs.readdirSync(root).filter(n=>n.startsWith('recovered-')),[]);
 const restored=await recovery.prepareRestoredProfile({base:root,bundlePath:bundle.destination,secret});
 assert.equal(restored.counts.complaints,1);assert.deepEqual(fs.readFileSync(file),before);
 assert.deepEqual(fs.readFileSync(path.join(root,'desktop-options.json')),originalOptions,'preparation must not activate before explicit commit');
 const profile=path.join(root,restored.profile);assert.equal(fs.existsSync(path.join(profile,'data','storage-key')),false);
 const restoredDb=openDatabase(path.join(profile,'data','complaints.sqlite'),{storageKey});
 try{assert.equal(createComplaintsService({db:restoredDb,audit(){}}).readState().state.complaints[0].summary,'اختبار استعادة');assert.equal(createAuditService({db:restoredDb,databasePath:path.join(profile,'data','complaints.sqlite')}).verifyChain().ok,true);}finally{restoredDb.close();}
 recovery.saveOptions(root,{...recovery.readOptions(root),activeProfile:restored.profile});assert.equal(recovery.readOptions(root).activeProfile,restored.profile);
 assert.match(fs.readFileSync(path.join(profile,'.env'),'utf8'),/SESSION_SECRET=/);
});

test('recovery settings reject path traversal and credential line injection',t=>{
 const root=temporary(t);fs.writeFileSync(path.join(root,'desktop-options.json'),JSON.stringify({activeProfile:'../other'}));
 assert.throws(()=>recovery.readOptions(root),/غير صالحة/);
 assert.throws(()=>recovery.recoveryKey('x'.repeat(32)+'\nADMIN_USERNAME=attacker'),/غير صالح/);
 const keyFile=path.join(root,'key.json');recovery.writeRecoveryKey(keyFile,'x'.repeat(48));assert.equal(recovery.readRecoveryKey(keyFile),'x'.repeat(48));
 recovery.writeRecoveryKey(keyFile,'x'.repeat(48));
 assert.throws(()=>recovery.writeRecoveryKey(keyFile,'y'.repeat(48)),/اسمًا جديدًا/);assert.equal(recovery.readRecoveryKey(keyFile),'x'.repeat(48));
 const other=path.join(root,'other.json');fs.writeFileSync(other,'original user data');assert.throws(()=>recovery.writeRecoveryKey(other,'x'.repeat(48)),/اسمًا جديدًا/);assert.equal(fs.readFileSync(other,'utf8'),'original user data');
});

test('native recovery actions require a current administrator before any file dialog',async()=>{
 let template,dialogs=0,errors=0;
 require('../desktop/maintenance').installMaintenanceMenu({app:{},Menu:{buildFromTemplate:t=>(template=t),setApplicationMenu(){}},dialog:{showOpenDialog(){dialogs++;},showSaveDialog(){dialogs++;},async showMessageBox(){errors++;}},shell:{},window:{webContents:{session:{async fetch(){return {ok:true,async json(){return {user:{role:'staff'}};}};}}}},origin:'http://127.0.0.1:3000',paths:{},runtime:{}});
 for(const item of template[0].submenu.filter(x=>x.click))await item.click();
 assert.equal(dialogs,0);assert.equal(errors,3);
});

test('legacy Windows list matcher accepts native patterns without weakening modern named APIs',()=>{
 const file=path.join(__dirname,'../vendor/minimatch-compat/index.js'),box={require,process:{platform:'win32'},module:{exports:{}}};vm.runInNewContext(fs.readFileSync(file,'utf8'),box,{filename:file});
 assert.deepEqual(box.module.exports.match(['C:/work/one.txt','C:/work/a.js'],'C:\\work\\*.txt'),['C:/work/one.txt']);
 assert.equal(box.module.exports.minimatch,require('minimatch-patched').minimatch);
});

test('release manifest binds exact downloadable bytes to the source commit',async t=>{
 const root=temporary(t),version='1.0.0-test',filename='complaints-system-'+version+'-portable.exe',bytes=Buffer.from('synthetic EXE fixture');fs.writeFileSync(path.join(root,filename),bytes);
 const {generateManifest}=require('../scripts/release-manifest'),commit='a'.repeat(40);const manifest=await generateManifest(root,version,commit);
 assert.equal(manifest.sha256,crypto.createHash('sha256').update(bytes).digest('hex'));assert.equal(manifest.commit,commit);
 assert.match(fs.readFileSync(path.join(root,'SHA256SUMS.txt'),'utf8'),new RegExp(filename.replace(/\./g,'\\.')));
 await assert.rejects(generateManifest(root,version,'main'),/immutable/);
});
