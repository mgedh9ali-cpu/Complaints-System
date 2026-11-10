'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
test('column settings are account scoped, discard invalid keys and preserve required columns',()=>{
 const storage=new Map(),user={id:'one'};
 const context=vm.createContext({authenticatedUser:user,document:{addEventListener(){}},localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},toast(){}});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../ui/features/registry-columns.js'),'utf8'),context);
 vm.runInContext("storeRegistryColumns([{key:'prov',visible:false},{key:'id',visible:false},{key:'unknown',visible:true},{key:'prov',visible:true}])",context);
 let cols=vm.runInContext('registryColumns()',context);assert.equal(cols.length,8);assert.equal(cols[0].key,'prov');assert.equal(cols[0].visible,false);assert.equal(cols.find(c=>c.key==='id').visible,true);
 user.id='two';cols=vm.runInContext('registryColumns()',context);assert.equal(cols[0].key,'id');assert.equal(cols.every(c=>c.visible),true);
});
