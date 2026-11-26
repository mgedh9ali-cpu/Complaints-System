'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');

function browser(){
  const alerts=[],events=new Map(),nodes=new Map();
  for(const id of ['#topUnread','#navNotificationsCount'])nodes.set(id,{style:{}});
  let poll,resolveResponse;
  const context={
    window:{addEventListener:(type,fn)=>events.set('window:'+type,fn)},authenticatedUser:{id:'one'},stateLoaded:true,page:'dashboard',
    db:{notifications:[],complaints:[{id:'local-unsaved'}]},stateRevision:7,
    $:selector=>nodes.get(selector),esc:String,timeText:()=>'',
    api:async()=>new Promise(resolve=>{resolveResponse=resolve;}),
    loadDb:async()=>{},setTimeout:()=>0,setInterval:fn=>{poll=fn;},
    document:{querySelectorAll:()=>alerts,createElement:()=>({setAttribute(){},remove(){},innerHTML:''}),
      getElementById:()=>({appendChild:node=>alerts.push(node)}),
      addEventListener:(type,fn)=>events.set(type,fn)}
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../ui/features/notify-alerts.js'),'utf8'),context);
  return {context,alerts,nodes,events,poll:()=>poll(),reply:list=>resolveResponse({notifications:list})};
}
const notice={id:'uuid-a',title:'رسالة جديدة',body:'نص تجريبي',complaintId:'SY-1'};
test('alerts fetch remote messages, deduplicate UUIDs, and leave unsaved state and revision intact',async()=>{
  const b=browser(),c=b.context;
  await c.loadDb();
  const first=c.window.pollNotificationAlerts();b.reply([notice]);await first;
  assert.equal(b.alerts.length,1);
  assert.match(b.alerts[0].innerHTML,/notification-open/);
  assert.equal(b.nodes.get('#navNotificationsCount').textContent,'1');
  assert.equal(b.nodes.get('#topUnread').hidden,false);
  assert.equal(c.stateRevision,7);
  assert.equal(c.db.complaints[0].id,'local-unsaved');
  assert.equal(c.db.notifications.length,0);
  const next=c.window.pollNotificationAlerts();b.reply([notice,{...notice,id:'uuid-b'}]);await next;
  assert.equal(b.alerts.length,2);
  const read=c.window.pollNotificationAlerts();b.reply([{...notice,read:true}]);await read;
  assert.equal(b.nodes.get('#topUnread').hidden,true);
});
test('late responses are discarded after account changes and simultaneous polls do not overlap',async()=>{
  const b=browser(),c=b.context;
  const request=c.window.pollNotificationAlerts();
  await c.window.pollNotificationAlerts();
  c.authenticatedUser={id:'two'};b.reply([notice]);await request;
  assert.equal(b.alerts.length,0);
  c.db.notifications=[notice];await c.loadDb();
  assert.equal(b.alerts.length,0,'loading existing unread notifications is silent');
  const fresh=c.window.pollNotificationAlerts();b.reply([notice,{...notice,id:'fresh-for-two'}]);await fresh;
  assert.equal(b.alerts.length,1);
  c.authenticatedUser=null;c.window.updateNotificationIndicators();
  assert.equal(b.nodes.get('#topUnread').hidden,true);
});
test('notification feed requires authentication and read permission, and only returns notifications',async t=>{
  const express=require('express');
  const {createComplaintsRouter}=require('../modules/complaints/routes');
  const app=express();
  app.use('/api',createComplaintsRouter({
    complaintsService:{readState:()=>({state:{notifications:[notice],complaints:[{private:'data'}]}})},
    middleware:{requireCsrf:(req,res,next)=>next(),requireAuth:(req,res,next)=>req.get('X-User')?next():res.sendStatus(401)},
    rolesService:{requirePermission:permission=>(req,res,next)=>permission==='complaints.read'&&req.get('X-Read')==='yes'?next():res.sendStatus(403)}
  }));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const url='http://127.0.0.1:'+server.address().port+'/api/notifications';
  assert.equal((await fetch(url)).status,401);
  assert.equal((await fetch(url,{headers:{'X-User':'one'}})).status,403);
  const response=await fetch(url,{headers:{'X-User':'one','X-Read':'yes'}});
  assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
  assert.deepEqual(await response.json(),{notifications:[notice]});
});

// The generic, text-free alert was replaced by a truncated preview of the message; the privacy
// contract of the toast is now that it never repeats the full title or body.
test('floating alerts keep a bounded preview and aggregate a burst into one alert',async()=>{
  const b=browser(),c=b.context;await c.loadDb();
  const request=c.window.pollNotificationAlerts();
  const title='PRIVATE-TITLE-'.repeat(20),body='PRIVATE-PHONE-'.repeat(20);
  b.reply(Array.from({length:8},(_,i)=>({...notice,id:String(i),title,body})));
  await request;
  assert.equal(b.alerts.length,1,'a burst of 8 new messages raises one alert');
  const html=b.alerts[0].innerHTML;
  const titlePreview=(html.match(/<strong>(.*?)<\/strong>/)||[])[1]||'';
  const bodyPreview=(html.match(/<p>(.*?)<\/p>/)||[])[1]||'';
  assert.ok(title.length>titlePreview.length,'the alert never repeats the full title');
  assert.ok(titlePreview.length<=70,'the alert title is truncated to 70 characters');
  assert.ok(titlePreview.endsWith('…'),'a truncated title is marked with an ellipsis');
  assert.ok(body.length>bodyPreview.length,'the alert never repeats the full body');
  assert.ok(bodyPreview.length<=120,'the alert body is truncated to 120 characters');
  assert.ok(bodyPreview.endsWith('…'),'a truncated body is marked with an ellipsis');
  assert.equal(b.nodes.get('#navNotificationsCount').textContent,'8');
});
test('hidden pages update unread counts without showing personal alerts',async()=>{
  const b=browser(),c=b.context;await c.loadDb();c.document.visibilityState='hidden';
  const request=c.window.pollNotificationAlerts();b.reply([notice]);await request;
  assert.equal(b.alerts.length,0);assert.equal(b.nodes.get('#navNotificationsCount').textContent,'1');
  c.document.visibilityState='visible';
  const visible=c.window.pollNotificationAlerts();b.reply([notice]);await visible;
  assert.equal(b.alerts.length,1);
});
