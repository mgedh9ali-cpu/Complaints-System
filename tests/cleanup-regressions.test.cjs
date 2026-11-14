'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {verifyRenderedFonts}=require('../desktop/verify-fonts');

test('loopback security policy permits local fonts without upgrading HTTP resources',async t=>{
 const express=require('express');
 const app=express();app.use(require('../config/security').createHelmetMiddleware());app.get('/',(req,res)=>res.send('local'));
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 t.after(()=>{server.closeAllConnections();server.close();});
 const response=await fetch('http://127.0.0.1:'+server.address().port);
 const policy=response.headers.get('content-security-policy');
 assert.match(policy,/(?:^|;)font-src 'self'(?:;|$)/);
 assert.doesNotMatch(policy,/upgrade-insecure-requests/);
 assert.match(policy,/script-src 'self'/);
 assert.match(policy,/object-src 'none'/);
 assert.equal(response.headers.get('strict-transport-security'),null);
});

test('user-controlled modal titles are text and background controls cannot receive focus',()=>{
 const root={dataset:{},innerHTML:'',classList:{remove(){}}},shell={inert:false},dlg={focus(){}};
 const context={document:{activeElement:null,documentElement:{dataset:{}},addEventListener(){},contains:()=>false},window:{},esc:s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'),CustomEvent:class{},$:s=>s==='#modalRoot'?root:s==='#appShell'?shell:s==='.modal'?dlg:null,$$:()=>[]};
 const api=vm.runInNewContext(fs.readFileSync('ui/components/dialogs.js','utf8')+';({modal,closeModal})',context);
 api.modal('تسجيل رد <img src=x onerror=alert(1)>','وصف','<p>محتوى موثوق</p>');
 assert.doesNotMatch(root.innerHTML,/<img/);assert.match(root.innerHTML,/&lt;img/);assert.match(root.innerHTML,/<p>محتوى موثوق<\/p>/);
 assert.equal(shell.inert,true);api.closeModal();assert.equal(shell.inert,false);
});

test('all bundled Thmanyah faces decode and cover Arabic complaint labels and digits',()=>{
 const fontkit=require('fontkit');
 for(const weight of ['Light','Regular','Medium','Bold','Black']){
  const font=fontkit.openSync('assets/fonts/thmanyah/thmanyahsans-'+weight+'.woff2');
  assert.match(font.familyName,/thmanyah/i);
  for(const char of new Set('الاستفسارات والشكاوى 0123456789'))assert.ok(font.hasGlyphForCodePoint(char.codePointAt(0)),weight+' lacks '+char);
 }
});

function renderer({loaded=true,fonts=[{familyName:'thmanyah sans',isCustomFont:true,glyphCount:12}]}={}){
 const calls=[];
 return {calls,executeJavaScript:async()=>[300,400,500,700,900].map(weight=>({weight,loaded})),debugger:{attach(){calls.push('attach');},detach(){calls.push('detach');},async sendCommand(name){calls.push(name);if(name==='DOM.getDocument')return {root:{nodeId:1}};if(name==='DOM.querySelector')return {nodeId:2};if(name==='CSS.getPlatformFontsForNode')return {fonts};}}};
}
test('release verification rejects decoded-but-unused fonts and always detaches the debugger',async()=>{
 const fallback=renderer({fonts:[{familyName:'Arial',isCustomFont:false,glyphCount:12}]});
 await assert.rejects(verifyRenderedFonts(fallback),/fallback/);assert.equal(fallback.calls.at(-1),'detach');
 const missing=renderer({loaded:false});await assert.rejects(verifyRenderedFonts(missing),/decode/);assert.equal(missing.calls.length,0);
 const empty=renderer({fonts:[]});await assert.rejects(verifyRenderedFonts(empty),/fallback/);
 const correct=renderer();assert.equal((await verifyRenderedFonts(correct)).ok,true);assert.equal(correct.calls.at(-1),'detach');
});

test('registry typing renders once per pause and delayed work cannot reopen private UI',()=>{
 const timers=new Map();let next=0,renders=0,focused=0;
 const input={value:'دم',selectionStart:2,selectionEnd:2};
 const replacement={focus(){focused++;},setSelectionRange(){}};
 const context={authenticatedUser:{id:'owner'},page:'complaints',searchText:'',document:{activeElement:input},clearTimeout:id=>timers.delete(id),setTimeout:fn=>{timers.set(++next,fn);return next;},$:()=>input,render(){renders++;context.$=()=>replacement;}};
 const source=fs.readFileSync('ui/pages/registry.js','utf8').split('function complaintDateValue')[0];
 vm.runInNewContext(source+';globalThis.schedule=scheduleRegistrySearch;',context);
 context.schedule(input);input.value='دمشق';context.schedule(input);
 assert.equal(timers.size,1);assert.equal(context.searchText,'دمشق');[...timers.values()][0]();assert.equal(renders,1);assert.equal(focused,1);
 timers.clear();context.$=()=>input;context.schedule(input);context.authenticatedUser=null;[...timers.values()][0]();assert.equal(renders,1);
});
