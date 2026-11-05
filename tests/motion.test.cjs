'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../ui/features/motion.js'),'utf8');
function fixture(reduced=false){
 const events=new Map(),frames=new Map(),attrs=new Set(),saved=new Map(),root={dataset:{}};
 let next=0,mediaChange;const counter={textContent:'24',isConnected:true};
 const media={matches:reduced,addEventListener(_name,fn){mediaChange=fn;}};
 const content={setAttribute:n=>attrs.add(n),removeAttribute:n=>attrs.delete(n),querySelectorAll:()=>[counter]};
 const document={documentElement:root,visibilityState:'visible',getElementById:()=>content,addEventListener:(name,fn)=>events.set(name,fn)};
 const window={matchMedia:()=>media,requestAnimationFrame:fn=>{frames.set(++next,fn);return next;},cancelAnimationFrame:id=>frames.delete(id)};
 vm.runInNewContext(source,{document,window,localStorage:{getItem:k=>saved.get(k),setItem:(k,v)=>saved.set(k,v)},setTimeout:()=>1,clearTimeout(){}});
 return {root,window,attrs,frames,counter,saved,render:route=>events.get('complaints:render')({detail:{route}}),frame(time){const pending=[...frames.values()];frames.clear();pending.forEach(fn=>fn(time));},reduce(){media.matches=true;mediaChange();}};
}
test('route entry starts counters once, while a search rerender keeps the correct final number',()=>{
 const f=fixture();f.render('dashboard');assert.ok(f.attrs.has('data-enter'));assert.equal(f.frames.size,1);
 f.frame(0);f.frame(350);assert.ok(Number(f.counter.textContent)>0&&Number(f.counter.textContent)<24);
 f.render('dashboard');assert.equal(f.frames.size,0);assert.equal(f.counter.textContent,'24');assert.equal(f.attrs.has('data-enter'),false);
 f.render('reports');f.frame(1000);f.frame(1700);assert.equal(f.counter.textContent,'24');assert.equal(f.frames.size,0);
});
test('reduced motion prevents animations and changing the preference restores final counter values immediately',()=>{
 const f=fixture(true);f.render('dashboard');assert.equal(f.frames.size,0);assert.equal(f.attrs.size,0);
 const active=fixture();active.render('dashboard');active.frame(0);active.reduce();assert.equal(active.frames.size,0);assert.equal(active.counter.textContent,'24');assert.equal(active.attrs.size,0);
});
test('palette selection accepts only the three supplied themes and survives local storage errors',()=>{
 const f=fixture();f.window.setPalette('ocean');assert.equal(f.root.dataset.palette,'ocean');assert.equal(f.saved.get('palette'),'ocean');
 f.window.setPalette('ember');assert.equal(f.root.dataset.palette,'ember');f.window.setPalette('invalid');assert.equal(f.root.dataset.palette,'');
});
