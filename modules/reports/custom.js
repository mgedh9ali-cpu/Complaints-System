'use strict';
const {dayKey}=require('../../lib/work-time');
const crypto=require('node:crypto');
const TYPES={complaint:'شكوى',inquiry:'استفسار',contact:'تواصل'};
const STATUS={draft:'غير مكتملة',new:'جديدة',in_progress:'قيد المعالجة',awaiting_reply:'قيد المعالجة',awaiting_approval:'قيد المعالجة',closed:'مغلقة',cancelled:'ملغاة'};
const PRIORITY={normal:'عادية',high:'عالية',urgent:'عاجلة'};
const FIELDS=Object.freeze({id:'رقم السجل',recordType:'نوع السجل',created:'تاريخ التسجيل',firstContactDate:'أول تواصل',province:'المحافظة',entity:'الجهة',category:'التصنيف',status:'الحالة',priority:'الأولوية',summary:'الموضوع',name:'الاسم',phone:'الهاتف',due:'المهلة'});
const DEFAULT=['id','recordType','created','province','category','status'];
const FORMATS=Object.freeze({csv:'text/csv; charset=utf-8',tsv:'text/tab-separated-values; charset=utf-8',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',pdf:'application/pdf',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',html:'text/html; charset=utf-8',txt:'text/plain; charset=utf-8',json:'application/json; charset=utf-8',xml:'application/xml; charset=utf-8',md:'text/markdown; charset=utf-8',svg:'image/svg+xml',rtf:'application/rtf',odt:'application/vnd.oasis.opendocument.text',ods:'application/vnd.oasis.opendocument.spreadsheet',zip:'application/zip'});
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const clean=v=>String(v??'').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g,'');
const esc=v=>clean(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const label=(key,value)=>{const map={recordType:TYPES,status:STATUS,priority:PRIORITY}[key];return map&&own(map,value)?map[value]:clean(value);};
function buildModel(service,query={}){
 const get=(k,max=200)=>typeof query[k]==='string'?query[k].trim().slice(0,max):'';
 const filters={};for(const k of ['from','to','province','category','status','priority']){const v=get(k);if(v)filters[k]=v;}
 for(const k of ['from','to'])if(filters[k]&&(!/^\d{4}-\d{2}-\d{2}$/.test(filters[k])||!Number.isFinite(Date.parse(filters[k]))||new Date(filters[k]).toISOString().slice(0,10)!==filters[k]))throw Object.assign(new Error('تاريخ غير صالح'),{status:400});
 if(filters.from&&filters.to&&filters.from>filters.to)throw Object.assign(new Error('الفترة غير صالحة'),{status:400});
 const type=get('recordType'),entity=get('entity');
 let rows=service.applyFilters(service.listComplaints(),filters).filter(c=>c&&(!type||(c.recordType||'complaint')===type)&&(!entity||c.entity===entity));
 if(rows.length>5000)throw Object.assign(new Error('حدد فترة أصغر: الحد 5000 سجل لكل تقرير'),{status:400});
 const requested=get('columns',500).split(',').filter(k=>own(FIELDS,k));
 const columns=[...new Set(requested.length?requested:DEFAULT)];
 const sort=columns.includes(get('sort'))?get('sort'):columns[0], direction=get('direction')==='desc'?-1:1;
 const value=(c,k)=>label(k,k==='recordType'?(c.recordType||'complaint'):c[k]);
 rows=rows.slice().sort((a,b)=>direction*value(a,sort).localeCompare(value(b,sort),'ar',{numeric:true}));
 const groupKey=['recordType','status','province','entity','category','priority'].includes(get('group'))?get('group'):'recordType';
 const groups=new Map();for(const c of rows){const k=value(c,groupKey)||'غير محدد';groups.set(k,(groups.get(k)||0)+1);}
 return {title:get('title',160)||'تقرير السجلات',description:get('description',2000),generatedAt:new Date().toISOString(),filters:{...filters,recordType:type,entity},columns:columns.map(key=>({key,label:FIELDS[key]})),rows:rows.map(c=>columns.map(k=>value(c,k))),count:rows.length,closed:rows.filter(c=>c.status==='closed').length,groupLabel:FIELDS[groupKey],groups:[...groups].sort((a,b)=>b[1]-a[1])};
}
const csvCell=(v,sep)=>{let s=clean(v);if(/^[\s\u0000-\u001f]*[=+\-@]/.test(s))s="'"+s;return s.includes(sep)||/["\r\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;};
const lines=m=>[m.title,m.description,'عدد السجلات: '+m.count,'مغلقة: '+m.closed,m.groupLabel,...m.groups.map(([k,n])=>k+': '+n),...m.rows.map(r=>r.map((v,i)=>m.columns[i].label+': '+v).join(' | '))];
function svg(m){
 const groups=m.groups.slice(0,20),max=Math.max(1,...groups.map(x=>x[1])),height=80+groups.length*32;
 return '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="'+height+'" viewBox="0 0 900 '+height+'"><rect width="900" height="'+height+'" fill="white"/><g font-family="Tahoma,Arial,sans-serif" fill="#183e34"><text x="870" y="28" text-anchor="end" font-size="20">'+esc(m.title)+'</text><text x="870" y="53" text-anchor="end">عدد السجلات: '+m.count+'</text>'+groups.map(([k,n],i)=>'<text x="870" y="'+(82+i*32)+'" text-anchor="end" font-size="14">'+esc(k.slice(0,45))+'</text><rect x="65" y="'+(67+i*32)+'" width="'+Math.round(n/max*400)+'" height="19" rx="3" fill="#34745e"/><text x="55" y="'+(82+i*32)+'" text-anchor="end">'+n+'</text>').join('')+'</g></svg>';
}
const HTML_SCRIPT="const q=document.getElementById('report-search'),count=document.getElementById('report-visible'),rows=Array.from(document.querySelectorAll('tbody tr'));function filter(){const term=q.value.trim().toLocaleLowerCase('ar');let n=0;for(const row of rows){row.hidden=!row.textContent.toLocaleLowerCase('ar').includes(term);if(!row.hidden)n++;}count.textContent=n+' / '+rows.length;}q.addEventListener('input',filter);for(const [i,button] of Array.from(document.querySelectorAll('thead button')).entries()){let asc=true;button.addEventListener('click',()=>{rows.sort((a,b)=>(asc?1:-1)*a.cells[i].textContent.localeCompare(b.cells[i].textContent,'ar',{numeric:true}));for(const row of rows)row.parentNode.appendChild(row);asc=!asc;});}filter();";
const HTML_SCRIPT_HASH=crypto.createHash('sha256').update(HTML_SCRIPT).digest('base64');
function html(m){return '<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; style-src &#39;unsafe-inline&#39;; script-src &#39;sha256-'+HTML_SCRIPT_HASH+'&#39;"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+esc(m.title)+'</title><style>body{font-family:Tahoma,Arial,sans-serif;margin:2rem;color:#183e34}table{border-collapse:collapse;width:100%}td,th{border:1px solid #c8d5d0;padding:8px;text-align:right;overflow-wrap:anywhere}th{background:#e5f0ea}th button{border:0;background:transparent;font:inherit;cursor:pointer;color:inherit;text-align:right}input{font:inherit;margin:8px;padding:6px}svg{max-width:100%;height:auto}tr{break-inside:avoid}@media print{body{margin:0}thead{display:table-header-group}}</style></head><body><h1>'+esc(m.title)+'</h1><p>'+esc(m.description)+'</p><p>عدد السجلات: '+m.count+' · مغلقة: '+m.closed+'</p>'+svg(m)+'<h2>'+esc(m.groupLabel)+'</h2><ul>'+m.groups.map(([k,n])=>'<li>'+esc(k)+': '+n+'</li>').join('')+'</ul><label for="report-search">البحث داخل التقرير</label> <input id="report-search" type="search"> <output id="report-visible" aria-live="polite"></output><table><thead><tr>'+m.columns.map(c=>'<th><button type="button">'+esc(c.label)+'</button></th>').join('')+'</tr></thead><tbody>'+m.rows.map(r=>'<tr>'+r.map(v=>'<td>'+esc(v)+'</td>').join('')+'</tr>').join('')+'</tbody></table><script>'+HTML_SCRIPT+'</script></body></html>';}
const rtfText=v=>Array.from(clean(v)).map(c=>{let out='';for(let i=0;i<c.length;i++){const n=c.charCodeAt(i);out+=n>127?'\\u'+(n>32767?n-65536:n)+'?':c[i].replace(/[\\{}]/g,'\\$&').replace(/\r/g,'').replace(/\n/g,'\\line ');}return out;}).join('');
async function openDocument(m,format){
 const JSZip=require('jszip'),zip=new JSZip(),mime=FORMATS[format];
 zip.file('mimetype',mime,{compression:'STORE'});
 const ns=' xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" office:version="1.2"';
 const p=v=>'<text:p>'+esc(v)+'</text:p>';
 const tableRows=[m.columns.map(c=>c.label),...m.rows].map(r=>'<table:table-row>'+r.map(v=>'<table:table-cell office:value-type="string">'+p(v)+'</table:table-cell>').join('')+'</table:table-row>').join('');
 const table='<table:table table:name="Report">'+tableRows+'</table:table>';
 const body=format==='odt'?'<office:text>'+p(m.title)+p(m.description)+p('عدد السجلات: '+m.count)+table+'</office:text>':'<office:spreadsheet>'+table+'</office:spreadsheet>';
 zip.file('content.xml','<?xml version="1.0" encoding="UTF-8"?><office:document-content'+ns+'><office:body>'+body+'</office:body></office:document-content>');
 zip.file('META-INF/manifest.xml','<?xml version="1.0" encoding="UTF-8"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2"><manifest:file-entry manifest:full-path="/" manifest:media-type="'+mime+'"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/></manifest:manifest>');
 return zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
}
async function encodeReport(m,format){
 if(!own(FORMATS,format))throw new Error('صيغة غير مدعومة');
 const headers=m.columns.map(c=>c.label);
 if(format==='csv'||format==='tsv'){const sep=format==='csv'?',':'\t';return Buffer.from('\uFEFF'+[headers,...m.rows].map(r=>r.map(v=>csvCell(v,sep)).join(sep)).join('\r\n'));}
 if(format==='json')return Buffer.from(JSON.stringify(m,null,2));
 if(format==='xml')return Buffer.from('<?xml version="1.0" encoding="UTF-8"?><report><title>'+esc(m.title)+'</title><description>'+esc(m.description)+'</description><count>'+m.count+'</count><rows>'+m.rows.map(r=>'<row>'+r.map((v,i)=>'<field name="'+esc(m.columns[i].key)+'">'+esc(v)+'</field>').join('')+'</row>').join('')+'</rows></report>');
 if(format==='txt')return Buffer.from(lines(m).join('\n'));
 if(format==='md'){const md=v=>clean(v).replace(/[\\|<>\x60]/g,c=>'\\'+c).replace(/\r?\n/g,' ');return Buffer.from('# '+md(m.title)+'\n\n'+md(m.description)+'\n\n'+[headers,headers.map(()=> '---'),...m.rows].map(r=>'| '+r.map(md).join(' | ')+' |').join('\n'));}
 if(format==='html')return Buffer.from(html(m));
 if(format==='svg')return Buffer.from(svg(m));
 if(format==='rtf')return Buffer.from('{\\rtf1\\ansi\\ansicpg1252\\uc1\\deff0{\\fonttbl{\\f0 Tahoma;}}\\rtlpar\\f0\\fs24 '+lines(m).map(rtfText).join('\\par ')+'}');
 if(format==='odt'||format==='ods')return openDocument(m,format);
 if(format==='pdf')return require('../../lib/simple-pdf').buildSimplePdf({title:m.title,lines:lines(m).slice(1)});
 if(format==='docx')return require('../../lib/word-export').buildWordDocument({title:m.title,paragraphs:lines(m).map((text,i)=>({text,heading:i===0})),integrityHash:crypto.createHash('sha256').update(JSON.stringify(m)).digest('hex')});
 if(format==='xlsx'){
  const ExcelJS=require('exceljs'),book=new ExcelJS.Workbook();
  const sheet=book.addWorksheet('السجلات',{views:[{rightToLeft:true,state:'frozen',ySplit:1}]});
  sheet.addRow(headers);sheet.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};sheet.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF245B49'}};
  for(const row of m.rows)sheet.addRow(row.map(clean));
  sheet.columns.forEach(c=>{c.width=24;c.alignment={horizontal:'right',wrapText:true};});
  const stats=book.addWorksheet('الملخص',{views:[{rightToLeft:true}]});stats.addRows([[m.title],[m.description],['عدد السجلات',m.count],['مغلقة',m.closed],[m.groupLabel,'العدد'],...m.groups]);stats.getColumn(1).width=45;stats.getColumn(2).width=18;
  return Buffer.from(await book.xlsx.writeBuffer());
 }
 if(format==='zip'){const JSZip=require('jszip'),zip=new JSZip();for(const f of ['csv','xlsx','docx','pdf','html','json','svg'])zip.file('report.'+f,await encodeReport(m,f));return zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});}
}
module.exports={buildModel,encodeReport,FORMATS,FIELDS};
