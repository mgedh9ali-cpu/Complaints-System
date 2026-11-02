'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
test('CircleCI uses reproducible test dependencies and persists failure logs',()=>{
 const ci=read('.circleci/config.yml');
 assert.match(ci,/image: cimg\/node:24/);
 assert.match(ci,/npm ci --ignore-scripts --no-audit --no-fund/);
 assert.match(ci,/npm rebuild better-sqlite3 --build-from-source/);
 assert.match(ci,/npm run check/);
 assert.match(ci,/npm test/);
 assert.match(ci,/store_artifacts:/);
 assert.doesNotMatch(ci,/npm ci[^\n]*\|\| npm install/);
 assert.doesNotMatch(ci,/sudo apt-get update/);
});
test('critical data operations remain private and role restricted',()=>{
 const roles=read('modules/roles/service.js'),server=read('server.js');
 const state=read('modules/complaints/service.js');
 const attachments=read('lib/attachments.js');
 for(const action of ['complaints.create','complaints.update','attachments.upload','backup.database']){
  assert.ok(roles.includes("'"+action+"'"),action);
 }
 assert.match(server,/requireLocalHost/);
 assert.match(state,/إنشاء شكوى عبر حفظ الحالة غير مسموح/);
 assert.match(state,/لا يجوز تغيير نص الرد المعتمد/);
 assert.match(attachments,/الحد الأقصى لعدد المرفقات/);
 assert.match(attachments,/\^\[A-Za-z0-9\]/);
});
