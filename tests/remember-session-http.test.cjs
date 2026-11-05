'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createSessionMiddleware}=require('../config/session');
const {createAuthRouter}=require('../modules/auth/routes');

// express-session derives originalMaxAge through two Date.now() calls in the
// expires setter/getter, so elapsed clock time may reduce the stored lifetime.
function assertStoredLifetime(cookie, duration, startedAt, completedAt) {
 const elapsed = completedAt - startedAt;
 assert.ok(cookie.originalMaxAge <= duration && cookie.originalMaxAge >= duration - elapsed,
  'stored TTL must match the selected duration within the measured request time');
 const expires = Date.parse(cookie.expires);
 assert.ok(expires >= startedAt + duration - elapsed && expires <= completedAt + duration,
  'stored expiry must match the selected duration within the request time');
}

test('session TTL assertions tolerate a clock tick but reject a different duration', t=>{
 const {Cookie}=require('express-session');
 let now=1800000000000;const startedAt=now;
 t.mock.method(Date,'now',()=>now++);
 const duration=30*86400000;
 const cookie=new Cookie({maxAge:duration}).data;
 assert.equal(cookie.originalMaxAge,duration-1,'exercise the one-millisecond setter/getter boundary');
 assertStoredLifetime(cookie,duration,startedAt,now);
 assert.throws(()=>assertStoredLifetime({...cookie,originalMaxAge:30*60000},duration,startedAt,now));
 assert.throws(()=>assertStoredLifetime({...cookie,originalMaxAge:duration+1},duration,startedAt,now));
});

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
  assertStoredLifetime(stored.cookie,days*86400000,before,Date.now());
  assert.equal(stored.password,undefined);
 }
 const response=await fetch(base+'/api/auth/logout',{method:'POST',headers:{cookie:cookies.at(-1)}});
 assert.equal(response.status,200);
 assert.equal((await fetch(base+'/api/csrf',{headers:{cookie:cookies.at(-1)}})).status,401);
 const bad=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'synthetic',password:'wrong',rememberMe:true})});
 assert.equal(bad.status,401);assert.equal(bad.headers.get('set-cookie'),null);
});
