'use strict';
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const SOURCE_FILES=Object.freeze([
  "ui/core/bootstrap.js",
  "ui/core/format.js",
  "ui/pages/dashboard.js",
  "ui/pages/registry.js",
  "ui/pages/communication.js",
  "ui/pages/reports.js",
  "ui/pages/settings.js",
  "ui/core/navigation.js",
  "ui/components/dialogs.js",
  "ui/features/intake.js",
  "ui/pages/detail.js",
  "ui/features/complaint-actions.js",
  "ui/features/replies.js",
  "ui/features/settings-actions.js",
  "ui/core/events.js"
]);
function assembleUiBundle(root=path.resolve(__dirname,'..')){
  const bundled=SOURCE_FILES.map(name=>{
    const full=path.resolve(root,name);
    if(!full.startsWith(path.resolve(root)+path.sep))throw new Error('Unsafe UI source path');
    return fs.readFileSync(full,'utf8');
  }).join('\n');
  if(!bundled.includes("'use strict'")||!bundled.includes("STORAGE_KEY")||bundled.length<20000)
    throw new Error('UI source files incomplete');
  return bundled;
}
function validateUiBundle(root){
  const bundled=assembleUiBundle(root);
  new vm.Script(bundled,{filename:'app.bundle.js'});
  return {size:bundled.length,files:SOURCE_FILES.length};
}
module.exports={SOURCE_FILES,assembleUiBundle,validateUiBundle};
