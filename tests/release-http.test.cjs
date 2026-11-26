'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const net=require('node:net');
const {spawn}=require('node:child_process');

async function freePort(){return new Promise(resolve=>{const server=net.createServer();server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port));});});}

test('HTTP acceptance: sole operator, disabled staff APIs, attachments, confirmations, conflict and safe backup', {timeout:45000}, async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'complaints-release-http-'));
 const port=await freePort();const base='http://127.0.0.1:'+port;
 const child=spawn(process.execPath,['server.js'],{cwd:path.join(__dirname,'..'),env:{...process.env,
  HOST:'127.0.0.1',PORT:String(port),ALLOW_LAN:'false',COOKIE_SECURE:'false',
  SESSION_SECRET:'test-only-http-session-secret-2026-with-length',DATA_KEY:'test-only-http-data-key-2026-with-enough-length',
  BACKUP_SECRET:'test-only-http-backup-secret-2026-with-length',ADMIN_USERNAME:'director',ADMIN_PASSWORD:'Test-password-2026',
  DATABASE_PATH:path.join(directory,'office.sqlite'),SESSIONS_DIR:path.join(directory,'sessions'),INSTANCE_ID_PATH:path.join(directory,'instance'),
  BACKUP_DIR:path.join(directory,'backups')},stdio:['ignore','pipe','pipe']});
 let output='';child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>output+=x);
 t.after(async()=>{if(child.exitCode===null){child.kill();await new Promise(resolve=>child.once('exit',resolve));}fs.rmSync(directory,{recursive:true,force:true});});
 for(let i=0;i<100;i++){
  if(child.exitCode!==null)throw new Error(output);
  try{if((await fetch(base+'/api/health')).ok)break;}catch(_){}
  if(i===99)throw new Error('HTTP server readiness timeout: '+output);
  await new Promise(r=>setTimeout(r,50));
 }
 async function login(username){
  const response=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password:'Test-password-2026'})});
  assert.equal(response.status,200);const user=(await response.json()).user;
  const cookie=response.headers.get('set-cookie').split(';')[0];
  const csrf=(await (await fetch(base+'/api/csrf',{headers:{cookie}})).json()).csrfToken;
  return {cookie,csrf,user};
 }
 async function request(session,url,method='GET',body,extra={}){
  const headers={cookie:session.cookie,'X-CSRF-Token':session.csrf,...extra};
  const isForm=body instanceof FormData;
  if(!isForm)headers['Content-Type']='application/json';
  const response=await fetch(base+url,{method,headers,body:body===undefined?undefined:isForm?body:JSON.stringify(body)});
  const type=response.headers.get('content-type')||'';
  const data=type.includes('application/json')?await response.json():Buffer.from(await response.arrayBuffer());
  return {status:response.status,body:data,headers:response.headers};
 }
 const admin=await login('director');
 for(const url of ['/api/users','/api/assignees','/api/roles'])assert.equal((await request(admin,url)).status,410);
 assert.equal((await request(admin,'/api/users','POST',{username:'employee',role:'staff',password:'Test-password-2026'})).status,410);
 const denied=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'employee',password:'Test-password-2026'})});assert.equal(denied.status,401);
 const staff=admin,reviewer=admin;
 const created=await request(staff,'/api/complaints','POST',{summary:'تجربة قبول اصطناعية',province:'دمشق',category:'استفسار عام',name:'اسم وهمي',phone:'0912345678',details:'بيانات اختبار فقط'});
 assert.equal(created.status,201);const id=created.body.complaint.id;
 assert.equal(created.body.complaint.owner,undefined);
 const fresh=await request(staff,'/api/state');const snapshot=structuredClone(fresh.body.state);
 snapshot.complaints[0].notes.unshift({text:'ملاحظة اصطناعية',by:'director',at:new Date().toISOString()});
 snapshot.complaints[0].timeline.unshift({event:'إضافة ملاحظة داخلية',by:'director',at:new Date().toISOString(),detail:'اختبار prepend'});
 assert.equal((await request(staff,'/api/state','PUT',snapshot,{'X-State-Revision':String(fresh.body.revision)})).status,200);
 assert.equal((await request(staff,'/api/state','PUT',snapshot,{'X-State-Revision':String(fresh.body.revision)})).status,409);
 assert.equal((await request(staff,'/api/complaints/'+id,'PATCH',{summary:'تعديل قديم'},{'X-State-Revision':String(fresh.body.revision)})).status,409);
 const editor=(await request(staff,'/api/state')).body;
 editor.state.complaints[0].owner='made-up-person';
 assert.equal((await request(staff,'/api/state','PUT',editor.state,{'X-State-Revision':String(editor.revision)})).status,409);
 const multipart=new FormData();multipart.append('files',new Blob(['private fictional document'],{type:'text/plain'}),'وثيقة-اختبار.txt');
 const upload=await request(staff,'/api/attachments/'+id,'POST',multipart);
 assert.equal(upload.status,201,JSON.stringify(upload.body));const storedName=upload.body.attachments[0].storedName;
 assert.equal(upload.body.attachments[0].originalName,'وثيقة-اختبار.txt');
 const list=await request(reviewer,'/api/attachments/by-complaint/'+id);
 assert.equal(list.status,200);assert.equal(list.body.attachments.length,1);
 assert.equal(list.body.attachments[0].originalName,upload.body.attachments[0].originalName);
 const download=await request(reviewer,'/api/attachments/'+encodeURIComponent(storedName));
 assert.equal(download.status,200);assert.equal(download.body.toString(),'private fictional document');
 assert.equal((await fetch(base+'/api/attachments/'+encodeURIComponent(storedName))).status,401);
 assert.equal((await request(admin,'/api/attachments/'+storedName,'DELETE',{})).status,400);
 assert.equal((await request(admin,'/api/attachments/'+storedName,'DELETE',{reason:'أرشفة المرفق بقرار المالك'})).status,200);
 assert.equal((await request(reviewer,'/api/attachments/'+storedName)).status,404);
 assert.equal((await request(admin,'/api/complaints/'+id,'PATCH',{owner:'employee'})).status,400);
 assert.equal((await request(admin,'/api/complaints/'+id,'PATCH',{coAssistants:['employee']})).status,400);
 assert.equal((await request(staff,'/api/complaints/'+id+'/reply','PATCH',{action:'draft',text:'رد اختبار للمراجعة'})).status,200);
 assert.equal((await request(staff,'/api/complaints/'+id+'/reply','PATCH',{action:'review'})).status,200);
 assert.equal((await request(admin,'/api/complaints/'+id+'/reply','PATCH',{action:'approve'})).status,200);
 assert.equal((await request(staff,'/api/complaints/'+id+'/reply','PATCH',{action:'draft',text:'تبديل رد معتمد'})).status,409);
 const {sealPackage,openPackage}=require('../lib/sync-envelope');const password='synthetic-transfer-password';
 const encrypted=(await request(admin,'/api/sync/export','POST',{password})).body;
 assert.equal(encrypted.format,'complaints-encrypted-sync-v1');
 const bundle=await openPackage(encrypted,password);
 bundle.sourceInstanceId='a-different-authorized-local-instance';bundle.syncId=require('node:crypto').randomUUID();
 const malformedBundle={...bundle,attachmentFiles:'invalid'};
 assert.equal((await request(admin,'/api/sync/preview','POST',{package:await sealPackage(malformedBundle,password),password})).status,400);
 const beforeExportAudit=(await request(admin,'/api/audit')).body.events.filter(e=>e.action==='sync_exported').length;
 assert.equal((await request(admin,'/api/sync/export','POST',{password:'short'})).status,400);
 assert.equal((await request(admin,'/api/audit')).body.events.filter(e=>e.action==='sync_exported').length,beforeExportAudit);
 assert.equal((await fetch(base+'/api/sync/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,401);
 assert.equal((await fetch(base+'/api/sync/preview',{method:'POST',headers:{cookie:admin.cookie,'Content-Type':'application/json'},body:'{}'})).status,403);
 const preview=await request(admin,'/api/sync/preview','POST',{package:await sealPackage(bundle,password),password});assert.equal(preview.status,200);
 const beforeBackups=fs.readdirSync(path.join(directory,'backups')).filter(n=>n.startsWith('before-import-')).length;
 assert.equal((await request(admin,'/api/sync/import','POST',{package:await sealPackage(bundle,password),password,forceReplace:true,expectedRevision:preview.body.revision-1})).status,409);
 assert.equal(fs.readdirSync(path.join(directory,'backups')).filter(n=>n.startsWith('before-import-')).length,beforeBackups);
 const imported=await request(admin,'/api/sync/import','POST',{package:await sealPackage(bundle,password),password,forceReplace:true,expectedRevision:preview.body.revision});
 assert.equal(imported.status,200,JSON.stringify(imported.body));assert.equal(imported.body.safetyBackup,true);
 assert.ok(fs.readdirSync(path.join(directory,'backups')).some(n=>n.startsWith('before-import-')&&n.endsWith('.csb')));
 const csv=await request(admin,'/api/export/csv/selection','POST',{ids:[id]});assert.equal(csv.status,200);assert.match(csv.body.toString(),new RegExp(id));
 const integrity=await request(admin,'/api/audit/verify');assert.equal(integrity.status,200);assert.equal(integrity.body.ok,true);
 const events=(await request(admin,'/api/audit')).body.events;
 assert.ok(events.some(e=>e.action==='attachment_accessed'));
 assert.ok(events.some(e=>e.action==='csv_export'));
  const ownerProbe=await request(admin,'/api/complaints','POST',{summary:'اختبار صلاحيات المالك',province:'دمشق',category:'استفسار عام'});
  assert.equal(ownerProbe.status,201);const probeId=ownerProbe.body.complaint.id;
  assert.equal((await request(admin,'/api/complaints/'+probeId,'DELETE',{})).status,409);
  assert.equal((await request(admin,'/api/complaints/'+probeId,'DELETE',{reason:'أرشفة اختبارية'})).status,200);
  assert.equal((await request(admin,'/api/complaints/'+probeId,'PATCH',{summary:'تعديل مؤرشف موثق'})).status,200);
 const ownerSettings=(await request(admin,'/api/settings')).body;
 const changedSettings={...ownerSettings.settings,categories:[],clearedOptionLists:['categories']};
 const savedSettings=await request(admin,'/api/settings','PUT',changedSettings,{'X-State-Revision':String(ownerSettings.revision)});
 assert.equal(savedSettings.status,200);assert.deepEqual(savedSettings.body.settings.categories,[]);
 assert.deepEqual((await request(admin,'/api/settings')).body.settings.categories,[]);
 const beforeMerge=(await request(admin,'/api/state')).body;
 const localRecord=beforeMerge.state.complaints.find(c=>c.id===id);
 const mergeBundle=structuredClone(bundle);
 mergeBundle.syncId=require('node:crypto').randomUUID();
 mergeBundle.state.complaints=[{...localRecord,summary:'تعارض وارد لا يُستبدل'},{...localRecord,id:'SYNC-TEST-001',summary:'سجل وارد جديد'}];
 mergeBundle.attachmentFiles=[];
 mergeBundle.reminders=[{complaintId:'SYNC-TEST-001',reminderTime:new Date(Date.now()+86400000).toISOString(),note:'موعد متابعة من الجهاز الآخر',priority:'normal',dismissed:false}];
 for(let attempt=0;attempt<2;attempt++){
   mergeBundle.syncId=require('node:crypto').randomUUID();
   const sealed=await sealPackage(mergeBundle,password);
   const pv=await request(admin,'/api/sync/preview','POST',{package:sealed,password});
   assert.equal(pv.status,200);assert.ok(pv.body.conflicts.some(c=>c.id===id));
   const merged=await request(admin,'/api/sync/import','POST',{package:sealed,password,merge:true,expectedRevision:pv.body.revision});
   assert.equal(merged.status,200,JSON.stringify(merged.body));assert.equal(merged.body.preservedConflicts,1);
   const after=(await request(admin,'/api/state')).body.state;
   assert.equal(after.complaints.find(c=>c.id===id).summary,localRecord.summary);
   assert.ok(after.complaints.some(c=>c.id===probeId&&c.archivedAt));
   assert.equal(after.complaints.filter(c=>c.id==='SYNC-TEST-001').length,1);
   const rr=await request(admin,'/api/complaints/SYNC-TEST-001/reminders');
   assert.equal(rr.status,200);assert.equal(rr.body.reminders.filter(r=>r.note==='موعد متابعة من الجهاز الآخر').length,1);
 }
 const malformed=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:'{bad-json'});
 assert.equal(malformed.status,400);
 const logout=await fetch(base+'/api/auth/logout',{method:'POST',headers:{cookie:reviewer.cookie,'Content-Type':'application/json'},body:'{}'});
 assert.equal(logout.status,403,'logout must retain CSRF protection');
 assert.equal((await request(reviewer,'/api/auth/logout','POST',{})).status,200);
});

