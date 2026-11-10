const registryColumnLabels={id:'رقم السجل',type:'النوع',subject:'الموضوع',prov:'المحافظة',status:'الحالة',pri:'الأولوية',owner:'المسؤول',age:'مدة البقاء',act:'الإجراءات'};
function registryColumnKey(){return authenticatedUser?.id?'complaints-columns:'+encodeURIComponent(authenticatedUser.id):null;}
function registryColumns(){
 const defaults=Object.keys(registryColumnLabels).map(key=>({key,visible:true}));
 try{
  const stored=JSON.parse(localStorage.getItem(registryColumnKey())||'null');
  if(!Array.isArray(stored))return defaults;
  const seen=new Set(),list=[];
  for(const item of stored){if(!item||!Object.hasOwn(registryColumnLabels,item.key)||seen.has(item.key))continue;seen.add(item.key);list.push({key:item.key,visible:['id','subject','act'].includes(item.key)||item.visible!==false});}
  return list.concat(defaults.filter(x=>!seen.has(x.key)));
 }catch(_){return defaults;}
}
function registryColumnsDialog(){
 modal('أعمدة السجل','رتّب الأعمدة واختر ما يظهر لهذا الحساب.',registryColumns().map((c,i)=>'<div class="setting-row"><label><input type="checkbox" data-column-visible="'+c.key+'" '+(c.visible?'checked':'')+' '+(['id','subject','act'].includes(c.key)?'disabled':'')+'> '+registryColumnLabels[c.key]+'</label><button type="button" class="btn btn-sm" data-action="move-registry-column" data-key="'+c.key+'" '+(i===0?'disabled':'')+'>تحريك للأعلى</button></div>').join(''),'<button class="btn" data-action="close-modal">تم</button>');
}
function storeRegistryColumns(columns){
 const key=registryColumnKey();if(!key)return false;
 try{localStorage.setItem(key,JSON.stringify(columns));return true;}catch(_){toast('تعذر حفظ إعداد الأعمدة.','error');return false;}
}
function applyRegistryColumns(){
 if(page!=='complaints')return;
 const columns=registryColumns();
 document.querySelectorAll('.registry-panel table tr').forEach(row=>{
  for(const c of columns){const cell=row.querySelector?.('.col-'+c.key);if(cell){cell.hidden=!c.visible;row.appendChild(cell);}}
 });
}
document.addEventListener('complaints:render',applyRegistryColumns);
document.addEventListener('change',e=>{
 const key=e.target?.dataset?.columnVisible;if(!Object.hasOwn(registryColumnLabels,key))return;
 const cols=registryColumns();const c=cols.find(x=>x.key===key);c.visible=['id','subject','act'].includes(key)||e.target.checked;
 if(storeRegistryColumns(cols))applyRegistryColumns();
});
document.addEventListener('click',e=>{
 const el=e.target.closest?.('[data-action]');if(!el)return;
 if(el.dataset.action==='registry-columns')registryColumnsDialog();
 if(el.dataset.action==='move-registry-column'){
  const cols=registryColumns(),i=cols.findIndex(c=>c.key===el.dataset.key);if(i<1)return;
  [cols[i-1],cols[i]]=[cols[i],cols[i-1]];
  if(storeRegistryColumns(cols)){applyRegistryColumns();registryColumnsDialog();}
 }
});
