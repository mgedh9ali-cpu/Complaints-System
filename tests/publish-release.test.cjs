'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {publish}=require('../scripts/publish-release');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function fixture(t,{existing=false,published=false,mismatch=false,badHost=false,createError=false,wrongTag=false,installer=true}={}){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'release-publish-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const version=require('../package.json').version,commit='a'.repeat(40),filename='complaints-system-'+version+'-portable.exe',bytes=Buffer.from('synthetic executable');
 const manifest={version,commit,filename,bytes:bytes.length,sha256:sha(bytes)};
 const files={[filename]:bytes,'SHA256SUMS.txt':Buffer.from(sha(bytes)+'  '+filename+'\n'),'build-manifest.json':Buffer.from(JSON.stringify(manifest))};
 if(installer){
  const name='complaints-system-'+version+'-setup.exe',content=Buffer.from('synthetic installer');
  manifest.artifacts=[{filename,bytes:bytes.length,sha256:sha(bytes)},{filename:name,bytes:content.length,sha256:sha(content)}];
  files[name]=content;files['build-manifest.json']=Buffer.from(JSON.stringify(manifest));
  files['SHA256SUMS.txt']=Buffer.from(manifest.artifacts.map(a=>a.sha256+'  '+a.filename+'\n').join(''));
 }
 for(const [name,content]of Object.entries(files))fs.writeFileSync(path.join(directory,name),content);
 const tag='v'+version+'-build.'+commit,repo='mgedh9ali-cpu/Complaints-System',api='https://api.github.com/repos/'+repo;
 let release=existing?record():null;const calls=[];
 function record(){return {id:7,tag_name:tag,target_commitish:commit,draft:!published,upload_url:'https://'+(badHost?'other.example':'uploads.github.com')+'/repos/'+repo+'/releases/7/assets{?name,label}',html_url:'https://github.com/'+repo+'/releases/tag/'+tag,assets:Object.entries(files).map(([name,b],i)=>({id:20+i,name,state:'uploaded',size:b.length,digest:'sha256:'+sha(mismatch&&name.endsWith('-setup.exe')?Buffer.from('different'):b)}))};}
 const response=(status,data)=>({status,ok:status>=200&&status<300,json:async()=>data});
 const fetchImpl=async(url,options)=>{
  calls.push({url,...options});const method=options.method||'GET';
  if(url.includes('/git/ref/tags/'))return wrongTag?response(200,{object:{type:'commit',sha:'b'.repeat(40)}}):response(404,{});
  if(method==='GET'&&url.includes('/releases?'))return response(200,[{id:1,tag_name:'v'+version,draft:false,target_commitish:'old-source'},...(release?[release]:[])]);
  if(method==='POST'&&url===api+'/releases'){
   if(createError)return response(422,{message:'Validation Failed',errors:[{field:'tag_name',code:'already_exists'}]});
   const body=JSON.parse(options.body);assert.equal(body.tag_name,tag);assert.equal(body.target_commitish,commit);release={...record(),draft:true,assets:[]};return response(201,release);
  }
  if(method==='GET'&&url.includes('/releases/7/assets?'))return response(200,release.assets);
  if(method==='DELETE'){const id=Number(url.split('/').at(-1));release.assets=release.assets.filter(a=>a.id!==id);return response(204);}
  if(method==='POST'&&url.startsWith('https://uploads.github.com/')){
   const name=new URL(url).searchParams.get('name');const asset={id:100+calls.length,name,state:'uploaded',size:options.body.length,digest:'sha256:'+sha(options.body)};
   release.assets.push(asset);return response(201,asset);
  }
  if(method==='PATCH'&&url===api+'/releases/7'){release.draft=false;return response(200,release);}
  throw new Error('Unexpected API request: '+method+' '+url);
 };
 const options={directory,version,env:{GITHUB_TOKEN:'synthetic-ci-token',GITHUB_REPOSITORY:repo,GITHUB_SHA:commit,GITHUB_REF:'refs/heads/main'},fetchImpl,log(){}};
 return {options,calls,files,tag};
}
test('a new source build uses a distinct tag despite an older release with the same package version',async t=>{
 const f=fixture(t);const release=await publish(f.options);assert.equal(release.tag_name,f.tag);assert.equal(release.draft,false);
 assert.equal(f.calls.filter(c=>c.url.startsWith('https://uploads.github.com/')).length,1);
});
test('retrying a complete published build performs no mutations',async t=>{
 const f=fixture(t,{existing:true,published:true});await publish(f.options);assert.equal(f.calls.filter(c=>c.method&&c.method!=='GET').length,0);
});
test('a verified existing draft resumes without duplicate uploads',async t=>{
 const f=fixture(t,{existing:true});await publish(f.options);assert.deepEqual(f.calls.filter(c=>c.method&&c.method!=='GET').map(c=>c.method),['PATCH']);
});
test('a mismatched upload is replaced only inside the matching draft',async t=>{
 const f=fixture(t,{existing:true,mismatch:true});await publish(f.options);assert.deepEqual(f.calls.filter(c=>c.method&&c.method!=='GET').map(c=>c.method),['DELETE','POST','PATCH']);
});
test('published asset mismatches fail without changing the old release',async t=>{
 const f=fixture(t,{existing:true,published:true,mismatch:true});await assert.rejects(publish(f.options),/left unchanged/);assert.equal(f.calls.filter(c=>c.method&&c.method!=='GET').length,0);
});
test('API validation errors identify the failing endpoint and field',async t=>{
 const f=fixture(t,{createError:true});await assert.rejects(publish(f.options),e=>/422 POST/.test(e.message)&&/tag_name/.test(e.message)&&!e.message.includes(f.options.env.GITHUB_TOKEN));
});
test('wrong existing tag targets and untrusted upload hosts stop publication',async t=>{
 for(const option of [{wrongTag:true},{existing:true,badHost:true}]){const f=fixture(t,option);await assert.rejects(publish(f.options),/publishing commit|upload destination/);assert.equal(f.calls.filter(c=>c.method&&c.method!=='GET').length,0);}
});
test('artifact checksums and branch restrictions are checked before network access',async t=>{
 const f=fixture(t);fs.writeFileSync(path.join(f.options.directory,Object.keys(f.files)[0]),'tampered');await assert.rejects(publish(f.options),/checksum/);assert.equal(f.calls.length,0);
 f.options.env.GITHUB_REF='refs/pull/66/merge';await assert.rejects(publish(f.options),/canonical main/);assert.equal(f.calls.length,0);
});

