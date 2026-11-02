/* Operational reporting uses saved complaint records only; no external chart library. */
function reportsPage(){
  const records=Array.isArray(db.complaints)?db.complaints.filter(c=>!c.archivedAt):[];
  const today=new Date(workDayKey(Date.now())+'T12:00:00Z');
  const daily=Array.from({length:14},(_,i)=>{
    const d=new Date(today);
    d.setUTCDate(today.getUTCDate()-(13-i));
    const day=workDayKey(d);
    const count=records.filter(c=>{
      const at=new Date(c.created).getTime();
      return Number.isFinite(at)&&workDayKey(at)===day;
    }).length;
    return {date:d,count};
  });
  const categories=new Map(), provinces=new Map();
  for(const c of records){
    const category=String(c.category||'غير مصنف').trim()||'غير مصنف';
    const province=String(c.province||'غير محددة').trim()||'غير محددة';
    categories.set(category,(categories.get(category)||0)+1);
    provinces.set(province,(provinces.get(province)||0)+1);
  }
  const sortedCategories=[...categories].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0],'ar'));
  const sortedProvinces=[...provinces].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0],'ar'));
  const closed=records.filter(c=>c.status==='closed');
  const openingCounts=[records.filter(c=>ageDays(c)<7).length,records.filter(c=>ageDays(c)>=7&&ageDays(c)<=30).length,records.filter(c=>ageDays(c)>30).length];
  const peak=Math.max(1,...daily.map(d=>d.count));
  const dailyBars=daily.map(({date,count},i)=>{
    const label=new Intl.DateTimeFormat('ar-SY-u-nu-latn',{timeZone:'Asia/Damascus',day:'2-digit',month:'2-digit'}).format(date);
    const value=Math.round(count/peak*100);
    return '<div class="daily-bar-item" role="listitem" title="'+label+' · '+count+' شكوى" aria-label="'+label+'، '+count+' شكوى">'+
      '<span class="daily-count">'+(count||'')+'</span>'+
      '<div class="daily-track"><span class="daily-fill" style="height:'+value+'%"></span></div>'+
      '<span class="daily-label">'+(i===0||i===6||i===13?label:'')+'</span></div>';
  }).join('');
  const horizontal=(items,emptyLabel)=>{
    if(!items.length)return '<p class="empty-state calm-empty">'+emptyLabel+'</p>';
    const max=Math.max(1,...items.map(item=>item[1]));
    return '<div class="report-rank-list">'+items.map(([label,count])=>
      '<div class="report-rank-item"><div class="status-line"><span>'+esc(label)+'</span><strong>'+count+'</strong></div>'+
      '<div class="progress" role="meter" aria-label="'+esc(label)+'" aria-valuemin="0" aria-valuemax="'+max+'" aria-valuenow="'+count+'">'+
      '<span style="width:'+Math.round(count/max*100)+'%"></span></div></div>'
    ).join('')+'</div>';
  };
  return heading('التقارير التشغيلية','اتجاه تسجيل الشكاوى وتوزيعها بحسب التصنيف والمحافظة، من السجلات المحفوظة فقط.',
    btn('طباعة / حفظ PDF','print-report')+btn('تصدير CSV','export-csv'))+
    '<div class="mini-card-grid report-summary">'+[
      ['إجمالي السجلات',records.length],
      ['خلال آخر 14 يومًا',daily.reduce((n,d)=>n+d.count,0)],
      ['سجلات مغلقة',closed.length],
      ['سجلات متجاوزة للمهلة',lateComplaints().length]
    ].map(([label,count])=>'<div class="mini-card"><small>'+label+'</small><strong>'+count+'</strong></div>').join('')+'</div>'+
    '<section class="panel report-trend"><div class="panel-header"><div><h2>الشكاوى المسجلة يوميًا</h2><p>آخر 14 يومًا، حسب تاريخ إنشاء السجل</p></div></div><div class="panel-body">'+
      (daily.some(d=>d.count>0)?'<div class="daily-chart" role="list" aria-label="عدد الشكاوى في كل يوم">'+dailyBars+'</div>':
      '<div class="empty-state calm-empty">لم تُسجل شكاوى خلال آخر 14 يومًا.</div>')+
    '</div></section>'+
    '<div class="two-col report-breakdowns"><section class="panel"><div class="panel-header"><div><h2>حسب التصنيف</h2><p>الأكثر تسجيلًا أولًا</p></div></div><div class="panel-body">'+horizontal(sortedCategories,'لا توجد تصنيفات مسجلة.')+'</div></section>'+
    '<section class="panel"><div class="panel-header"><div><h2>حسب المحافظة</h2><p>التوزيع الجغرافي لجميع السجلات</p></div></div><div class="panel-body">'+horizontal(sortedProvinces,'لا توجد محافظات مسجلة.')+'</div></section></div>'+
    '<section class="panel report-age"><div class="panel-header"><div><h2>عمر السجلات</h2><p>المدة منذ الإنشاء، وليس متوسط زمن الإغلاق</p></div></div><div class="panel-body">'+
      horizontal([['أقل من 7 أيام',openingCounts[0]],['من 7 إلى 30 يومًا',openingCounts[1]],['أكثر من 30 يومًا',openingCounts[2]]],
      'لا توجد سجلات لعرض أعمارها.')+
    '</div></section>';
}
