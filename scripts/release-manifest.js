'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
async function generateManifest(directory,version,commit){
 if(!/^[a-f0-9]{40}$/.test(commit||''))throw new Error('An immutable source commit is required.');
 const filename='complaints-system-'+version+'-portable.exe',file=path.join(directory,filename);
 const hash=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(file))hash.update(chunk);
 const sha256=hash.digest('hex');
 const manifest={format:'complaints-windows-release-v1',version,commit,filename,bytes:fs.statSync(file).size,sha256,platform:'win32',arch:'x64'};
 fs.writeFileSync(path.join(directory,'SHA256SUMS.txt'),sha256+'  '+filename+'\n');
 fs.writeFileSync(path.join(directory,'build-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
 return manifest;
}
if(require.main===module)generateManifest(path.resolve('dist-desktop'),require('../package.json').version,process.env.GITHUB_SHA).then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={generateManifest};
