'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const ui=fs.readFileSync(path.join(__dirname,'..','attachments-ui-bridge.js'),'utf8');
function readEscapeHelper(){
 const start=ui.indexOf('function escapeHtml(s) {');
 const end=ui.indexOf('  async function injectIntoDetail()',start);
 assert.ok(start>=0&&end>start,'attachment escaping helper must be present');
 return vm.runInNewContext('('+ui.slice(start,end).trim()+')');
}

test('file names are escaped for safe HTML text insertion',()=>{
 const escapeHtml=readEscapeHelper();
 assert.equal(escapeHtml('<img src=x onerror="alert(1)">'),
  '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
 assert.equal(escapeHtml('invoice & report.pdf'), 'invoice &amp; report.pdf');
 assert.equal(escapeHtml("O'Reilly.xls"),'O&#39;Reilly.xls');
});

test('escaped attachment metadata is used in uploaded file previews and downloads',()=>{
 assert.match(ui,/escapeHtml\(f\.name\)/);
 assert.match(ui,/escapeHtml\(name\)/);
 assert.doesNotMatch(ui,/\{ "&": "&", "<": "<"/);
});
