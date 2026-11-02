'use strict';
// Run a built app against isolated synthetic data. No existing userData is used.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const net=require('node:net'),crypto=require('node:crypto');
const {spawn,spawnSync}=require('node:child_process');
const assert=require('node:assert/strict');
async function smoke(executable,serverScript){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'complaints-packaged-smoke-'));
 const port=await new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(e=>e?reject(e):resolve(p));});});
 const password='Smoke-only-'+crypto.randomBytes(24).toString('base64url');
 const env={...process.env,APPDATA:directory,LOCALAPPDATA:directory,COMPLAINTS_SMOKE_USER_DATA:directory,
  HOST:'127.0.0.1',PORT:String(port),ALLOW_LAN:'false',COOKIE_SECURE:'false',
  ADMIN_USERNAME:'release_admin',ADMIN_PASSWORD:password,
  SESSION_SECRET:crypto.randomBytes(32).toString('hex'),DATA_KEY:crypto.randomBytes(32).toString('hex'),BACKUP_SECRET:crypto.randomBytes(32).toString('hex'),
  DATABASE_PATH:path.join(directory,'data','complaints.sqlite'),SESSIONS_DIR:path.join(directory,'data','sessions'),INSTANCE_ID_PATH:path.join(directory,'data','instance'),BACKUP_DIR:path.join(directory,'backups')};
 if(serverScript)env.ELECTRON_RUN_AS_NODE='1';else delete env.ELECTRON_RUN_AS_NODE;
 const child=spawn(path.resolve(executable),serverScript?[path.resolve(serverScript)]:['--release-smoke'],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});
 let diagnostic='';child.stderr.on('data',b=>{diagnostic=(diagnostic+b).slice(-8000);});
 let spawnError;child.once('error',e=>{spawnError=e;});
 const base='http://127.0.0.1:'+port;
 try{
  let ready=false;
  for(let i=0;i<180;i++){
   if(spawnError)throw spawnError;
   if(child.exitCode!==null&&child.exitCode!==0)throw new Error('Packaged app exited: '+diagnostic);
   try{if((await fetch(base+'/api/health',{signal:AbortSignal.timeout(1000)})).ok){ready=true;break;}}catch{}
   await new Promise(r=>setTimeout(r,500));
  }
  assert.ok(ready,'Packaged app readiness timed out: '+diagnostic);
  const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'release_admin',password})});
  assert.equal(login.status,200,'Packaged login');
  const cookie=login.headers.get('set-cookie').split(';')[0];
  const csrf=(await(await fetch(base+'/api/csrf',{headers:{cookie}})).json()).csrfToken;
  const created=await fetch(base+'/api/complaints',{method:'POST',headers:{cookie,'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify({summary:'اختبار حزمة ببيانات اصطناعية',province:'دمشق',category:'استفسار عام'})});
  assert.equal(created.status,201,'Packaged complaint creation');
  const id=(await created.json()).complaint.id;
  for(const [format,signature]of [['pdf','%PDF'],['xlsx','PK']]){
   const response=await fetch(base+'/api/export/'+format+'/'+encodeURIComponent(id),{headers:{cookie}});
   assert.equal(response.status,200,'Packaged '+format);const buffer=Buffer.from(await response.arrayBuffer());assert.equal(buffer.subarray(0,signature.length).toString(),signature);
  }
  const metrics=await(await fetch(base+'/api/health/metrics',{headers:{cookie}})).json();
  assert.equal(metrics.integrity,'ok');assert.equal(metrics.contentEncryptionEnabled,true);
  assert.equal((await fetch(base+'/.env')).status,404);
  console.log(JSON.stringify({passed:true,platform:process.platform,mode:serverScript?'packaged-server':'portable-application',checks:['startup','login','encrypted-sqlite','complaint-write','arabic-pdf','xlsx','private-config']}));
 }finally{
  if(process.platform==='win32'&&child.pid)spawnSync('taskkill',['/PID',String(child.pid),'/T','/F'],{stdio:'ignore',windowsHide:true});
  else if(child.pid&&child.exitCode===null){child.kill('SIGTERM');await new Promise(resolve=>{const timer=setTimeout(()=>child.kill('SIGKILL'),2000);child.once('exit',()=>{clearTimeout(timer);resolve();});});}
  fs.rmSync(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});
 }
}
if(require.main===module){const [executable,flag,serverScript]=process.argv.slice(2);if(!executable||(flag&&flag!=='--node-server')){console.error('Usage: node scripts/smoke-packaged.js APP [--node-server PACKAGED_SERVER_JS]');process.exitCode=1;}else smoke(executable,serverScript).catch(e=>{console.error(e.message);process.exitCode=1;});}
module.exports={smoke};