test('startup uses the existing owner when initial admin configuration is invalid', { timeout: 30000 }, async t => {
  const { spawnSync } = require('node:child_process');
  const { openDatabase } = require('../config/db');
  const { createAuthService } = require('../modules/auth/service');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'complaints-owner-startup-'));
  let child;
  t.after(async () => {
    if (child && child.exitCode === null && child.signalCode === null) {
      const exit = new Promise(resolve => child.once('exit', resolve));
      child.kill();
      await exit;
    }
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  const port = await freePort();
  const password = 'Test-owner-password-2026';
  const env = {
    ...process.env,
    HOST: '127.0.0.1', PORT: String(port), ALLOW_LAN: 'false', COOKIE_SECURE: 'false',
    SESSION_SECRET: 'test-only-owner-session-secret-2026',
    DATA_KEY: 'test-only-owner-storage-secret-2026',
    BACKUP_SECRET: 'test-only-owner-backup-secret-2026',
    ADMIN_USERNAME: 'invalid owner name', ADMIN_PASSWORD: 'x'.repeat(201),
    DATABASE_PATH: path.join(directory, 'office.sqlite'),
    SESSIONS_DIR: path.join(directory, 'sessions'),
    INSTANCE_ID_PATH: path.join(directory, 'instance'),
    BACKUP_DIR: path.join(directory, 'backups')
  };
  const cwd = path.join(__dirname, '..');
  const fresh = spawnSync(process.execPath, ['server.js'], { cwd, env, encoding: 'utf8', timeout: 7000 });
  assert.equal(fresh.status, 1, fresh.stderr);
  assert.match(fresh.stderr, /ADMIN_USERNAME/);
  const badPassword = spawnSync(process.execPath, ['server.js'], {
    cwd, env: { ...env, ADMIN_USERNAME: 'existing-owner' }, encoding: 'utf8', timeout: 7000
  });
  assert.equal(badPassword.status, 1, badPassword.stderr);
  assert.match(badPassword.stderr, /ADMIN_PASSWORD/);

  const db = openDatabase(env.DATABASE_PATH, { storageKey: env.DATA_KEY });
  const ownerId = createAuthService({ db }).ensureBootstrapAdmin('existing-owner', password);
  db.close();

  child = spawn(process.execPath, ['server.js'], { cwd, env, stdio: ['ignore', 'ignore', 'pipe'] });
  let output = '';
  child.stderr.on('data', data => { output += data; });

  const base = 'http://127.0.0.1:' + port;
  let online = false;
  for (let attempt = 0; attempt < 100 && !online; attempt++) {
    assert.equal(child.exitCode, null, output);
    try {
      online = (await fetch(base + '/api/health')).ok;
    } catch {}
    if (!online) await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.ok(online, output);
  for (const url of ['/', '/app.bundle.js', '/api/auth/me', '/api/csrf']) {
    const anonymous = await fetch(base + url);
    await anonymous.arrayBuffer();
    assert.equal(anonymous.headers.has('set-cookie'), false, url);
  }
  const response = await fetch(base + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'existing-owner', password })
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).user.id, ownerId);
});
