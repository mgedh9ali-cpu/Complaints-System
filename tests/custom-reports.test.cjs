'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createReportsService}=require('../modules/reports/service');
const {buildModel,encodeReport,FORMATS}=require('../modules/reports/custom');
const service=createReportsService({complaintsService:{readState:()=>({state:{complaints:[
{id:'A',recordType:'contact',status:'closed',province:'دمشق',entity:'أ',summary:'<script>alert(1)</script>',name:'خاص',phone:'0123',created:'2026-01-05T09:00:00Z'},
{id:'B',recordType:'inquiry',status:'new',province:'حلب',entity:'ب',summary:'=1+1',created:'2026-01-06T09:00:00Z'},
{id:'C',recordType:'contact',status:'new',archivedAt:'2026-01-07',created:'2026-01-06T09:00:00Z'}
]}})}});
test('custom filters, sort, group, and default privacy',()=>{
 const m=buildModel(service,{recordType:'contact',entity:'أ',from:'2026-01-01',to:'2026-01-31'});
 assert.equal(m.count,1);assert.equal(m.closed,1);assert.deepEqual(m.groups,[['تواصل',1]]);
 assert.ok(!m.columns.some(c=>['name','phone','summary'].includes(c.key)));
 assert.equal(buildModel(service,{columns:'id',sort:'id',direction:'desc'}).rows[0][0],'B');
 assert.throws(()=>buildModel(service,{from:'2026-02-30'}),/تاريخ/);
 assert.throws(()=>buildModel(service,{from:'2026-03-01',to:'2026-01-01'}),/الفترة/);
});
test('custom HTML XML escape markup and CSV TSV guard formulas',async()=>{
 const m=buildModel(service,{columns:'id,summary'});
 for(const format of ['html','xml']){
  const result=(await encodeReport(m,format)).toString();
  assert.ok(!result.includes('<script>alert(1)</script>'));assert.ok(result.includes('&lt;script&gt;'));if(format==='html'){assert.match(result,/sha256-[A-Za-z0-9+/=]+/);assert.ok(result.includes('report-search'));}
 }
 for(const format of ['csv','tsv'])assert.ok((await encodeReport(m,format)).toString().includes("'=1+1"));
 const json=JSON.parse((await encodeReport(m,'json')).toString());
 assert.deepEqual(json.rows,m.rows);
});
test('custom export produces native Office and OpenDocument containers',async()=>{
 const m=buildModel(service,{columns:'id,summary'});
 const JSZip=require('jszip');
 for(const [format,member] of [['docx','word/document.xml'],['xlsx','xl/workbook.xml'],['odt','content.xml'],['ods','content.xml']]){
  const zip=await JSZip.loadAsync(await encodeReport(m,format));assert.ok(zip.file(member),format);
  if(format==='odt'||format==='ods')assert.equal(await zip.file('mimetype').async('string'),FORMATS[format]);
 }
 const ExcelJS=require('exceljs'),workbook=new ExcelJS.Workbook();await workbook.xlsx.load(await encodeReport(m,'xlsx'));assert.equal(workbook.worksheets[0].getCell('B3').value,'=1+1');
});
test('custom PDF signature and remaining text/vector formats',async()=>{
 const m=buildModel(service,{columns:'id'});
 assert.equal((await encodeReport(m,'pdf')).subarray(0,5).toString(),'%PDF-');
 for(const f of ['svg','rtf','md','txt'])assert.ok((await encodeReport(m,f)).length>10);
 const JSZip=require('jszip'),zip=await JSZip.loadAsync(await encodeReport(m,'zip'));assert.ok(zip.file('report.pdf'));assert.ok(zip.file('report.xlsx'));
});
