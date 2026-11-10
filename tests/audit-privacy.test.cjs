'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {sanitizeAuditDetails}=require('../lib/audit-privacy');
const {createRolesService}=require('../modules/roles/service');
test('new audit details redact credentials and personal content while retaining structural before/after changes',()=>{
 const input={changes:{summary:{before:'private-old',after:'private-new'},status:{before:'new',after:'closed'},notes:[{text:'private-note'}]},
 password:'SECRET',nested:{session_token:'TOKEN',authorization:'AUTH',apiKey:'KEY'},phone:'PRIVATE-PHONE'};
 const output=sanitizeAuditDetails(input),text=JSON.stringify(output);
 assert.doesNotMatch(text,/private-|SECRET|TOKEN|AUTH|KEY|PRIVATE-PHONE/);
 assert.deepEqual(output.changes.status,{before:'new',after:'closed'});
 assert.deepEqual(output.changes.summary.after,{redacted:true,length:11});
 assert.equal(input.password,'SECRET','sanitization does not mutate source records');
});
test('permission denials record only action metadata and retain deny-by-default',()=>{
 const events=[],service=createRolesService({audit:(...args)=>events.push(args)});
 const req={method:'POST',user:{id:'one',role:'reviewer'},url:'/private?password=SECRET',body:{text:'PRIVATE'}};
 const res={status(n){this.code=n;return this},json(){}};let called=false;
 service.requirePermission('backup.database')(req,res,()=>called=true);
 assert.equal(res.code,403);assert.equal(called,false);
 assert.deepEqual(events,[['one','permission_denied','permission','backup.database',{method:'POST'}]]);
 assert.equal(service.can('admin','unknown-action'),false);
 service.requirePermission('export.csv')(req,res,()=>called=true);assert.equal(called,true);assert.equal(events.length,1);
});
