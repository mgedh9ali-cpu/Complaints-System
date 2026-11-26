'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const {createReportsService}=require('../modules/reports/service');
const {createReportsRouter}=require('../modules/reports/routes');
const rows=[{id:'active',name:'اختبار',summary:'موضوع',status:'new'},
  {id:'hidden',summary:'خارج التصفية',status:'closed'},
  {id:'archived',summary:'مؤرشف',status:'closed',archivedAt:'2026-11-10'}];
function service(){return createReportsService({complaintsService:{readState:()=>({state:{complaints:rows}})}});}
test('CSV, Excel and PDF selection honor exact IDs; archive inclusion is explicit',async()=>{
  const s=service();
  assert.equal(s.buildCsv({ids:[]}).count,0);
  assert.equal(s.buildCsv({ids:['archived']}).count,0);
  assert.equal(s.buildCsv({ids:['archived'],includeArchived:true}).count,1);
  const csv=s.buildCsv({ids:['active']});assert.equal(csv.count,1);assert.doesNotMatch(csv.buffer.toString(),/hidden|archived/);
  const ExcelJS=require('exceljs');const xlsx=await s.buildXlsx('test',{ids:['active']});
  const book=new ExcelJS.Workbook();await book.xlsx.load(xlsx.buffer);
  const cells=[];book.eachSheet(sheet=>sheet.eachRow(row=>cells.push(JSON.stringify(row.values))));
  assert.match(cells.join(' '),/active/);assert.doesNotMatch(cells.join(' '),/hidden|archived/);
  const pdf=await s.buildRegistryPdf('test',{ids:['active']});
  assert.equal(pdf.count,1);assert.equal(pdf.buffer.subarray(0,5).toString(),'%PDF-');
});
test('selection HTTP route enforces authentication, permission, CSRF and input bounds',async t=>{
  const express=require('express'),app=express(),audits=[];
  app.use(express.json());app.use((req,res,next)=>{req.user={id:'one',username:'test'};next();});
  app.use('/api',createReportsRouter({reportsService:service(),audit:(...args)=>audits.push(args),
    middleware:{requireAuth:(req,res,next)=>req.get('X-Auth')==='yes'?next():res.sendStatus(401),
      requireCsrf:(req,res,next)=>req.get('X-CSRF')==='yes'?next():res.sendStatus(403)},
    rolesService:{requirePermission:permission=>(req,res,next)=>req.get('X-Permission')===permission?next():res.sendStatus(403)}}));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  async function request(format,body,headers={}){return fetch('http://127.0.0.1:'+server.address().port+'/api/export/'+format+'/selection',{
    method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});}
  const headers={'X-Auth':'yes','X-Permission':'export.csv','X-CSRF':'yes'};
  assert.equal((await request('csv',{ids:['active']})).status,401);
  assert.equal((await request('csv',{ids:['active']},{'X-Auth':'yes'})).status,403);
  assert.equal((await request('csv',{ids:['active']},{...headers,'X-CSRF':'no'})).status,403);
  for(const ids of [null,[{}],[''],Array(5001).fill('active')])assert.equal((await request('csv',{ids},headers)).status,400);
  assert.equal((await request('pdf',{ids:['active']},headers)).status,403);
  assert.equal((await request('exe',{ids:['active']},headers)).status,404);
  const csv=await request('csv',{ids:['active','active']},headers);
  assert.equal(csv.status,200);assert.equal(csv.headers.get('cache-control'),'no-store');
  assert.equal(csv.headers.get('x-export-count'),'1');assert.doesNotMatch(await csv.text(),/hidden|archived/);
  assert.deepEqual(audits[0][4].selectedIds,['active']);
  const pdf=await request('pdf',{ids:['archived'],includeArchived:true},{...headers,'X-Permission':'export.xlsx'});
  assert.equal(pdf.status,200);assert.equal(pdf.headers.get('content-type'),'application/pdf');
  assert.equal(pdf.headers.get('x-export-count'),'1');
});
test('export preview freezes all filtered pages, escapes sample text, and cancels without downloading',async()=>{
  let decide,options,request,downloads=0;
  const filtered=Array.from({length:60},(_,i)=>({id:'id-'+i,summary:'<img onerror=x>'}));
  const context={page:'complaints',db:{complaints:[...filtered,{id:'excluded'}]},uiCan:()=>true,
    filteredComplaints:()=>filtered,esc:s=>String(s).replace(/</g,'&lt;').replace(/>/g,'&gt;'),
    toast(){},confirmDialog:o=>{options=o;return new Promise(resolve=>decide=resolve);},
    flushUiBeforeAction:async()=>{},getWriteCsrf:async()=>'csrf',workDayKey:()=> '2026-11-10',Date,
    fetch:async(url,opts)=>{request={url,...opts};return {ok:true,blob:async()=>new Blob(['file'])};},
    URL:{createObjectURL:()=> 'blob:example',revokeObjectURL(){}},setTimeout(){},
    document:{createElement:()=>({click(){downloads++;}})}};
  vm.createContext(context);vm.runInContext(fs.readFileSync('ui/features/documents.js','utf8'),context);
  const pending=context.previewRegistryExport('pdf');
  assert.match(options.message,/60/);assert.equal(options.records.length,5);
  filtered.pop();decide(true);await pending;
  const body=JSON.parse(request.body);assert.equal(body.ids.length,60);assert.ok(!body.ids.includes('excluded'));
  assert.equal(request.headers['X-CSRF-Token'],'csrf');assert.equal(downloads,1);
  const cancel=context.previewRegistryExport('csv');decide(false);assert.equal(await cancel,false);assert.equal(downloads,1);
  const selected=context.previewRegistryExport('csv',['id-2','excluded']);assert.match(options.message,/1 سجل/);decide(false);await selected;
});
test('registry date filtering uses Damascus day boundaries and preserves date-only inputs',()=>{
  const {dayKey}=require('../lib/work-time');
  const c={Date,workDayKey:dayKey};vm.createContext(c);
  vm.runInContext(fs.readFileSync('ui/pages/registry.js','utf8'),c);
  vm.runInContext("dateFrom='2026-11-10';dateTo='2026-11-10'",c);
  assert.equal(c.inDateRange({created:'2026-11-09T21:00:00.000Z'}),true);
  assert.equal(c.inDateRange({created:'2026-11-10T21:00:00.000Z'}),false);
  vm.runInContext("dateTypeFilter='first_contact'",c);
  assert.equal(c.inDateRange({firstContactDate:'2026-11-10'}),true);
  assert.equal(c.inDateRange({firstContactDate:'invalid'}),false);
});

test('registry closure date prefers stored completion date and supports legacy history',()=>{
 const c={Date};vm.createContext(c);
 vm.runInContext(fs.readFileSync('ui/pages/registry.js','utf8'),c);
 assert.equal(c.complaintDateValue({status:'closed',closedAt:'2026-11-10'},'closed'),'2026-11-10');
 assert.equal(c.complaintDateValue({status:'closed',statusHistory:[{to:'closed',at:'2026-11-09'}]},'closed'),'2026-11-09');
 assert.equal(c.complaintDateValue({status:'in_progress',statusHistory:[{to:'closed',at:'2026-11-09'}]},'closed'),'');
 assert.equal(c.normalizeRegistryQueue('closed'),'closed');
});
