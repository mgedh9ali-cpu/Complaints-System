'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {dayBoundary,dayKey}=require('../lib/work-time');
const {createReportsService}=require('../modules/reports/service');
const {createDashboardService}=require('../modules/dashboard/service');

test('Syrian working-day boundaries and day labels use Damascus time',()=>{
 assert.equal(new Date(dayBoundary('2026-11-02')).toISOString(),'2026-11-01T21:00:00.000Z');
 assert.equal(new Date(dayBoundary('2026-11-02',true)).toISOString(),'2026-11-02T20:59:59.999Z');
 assert.equal(dayKey('2026-11-01T22:00:00Z'),'2026-11-02');assert.equal(dayBoundary('2026-02-30'),null);
});
test('daily report filters include Syrian midnight rather than the UTC date boundary',()=>{
 const state={complaints:[{id:'before',created:'2026-11-01T20:59:59Z'},{id:'after',created:'2026-11-01T21:00:00Z'}],settings:{}};
 const service=createReportsService({complaintsService:{readState:()=>({state})}});
 assert.equal(service.buildCsv({from:'2026-11-02',to:'2026-11-02'}).count,1);
 assert.match(service.buildCsv({from:'2026-11-02',to:'2026-11-02'}).buffer.toString(),/after/);
});
test('server overdue counters exclude drafts and terminal records and require SLA approval',()=>{
 const state={complaints:['draft','closed','cancelled','in_progress'].map((status,i)=>({id:String(i),status,due:'2020-01-01T00:00:00Z'})),settings:{slaApproved:true}};
 const source={readState:()=>({state})};
 const reports=createReportsService({complaintsService:source}),dashboard=createDashboardService({complaintsService:source});
 assert.equal(reports.buildSummaryReport().totals.late,1);assert.equal(dashboard.buildSummary().totals.late,1);
 state.settings.slaApproved=false;assert.equal(reports.buildSummaryReport().totals.late,0);assert.equal(dashboard.buildSummary().totals.late,0);
});


test('CSV exports neutralize spreadsheet formulas in user-entered fields',()=>{
 const state={complaints:[{id:'safe',created:'2026-11-01T12:00:00Z',name:'=HYPERLINK("bad")',summary:' +SUM(1,2)',phone:'@SUM(1)'}],settings:{}};
 const reports=createReportsService({complaintsService:{readState:()=>({state})}});
 const csv=reports.buildCsv().buffer.toString();
 assert.ok(csv.includes("'=HYPERLINK"));assert.ok(csv.includes("' +SUM"));assert.ok(csv.includes("'@SUM"));
});
