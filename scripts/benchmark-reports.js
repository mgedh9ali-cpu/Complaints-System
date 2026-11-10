'use strict';
// Synthetic records only. Does not open a database or write citizen information.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {performance}=require('node:perf_hooks'),{dayKey}=require('../lib/work-time');
const records=Array.from({length:10000},(_,i)=>({id:'SYNTHETIC-'+i,created:new Date(Date.UTC(2026,0,1)+i%300*86400000).toISOString(),status:i%3?'new':'closed',province:i%2?'دمشق':'حلب',category:'تصنيف '+i%8,priority:'normal',owner:'موظف '+i%10}));
const context=vm.createContext({Date,Intl,URLSearchParams,workDayKey:dayKey,records});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../ui/pages/reports.js'),'utf8'),context);
const started=performance.now();const model=vm.runInContext('buildReportModel(records,{},{slaApproved:false})',context);
assert.equal(model.records.length,10000);assert.equal(model.bins.reduce((n,b)=>n+b.count,0),10000);
console.log(JSON.stringify({syntheticRecords:10000,reportModelMs:Number((performance.now()-started).toFixed(2)),chartBuckets:model.bins.length}));
