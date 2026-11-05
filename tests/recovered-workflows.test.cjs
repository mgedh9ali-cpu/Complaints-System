'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../ui/features/recovered-workflows.js'),'utf8');
function fixture(failAt=0){
 const calls=[],messages=[];let refreshed=0;
 const context={selectedIds:new Set(['A','B']),stateRevision:3,confirm:()=>true,uiCan:()=>true,flushUiBeforeAction:async()=>{},closeModal(){},reloadStoredState:async()=>{refreshed++;},toast:text=>messages.push(text),
 api:async(url,options)=>{calls.push({url,...options});if(calls.length===failAt)throw new Error('تعارض');return {revision:3+calls.length};}};
 vm.createContext(context);vm.runInContext(source,context);return {context,calls,messages,refreshed:()=>refreshed};
}
test('recovered bulk assignment uses the assignment API and advances the revision after each committed record',async()=>{
 const f=fixture();await f.context.applyRecoveredBulk('assign','employee');
 assert.deepEqual(f.calls.map(c=>[c.url,c.method,c.headers['X-State-Revision'],JSON.parse(c.body)]),[
 ['/api/complaints/A','PATCH','3',{owner:'employee'}],['/api/complaints/B','PATCH','4',{owner:'employee'}]]);
 assert.equal(f.refreshed(),1);assert.equal(f.context.selectedIds.size,0);
});
test('a bulk conflict stops subsequent work, reloads authoritative data and reports the partial result',async()=>{
 const f=fixture(2);await f.context.applyRecoveredBulk('priority','urgent');
 assert.equal(f.calls.length,2);assert.equal(f.refreshed(),1);assert.match(f.messages[0],/1 من 2/);
});
test('bulk actions enforce the effective permission before issuing requests',async()=>{
 const f=fixture();f.context.uiCan=()=>false;await f.context.applyRecoveredBulk('assign','employee');assert.equal(f.calls.length,0);
});
