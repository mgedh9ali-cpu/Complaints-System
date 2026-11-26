/** Sticky floating actions on detail + skeleton for registry/dashboard tables. */

function floatingDetailActions(c){
  if(!c) return '';
  const id=esc(c.id);
  const closed=['closed','cancelled'].includes(c.status);
  const actions=[];
  if(uiCan('complaints.update')&&!c.archivedAt&&!closed)
    actions.push('<button type="button" class="btn btn-sm" data-action="edit-complaint" data-id="'+id+'">تعديل</button>');
  if(uiCan('complaints.status')&&!c.archivedAt)
    actions.push('<button type="button" class="btn btn-sm" data-action="detail-section" data-target="complaint-actions">تغيير الحالة</button>');
  if(uiCan('complaints.update')&&!c.archivedAt&&!closed)
    actions.push('<button type="button" class="btn btn-sm" data-action="referral-create" data-id="'+id+'">إحالة</button>');
  actions.push('<button type="button" class="btn btn-sm" data-action="print-complaint-cover" data-id="'+id+'">طباعة</button>');
  if(uiCan('complaints.update'))
    actions.push('<button type="button" class="btn btn-sm" data-action="add-note" data-id="'+id+'">ملاحظة</button>');
  if(uiCan('complaints.create')||uiCan('complaints.update'))
    actions.push('<button type="button" class="btn btn-sm" data-action="copy-complaint" data-id="'+id+'">نسخ</button>');
  if(!actions.length) return '';
  return '<div class="floating-actions" role="toolbar" aria-label="إجراءات سريعة للسجل">'+actions.join('')+'</div>';
}

function tableSkeleton(rowCount){
  const n=Math.max(3,Math.min(Number(rowCount)||6,12));
  const rows=Array.from({length:n},(_,i)=>
    '<tr class="skeleton-row" aria-hidden="true">'+
    '<td colspan="9"><div class="skeleton-line w-'+(i%3===0?'80':i%3===1?'60':'full')+'"></div></td>'+
    '</tr>'
  ).join('');
  return '<div class="table-wrap registry-table-wrap is-skeleton" aria-busy="true" aria-label="جاري التحميل">'+
    '<table class="registry-table"><thead><tr>'+
    '<th class="col-id">رقم السجل</th><th class="col-type">النوع</th><th class="col-subject">الموضوع</th>'+
    '<th class="col-prov">المحافظة</th><th class="col-status">الحالة</th><th class="col-pri">الأولوية</th>'+
    '<th class="col-age">مدة البقاء</th><th class="col-act">الإجراء</th>'+
    '</tr></thead><tbody>'+rows+'</tbody></table></div>';
}

function dashboardStatsSkeleton(){
  return '<div class="dashboard-stats" aria-busy="true" aria-label="جاري تحميل المؤشرات">'+
    [1,2,3,4].map(()=>'<div class="stat-item skeleton-card"><div class="skeleton-line w-40"></div><div class="skeleton-line w-60"></div></div>').join('')+
    '</div>';
}

function installFloatingActionsEnhancer(){
  if(typeof complaintDetailPage!=='function') return false;
  if(complaintDetailPage.__floatingActionsWrapped) return true;
  const orig=complaintDetailPage;
  function wrapped(){
    let html=orig.apply(this,arguments);
    if(typeof html!=='string') return html;
    const id=currentId;
    const c=(db.complaints||[]).find(x=>x&&x.id===id);
    if(!c) return html;
    if(html.indexOf('floating-actions')<0){
      const bar=floatingDetailActions(c);
      if(bar){
        if(html.lastIndexOf('</article>')>0)
          html=html.replace(/<\/article>\s*$/,' '+bar+'</article>');
        else
          html+=bar;
      }
    }
    return html;
  }
  wrapped.__floatingActionsWrapped=true;
  complaintDetailPage=wrapped;
  return true;
}

function installTableSkeletonEnhancer(){
  if(typeof complaintsPage!=='function') return false;
  if(complaintsPage.__skeletonWrapped) return true;
  const origComplaints=complaintsPage;
  complaintsPage=function(){
    if(!stateLoaded)
      return heading('سجل الشكاوى والاستفسارات','جاري تحميل البيانات من القاعدة المحلية…','')+
        '<section class="panel table-panel registry-panel">'+tableSkeleton(8)+'</section>';
    return origComplaints.apply(this,arguments);
  };
  complaintsPage.__skeletonWrapped=true;

  if(typeof dashboard==='function'&&!dashboard.__skeletonWrapped){
    const origDash=dashboard;
    dashboard=function(){
      if(!stateLoaded)
        return '<div class="dashboard-workspace">'+heading('مكتب الفرز والمتابعة','جاري تجهيز لوحة العمل…','')+
          dashboardStatsSkeleton()+
          '<section class="panel table-panel">'+tableSkeleton(5)+'</section></div>';
      return origDash.apply(this,arguments);
    };
    dashboard.__skeletonWrapped=true;
  }
  return true;
}

function installUiPolishEnhancers(){
  installFloatingActionsEnhancer();
  installTableSkeletonEnhancer();
}
if(!installUiPolishEnhancers()){
  document.addEventListener('DOMContentLoaded',installUiPolishEnhancers);
  setTimeout(installUiPolishEnhancers,0);
  setTimeout(installUiPolishEnhancers,50);
  setTimeout(installUiPolishEnhancers,200);
}
