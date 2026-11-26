'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {assembleUiBundle}=require('../lib/ui-bundle');

test('sync confirmation and reply status renderer are not shadowed by duplicate declarations',()=>{
 const bundle=assembleUiBundle();
 for(const name of ['confirmSyncPassword','confirmExportSyncPassword','replyStatusPill']){
   const declarations=bundle.match(new RegExp('^\\s*(?:async\\s+)?function\\s+'+name+'\\s*\\(', 'gm'))||[];
   assert.equal(declarations.length,1,name+' must have exactly one declaration');
 }
 assert.match(bundle,/if\(typeof syncPasswordResolve==='function'\)return confirmExportSyncPassword\(\)/);
});
