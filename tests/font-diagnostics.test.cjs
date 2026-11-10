'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function fixture({status=200,signature='wOF2',loaded=true,loadError=false,missingApi=false}={}){
 const requests=[],specs=[],modals=[];
 const c={authenticatedUser:{id:'one'},Uint8Array,String,Promise,
  document:{body:{},fonts:missingApi?null:{load:async spec=>{specs.push(spec);if(loadError)throw new Error('decode');return loaded?[{}]:[];},check:()=>loaded}},
  fetch:async(url,options)=>{requests.push({url,options});return {ok:status===200,status,headers:{get:()=> 'font/woff2'},arrayBuffer:async()=>Buffer.from(signature)};},
  esc:s=>String(s).replace(/</g,'&lt;').replace(/>/g,'&gt;'),getComputedStyle:()=>({fontFamily:'"Thmanyah Sans", Cairo'}),
  modal:(...args)=>modals.push(args),toast:()=>false};
 vm.createContext(c);vm.runInContext(fs.readFileSync('ui/features/font-diagnostics.js','utf8'),c);
 return {c,requests,specs,modals};
}
test('font check verifies every bundled weight with fresh local fetches and actual FontFaceSet loading',async()=>{
 const f=fixture(),result=await f.c.diagnoseLocalFonts();assert.equal(result.ok,true);
 assert.equal(f.requests.length,5);assert.equal(f.specs.length,5);
 for(const {url,options} of f.requests){assert.match(url,/^\/assets\/fonts\/thmanyah\//);assert.equal(options.cache,'no-store');assert.equal(options.credentials,'same-origin');}
 assert.match(f.modals[0][1],/نجح/);assert.match(f.modals[0][2],/HTTP 200/);
});
test('font check reports missing, malformed, undeclared and undecodable fonts as failures',async()=>{
 for(const options of [{status:404},{signature:'html'},{loaded:false},{loadError:true}]){
  const f=fixture(options),result=await f.c.diagnoseLocalFonts();assert.equal(result.ok,false);assert.equal(f.modals.length,1);assert.match(f.modals[0][1],/تعذر/);
  if(options.status||options.signature)assert.equal(f.specs.length,0);
 }
 const missing=fixture({missingApi:true});assert.equal(await missing.c.diagnoseLocalFonts(),false);assert.equal(missing.requests.length,0);
});
test('finishing font checks after logout never opens a modal in the logged-out session',async()=>{
 const f=fixture(),pending=f.c.diagnoseLocalFonts();f.c.authenticatedUser=null;
 assert.equal(await pending,false);assert.equal(f.modals.length,0);
});
