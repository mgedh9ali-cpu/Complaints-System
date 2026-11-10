'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createAuthMiddleware}=require('../modules/auth/middleware');
function fixture(minutes=30){
 const session={user:{id:'u',version:1},lastUserActivity:Date.now()-minutes*60000,idleMinutes:30,destroy(fn){this.destroyed=true;fn();}};
 const req={session},res={status(n){this.code=n;return this;},json(body){this.body=body;return this;}};
 const db={prepare:()=>({get:()=>({id:'u',session_version:1,active:1})})};
 return {session,req,res,run:next=>createAuthMiddleware({db}).requireAuth(req,res,next)};
}
test('idle expiry revokes a remembered session and background API calls do not extend activity',()=>{
 const expired=fixture(31);let called=false;expired.run(()=>{called=true;});
 assert.equal(called,false);assert.equal(expired.res.code,401);assert.equal(expired.res.body.code,'SESSION_IDLE');assert.equal(expired.session.destroyed,true);
 const active=fixture(10),before=active.session.lastUserActivity;active.run(()=>{called=true;});assert.equal(called,true);assert.equal(active.session.lastUserActivity,before);
});
test('idle duration is bounded and a shorter configured duration is enforced',()=>{
 const short=fixture(16);short.session.idleMinutes=15;short.run(()=>assert.fail('expired session accepted'));assert.equal(short.res.code,401);
 const invalid=fixture(31);invalid.session.idleMinutes=999;invalid.run(()=>assert.fail('unbounded idle accepted'));assert.equal(invalid.res.code,401);
});
