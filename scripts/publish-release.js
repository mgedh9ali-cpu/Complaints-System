'use strict';
// CI only: the token is provided to this publishing step after build and smoke pass.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
async function publish(){
 const {GITHUB_TOKEN:token,GITHUB_REPOSITORY:repo,GITHUB_SHA:commit,GITHUB_REF:ref}=process.env;
 if(!token||repo!=='mgedh9ali-cpu/Complaints-System'||ref!=='refs/heads/main')throw new Error('Release publication is restricted to the canonical main branch.');
 const directory=path.resolve('dist-desktop'),manifest=JSON.parse(fs.readFileSync(path.join(directory,'build-manifest.json'),'utf8'));
 const version=require('../package.json').version,filename='complaints-system-'+version+'-portable.exe';
 if(manifest.commit!==commit||manifest.version!==version||manifest.filename!==filename)throw new Error('Artifact source does not match the publishing commit.');
 const bytes=fs.readFileSync(path.join(directory,filename));
 if(bytes.length!==manifest.bytes||crypto.createHash('sha256').update(bytes).digest('hex')!==manifest.sha256)throw new Error('Release artifact checksum mismatch.');
 const headers={Authorization:'Bearer '+token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'};
 async function request(url,options={}){const response=await fetch(url,{...options,headers:{...headers,...options.headers}});if(!response.ok)throw new Error('GitHub release request failed: '+response.status);return response.json();}
 const api='https://api.github.com/repos/'+repo;
 const release=await request(api+'/releases',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
  tag_name:'v'+version,target_commitish:commit,name:'نظام الشكاوى '+version,draft:true,prerelease:version.includes('-'),
  body:'نسخة Windows x64 محمولة: نزّل ملف EXE وشغّله دون تثبيت Node.js.\n\nاجتازت اختبارات المصدر والتبعيات واختبار تشغيل الحزمة على Windows. يمكن اختيار مجلد النسخ وحفظ مفتاح الاستعادة والاستعادة من قائمة «النسخ والاستعادة».\n\nللترقية: احفظ نسخة كاملة ومفتاحها، أغلق البرنامج، ثم استبدل EXE. البيانات خارج ملف البرنامج.\n\nبصمة SHA-256 ومرجع المصدر في الملفين المرفقين. إثبات منشأ البناء في GitHub مستقل عن شهادة توقيع Windows؛ الملف لا يحمل شهادة الجهة ما لم تُضبط في بيئة البناء.'
 })});
 const upload=release.upload_url.replace(/\{.*$/,'');
 if(new URL(upload).hostname!=='uploads.github.com')throw new Error('Unexpected GitHub upload destination.');
 for(const name of [filename,'SHA256SUMS.txt','build-manifest.json'])await request(upload+'?name='+encodeURIComponent(name),{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:name===filename?bytes:fs.readFileSync(path.join(directory,name))});
 const published=await request(api+'/releases/'+release.id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({draft:false})});
 console.log(published.html_url);
}
if(require.main===module)publish().catch(e=>{console.error(e.message);process.exitCode=1;});
