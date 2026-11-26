'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const source=fs.readFileSync(path.join(__dirname,'../ui/features/recovered-workflows.js'),'utf8');
function makeView(){
 const context=vm.createContext({
  document:{addEventListener(){}},
  authenticatedUser:{id:'first'},
  uiCan:()=>true,
  api:async()=>({events:[{targetId:'first-record'}],ok:true}),
  render(){},toast(){}
 });
 vm.runInContext(source,context);
 return {context,run:code=>vm.runInContext(code,context)};
}
test('audit view clears events, verification, search and pagination on session change',async()=>{
 const {context,run}=makeView();
 await run('refreshAudit()');
 await run('verifyAudit()');
 run("auditViewQuery='first'; auditViewPage=3");
 assert.equal(run('displayedAudit.length'),1);
 assert.equal(run('auditCheck.ok'),true);
 context.authenticatedUser=null;
 run('syncAuditViewSession()');
 assert.equal(run('displayedAudit.length'),0);
 assert.equal(run('auditCheck'),null);
 assert.equal(run('auditViewQuery'),'');
 assert.equal(run('auditViewPage'),1);
});
test('late audit and verification responses cannot populate a different login session',async()=>{
 const {context,run}=makeView();
 const complete=[];
 context.api=()=>new Promise(resolve=>complete.push(resolve));
 const pending=[run('refreshAudit()'),run('verifyAudit()')];
 context.authenticatedUser={id:'first'};
 run('syncAuditViewSession()');
 complete[0]({events:[{targetId:'old-record'}]});
 complete[1]({ok:true});
 await Promise.all(pending);
 assert.equal(run('displayedAudit.length'),0);
 assert.equal(run('auditCheck'),null);
});
test('audit endpoints are not requested without the corresponding permissions',async()=>{
 const {context,run}=makeView();
 context.uiCan=()=>false;
 let called=0;
 context.api=async()=>{called++;return {}};
 await run('refreshAudit()');
 await run('verifyAudit()');
 assert.equal(called,0);
});
