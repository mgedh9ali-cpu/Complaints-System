'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const {createBackupScheduler}=require('../modules/backup/scheduler');

test('Windows ACL setup is reused only after success and while directory metadata and account match',()=>{
 const stat={dev:1,ino:10,birthtimeMs:100,ctimeMs:100},calls=[];
 const environment={USERNAME:'operator'};let status=1,replaceDuringAcl=false;
 const box={module:{exports:{}},process:{platform:'win32',env:environment},require(name){
  if(name==='node:fs')return {mkdirSync(){},statSync(){return {...stat};}};
  if(name==='node:child_process')return {spawnSync(command,args,options){calls.push({command,args,options});stat.ctimeMs++;if(replaceDuringAcl){stat.ino++;replaceDuringAcl=false;}return {status};}};
  return require(name);
 }};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../lib/data-protection.js'),'utf8'),box);
 const protect=box.module.exports.lockDownDir;
 protect('/private-data');protect('/private-data');assert.equal(calls.length,2,'failed ACL setup must be retried');
 status=0;protect('/private-data');protect('/private-data');assert.equal(calls.length,3);
 stat.ctimeMs++;protect('/private-data');assert.equal(calls.length,4,'metadata changes invalidate the cached result');
 stat.ino++;protect('/private-data');assert.equal(calls.length,5,'a replaced directory must be protected again');
 environment.USERNAME='another-operator';protect('/private-data');assert.equal(calls.length,6);
 replaceDuringAcl=true;stat.ctimeMs++;protect('/private-data');protect('/private-data');assert.equal(calls.length,8,'replacement during ACL setup must not be cached');
 assert.equal(calls[0].command,'icacls');assert.equal(calls[0].options.timeout,5000);
 assert.ok(calls.at(-1).args.includes('another-operator:(OI)(CI)F'));
});

function backupFixture(t){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'startup-backup-'));
 t.after(()=>fs.rmSync(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100}));
 const source=path.join(directory,'verified.csb');fs.writeFileSync(source,'synthetic verified backup');let calls=0;
 const scheduler=createBackupScheduler({directory:path.join(directory,'backups'),backupService:{
  async createCompleteBackup(){calls++;return {destination:source,backupDir:directory};},cleanupBackupDir(){}
 }});
 t.after(()=>scheduler.stop());return {scheduler,count:()=>calls};
}

test('startup leaves time for login to load, then starts one verified automatic backup',async t=>{
 t.mock.timers.enable({apis:['setTimeout','setInterval']});
 const f=backupFixture(t);f.scheduler.start();f.scheduler.start();
 assert.equal(f.count(),0);t.mock.timers.tick(9999);assert.equal(f.count(),0);
 t.mock.timers.tick(1);await new Promise(setImmediate);
 assert.equal(f.count(),1);assert.ok(f.scheduler.status().lastSuccessfulAt);
 assert.equal(f.scheduler.status().intervalMinutes,15);
 f.scheduler.stop();t.mock.timers.tick(15*60000);assert.equal(f.count(),1);
});

test('manual backup cancels the pending startup copy and stopping cancels all timers',async t=>{
 t.mock.timers.enable({apis:['setTimeout','setInterval']});
 const f=backupFixture(t);f.scheduler.start();assert.equal(await f.scheduler.runOnce(),true);
 t.mock.timers.tick(10000);await new Promise(setImmediate);assert.equal(f.count(),1);
 f.scheduler.stop();f.scheduler.start();f.scheduler.stop();t.mock.timers.tick(15*60000);
 await new Promise(setImmediate);assert.equal(f.count(),1);
});

test('Windows build keeps portable compatibility and adds a per-user installer without deleting app data',async()=>{
 const pkg=require('../package.json');
 const {validateConfiguration}=require('app-builder-lib/out/util/config/config');
 await validateConfiguration(pkg.build,{add(){}});
 assert.deepEqual(pkg.build.win.target.map(t=>t.target),['nsis','portable']);
 assert.equal(pkg.build.nsis.perMachine,false);assert.equal(pkg.build.nsis.deleteAppDataOnUninstall,false);
 assert.equal(pkg.build.nsis.createDesktopShortcut,true);
 assert.equal(pkg.build.appId,'local.complaints.system');assert.equal(pkg.name,'complaints-local-system');
 assert.equal(pkg.build.portable.artifactName.replace('${version}',pkg.version).replace('${ext}','exe'),'complaints-system-'+pkg.version+'-portable.exe');
 assert.equal(pkg.build.nsis.artifactName.replace('${version}',pkg.version).replace('${ext}','exe'),'complaints-system-'+pkg.version+'-setup.exe');
});
