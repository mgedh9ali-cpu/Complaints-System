function referralsPage(){
  const list=referralList();
  const waiting=list.filter(r=>!r.response).length;
  const late=list.filter(r=>!r.response&&new Date(r.due)<new Date()).length;
  return heading('إدارة الإحالات','تابع تاريخ الإرسال والجهة وموعد الرد المتوقع من سجل الشكوى.',btn('＋ إحالة جديدة','new-referral','btn-primary'))+
  '<div class="mini-card-grid">'+
  '<div class="mini-card"><small>إجمالي الإحالات</small><strong>'+list.length+'</strong></div>'+
  '<div class="mini-card"><small>بانتظار الرد</small><strong>'+waiting+'</strong></div>'+
  '<div class="mini-card'+(late?' alert':'')+'"><small>متأخرة</small><strong>'+late+'</strong></div>'+
  '</div>'+
  '<section class="panel table-panel"><div class="panel-header"><div><h2>سجل الإحالات</h2><p>افتح الشكوى لتسجيل رد الجهة أو المتابعة</p></div></div>'+
  (list.length?
    '<div class="table-wrap"><table><thead><tr><th>رقم الشكوى</th><th>الجهة</th><th>تاريخ الإرسال</th><th>موعد الرد</th><th>الحالة</th><th>الملخص</th><th></th></tr></thead><tbody>'+
    list.map(r=>'<tr><td><span class="ticket-id">'+esc(r.complaintId)+'</span></td><td>'+esc(r.entity)+'</td><td>'+dateText(r.sent)+'</td><td>'+dateText(r.due)+'</td><td>'+
    (r.response?'<span class="pill progressing">ورد الرد</span>':new Date(r.due)<new Date()?'<span class="pill urgent">متأخرة</span>':'<span class="pill waiting">بانتظار</span>')+
    '</td><td>'+esc(r.complaintSummary)+'</td><td><button class="btn btn-sm btn-primary" data-action="detail" data-id="'+esc(r.complaintId)+'">فتح</button></td></tr>').join('')+
    '</tbody></table></div>'
  :'<div class="empty-state"><p>لا توجد إحالات مسجّلة بعد.</p><button class="btn btn-primary" data-action="new-referral">إنشاء إحالة</button></div>')+
  '</section>';
}
function repliesPage(){
  const rows=db.complaints.filter(c=>!c.archivedAt&&c.reply);
  return heading('الردود والاعتماد','مسار الرد: مسودة ← مراجعة ← اعتماد من مستخدم آخر ← توثيق الإرسال.',btn('＋ إنشاء رد','new-reply','btn-primary'))+
  '<div class="risk-note">لا يُسمح لمُعدّ الرد باعتماده؛ يجب الاعتماد من حساب مخوّل آخر.</div>'+
  '<section class="panel table-panel"><div class="panel-header"><div><h2>ملفات الردود</h2><p>'+rows.length+' رد مرتبط بسجل شكوى</p></div></div>'+
  (rows.length?
    '<div class="table-wrap"><table><thead><tr><th>رقم الشكوى</th><th>الموضوع</th><th>معدّ الرد</th><th>الحالة</th><th>آخر تحديث</th><th></th></tr></thead><tbody>'+
    rows.map(c=>'<tr><td><span class="ticket-id">'+esc(c.id)+'</span></td><td>'+esc(c.summary)+'</td><td>'+esc(c.reply.author)+'</td><td>'+replyStatusPill(c.reply.status)+'</td><td>'+dateText(c.updated)+'</td><td><button class="btn btn-sm btn-primary" data-action="detail" data-id="'+esc(c.id)+'">فتح الرد</button></td></tr>').join('')+
    '</tbody></table></div>'
  :'<div class="empty-state"><p>لا توجد ردود بعد. افتح شكوى ثم اختر «صياغة رد».</p><button class="btn btn-primary" data-action="new-reply">إنشاء رد</button></div>')+
  '</section>';
}
function replyStatusPill(s){const m={draft:['مسودة','new'],review:['مراجعة','waiting'],approval:['بانتظار الاعتماد','waiting'],approved:['معتمد','progressing'],sent:['تم توثيق الإرسال','closed']};const x=m[s]||[s,'closed'];return '<span class="pill '+x[1]+'">'+x[0]+'</span>';}
function notificationsPage(){
  const list=db.notifications||[];
  const unread=list.filter(n=>!n.read).length;
  return heading('مركز الإشعارات','تنبيهات داخلية للاستكمال والاعتماد والإحالات والمتأخرات.',unread?btn('تحديد الكل كمقروء','read-all'):'')+
  '<section class="panel"><div class="panel-header"><h2>آخر التنبيهات</h2><span class="setting-value">'+unread+' غير مقروء</span></div><div class="panel-body">'+
  (list.length?
    '<div class="notice-list">'+list.map(n=>{
      const nid=esc(String(n.id));
      const cid=n.complaintId?esc(n.complaintId):'';
      return '<div class="notice-item'+(n.read?' is-read':'')+'">'+'<div class="notice-mark '+(n.read?'read':'')+'">'+(n.read?'✓':'!')+'</div>'+'<div class="notice-body"><strong>'+esc(n.title)+'</strong><p>'+esc(n.body)+'</p><small>'+timeText(n.date||n.at)+'</small></div>'+'<div class="notice-actions">'+(cid?'<button class="btn btn-sm btn-primary" data-action="detail" data-id="'+cid+'">فتح الشكوى</button>':'')+(!n.read?'<button class="btn btn-sm" data-action="read-notice" data-id="'+nid+'">تمّت القراءة</button>':'')+'</div></div>';
    }).join('')+'</div>'
  :'<div class="empty-state"><p>لا توجد إشعارات حالياً. تظهر هنا التنبيهات عند الاستكمال أو التأخير أو الاعتماد.</p></div>')+
  '</div></section>';
}
