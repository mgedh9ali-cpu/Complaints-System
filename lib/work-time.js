'use strict';
const zone='Asia/Damascus';
const partsFormatter=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
function dayBoundary(day,end=false){
 if(typeof day!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(day))return null;
 const wall=Date.parse(day+'T00:00:00.000Z');
 if(!Number.isFinite(wall)||new Date(wall).toISOString().slice(0,10)!==day)return null;
 if(end)return dayBoundary(new Date(wall+86400000).toISOString().slice(0,10),false)-1;
 let instant=wall;
 for(let i=0;i<3;i++){
  const p=Object.fromEntries(partsFormatter.formatToParts(new Date(instant)).filter(x=>x.type!=='literal').map(x=>[x.type,Number(x.value)]));
  const offset=Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second)-instant;
  instant=wall-offset;
 }
 return instant;
}
function dayKey(value=Date.now()){
 const date=new Date(value);if(!Number.isFinite(date.getTime()))return null;
 const parts=Object.fromEntries(partsFormatter.formatToParts(date).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
 return parts.year+'-'+parts.month+'-'+parts.day;
}
module.exports={dayBoundary,dayKey,zone};
