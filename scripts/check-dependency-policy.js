'use strict';
// Offline dependency policy. The registry advisory check runs in CI, but a
// pipeline must never be able to merge a tree whose lockfile describes
// something other than what it installs, so the same rules are also checked
// here without touching the network.
//
// Two classes of defect are covered:
//   1. a lockfile entry whose declared version does not match the tarball it
//      points at, which is how a vulnerable engine can hide behind a patched
//      version number;
//   2. a resolved version inside an advisory range that the registry reports.
//
// The advisory ranges below are the ones the registry publishes for the
// packages this project ships. `npm run check:security` repeats the check
// against the live registry.
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');

// name -> { vulnerable: [ [from, to] ] as inclusive version ranges, note }
const ADVISORY_POLICY=[
  {name:'glob',ranges:[[[9,0,0],[14,0,1]]],note:'ReDoS and command injection in the matching engine.'},
  {name:'minimatch',ranges:[[[7,0,0],[11,0,0]]],note:'ReDoS in the pattern matcher.'},
  {name:'brace-expansion',ranges:[[[1,0,0],[1,1,20]],[[2,0,0],[2,1,6]]],note:'Denial of service while expanding patterns.'},
  {name:'uuid',ranges:[[[0,0,0],[11,1,0]]],note:'Missing buffer bounds check in the hashing helpers.'},
];

function parseVersion(version){
  const match=/^(\d+)\.(\d+)\.(\d+)/.exec(String(version||''));
  if(!match)return null;
  return [Number(match[1]),Number(match[2]),Number(match[3])];
}
function compare(left,right){
  for(let index=0;index<3;index++){
    if(left[index]!==right[index])return left[index]-right[index];
  }
  return 0;
}
function withinRange(version,from,to){
  if(compare(version,from)<0||compare(version,to)>0)return false;
  return true;
}
// The tarball name carries the version that npm actually installs. A mismatch
// between that number and the declared version means the lockfile lies about
// what the tree contains.
function tarballVersion(resolved){
  const match=/\/-\/[^/]+-(\d+\.\d+\.\d+[^/]*)\.tgz$/.exec(String(resolved||''));
  return match?match[1]:null;
}

function checkLockfile(lock){
  const violations=[];
  const packages=(lock&&lock.packages)||{};
  for(const [key,entry] of Object.entries(packages)){
    if(!entry||typeof entry!=='object')continue;
    if(entry.link)continue; // Local workspace adapter: it installs no tarball.
    const resolved=entry.resolved;
    if(!resolved||!/\/-\/[^/]+\.tgz$/.test(resolved))continue;
    const declared=entry.version;
    const installed=tarballVersion(resolved);
    if(!declared||!installed)continue;
    if(compare(parseVersion(declared)||[],parseVersion(installed)||[])!==0){
      violations.push({
        kind:'mismatch',
        package:key,
        detail:'declares '+declared+' but installs '+installed+' from '+resolved,
      });
      continue;
    }
    const packageName=(entry.name||key.split('node_modules/').pop()||'').replace(/-patched$/,'');
    const policy=ADVISORY_POLICY.find(item=>item.name===packageName);
    if(!policy)continue;
    const version=parseVersion(installed);
    if(!version)continue;
    for(const [from,to] of policy.ranges){
      if(withinRange(version,from,to)){
        violations.push({kind:'advisory',package:key,detail:installed+' falls in a published advisory range for '+packageName+'. '+policy.note});
        break;
      }
    }
  }
  return violations;
}

function readLockfile(directory=root){
  const file=path.join(directory,'package-lock.json');
  return JSON.parse(fs.readFileSync(file,'utf8'));
}

function main(){
  const violations=checkLockfile(readLockfile());
  if(violations.length){
    for(const violation of violations){
      process.stderr.write('Dependency policy violation ('+violation.kind+'): '+violation.package+' '+violation.detail+'\n');
    }
    process.stderr.write('The dependency policy found '+violations.length+' violation(s). The tree cannot be released in this state.\n');
    process.exit(1);
  }
  console.log('Dependency policy satisfied: every locked version matches its tarball and no advisory range is used.');
}

module.exports={ADVISORY_POLICY,checkLockfile,readLockfile,tarballVersion};

if(require.main===module)main();
