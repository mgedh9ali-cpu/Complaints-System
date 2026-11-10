/* Explicit local check: no cache deletion, site-data clearing, or remote requests. */
async function diagnoseLocalFonts(){
  if(!document.fonts?.load||!document.fonts?.check)
    return toast('فحص الخط غير متاح في هذا المتصفح. حدّث التطبيق ثم أعد المحاولة.','error');
  const owner=authenticatedUser;
  const fonts=[[300,'Light'],[400,'Regular'],[500,'Medium'],[700,'Bold'],[900,'Black']];
  const results=await Promise.all(fonts.map(async([weight,name])=>{
    try{
      const response=await fetch('/assets/fonts/thmanyah/thmanyahsans-'+name+'.woff2',{cache:'no-store',credentials:'same-origin'});
      const mime=response.headers.get('content-type')||'';
      if(!response.ok)return {weight,name,ok:false,status:response.status,mime,detail:'تعذر تنزيل الملف؛ تحقق من نسخة التثبيت.'};
      const signature=new Uint8Array(await response.arrayBuffer()).slice(0,4);
      if(String.fromCharCode(...signature)!=='wOF2')return {weight,name,ok:false,status:response.status,mime,detail:'الملف لا يحمل ترويسة WOFF2 صحيحة.'};
      const spec=weight+' 16px "Thmanyah Sans"';
      const faces=await document.fonts.load(spec,'الاستفسارات والشكاوى 0123456789');
      const ok=faces.length>0&&document.fonts.check(spec,'الاستفسارات والشكاوى');
      return {weight,name,ok,status:response.status,mime,detail:ok?'تم تحميل الخط وفكّه بنجاح.':'تعذر تفعيل الخط؛ أعد تشغيل التطبيق بعد تثبيت آخر نسخة.'};
    }catch(_){return {weight,name,ok:false,detail:'تعذر تحميل الخط أو فكّه. تحقق من ملفات النسخة وأعد المحاولة.'};}
  }));
  // A late result must not open private UI after logout or a session change.
  if(owner!==authenticatedUser||!owner)return false;
  const passed=results.every(r=>r.ok);
  const family=getComputedStyle(document.body).fontFamily;
  modal('فحص خط ثمانية',passed?'نجح تحميل جميع الأوزان المحلية.':'تعذر تحميل بعض الأوزان. راجع النتائج أدناه.',
    '<p class="small-copy">الخط المحدد للواجهة: <bdi>'+esc(family)+'</bdi></p>'+
    '<ul class="font-diagnostics">'+results.map(r=>'<li><strong><bdi>'+r.name+' · '+r.weight+'</bdi> — '+(r.ok?'ناجح':'تعذر التحميل')+'</strong><p>'+esc(r.detail)+'</p><small><bdi>HTTP '+esc(r.status??'—')+' · '+esc(r.mime||'—')+'</bdi></small></li>').join('')+'</ul>'+
    '<p>نص تجريبي: الاستفسارات والشكاوى · <bdi>SY-2026-10001 · 10/11/2026</bdi></p>'+
    '<p class="small-copy">اختيار الخط في CSS لا يثبت استخدامه لكل محرف. هذا الفحص يتحقق من تنزيل الملفات وقبولها في المتصفح، ولا يمس الشكاوى أو المسودات.</p>',
    '<button class="btn" data-action="close-modal">إغلاق</button>');
  return {ok:passed};
}
