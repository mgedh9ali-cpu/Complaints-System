'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
test('confirmation waits for the explicit decision and closing settles it as cancelled',async()=>{
 const root={dataset:{},innerHTML:'',classList:{remove(){}}},dlg={focus(){}};
 const context={document:{activeElement:null,documentElement:{dataset:{}},addEventListener(){},contains:()=>false},window:{},esc:s=>String(s).replace(/</g,'&lt;').replace(/>/g,'&gt;'),CustomEvent:class{},$:s=>s==='#modalRoot'?root:s==='.modal'?dlg:null,$$:()=>[]};
 const api=vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../ui/components/dialogs.js'),'utf8')+';({confirmDialog,resolveConfirmDialog,closeModal})',context);
 let settled=false;const pending=api.confirmDialog({records:[{id:'<id>',summary:'<img onerror=x>'}]}).then(value=>{settled=true;return value;});await Promise.resolve();assert.equal(settled,false);assert.doesNotMatch(root.innerHTML,/<img/);assert.match(root.innerHTML,/&lt;img/);
 api.resolveConfirmDialog(true);assert.equal(await pending,true);
 const cancelled=api.confirmDialog();api.closeModal();assert.equal(await cancelled,false);
});
