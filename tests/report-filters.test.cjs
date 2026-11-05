'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {dayKey}=require('../lib/work-time');
const {createReportsService}=require('../modules/reports/service');
const script=fs.readFileSync(path.join(__dirname,'../ui/pages/reports.js'),'utf8');
const fixed=Date.parse('2026-11-05T12:00:00Z');
function setup(records=[],extra={}){
 const context=vm.createContext({Date,Intl,URLSearchParams,workDayKey:dayKey,db:{complaints:records,settings:{slaApproved:true}},esc:v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),heading:(t,d,a)=>'<header>'+t+d+a+'</header>',btn:(t,a)=>'<button data-action="'+a+'">'+t+'</button>',...extra});
 vm.runInContext(script,context);return context;
}
const rows=[
 {id:'before',created:'2026-10-31T20:59:59.999Z',province:'دمشق',category:'مياه',priority:'urgent',status:'new',owner:'employee'},
 {id:'start',created:'2026-10-31T21:00:00.000Z',province:'دمشق',category:'مياه',priority:'urgent',status:'new',owner:'employee'},
 {id:'end',created:'2026-11-01T20:59:59.999Z',province:'دمشق',category:'مياه',priority:'urgent',status:'new',owner:'employee'},
 {id:'after',created:'2026-11-01T21:00:00.000Z',province:'دمشق',category:'مياه',priority:'urgent',status:'new',owner:'employee'},
 {id:'other',created:'2026-11-01T08:00:00Z',province:'حلب',category:'نقل',priority:'normal',status:'closed',owner:'other'},
 {id:'archived',created:'2026-11-01T08:00:00Z',province:'دمشق',category:'مياه',priority:'urgent',status:'new',owner:'employee',archivedAt:'2026-11-02'},
 {id:'invalid',created:'invalid',province:'دمشق',category:'مياه',priority:'urgent',status:'new',owner:'employee'}
];
const filters={from:'2026-11-01',to:'2026-11-01',province:'دمشق',category:'مياه',priority:'urgent',status:'new',owner:'employee'};
test('charts and server exports agree on combined filters and Damascus midnight boundaries',()=>{
 const context=setup(rows);context.filters=filters;
 const ui=vm.runInContext('filteredReportRecords(db.complaints,filters).map(c=>c.id)',context);
 const service=createReportsService({complaintsService:{readState:()=>({state:{complaints:rows}})}});
 assert.deepEqual(Array.from(ui),['start','end']);
 assert.deepEqual(service.applyFilters(service.listComplaints(),filters).map(c=>c.id),Array.from(ui));
 const csv=service.buildCsv(filters);assert.equal(csv.count,2);assert.match(csv.buffer.toString(),/start/);assert.doesNotMatch(csv.buffer.toString(),/archived|other|before|after|invalid/);
 assert.equal(service.buildSummaryReport(filters,'synthetic').totals.all,2);
});
test('bounded time buckets and all category totals account for filtered records exactly once',()=>{
 const records=Array.from({length:100},(_,i)=>({id:String(i),created:new Date(Date.UTC(2020,0,1)+i*20*86400000).toISOString(),category:'فئة '+i%3,province:'محافظة '+i%2,owner:'موظف '+i%4,status:i%2?'new':'closed',priority:'normal'}));
 const context=setup(records);context.now=fixed;
 const model=vm.runInContext('buildReportModel(db.complaints,{},db.settings,now)',context);
 assert.ok(model.bins.length<=24);assert.equal(model.bins.reduce((n,b)=>n+b.count,0),100);
 for(const key of ['category','province','status','owner','priority'])assert.equal(model.group(key).reduce((n,item)=>n+item[1],0),100);
 assert.equal(model.ageCounts.reduce((n,c)=>n+c,0),100);
 assert.equal(vm.runInContext("buildReportModel([], {from:'2028-01-01'}, {}, now).bins.length",context),1,'future lower bound remains finite');
});
test('SLA metrics use the filtered population and require approved policy',()=>{
 const context=setup([
  {id:'late',province:'دمشق',status:'new',created:'2026-11-01',due:'2026-11-02'},
  {id:'ontime',province:'دمشق',status:'closed',created:'2026-11-01',due:'2026-11-03',statusHistory:[{to:'closed',at:'2026-11-02'}]},
  {id:'other',province:'حلب',status:'new',created:'2026-11-01',due:'2026-11-02'},
  {id:'draft',province:'دمشق',status:'draft',created:'2026-11-01',due:'2026-11-02'}
 ]);context.now=fixed;
 let model=vm.runInContext("buildReportModel(db.complaints,{province:'دمشق'},db.settings,now)",context);
 assert.equal(model.late,1);assert.equal(model.eligible,2);assert.equal(model.compliance,50);
 model=vm.runInContext("buildReportModel(db.complaints,{province:'دمشق'},{slaApproved:false},now)",context);
 assert.equal(model.late,0);assert.equal(model.compliance,null);
});
test('inverted or invalid dates do not replace applied filters',()=>{
 let renders=0,focused=0;const nodes={reportFrom:{value:'2026-11-05'},reportTo:{value:'2026-11-01'},reportFilterError:{focus(){focused++;}}};
 const context=setup([],{$:selector=>nodes[selector.slice(1)],render:()=>renders++});
 vm.runInContext('applyReportFilters()',context);assert.equal(renders,0);assert.equal(focused,1);assert.equal(nodes.reportFilterError.hidden,false);
 assert.equal(vm.runInContext('reportFilterParams().toString()',context),'');
 nodes.reportFrom.value='2026-02-30';vm.runInContext('applyReportFilters()',context);assert.equal(renders,0);
 nodes.reportFrom.value='2026-11-01';vm.runInContext('applyReportFilters()',context);assert.equal(renders,1);
 assert.equal(vm.runInContext('reportFilterParams().get("from")',context),'2026-11-01');
});
test('export uses applied filters even while form controls have unsaved edits',async()=>{
 const requests=[],downloads=[];
 const context=setup([],{
  uiCan:()=>true,$:()=>({value:'unsaved'}),fetch:async url=>{requests.push(url);return {ok:true,blob:async()=>Buffer.from('synthetic')}} ,
  URL:{createObjectURL:()=> 'blob:synthetic',revokeObjectURL(){}},document:{createElement:()=>({click(){downloads.push(this.download);}})},setTimeout:fn=>fn(),toast(){}
 });
 context.applied={...filters,category:'مياه & صرف'};vm.runInContext('reportFilters=applied',context);
 await vm.runInContext("exportReport('csv')",context);await vm.runInContext("exportReport('xlsx')",context);
 for(const url of requests){const query=new URL(url,'http://localhost').searchParams;for(const [key,value] of Object.entries(context.applied))assert.equal(query.get(key),value);assert.doesNotMatch(url,/unsaved/);}
 assert.equal(downloads.length,2);assert.match(downloads[0],/\.csv$/);assert.match(downloads[1],/\.xlsx$/);
});
test('report charts escape untrusted labels and empty filters do not invent records',()=>{
 const context=setup([{id:'synthetic',created:'2026-11-05',category:'<img src=x onerror=alert(1)>',province:'دمشق',status:'new',priority:'urgent',owner:'test'}]);
 let html=vm.runInContext('reportsPage()',context);assert.doesNotMatch(html,/<img src=x/);assert.match(html,/&lt;img/);assert.match(html,/report-donut/);assert.match(html,/report-line-svg/);
 context.db.complaints=[];html=vm.runInContext('reportsPage()',context);assert.match(html,/لا توجد شكاوى تطابق التصفية/);assert.doesNotMatch(html,/<svg/);
});
test('HTTP export route forwards category and priority filters to the existing export service',async t=>{
 const express=require('express'),{createReportsRouter}=require('../modules/reports/routes');const app=express();let seen;
 const service={buildCsv:filters=>{seen=filters;return {buffer:Buffer.from('synthetic'),filename:'synthetic.csv',count:1};}};
 app.use('/api',createReportsRouter({reportsService:service,middleware:{requireAuth:(req,res,next)=>{req.user={id:'test',username:'test'};next();},requireCsrf:(_req,_res,next)=>next()},rolesService:{requirePermission:()=> (_req,_res,next)=>next()}}));
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});t.after(()=>new Promise(resolve=>server.close(resolve)));
 const query=new URLSearchParams(filters);const response=await fetch('http://127.0.0.1:'+server.address().port+'/api/export/csv?'+query);assert.equal(response.status,200);await response.text();
 for(const [key,value] of Object.entries(filters))assert.equal(seen[key],value);
});
