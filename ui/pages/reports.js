/* Local reporting: all charts and downloads share the same applied filters. */
let reportFilters={from:'',to:'',province:'',category:'',status:'',priority:''};
const REPORT_STATUS_LABELS={draft:'غير مكتملة',new:'جديدة',in_progress:'قيد المعالجة',closed:'مغلقة',cancelled:'ملغاة'};
function reportDisplayStatus(status){return ['awaiting_reply','awaiting_approval'].includes(status)?'in_progress':status;}
const REPORT_PRIORITY_LABELS={normal:'عادية',high:'عالية',urgent:'عاجلة'};
function reportDayValid(day){return /^\d{4}-\d{2}-\d{2}$/.test(day)&&Number.isFinite(Date.parse(day+'T00:00:00Z'))&&new Date(day+'T00:00:00Z').toISOString().slice(0,10)===day;}
function reportCreatedDay(c){return c.created?workDayKey(c.created):'';}
function reportDateLabel(day){return day?day.split('-').reverse().join('/'):'—';}
function reportFilterParams(filters=reportFilters){const params=new URLSearchParams();for(const key of ['from','to','province','category','status','priority'])if(filters[key])params.set(key,filters[key]);return params;}
function filteredReportRecords(complaints,filters=reportFilters){
 return (Array.isArray(complaints)?complaints:[]).filter(c=>{
  if(!c||c.archivedAt)return false;
  for(const key of ['province','category','status','priority'])if(filters[key]&&(key==='status'?reportDisplayStatus(c.status)!==reportDisplayStatus(filters.status):c[key]!==filters[key]))return false;
  if(filters.from||filters.to){const day=reportCreatedDay(c);if(!day||(filters.from&&day<filters.from)||(filters.to&&day>filters.to))return false;}
  return true;
 });
}
function buildReportModel(complaints,filters={},settings={},now=Date.now()){
 const records=filteredReportRecords(complaints,filters);
 const group=key=>{const counts=new Map();for(const c of records){const label=String((key==='status'?reportDisplayStatus(c.status):c[key])||'غير محدد');counts.set(label,(counts.get(label)||0)+1);}return [...counts].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0],'ar'));};
 const validDays=records.map(c=>reportCreatedDay(c)).filter(Boolean).sort();
 const today=workDayKey(now);
 const end=filters.to||[today,validDays.at(-1),filters.from].filter(Boolean).sort().at(-1);
 const fallbackStart=new Date(Date.parse(end+'T12:00:00Z')-13*86400000).toISOString().slice(0,10);
 const start=filters.from||[fallbackStart,validDays[0]].filter(Boolean).sort()[0];
 const days=Math.max(1,Math.round((Date.parse(end)-Date.parse(start))/86400000)+1);
 const span=Math.max(1,Math.ceil(days/24));
 const bins=Array.from({length:Math.ceil(days/span)},(_,i)=>{
  const first=new Date(Date.parse(start)+i*span*86400000).toISOString().slice(0,10);
  const last=new Date(Math.min(Date.parse(end),Date.parse(first)+(span-1)*86400000)).toISOString().slice(0,10);
  return {first,last,count:0};
 });
 for(const c of records){const day=reportCreatedDay(c);if(!day||day<start||day>end)continue;const i=Math.floor((Date.parse(day)-Date.parse(start))/86400000/span);if(bins[i])bins[i].count++;}
 const ageCounts=[0,0,0,0];
 for(const c of records){const created=Date.parse(c.created);if(!Number.isFinite(created)){ageCounts[3]++;continue;}const age=Math.max(0,Math.floor((now-created)/86400000));ageCounts[age<7?0:age<=30?1:2]++;}
 const eligible=settings.slaApproved?records.filter(c=>!['draft','cancelled'].includes(c.status)&&Number.isFinite(Date.parse(c.created))&&Number.isFinite(Date.parse(c.due))):[];
 const compliant=eligible.filter(c=>{
  if(c.status!=='closed')return now<=Date.parse(c.due);
  const closedAt=c.closedAt||(c.statusHistory||[]).filter(t=>t.to==='closed').at(-1)?.at||c.closed||c.updated;
  return Number.isFinite(Date.parse(closedAt))&&Date.parse(closedAt)<=Date.parse(c.due);
 });
 const late=settings.slaApproved?records.filter(c=>!['draft','closed','cancelled'].includes(c.status)&&Number.isFinite(Date.parse(c.due))&&Date.parse(c.due)<now).length:0;
 return {records,bins,start,end,span,days,group,ageCounts,late,closed:records.filter(c=>c.status==='closed').length,eligible:eligible.length,compliant:compliant.length,compliance:eligible.length?Math.round(compliant.length/eligible.length*100):null};
}
function applyReportFilters(){
 const next={};for(const key of Object.keys(reportFilters))next[key]=$('#report'+key[0].toUpperCase()+key.slice(1))?.value?.trim()||'';
 const error=$('#reportFilterError');
 if((next.from&&!reportDayValid(next.from))||(next.to&&!reportDayValid(next.to))||(next.from&&next.to&&next.from>next.to)){
  if(error){error.textContent='اختر فترة صحيحة؛ تاريخ البداية يجب أن يسبق تاريخ النهاية.';error.hidden=false;error.focus();}return;
 }
 reportFilters=next;render();
}
function setReportPeriod(days){
 if(!days){reportFilters={from:'',to:'',province:'',category:'',status:'',priority:''};}
 else{const to=workDayKey(Date.now());const from=new Date(Date.parse(to+'T12:00:00Z')-(days-1)*86400000).toISOString().slice(0,10);reportFilters={...reportFilters,from,to};}
 render();
}
async function exportReport(format){
 if(!['csv','xlsx'].includes(format)||!uiCan('export.'+format))return toast('لا تملك صلاحية تصدير هذا النوع.','error');
 const params=reportFilterParams();const response=await fetch('/api/export/'+format+(params.size?'?'+params.toString():''),{credentials:'same-origin'});
 if(!response.ok){const data=await response.json().catch(()=>({}));throw new Error(data.error||'تعذر تصدير التقرير.');}
 const blob=await response.blob(),url=URL.createObjectURL(blob),link=document.createElement('a');
 link.href=url;link.download='complaints-report-'+workDayKey(Date.now())+'.'+format;link.click();setTimeout(()=>URL.revokeObjectURL(url),1500);
 toast('تم تصدير التقرير وفق التصفية المطبقة.');
}
function reportsPage(){
 const filters=reportFilters,all=Array.isArray(db.complaints)?db.complaints.filter(c=>c&&!c.archivedAt):[];
 const model=buildReportModel(all,filters,db.settings||{}),records=model.records,total=records.length;
 const safe=esc;
 const choice=(key,title,labels={})=>{
  const options=[...new Set(all.map(c=>String((key==='status'?reportDisplayStatus(c.status):c[key])||'')).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ar'));
  const id='report'+key[0].toUpperCase()+key.slice(1);
  return '<div class="form-field"><label for="'+id+'">'+title+'</label><select id="'+id+'"><option value="">الكل</option>'+options.map(value=>'<option value="'+safe(value)+'" '+(filters[key]===value?'selected':'')+'>'+safe(labels[value]||value)+'</option>').join('')+'</select></div>';
 };
 const horizontal=(items,emptyLabel)=>{
  if(!items.length)return '<p class="empty-state calm-empty">'+emptyLabel+'</p>';
  const max=Math.max(1,...items.map(item=>item[1]));
  return '<div class="report-rank-list">'+items.map(([label,count],i)=>'<div class="report-rank-item"><div class="status-line"><span>'+safe(label)+'</span><strong>'+count+'</strong></div><div class="progress" role="meter" aria-label="'+safe(label)+'" aria-valuemin="0" aria-valuemax="'+max+'" aria-valuenow="'+count+'"><span style="width:'+Math.round(count/max*100)+'%;background:var(--chart-'+(i%6+1)+')"></span></div></div>').join('')+'</div>';
 };
 const panel=(title,description,content,extra='')=>'<section class="panel '+extra+'"><div class="panel-header"><div><h2>'+title+'</h2><p>'+description+'</p></div></div><div class="panel-body">'+content+'</div></section>';
 const peak=Math.max(1,...model.bins.map(b=>b.count));
 const chartSubtitle=(model.span===1?'حسب اليوم':'تجميع كل '+model.span+' يومًا')+' · '+reportDateLabel(model.start)+' — '+reportDateLabel(model.end);
 const dailyBars=model.bins.map((b,i)=>{
  const label=reportDateLabel(b.first),count=b.count;
  return '<div class="daily-bar-item" role="listitem" aria-label="'+label+'، '+count+' شكوى" title="'+label+(b.last!==b.first?' — '+reportDateLabel(b.last):'')+' · '+count+' شكوى"><span class="daily-count">'+count+'</span><div class="daily-track"><span class="daily-fill" style="height:'+Math.round(count/peak*100)+'%"></span></div><span class="daily-label">'+(i===0||i===Math.floor(model.bins.length/2)||i===model.bins.length-1?label:'')+'</span></div>';
 }).join('');
 const recentEmpty=model.days===14?'لم تُسجل شكاوى خلال آخر 14 يومًا.':'لا توجد سجلات مؤرخة ضمن الفترة المحددة.';
 const bars=model.bins.some(b=>b.count)?'<div class="daily-chart" style="--report-bins:'+model.bins.length+'" role="list" aria-label="عدد الشكاوى في كل فترة">'+dailyBars+'</div>':'<div class="empty-state calm-empty">'+recentEmpty+'</div>';
 let running=0;const cumulative=model.bins.map(b=>running+=b.count),top=Math.max(1,running);
 const points=cumulative.map((n,i)=>[Math.round(32+(cumulative.length===1?0:i/(cumulative.length-1))*656),Math.round(180-n/top*140)]);
 if(points.length===1)points.push([688,points[0][1]]);
 const pointText=points.map(p=>p.join(',')).join(' ');
 const trend=running?'<div class="report-line-chart"><svg class="report-line-svg" viewBox="0 0 720 220" role="img" aria-label="إجمالي تراكمي من '+cumulative[0]+' إلى '+running+' سجل خلال الفترة"><path class="chart-grid" d="M32 40H688M32 110H688M32 180H688"/><polygon class="chart-area" points="32,180 '+pointText+' 688,180"/><polyline class="chart-line" points="'+pointText+'"/>'+points.map(p=>'<circle class="chart-point" cx="'+p[0]+'" cy="'+p[1]+'" r="4"/>').join('')+'<text x="8" y="44">'+running+'</text><text x="8" y="184">0</text></svg><div class="report-chart-axis"><span>'+reportDateLabel(model.start)+'</span><span>'+reportDateLabel(model.end)+'</span></div><p class="small-copy">المجموع التراكمي للسجلات ذات تاريخ الإنشاء الصالح: '+running+'</p></div>':'<div class="empty-state calm-empty">لا توجد بيانات لرسم الاتجاه التراكمي.</div>';
 const statuses=model.group('status');let percent=0;
 const slices=statuses.map(([,count],i)=>{const start=percent;percent+=count/Math.max(1,total)*100;return 'var(--chart-'+(i%6+1)+') '+start.toFixed(4)+'% '+percent.toFixed(4)+'%';});
 const donut=total?'<div class="report-donut-layout"><div class="report-donut" style="background:conic-gradient('+slices.join(',')+')" role="img" aria-label="توزيع '+total+' سجلًا حسب الحالة"><div><strong>'+total+'</strong><span>سجل</span></div></div><ul class="report-chart-legend">'+statuses.map(([status,count],i)=>'<li><span class="report-swatch" style="background:var(--chart-'+(i%6+1)+')" aria-hidden="true"></span><span>'+safe(REPORT_STATUS_LABELS[status]||status)+'</span><strong>'+count+' · '+Math.round(count/total*100)+'٪</strong></li>').join('')+'</ul></div>':'<div class="empty-state calm-empty">لا توجد حالات لعرضها.</div>';
 const actions=btn('طباعة / حفظ PDF','print-report')+(typeof uiCan!=='function'||uiCan('export.csv')?btn('تصدير CSV','export-csv'):'')+(typeof uiCan!=='function'||uiCan('export.xlsx')?btn('تصدير Excel','export-xlsx'):'');
 const scope=[filters.from?'من '+reportDateLabel(filters.from):'',filters.to?'حتى '+reportDateLabel(filters.to):'',...['province','category','status','priority'].map(key=>filters[key]?(REPORT_STATUS_LABELS[filters[key]]||REPORT_PRIORITY_LABELS[filters[key]]||filters[key]):'')].filter(Boolean).join(' · ')||'كل التواريخ والمحافظات والتصنيفات والحالات';
 return '<div class="reports-workspace">'+heading('التقارير التشغيلية','رسوم وإحصاءات من السجلات المحفوظة محليًا؛ التصفية حسب تاريخ تسجيل الشكوى.',actions)+customReportPanel()+
 '<section class="panel report-filters" aria-label="تصفية التقارير"><div class="panel-body"><form id="reportFiltersForm"><div class="report-filter-grid"><div class="form-field"><label for="reportFrom">من تاريخ</label><input id="reportFrom" type="date" value="'+safe(filters.from)+'"></div><div class="form-field"><label for="reportTo">إلى تاريخ</label><input id="reportTo" type="date" value="'+safe(filters.to)+'"></div>'+choice('province','المحافظة')+choice('category','التصنيف')+choice('status','الحالة',REPORT_STATUS_LABELS)+choice('priority','الأولوية',REPORT_PRIORITY_LABELS)+'</div><p id="reportFilterError" class="login-error" role="alert" tabindex="-1" hidden></p><div class="report-filter-actions"><button type="submit" class="btn btn-primary">تطبيق التصفية</button><button type="button" class="btn" data-action="report-period" data-days="0">إعادة الضبط / كل الفترات</button><span>فترات سريعة:</span>'+[14,30,90].map(n=>'<button type="button" class="filter-chip" data-action="report-period" data-days="'+n+'">آخر '+n+' يومًا</button>').join('')+'</div></form></div></section>'+
 '<p class="report-scope" role="status">التصفية المطبقة: '+safe(scope)+' · '+total+' من '+all.length+' سجل · تحديث '+safe(new Intl.DateTimeFormat('ar-SY-u-nu-latn',{timeZone:'Asia/Damascus',dateStyle:'short',timeStyle:'short'}).format(new Date()))+'</p>'+
 (!total?'<div class="empty-state">لا توجد شكاوى تطابق التصفية؛ غيّر الفترة أو أعد ضبط المرشحات.</div>':'')+
 '<div class="mini-card-grid report-summary">'+[['إجمالي السجلات',total],['سجلات مغلقة',model.closed],['سجلات مفتوحة',records.filter(c=>!['draft','closed','cancelled'].includes(c.status)).length],['سجلات متجاوزة للمهلة',model.late]].map(([label,count])=>'<div class="mini-card"><small>'+label+'</small><strong>'+count+'</strong></div>').join('')+'</div>'+
 '<div class="report-chart-grid">'+panel('الشكاوى المسجلة خلال الفترة',chartSubtitle,bars,'report-trend')+panel('الاتجاه التراكمي للتسجيل',chartSubtitle,trend)+panel('توزيع الحالات','الأعداد والنسب من نتائج التصفية المطبقة',donut)+panel('توزيع الأولويات','مقارنة أعداد الشكاوى حسب درجة الأولوية',horizontal(model.group('priority').map(([p,n])=>[REPORT_PRIORITY_LABELS[p]||p,n]),'لا توجد أولويات مسجلة.'))+panel('حسب التصنيف','الأكثر تسجيلًا أولًا',horizontal(model.group('category'),'لا توجد تصنيفات مسجلة.'))+panel('حسب المحافظة','التوزيع الجغرافي لنتائج التصفية',horizontal(model.group('province'),'لا توجد محافظات مسجلة.'))+panel('عمر السجلات','العمر منذ التسجيل، وليس مدة الإغلاق',horizontal(['أقل من 7 أيام','من 7 إلى 30 يومًا','أكثر من 30 يومًا','تاريخ غير معروف'].map((label,i)=>[label,model.ageCounts[i]]).filter(([,n])=>n>0),'لا توجد سجلات لعرض أعمارها.'))+
 panel('امتثال المهلة الإجمالي','يُحسب فقط عند اعتماد سياسة المهلة', '<div class="report-compliance"><div class="compliance-ring" style="--value:'+(model.compliance??0)+'" role="img" aria-label="امتثال المهلة '+(model.compliance===null?'غير متاح':model.compliance+' بالمئة')+'"><strong>'+(model.compliance===null?'—':model.compliance+'%')+'</strong></div><p>'+(model.compliance===null?'لا توجد مهل معتمدة قابلة للحساب.':model.compliant+' من '+model.eligible+' سجلًا ضمن المهلة. تعتمد السجلات المغلقة تاريخ الإغلاق، والمفتوحة الوقت الحالي.')+'</p></div>')+'</div></div>';
}

let reportListPage=1;
function reportMatchingRecords(reset=true){
 if(reset)reportListPage=1;
 const records=filteredReportRecords(db.complaints,reportFilters);
 const pages=Math.max(1,Math.ceil(records.length/50));reportListPage=Math.min(pages,Math.max(1,reportListPage));
 modal('سجلات التقرير','نتائج مطابقة للتصفية المطبقة · '+records.length+' سجل',complaintTable(records.slice((reportListPage-1)*50,reportListPage*50)),
 '<button class="btn" data-action="report-list-prev" '+(reportListPage===1?'disabled':'')+'>السابق</button><span>'+reportListPage+' / '+pages+'</span><button class="btn" data-action="report-list-next" '+(reportListPage===pages?'disabled':'')+'>التالي</button>',true);
}
function reportProcessingMetrics(records){
 const durations=[],reasons=new Map();let reopened=0;
 for(const c of records){
  const history=c.statusHistory||[];
  const closed=c.closedAt||history.filter(h=>h.to==='closed').at(-1)?.at||c.closed;
  const days=(Date.parse(closed)-Date.parse(c.created))/86400000;
  if(c.status==='closed'&&Number.isFinite(days)&&days>=0)durations.push(days);
  if(history.some(h=>['closed','cancelled'].includes(h.from)&&h.to==='in_progress'))reopened++;
  if(db.settings?.slaApproved&&!['draft','closed','cancelled'].includes(c.status)&&Number.isFinite(Date.parse(c.due))&&Date.parse(c.due)<Date.now()){
   const reason=String(c.delayReason||'سبب التأخير غير مسجل');reasons.set(reason,(reasons.get(reason)||0)+1);
  }
 }
 return '<section class="panel"><div class="panel-body"><h2>المعالجة وإعادة الفتح</h2><p>متوسط المدة حتى آخر إغلاق: <strong>'+(durations.length?(durations.reduce((a,b)=>a+b,0)/durations.length).toFixed(1)+' يوم':'غير متاح')+'</strong> · محسوب من '+durations.length+' سجل مغلق بتواريخ صالحة.</p><p>سجلات أُعيد فتحها: <strong>'+reopened+'</strong></p><h3>أسباب التأخر المسجلة</h3>'+([...reasons].map(([reason,n])=>'<p>'+esc(reason)+': '+n+'</p>').join('')||'<p>لا توجد سجلات متأخرة.</p>')+'<button class="btn" data-action="report-matching-records">عرض السجلات المطابقة</button></div></section>';
}
if(typeof document!=='undefined')document.addEventListener?.('click',e=>{
 const action=e.target.closest?.('[data-action]')?.dataset.action;
 if(action==='report-matching-records')reportMatchingRecords();
 if(action==='report-list-prev'){reportListPage--;reportMatchingRecords(false);}
 if(action==='report-list-next'){reportListPage++;reportMatchingRecords(false);}
});

/* Custom reports: server-side preview and exports, local configuration templates only. */
const CUSTOM_REPORT_FIELDS={id:'رقم السجل',recordType:'نوع السجل',created:'تاريخ التسجيل',firstContactDate:'أول تواصل',province:'المحافظة',entity:'الجهة',category:'التصنيف',status:'الحالة',priority:'الأولوية',summary:'الموضوع',name:'الاسم',phone:'الهاتف',due:'المهلة'};
const CUSTOM_REPORT_DEFAULT=['id','recordType','created','province','category','status'];
const CUSTOM_REPORT_FORMATS={docx:'Word',xlsx:'Excel',pdf:'PDF',html:'HTML',odt:'ODT',ods:'ODS',rtf:'RTF',csv:'CSV',tsv:'TSV',txt:'TXT',json:'JSON',xml:'XML',md:'Markdown',svg:'SVG — رسم ملخص',zip:'ZIP — حزمة'};
const CUSTOM_REPORT_TYPES={complaint:'شكوى',inquiry:'استفسار',contact:'تواصل'};
let customReportTimer,customReportSequence=0,customReportController;
function customReportStorageKey(){return 'complaints.report.templates.v1.'+String(authenticatedUser?.id||authenticatedUser?.username||'local');}
function customReportTemplates(){try{const data=JSON.parse(localStorage.getItem(customReportStorageKey())||'[]');return Array.isArray(data)?data.filter(x=>x&&typeof x.name==='string'&&typeof x.query==='string').slice(0,50):[];}catch(_){return [];}}
function customReportPanel(){
 if(typeof uiCan==='function'&&!uiCan('export.xlsx'))return '';
 const records=(db.complaints||[]).filter(c=>c&&!c.archivedAt);
 const labels={recordType:CUSTOM_REPORT_TYPES,status:REPORT_STATUS_LABELS,priority:REPORT_PRIORITY_LABELS};
 const select=(key,title)=>{
  const values=key==='recordType'?Object.keys(CUSTOM_REPORT_TYPES):[...new Set(records.map(c=>String((key==='status'?reportDisplayStatus(c.status):c[key])||'')).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ar'));
  return '<div class="form-field"><label for="custom-'+key+'">'+title+'</label><select id="custom-'+key+'" name="'+key+'"><option value="">الكل</option>'+values.map(v=>'<option value="'+esc(v)+'">'+esc(labels[key]?.[v]||v)+'</option>').join('')+'</select></div>';
 };
 const fieldOptions=Object.entries(CUSTOM_REPORT_FIELDS).map(([k,v])=>'<option value="'+k+'">'+v+'</option>').join('');
 const groupOptions=['recordType','status','province','entity','category','priority'].map(k=>'<option value="'+k+'">'+CUSTOM_REPORT_FIELDS[k]+'</option>').join('');
 return '<details class="panel custom-report-panel" id="customReportPanel"><summary class="panel-header"><div><h2>منشئ التقارير المخصصة</h2><p>اختر المحتوى، راجع النتائج، واحفظ قالبًا أو صدّر التقرير محليًا.</p></div></summary><div class="panel-body">'+
 '<form id="customReportForm"><div class="report-filter-grid"><div class="form-field"><label for="custom-title">عنوان التقرير</label><input id="custom-title" name="title" maxlength="160" value="تقرير السجلات"></div>'+
 '<div class="form-field"><label for="custom-from">من تاريخ</label><input type="date" id="custom-from" name="from"></div><div class="form-field"><label for="custom-to">إلى تاريخ</label><input type="date" id="custom-to" name="to"></div>'+
 select('recordType','نوع السجل')+select('province','المحافظة')+select('entity','الجهة')+select('category','التصنيف')+select('status','الحالة')+select('priority','الأولوية')+
 '<div class="form-field"><label for="custom-group">التجميع الإحصائي</label><select id="custom-group" name="group">'+groupOptions+'</select></div><div class="form-field"><label for="custom-sort">الترتيب حسب</label><select id="custom-sort" name="sort">'+fieldOptions+'</select></div>'+
 '<div class="form-field"><label for="custom-direction">اتجاه الترتيب</label><select id="custom-direction" name="direction"><option value="asc">تصاعدي</option><option value="desc">تنازلي</option></select></div></div>'+
 '<div class="form-field"><label for="custom-description">الملاحظات / الملخص التنفيذي</label><textarea id="custom-description" name="description" maxlength="2000" rows="3"></textarea></div>'+
 '<fieldset><legend>الأعمدة المطلوبة (الأسماء والهواتف مخفية افتراضيًا)</legend><div class="report-filter-grid">'+Object.entries(CUSTOM_REPORT_FIELDS).map(([k,v])=>'<label><input type="checkbox" name="columns" value="'+k+'" '+(CUSTOM_REPORT_DEFAULT.includes(k)?'checked':'')+'> '+v+'</label>').join('')+'</div></fieldset>'+
 '<div class="report-filter-actions"><button type="submit" class="btn btn-primary">معاينة التقرير</button><button type="button" class="btn" data-custom-report="reset">إعادة ضبط</button></div></form>'+
 '<section class="panel"><div class="panel-body"><h3>قوالب التقارير</h3><div class="report-filter-grid"><div class="form-field"><label for="customTemplateName">اسم القالب</label><input id="customTemplateName" maxlength="80"></div><div class="form-field"><label for="customTemplateSelect">القوالب المحفوظة</label><select id="customTemplateSelect"><option value="">اختر قالبًا</option>'+customReportTemplates().map((t,i)=>'<option value="'+i+'">'+esc(t.name)+'</option>').join('')+'</select></div></div>'+
 '<div class="report-filter-actions"><button type="button" class="btn" data-custom-report="save">حفظ / تحديث القالب</button><button type="button" class="btn" data-custom-report="load">فتح القالب</button><button type="button" class="btn" data-custom-report="delete">حذف القالب</button></div></div></section>'+
 '<p id="customReportStatus" role="status" aria-live="polite">افتح المنشئ لعرض المعاينة.</p><div id="customReportPreview" class="custom-report-preview"></div>'+
 '<div class="form-field"><label for="customReportFormat">صيغة التصدير</label><select id="customReportFormat">'+Object.entries(CUSTOM_REPORT_FORMATS).map(([k,v])=>'<option value="'+k+'">'+v+' (.'+k+')</option>').join('')+'</select></div><div class="report-filter-actions"><button type="button" class="btn btn-primary" data-custom-report="export">تصدير التقرير</button><button type="button" class="btn" data-custom-report="print">طباعة المعاينة</button></div><p class="small-copy">المعاينة تعرض أول 100 سجل، والتصدير يشمل جميع النتائج حتى 5000 سجل. SVG يعرض الملخص المرئي فقط. ZIP يجمع سبع صيغ شائعة.</p></div></details>';
}
function customReportQuery(){
 const form=$('#customReportForm');if(!form)throw Error('افتح منشئ التقارير');
 const data=new FormData(form),q=new URLSearchParams();
 for(const [k,v] of data)if(k!=='columns'&&v)q.set(k,v);
 const cols=data.getAll('columns');if(!cols.length)throw Error('اختر عمودًا واحدًا على الأقل');
 q.set('columns',cols.join(','));
 if(q.get('from')&&q.get('to')&&q.get('from')>q.get('to'))throw Error('الفترة الزمنية غير صالحة');
 return q;
}
function customReportStatus(message){const el=$('#customReportStatus');if(el)el.textContent=message;}
async function customReportPreview(){
 const target=$('#customReportPreview');if(!target)return;
 const seq=++customReportSequence;customReportController?.abort();customReportController=new AbortController();
 try{
  const q=customReportQuery();customReportStatus('جارٍ إعداد المعاينة…');
  const res=await fetch('/api/reports/custom/preview?'+q,{credentials:'same-origin',signal:customReportController.signal});
  const m=await res.json();if(!res.ok)throw Error(m.error||'تعذر إعداد المعاينة');
  if(seq!==customReportSequence||!target.isConnected)return;
  const max=Math.max(1,...m.groups.map(x=>x[1]));
  target.innerHTML='<section class="panel"><div class="panel-body"><h2>'+esc(m.title)+'</h2><p>'+esc(m.description)+'</p><div class="mini-card-grid report-summary"><div class="mini-card"><small>إجمالي السجلات</small><strong>'+m.count+'</strong></div><div class="mini-card"><small>مغلقة</small><strong>'+m.closed+'</strong></div></div>'+
  '<h3>'+esc(m.groupLabel)+'</h3><div class="report-rank-list">'+m.groups.map(([v,n])=>'<div class="report-rank-item"><div class="status-line"><span>'+esc(v)+'</span><strong>'+n+'</strong></div><div class="progress"><span style="width:'+Math.round(n/max*100)+'%"></span></div></div>').join('')+'</div>'+
  '<div style="overflow:auto"><table><thead><tr>'+m.columns.map(c=>'<th>'+esc(c.label)+'</th>').join('')+'</tr></thead><tbody>'+m.rows.map(row=>'<tr>'+row.map(v=>'<td>'+esc(v)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div></div></section>';
  customReportStatus('عدد النتائج: '+m.count+' · المعروض: '+m.rows.length);
 }catch(error){if(seq===customReportSequence&&error.name!=='AbortError'){target.textContent='';customReportStatus(error.message);}}
}
function customReportSchedule(){clearTimeout(customReportTimer);customReportTimer=setTimeout(customReportPreview,250);}
function customReportRefreshTemplates(){const select=$('#customTemplateSelect');if(!select)return;select.replaceChildren(new Option('اختر قالبًا',''),...customReportTemplates().map((t,i)=>new Option(t.name,String(i))));}
function customReportLoad(query){const q=new URLSearchParams(query),form=$('#customReportForm');for(const el of form.elements){if(!el.name)continue;if(el.name==='columns')el.checked=(q.get('columns')||'').split(',').includes(el.value);else el.value=q.get(el.name)||({group:'recordType',sort:'id',direction:'asc'}[el.name]||'');}customReportPreview();}
async function customReportDownload(button,print=false){
 const q=customReportQuery(),format=print?'pdf':$('#customReportFormat').value;
 if(!Object.hasOwn(CUSTOM_REPORT_FORMATS,format))throw Error('صيغة غير مدعومة');
 button.disabled=true;customReportStatus('جارٍ تجهيز '+CUSTOM_REPORT_FORMATS[format]+'…');
 try{
  const res=await fetch('/api/reports/custom/export/'+format+'?'+q,{credentials:'same-origin'});
  if(!res.ok){const data=await res.json().catch(()=>({}));throw Error(data.error||'تعذر التصدير');}
  const url=URL.createObjectURL(await res.blob()),a=document.createElement('a');a.href=url;a.download='report-'+workDayKey(Date.now())+'.'+format;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
  customReportStatus('تم تجهيز التقرير · '+(res.headers.get('X-Export-Count')||'')+' سجل'+(print?' · افتح ملف PDF للطباعة':''));
 }finally{button.disabled=false;}
}
if(typeof document!=='undefined'){
 document.addEventListener('toggle',e=>{if(e.target.id==='customReportPanel'&&e.target.open)customReportPreview();},true);
 document.addEventListener('input',e=>{if(e.target.closest?.('#customReportForm'))customReportSchedule();});
 document.addEventListener('change',e=>{if(e.target.closest?.('#customReportForm'))customReportSchedule();});
 document.addEventListener('submit',e=>{if(e.target.id==='customReportForm'){e.preventDefault();customReportPreview();}});
 document.addEventListener('click',async e=>{
  const button=e.target.closest?.('[data-custom-report]');if(!button)return;
  try{
   const action=button.dataset.customReport,select=$('#customTemplateSelect'),templates=customReportTemplates(),index=select?.value===''?-1:Number(select?.value);
   if(action==='reset'){$('#customReportForm').reset();customReportPreview();}
   if(action==='export'||action==='print')await customReportDownload(button,action==='print');
   if(action==='save'){
    const name=$('#customTemplateName').value.trim();if(!name)throw Error('أدخل اسم القالب');
    const q=customReportQuery();q.delete('description');q.delete('title');
    const existing=templates.findIndex(t=>t.name===name);
    if(existing>=0)templates[existing]={name,query:q.toString()};else{if(templates.length>=50)throw Error('الحد 50 قالبًا');templates.push({name,query:q.toString()});}
    localStorage.setItem(customReportStorageKey(),JSON.stringify(templates));customReportRefreshTemplates();customReportStatus('حُفظ القالب دون بيانات السجلات أو النصوص الحرة.');
   }
   if(action==='load'){if(!templates[index])throw Error('اختر قالبًا');$('#customTemplateName').value=templates[index].name;customReportLoad(templates[index].query);}
   if(action==='delete'){if(!templates[index])throw Error('اختر قالبًا');if(!window.confirm('حذف القالب؟'))return;templates.splice(index,1);localStorage.setItem(customReportStorageKey(),JSON.stringify(templates));customReportRefreshTemplates();customReportStatus('حُذف القالب.');}
  }catch(error){customReportStatus(error.message);}
 });
}
