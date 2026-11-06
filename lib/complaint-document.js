'use strict';
const {dayKey}=require('./work-time');
const STATUS={draft:'مسودة',new:'جديدة',in_progress:'قيد المعالجة',awaiting_reply:'بانتظار رد الجهة',awaiting_approval:'بانتظار الاعتماد',closed:'مغلقة',cancelled:'ملغاة'};
const PRIORITY={low:'منخفضة',normal:'عادية',high:'عالية',urgent:'عاجلة'};
const SOURCE={phone:'الهاتف',whatsapp:'واتساب',telegram:'تلغرام',other:'أخرى'};
function date(value){return value?dayKey(value)||String(value):'غير مسجل';}
function complaintDocument(c,generatedBy){
 const paragraphs=[];
 const add=(text,heading=false)=>paragraphs.push({text:String(text??''),heading});
 add('الاستفسارات والشكاوى',true);add('تقرير شكوى فردية',true);
 for(const [label,value] of [
  ['رقم الشكوى',c.id],['الموضوع',c.summary],['اسم المشتكي',c.name],['الهاتف',c.phone],
  ['تاريخ أول تواصل',c.firstContactDate],['تاريخ التسجيل',date(c.created||c.createdAt)],['آخر تحديث',date(c.updated)],
  ['المحافظة',c.province],['الجهة المختصة',c.entity],['التصنيف',c.category],['طبيعة الشكوى',c.nature],
  ['قناة الورود',SOURCE[c.source]||c.source],['الحالة',STATUS[c.status]||c.status],['الأولوية',PRIORITY[c.priority]||c.priority],
  ['المسؤول الرئيسي',c.owner],['المساعدون المشاركون',(c.coAssistants||[]).join('، ')],['موعد المتابعة',date(c.due)]
 ])add(label+': '+(value||'غير مسجل'));
 add('تفاصيل الشكوى',true);add(c.details||'لا توجد تفاصيل.');
 if(c.referrals?.length){add('الإحالات وردود الجهات',true);for(const r of c.referrals){add((r.entity||'جهة غير محددة')+' · '+date(r.at||r.sent)+' · موعد الرد: '+date(r.due));add(typeof r.response==='object'?r.response?.text||'بانتظار الرد':r.response||'بانتظار الرد');}}
 if(c.reply){add('الرد الخارجي',true);add('مرحلة الرد: '+({draft:'مسودة',review:'قيد المراجعة',approved:'معتمد',sent:'مرسل'}[c.reply.status]||c.reply.status));add(c.reply.text||'');}
 if(c.notes?.length){add('الملاحظات الداخلية',true);for(const n of c.notes)add((n.by||'')+' · '+date(n.at)+'\n'+(n.text||''));}
 if(c.timeline?.length){add('سجل الإجراءات',true);for(const e of c.timeline)add((e.event||'')+' · '+(e.by||'')+' · '+date(e.at)+'\n'+(e.detail||''));}
 add('أُصدر بواسطة: '+(generatedBy||'النظام')+' · تاريخ التصدير: '+dayKey());
 return {title:'شكوى '+c.id,paragraphs,lines:paragraphs.map(p=>p.text)};
}
module.exports={complaintDocument};
