'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function fixture(){
 const classes=new Set(),attrs=new Map([['aria-busy','false']]),timers=[];
 const button={disabled:false,innerHTML:'<strong>حفظ</strong>',textContent:'حفظ',classList:{contains:c=>classes.has(c),add:(...cs)=>cs.forEach(c=>classes.add(c)),remove:(...cs)=>cs.forEach(c=>classes.delete(c))},
 getAttribute:k=>attrs.has(k)?attrs.get(k):null,setAttribute:(k,v)=>attrs.set(k,v),removeAttribute:k=>attrs.delete(k)};
 const source=fs.readFileSync('ui/core/events.js','utf8').split('window.withButtonLock')[0];
 const c={window:{setTimeout:fn=>timers.push(fn)}};vm.createContext(c);vm.runInContext(source,c);
 return {lock:c.withButtonLock,button,classes,attrs,timers};
}
test('button shows custom progress, blocks repeated clicks and restores original markup and busy state',async()=>{
 const f=fixture();let done,calls=0;
 const first=f.lock(f.button,()=>{calls++;return new Promise(resolve=>done=resolve);},'جارٍ حفظ الشكوى…');
 assert.equal(f.button.textContent,'جارٍ حفظ الشكوى…');assert.equal(f.button.disabled,true);assert.equal(f.attrs.get('aria-busy'),'true');
 await f.lock(f.button,()=>calls++);assert.equal(calls,1);
 done(true);await first;assert.match(f.button.innerHTML,/تم/);assert.equal(f.timers.length,1);
 f.timers[0]();assert.equal(f.button.innerHTML,'<strong>حفظ</strong>');assert.equal(f.button.disabled,false);assert.equal(f.attrs.get('aria-busy'),'false');assert.equal(f.classes.size,0);
});
test('cancellations and structured failures never display success or defer restoring the button',async()=>{
 for(const result of [false,{ok:false},{success:false}]){
  const f=fixture();f.attrs.delete('aria-busy');
  assert.equal(await f.lock(f.button,async()=>result),result);
  assert.equal(f.button.innerHTML,'<strong>حفظ</strong>');assert.equal(f.button.disabled,false);assert.equal(f.timers.length,0);assert.equal(f.attrs.has('aria-busy'),false);
 }
});
test('synchronous and asynchronous errors are restored and propagated to the caller',async()=>{
 for(const fn of [()=>{throw new Error('failed')},async()=>{throw new Error('failed')}]){
  const f=fixture();await assert.rejects(f.lock(f.button,fn),/failed/);
  assert.equal(f.button.innerHTML,'<strong>حفظ</strong>');assert.equal(f.button.disabled,false);assert.equal(f.classes.size,0);assert.equal(f.timers.length,0);
 }
 const f=fixture();f.button.disabled=true;let called=false;await f.lock(f.button,()=>called=true);assert.equal(called,false);
});

test('inner save handlers cannot leave the success button enabled before restoration',async()=>{
 const f=fixture();await f.lock(f.button,async()=>{f.button.disabled=false;return true;});
 assert.equal(f.button.disabled,true);f.timers[0]();assert.equal(f.button.disabled,false);
});
