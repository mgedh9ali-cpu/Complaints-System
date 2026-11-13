'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {upgradeLegacyConfig,parseConfig}=require('../desktop/legacy-config');
const {createStorageCodec}=require('../lib/storage-codec');
const {readRecoveryKey}=require('../desktop/recovery');
const Database=require('better-sqlite3');
function fixture(t,{encrypted=true,wrongKey=false,modern=false}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'complaints-key-upgrade-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true,maxRetries:10,retryDelay:100}));
 fs.mkdirSync(path.join(root,'data'));
 const envPath=path.join(root,'.env'),databasePath=path.join(root,'data','complaints.sqlite'),secret='synthetic-legacy-session-key-at-least-32-chars';
 const original='SESSION_SECRET='+secret+'\nADMIN_USERNAME=director\nADMIN_PASSWORD=Synthetic-Only-12345\n'+(modern?'DATA_KEY='+secret+'-data\nBACKUP_SECRET='+secret+'-backup\n':'');
 fs.writeFileSync(envPath,original);
 const db=new Database(databasePath);
 db.exec('CREATE TABLE complaints(id TEXT PRIMARY KEY,payload_json TEXT)');
 const codec=createStorageCodec(wrongKey?secret+'wrong':secret);
 const payload=codec.encodeJson({summary:'Synthetic complaint'},'complaint:test');
 db.prepare('INSERT INTO complaints VALUES(?,?)').run('test',payload);
 if(encrypted){db.exec('CREATE TABLE storage_metadata(id INTEGER PRIMARY KEY,key_check TEXT)');db.prepare('INSERT INTO storage_metadata VALUES(1,?)').run(codec.encodeJson('complaints-storage-v1','key-check'));}
 db.close();
 return {root,envPath,databasePath,original,secret,payload,before:fs.readFileSync(databasePath)};
}
test('legacy upgrade preserves encrypted records and old backup recovery while creating independent keys',t=>{
 const f=fixture(t);
 assert.equal(upgradeLegacyConfig(f.envPath,f.databasePath).changed,true);
 const values=parseConfig(fs.readFileSync(f.envPath,'utf8'));
 assert.equal(values.DATA_KEY,f.secret);
 assert.equal(new Set([values.DATA_KEY,values.SESSION_SECRET,values.BACKUP_SECRET]).size,3);
 assert.equal(values.ADMIN_USERNAME,'director');assert.equal(values.ADMIN_PASSWORD,'Synthetic-Only-12345');
 assert.equal(readRecoveryKey(path.join(f.root,'legacy-backup-recovery-key.json')),f.secret);
 assert.equal(fs.readFileSync(f.envPath+'.before-key-upgrade','utf8'),f.original);
 assert.deepEqual(fs.readFileSync(f.databasePath),f.before);
 assert.equal(createStorageCodec(values.DATA_KEY).decodeJson(f.payload,'complaint:test').summary,'Synthetic complaint');
 const after=fs.readFileSync(f.envPath,'utf8');
 assert.equal(upgradeLegacyConfig(f.envPath,f.databasePath).changed,false);
 assert.equal(fs.readFileSync(f.envPath,'utf8'),after);
});
test('a wrong legacy key fails before changing configuration or database',t=>{
 const f=fixture(t,{wrongKey:true});
 assert.throws(()=>upgradeLegacyConfig(f.envPath,f.databasePath));
 assert.equal(fs.readFileSync(f.envPath,'utf8'),f.original);
 assert.deepEqual(fs.readFileSync(f.databasePath),f.before);
 assert.equal(fs.existsSync(f.envPath+'.before-key-upgrade'),false);
});
test('complete current configuration is never rewritten by the legacy upgrade',t=>{
 const f=fixture(t,{modern:true});
 assert.equal(upgradeLegacyConfig(f.envPath,f.databasePath).changed,false);
 assert.equal(fs.readFileSync(f.envPath,'utf8'),f.original);
});
test('a conflicting legacy recovery key is kept and prevents replacing active settings',t=>{
 const f=fixture(t),file=path.join(f.root,'legacy-backup-recovery-key.json');
 require('../desktop/recovery').writeRecoveryKey(file,'different-recovery-key-with-at-least-32-chars');
 assert.throws(()=>upgradeLegacyConfig(f.envPath,f.databasePath));
 assert.equal(fs.readFileSync(f.envPath,'utf8'),f.original);
 assert.equal(readRecoveryKey(file),'different-recovery-key-with-at-least-32-chars');
});
test('explicit invalid DATA_KEY is rejected instead of silently replacing it',t=>{
 const f=fixture(t);fs.appendFileSync(f.envPath,'DATA_KEY=short\n');const original=fs.readFileSync(f.envPath,'utf8');
 assert.throws(()=>upgradeLegacyConfig(f.envPath,f.databasePath));
 assert.equal(fs.readFileSync(f.envPath,'utf8'),original);
});
