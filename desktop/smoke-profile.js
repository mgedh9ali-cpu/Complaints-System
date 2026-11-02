'use strict';
const fs=require('node:fs'),path=require('node:path');
function configureSmokeProfile(app,args=process.argv,environment=process.env){
 if(!args.includes('--release-smoke'))return false;
 const root=environment.COMPLAINTS_SMOKE_USER_DATA;
 if(!root||!path.isAbsolute(root)||!path.basename(root).startsWith('complaints-packaged-smoke-')||!fs.statSync(root).isDirectory()||fs.readdirSync(root).length!==0){
  throw new Error('Release smoke testing requires a fresh, empty complaints-packaged-smoke-* directory.');
 }
 for(const [key,name]of [['userData','profile'],['sessionData','session'],['logs','logs'],['crashDumps','crashes']]){
  const directory=path.join(root,name);fs.mkdirSync(directory,{mode:0o700});app.setPath(key,directory);
 }
 return true;
}
module.exports={configureSmokeProfile};
