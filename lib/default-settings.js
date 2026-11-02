'use strict';
const DEFAULT_SETTINGS = Object.freeze({
  slaDays: 7, slaApproved: false, completionReminderHours: 24,
  categoryDescriptions: {}, entityDescriptions: {},
  provinces: ['دمشق','ريف دمشق','حلب','حمص','حماة','اللاذقية','طرطوس','إدلب','دير الزور','الرقة','الحسكة','درعا','السويداء','القنيطرة'],
  entities: ['مديرية الخدمات العامة','مديرية النقل','مديرية الشؤون الاجتماعية','مديرية التجارة الداخلية','مديرية التربية','مديرية المياه'],
  categories: ['خدمات عامة','نقل ومواصلات','شؤون اجتماعية','أسعار وأسواق','تعليم','مياه وصرف صحي','استفسار عام'],
  priorities: [{value:'urgent',label:'عاجلة'},{value:'high',label:'عالية'},{value:'normal',label:'عادية'},{value:'low',label:'منخفضة'}]
});
const DEFAULT_TEMPLATES = Object.freeze([
  {name:'إفادة باستلام الشكوى',version:1,text:'تم استلام الشكوى رقم {{رقم_الشكوى}}، وستتم مراجعتها وإحالتها إلى الجهة المختصة عند الحاجة.'},
  {name:'طلب استكمال معلومات',version:1,text:'يرجى استكمال المعلومات اللازمة للشكوى رقم {{رقم_الشكوى}} المتعلقة بـ {{التصنيف}}.'},
  {name:'إشعار بإحالة',version:1,text:'نحيطكم علمًا بأنه تمت إحالة الشكوى رقم {{رقم_الشكوى}} إلى {{الجهة}} للمتابعة.'}
]);
module.exports = { DEFAULT_SETTINGS, DEFAULT_TEMPLATES };
