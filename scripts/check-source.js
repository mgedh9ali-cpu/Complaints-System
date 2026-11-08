'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {validateUiBundle}=require('../lib/ui-bundle');
const {checkLockfile,readLockfile}=require('./check-dependency-policy');
const root=path.resolve(__dirname,'..');
const sources=['server.js','app.js','attachments-ui-bridge.js','ui-enhancements.js','sw.js','sw-register.js'];
function collect(directory){for(const entry of fs.readdirSync(path.join(root,directory),{withFileTypes:true})){const relative=path.join(directory,entry.name);if(entry.isDirectory())collect(relative);else if(entry.isFile()&&/\.(?:js|cjs|mjs)$/.test(entry.name))sources.push(relative);}}
for(const directory of ['config','lib','modules','desktop','scripts','vendor'])collect(directory);
for(const source of sources){const result=spawnSync(process.execPath,['--check',path.join(root,source)],{encoding:'utf8'});if(result.status!==0){process.stderr.write(result.stderr||('Syntax validation failed: '+source));process.exit(1);}}
const ui=validateUiBundle(root);
// The dependency policy runs with every source check so that a pipeline whose
// advisory step is misconfigured still refuses a tree that installs something
// other than what the lockfile promises.
const violations=checkLockfile(readLockfile(root));
if(violations.length){
 for(const violation of violations)process.stderr.write('Dependency policy violation ('+violation.kind+'): '+violation.package+' '+violation.detail+'\n');
 process.stderr.write('The dependency policy found '+violations.length+' violation(s).\n');
 process.exit(1);
}
console.log('Validated '+sources.length+' active JavaScript files and '+ui.files+' assembled UI sources.');
console.log('Dependency policy satisfied for the locked tree.');
