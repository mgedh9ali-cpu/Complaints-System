'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),Database=require('better-sqlite3');
const {installSingleOperator}=require('../lib/single-operator'),{applyReplyTransition}=require('../lib/reply-workflow');
test('operator identity is pinned, secondary sessions are rejected and legacy accounts are retained',async t=>{
 const db=new Database(':memory:');t.after(()=>db.close());
 db.exec("CREATE TABLE users(id TEXT PRIMARY KEY,username TEXT,role TEXT,active INTEGER,created_at TEXT);INSERT INTO users VALUES('old','older','admin',1,'2020'),('owner','myaccount','admin',1,'2021'),('staff','employee','staff',1,'2019')");
 const authService={authenticate:username=>({ok:true,user:{username}})},middleware={requireAuth:(req,_res,next)=>next()};
 const guard=installSingleOperator({db,authService,middleware,username:'myaccount'});
 assert.equal((await authService.authenticate('myaccount')).ok,true);assert.equal((await authService.authenticate('older')).ok,false);assert.equal((await authService.authenticate('employee')).ok,false);
 const res={status(n){this.code=n;return this;},json(body){this.body=body;return this;}};let destroyed=false;
 middleware.requireAuth({user:{id:'old'},session:{destroy(fn){destroyed=true;fn();}}},res,()=>assert.fail('secondary session accepted'));assert.equal(destroyed,true);assert.equal(res.code,403);
 for(const path of ['/users','/users/owner/permissions','/roles','/assignees']){guard({path,method:'GET'},res,()=>assert.fail('team API accepted'));assert.equal(res.code,410);}
 guard({path:'/complaints/A',method:'PATCH',body:{owner:'employee'}},res,()=>assert.fail('assignment accepted'));assert.equal(res.code,400);
 let called=false;guard({path:'/complaints/A/referrals',method:'POST',body:{entity:'مديرية'}},res,()=>called=true);assert.equal(called,true,'external entity referrals must remain available');
 installSingleOperator({db,authService:{authenticate:()=>({ok:true})},middleware:{requireAuth:(_q,_s,next)=>next()},username:'older'});
 assert.equal(db.prepare('SELECT user_id FROM single_operator').get().user_id,'owner');assert.equal(db.prepare('SELECT COUNT(*) n FROM users').get().n,3);
});
test('operator reviews and approves their own reply while approved text and send ordering remain protected',()=>{
 const actor={id:'owner',username:'myaccount'},can=()=>true,now=new Date().toISOString();
 const draft=applyReplyTransition({previous:null,proposed:{status:'draft',text:'رد رسمي'},actor,can,now,action:'draft',singleOperator:true});assert.equal(draft.ok,true);
 assert.equal(applyReplyTransition({previous:draft.reply,proposed:{...draft.reply,status:'sent'},actor,can,now,singleOperator:true}).ok,false);
 const review=applyReplyTransition({previous:draft.reply,proposed:{...draft.reply,status:'review'},actor,can,now,action:'review',singleOperator:true});assert.equal(review.ok,true);
 const approved=applyReplyTransition({previous:review.reply,proposed:{...review.reply,status:'approved'},actor,can,now,action:'approve',singleOperator:true});assert.equal(approved.ok,true);assert.equal(approved.reply.approvedById,'owner');
 assert.equal(applyReplyTransition({previous:approved.reply,proposed:{...approved.reply,text:'تعديل غير مسموح'},actor,can,now,singleOperator:true}).ok,false);
 assert.equal(applyReplyTransition({previous:review.reply,proposed:{...review.reply,status:'approved'},actor,can,now}).ok,false,'legacy multi-user service boundary retains its original policy');
});
