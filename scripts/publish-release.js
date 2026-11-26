'use strict';
// CI only: publication follows the canonical main build and Windows smoke test.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const digest=bytes=>'sha256:'+crypto.createHash('sha256').update(bytes).digest('hex');
async function publish({env=process.env,directory=path.resolve('dist-desktop'),version=require('../package.json').version,fetchImpl=fetch,log=console.log}={}){
 const {GITHUB_TOKEN:token,GITHUB_REPOSITORY:repo,GITHUB_SHA:commit,GITHUB_REF:ref}=env;
 if(!token||repo!=='mgedh9ali-cpu/Complaints-System'||ref!=='refs/heads/main')throw new Error('Release publication is restricted to the canonical main branch.');
 if(!/^[a-f0-9]{40}$/.test(commit||''))throw new Error('Release publication requires an immutable source commit.');
 const manifest=JSON.parse(fs.readFileSync(path.join(directory,'build-manifest.json'),'utf8'));
 const filename='complaints-system-'+version+'-portable.exe';
 if(manifest.commit!==commit||manifest.version!==version||manifest.filename!==filename)throw new Error('Artifact source does not match the publishing commit.');
 const bytes=fs.readFileSync(path.join(directory,filename));
 if(bytes.length!==manifest.bytes||digest(bytes)!=='sha256:'+manifest.sha256)throw new Error('Release artifact checksum mismatch.');
 const artifacts=manifest.artifacts||[{filename,bytes:manifest.bytes,sha256:manifest.sha256}];
 const allowed=new Set([filename,'complaints-system-'+version+'-setup.exe']);
 if(!Array.isArray(artifacts)||!artifacts.length||artifacts.length>2||new Set(artifacts.map(a=>a?.filename)).size!==artifacts.length||!artifacts.some(a=>a?.filename===filename))throw new Error('Invalid release artifact list.');
 const verifiedFiles=artifacts.map(artifact=>{
  if(!allowed.has(artifact?.filename))throw new Error('Unexpected release artifact filename.');
  const content=artifact.filename===filename?bytes:fs.readFileSync(path.join(directory,artifact.filename));
  if(content.length!==artifact.bytes||digest(content)!=='sha256:'+artifact.sha256)throw new Error('Release artifact checksum mismatch: '+artifact.filename);
  return {name:artifact.filename,bytes:content};
 });
 const installerName='complaints-system-'+version+'-setup.exe';
 const files=verifiedFiles.filter(file=>file.name===installerName);
 if(files.length!==1)throw new Error('A verified installer is required for the single-file release.');
 const headers={Authorization:'Bearer '+token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'};
 async function request(url,options={},allowMissing=false){
  const response=await fetchImpl(url,{...options,headers:{...headers,...options.headers}});
  if(allowMissing&&response.status===404)return null;
  if(response.status===204)return null;
  const data=await response.json().catch(()=>({}));
  if(!response.ok){
   const detail=JSON.stringify({message:data.message,errors:data.errors}).replaceAll(token,'[redacted]').slice(0,1000);
   const error=new Error('GitHub release request failed: '+response.status+' '+(options.method||'GET')+' '+new URL(url).pathname+' '+detail);
   error.status=response.status;throw error;
  }
  return data;
 }
 const api='https://api.github.com/repos/'+repo;
 // The package version can span many main commits. Never reuse its old release tag.
 const tag='v'+version+'-build.'+commit;
 const tagRef=await request(api+'/git/ref/tags/'+encodeURIComponent(tag),{},true);
 if(tagRef&&(tagRef.object?.type!=='commit'||tagRef.object.sha!==commit))throw new Error('Existing build tag does not point to the publishing commit.');
 async function findRelease(){
  for(let page=1;page<=100;page++){
   const list=await request(api+'/releases?per_page=100&page='+page);
   const matches=list.filter(r=>r.tag_name===tag);
   if(matches.length>1)throw new Error('Duplicate releases for the same immutable build tag.');
   if(matches.length){if(matches[0].target_commitish!==commit)throw new Error('Existing release does not match the publishing commit.');return matches[0];}
   if(list.length<100)return null;
  }
  throw new Error('Release lookup exceeded the pagination limit.');
 }
 let release=await findRelease();
 if(!release){
  try{release=await request(api+'/releases',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
   tag_name:tag,target_commitish:commit,name:'نظام الشكاوى '+version+' · '+commit.slice(0,12),draft:true,prerelease:true,
   body:'الجديد في هذا الإصدار:\n\n• إزالة قسم الإحالات والمتابعة وزر رأي المتصل وشريط مراحل المعالجة من تفاصيل السجل.\n• تبسيط خيارات الحالة والفلاتر مع إبقاء السجلات القديمة قابلة للوصول.\n\nتحسينات الإصدارات السابقة:\n• إدارة خيارات تسجيل السجل من الإعدادات لحساب المالك، مع إضافة الخيارات وتعديلها وحذفها.\n• زر «تسجيل سجل جديد» وإجراءات واضحة للتعديل والأرشفة.\n• موعد مراجعة وتذكير مع إظهار الوقت المتبقي داخل السجل.\n• عرض استعادة المسودة عند إدخال رقم الهاتف المطابق فقط.\n• تسجيل تواصل إلى جانب الشكوى والاستفسار، مع تصفية مستقلة وزرَّي حفظ وإلغاء.\n• نُقلت إجراءات الرد الخارجي من تفاصيل السجل إلى صفحة الردود، مع بقاء إيصال الاستلام في تفاصيل السجل.\n• يعيد التحديث محاولة تنظيف النسخة المحمولة السابقة إذا كان Windows يستخدم الملف مؤقتًا.\n• إصلاح تعذّر فتح التطبيق عند وجود حساب مدير محفوظ وإعدادات تهيئة قديمة.\n• واجهة عربية بألوان المشروع وخط ثمانية المضمّن، وتصميم أكثر مرونة للنوافذ الضيقة.\n• مراجعة الإصدار وملاحظاته والموافقة قبل التنزيل، مع عرض مراحل التنزيل والنسخ الاحتياطي والتثبيت.\n• تشديد صلاحيات المتصفح داخل تطبيق سطح المكتب وتحسين التنقّل بلوحة المفاتيح.\n\n• تحديث من داخل التطبيق: تنزيل مع نسبة تقدم، والتحقق من بصمة الملف، ونسخة احتياطية تلقائية قبل التثبيت.\n• شريط تثبيت Windows وإعادة فتح البرنامج تلقائيًا.\n• عرض رقم الإصدار وما الجديد بعد نجاح التشغيل.\n• استبدال ملفات التطبيق القديمة مع الحفاظ على قاعدة البيانات والمرفقات والإعدادات ومفاتيح التشفير.\n\nللمستودع الخاص: أدخل مرة واحدة رمز GitHub للمستودع بصلاحية Contents: Read-only؛ يُحفظ محميًا على جهازك.\n\nثبّت هذا الإصدار أول مرة من setup.exe لتفعيل الآلية الجديدة. النسخة المحمولة تنتقل إلى نسخة مثبتة؛ يُحذف ملفها الأصلي المعروف بعد تأكيد نجاح الجديدة. ملفات التثبيت التي نُزّلت يدويًا تبقى تحت تصرفك.\n\nملف واحد للتنزيل: setup.exe. لا تحتاج Node.js. بصمة SHA-256 متاحة ضمن معلومات الملف في GitHub؛ وسجلات فحص البناء في Actions.'
  })});}
  catch(error){if(error.status!==422)throw error;release=await findRelease();if(!release)throw error;}
 }
 const upload=release.upload_url.replace(/\{.*$/,'');
 const uploadUrl=new URL(upload);
 if(uploadUrl.protocol!=='https:'||uploadUrl.hostname!=='uploads.github.com'||uploadUrl.pathname!=='/repos/'+repo+'/releases/'+release.id+'/assets')throw new Error('Unexpected GitHub upload destination.');
 const assets=await request(api+'/releases/'+release.id+'/assets?per_page=100');
 for(const file of files){
  const existing=assets.find(a=>a.name===file.name);
  if(existing&&existing.state==='uploaded'&&existing.size===file.bytes.length&&existing.digest===digest(file.bytes))continue;
  if(!release.draft)throw new Error('Published build assets differ from this artifact; the published release was left unchanged.');
  // Failed or partial draft uploads may be retried; published assets are never replaced.
  if(existing)await request(api+'/releases/assets/'+existing.id,{method:'DELETE'});
  const uploaded=await request(upload+'?name='+encodeURIComponent(file.name),{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:file.bytes});
  if(uploaded.state!=='uploaded'||uploaded.size!==file.bytes.length||uploaded.digest!==digest(file.bytes))throw new Error('Uploaded asset did not match the verified local bytes: '+file.name);
 }
 if(release.draft)release=await request(api+'/releases/'+release.id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({draft:false})});
 log(release.html_url);return release;
}
module.exports={publish};
if(require.main===module)publish().catch(e=>{console.error(e.message);process.exitCode=1;});