test('build verifies installer and portable internally but publishes only one installer',async t=>{
 const f=fixture(t,{installer:true}),pkg=require('../package.json');
 const {generateManifest}=require('../scripts/release-manifest');
 const names=[pkg.build.portable.artifactName,pkg.build.nsis.artifactName].map(name=>name.replace('${version}',pkg.version).replace('${ext}','exe'));
 for(const name of names)assert.ok(fs.existsSync(path.join(f.options.directory,name)));
 const manifest=await generateManifest(f.options.directory,pkg.version,f.options.env.GITHUB_SHA,{requireInstaller:true});
 assert.deepEqual(manifest.artifacts.map(a=>a.filename),names);
 const release=await publish(f.options);assert.equal(release.draft,false);
 assert.equal(f.calls.filter(c=>c.url.startsWith('https://uploads.github.com/')).length,1);
});

test('a modified installer or unsafe artifact list stops publication before network access',async t=>{
 const f=fixture(t,{installer:true});
 fs.writeFileSync(path.join(f.options.directory,'complaints-system-'+f.options.version+'-setup.exe'),'tampered');
 await assert.rejects(publish(f.options),/checksum/);assert.equal(f.calls.length,0);
 const file=path.join(f.options.directory,'build-manifest.json'),manifest=JSON.parse(fs.readFileSync(file));
 manifest.artifacts[1].filename='../unexpected.exe';fs.writeFileSync(file,JSON.stringify(manifest));
 await assert.rejects(publish(f.options),/Unexpected release artifact/);assert.equal(f.calls.length,0);
});

test('release notes identify the actual version and never reuse older notes for an unknown version', () => {
 const {releaseNotes}=require('../scripts/publish-release');
 const commit='a'.repeat(40);
 assert.match(releaseNotes('9.9.9',commit),/لم تُرفق ملاحظات/);
 assert.ok(releaseNotes('9.9.9',commit).includes(commit));
 assert.match(releaseNotes('1.0.0-rc.20',commit),/سجل التحديثات/);
});
