'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const net=require('node:net');
const {spawn}=require('node:child_process');

async function freePort(){return new Promise(resolve=>{const server=net.createServer();server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port));});});}

test('HTTP acceptance: real accounts, per-user authorization, attachments, approvals, conflict and safe sync backup', {timeout:45000}, async t=>{
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
 for(const [username,role] of [['employee','staff'],['observer','reviewer']]){
  assert.equal((await request(admin,'/api/users','POST',{username,role,password:'Test-password-2026'})).status,201);
 }
 let staff=await login('employee');const reviewer=await login('observer');
 const initial=(await request(staff,'/api/state')).body;
 const forgedSettings=structuredClone(initial.state);forgedSettings.settings.slaDays=30;
 assert.equal((await request(staff,'/api/state','PUT',forgedSettings,{'X-State-Revision':String(initial.revision)})).status,403,'staff cannot change settings before the first complaint');
 assert.equal((await request(reviewer,'/api/complaints','POST',{summary:'محاولة غير مخولة',province:'دمشق',category:'استفسار'})).status,403);
 const created=await request(staff,'/api/complaints','POST',{summary:'تجربة قبول اصطناعية',province:'دمشق',category:'استفسار عام',name:'اسم وهمي',phone:'0912345678',details:'بيانات اختبار فقط'});
 assert.equal(created.status,201);const id=created.body.complaint.id;
 assert.equal(created.body.complaint.owner,'employee');
 const fresh=await request(staff,'/api/state');const snapshot=structuredClone(fresh.body.state);
 snapshot.complaints[0].notes.unshift({text:'ملاحظة اصطناعية',by:'employee',at:new Date().toISOString()});
 snapshot.complaints[0].timeline.unshift({event:'إضافة ملاحظة داخلية',by:'employee',at:new Date().toISOString(),detail:'اختبار prepend'});
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
 assert.equal((await request(admin,'/api/attachments/'+storedName,'DELETE',{reason:'حذف مباشر مرفوض'})).status,409);
 const removal=await request(staff,'/api/approvals','POST',{kind:'attachment_delete',complaintId:id,targetId:storedName,reason:'طلب حذف اصطناعي'});
 assert.equal(removal.status,201);
 assert.equal((await request(staff,'/api/approvals/'+removal.body.id+'/decision','POST',{decision:'approved',reason:'قرار غير مخول'})).status,403);
 assert.equal((await request(admin,'/api/approvals/'+removal.body.id+'/decision','POST',{decision:'approved',reason:'موافقة مدير على الطلب'})).status,200);
 assert.equal((await request(reviewer,'/api/attachments/'+storedName)).status,404);
 const user=(await request(admin,'/api/users')).body.users.find(u=>u.username==='employee');
 assert.equal((await request(admin,'/api/users/'+user.id+'/permissions','PATCH',{overrides:{'complaints.create':false}})).status,200);
 assert.equal((await request(staff,'/api/state')).status,401,'permission changes must revoke active sessions at the database level');
 staff=await login('employee');
 assert.equal((await request(staff,'/api/complaints','POST',{summary:'مرفوض بعد القرار',province:'دمشق',category:'استفسار'})).status,403);
 assert.equal((await request(staff,'/api/complaints/'+id+'/reply','PATCH',{action:'draft',text:'رد اختبار للمراجعة'})).status,200);
 assert.equal((await request(staff,'/api/complaints/'+id+'/reply','PATCH',{action:'review'})).status,200);
 assert.equal((await request(admin,'/api/complaints/'+id+'/reply','PATCH',{action:'approve'})).status,200);
 assert.equal((await request(staff,'/api/complaints/'+id+'/reply','PATCH',{action:'draft',text:'تبديل رد معتمد'})).status,409);
 const bundle=(await request(admin,'/api/sync/export')).body;
 bundle.sourceInstanceId='a-different-authorized-local-instance';bundle.syncId=require('node:crypto').randomUUID();
 assert.equal((await request(admin,'/api/sync/preview','POST',bundle)).status,200);
 const imported=await request(admin,'/api/sync/import','POST',{package:bundle,forceReplace:true});
 assert.equal(imported.status,200,JSON.stringify(imported.body));assert.equal(imported.body.safetyBackup,true);
 assert.ok(fs.readdirSync(path.join(directory,'backups')).some(n=>n.startsWith('before-import-')&&n.endsWith('.csb')));
 const csv=await request(admin,'/api/export/csv/selection','POST',{ids:[id]});assert.equal(csv.status,200);assert.match(csv.body.toString(),new RegExp(id));
 const integrity=await request(admin,'/api/audit/verify');assert.equal(integrity.status,200);assert.equal(integrity.body.ok,true);
 const events=(await request(admin,'/api/audit')).body.events;
 assert.ok(events.some(e=>e.action==='attachment_accessed'));
 assert.ok(events.some(e=>e.action==='csv_export'));
 const malformed=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:'{bad-json'});
 assert.equal(malformed.status,400);
 const logout=await fetch(base+'/api/auth/logout',{method:'POST',headers:{cookie:reviewer.cookie,'Content-Type':'application/json'},body:'{}'});
 assert.equal(logout.status,403,'logout must retain CSRF protection');
 assert.equal((await request(reviewer,'/api/auth/logout','POST',{})).status,200);
});
