'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createSessionMiddleware}=require('../config/session');
const {createAuthRouter}=require('../modules/auth/routes');

test('persistent login uses server sessions, strict boolean opt-in, regeneration and logout',async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'complaints-remember-'));
 const app=express();app.use(express.json());
 app.use(createSessionMiddleware({sessionSecret:'test-session-secret-with-at-least-32-characters',sessionsDir:directory,cookieSecure:false}));
 const requireAuth=(req,res,next)=>req.session.user?next():res.sendStatus(401);
 app.use('/api',createAuthRouter({authService:{authenticate:(_name,password)=>password==='test-password'?{ok:true,user:{id:'synthetic-user',sessionVersion:1}}:{ok:false,status:401}},middleware:{requireAuth,requireRole:()=>requireAuth,requireCsrf:(_req,_res,next)=>next()}}));
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 t.after(async()=>{await new Promise(resolve=>server.close(resolve));fs.rmSync(directory,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+server.address().port;
 const cookies=[];
 for(const [rememberMe,days] of [[undefined,30/1440],[true,30],[false,30/1440],['true',30/1440]]){
  const before=Date.now();
  const res=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json',...(cookies.length?{cookie:cookies.at(-1)}:{})},body:JSON.stringify({username:'synthetic',password:'test-password',rememberMe})});
  assert.equal(res.status,200);await res.json();
  const header=res.headers.get('set-cookie');assert.match(header,/HttpOnly/);assert.match(header,/SameSite=Strict/i);
  const expiry=Date.parse(/Expires=([^;]+)/i.exec(header)[1]);
  assert.ok(Math.abs(expiry-before-days*86400000)<5000,'cookie expiry matches the selected duration');
  const cookie=header.split(';')[0];assert.ok(!cookies.includes(cookie),'login regenerates the session ID');cookies.push(cookie);
  const sessionId=decodeURIComponent(cookie.slice(cookie.indexOf('=')+1)).slice(2).split('.')[0];
  const stored=JSON.parse(fs.readFileSync(path.join(directory,sessionId+'.json'),'utf8'));
  if(cookies.length>1)assert.equal((await fetch(base+'/api/csrf',{headers:{cookie:cookies.at(-2)}})).status,401,'the previous session no longer authenticates');
  assert.equal(stored.cookie.originalMaxAge,days*86400000,'file store retains the chosen TTL');
  assert.equal(stored.password,undefined);
 }
 const response=await fetch(base+'/api/auth/logout',{method:'POST',headers:{cookie:cookies.at(-1)}});
 assert.equal(response.status,200);
 assert.equal((await fetch(base+'/api/csrf',{headers:{cookie:cookies.at(-1)}})).status,401);
 const bad=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'synthetic',password:'wrong',rememberMe:true})});
 assert.equal(bad.status,401);assert.equal(bad.headers.get('set-cookie'),null);
});
