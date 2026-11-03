'use strict';
const fs=require('node:fs'),path=require('node:path');
const {storageFor}=require('./storage-codec');
const attachments=require('./attachments');
function exportFiles(state,service){
 if(!service)return [];
 return state.complaints.flatMap(c=>service.listByComplaint(c.id).map(meta=>({complaintId:c.id,meta,data:service.read(meta.storedName).toString('base64')})));
}
function validateFiles(payload,{db,dataDir}){
 const entries=payload.attachmentFiles||[];
 if(!Array.isArray(entries)||entries.length>25000)throw new Error('قائمة المرفقات غير صالحة.');
 const ids=new Set(payload.state.complaints.map(c=>c.id)),seen=new Set(),counts=new Map(),storage=storageFor(db);
 const directory=path.join(path.resolve(dataDir||path.dirname(process.env.DATABASE_PATH||'./data/complaints.sqlite')),'attachments');
 const checked=entries.map(entry=>{
  const {complaintId,meta,data}=entry||{};
  if(!ids.has(complaintId)||!meta||typeof meta.storedName!=='string'||!meta.storedName.startsWith(complaintId+'_')||!/^[-A-Za-z0-9_]+_[0-9a-f-]{36}\.[a-z0-9]+$/i.test(meta.storedName)||seen.has(meta.storedName)||typeof data!=='string'||data.length>8*1024*1024)throw new Error('مرجع مرفق غير صالح.');
  seen.add(meta.storedName);counts.set(complaintId,(counts.get(complaintId)||0)+1);
  const bytes=Buffer.from(data,'base64');
  if(counts.get(complaintId)>5||!attachments.isAllowed({originalname:meta.originalName,mimetype:meta.mime,size:bytes.length,buffer:bytes})||meta.size!==bytes.length)throw new Error('محتوى مرفق غير صالح.');
  return {complaintId,meta,bytes};
 });
 for(const {meta,bytes} of checked){
  const file=path.join(directory,meta.storedName);
  if(fs.existsSync(file)&&(!fs.lstatSync(file).isFile()||fs.lstatSync(file).isSymbolicLink()||!storage.open(fs.readFileSync(file),'attachment:'+meta.storedName).equals(bytes)))throw new Error('تعارض في محتوى مرفق موجود.');
 }
 return {checked,directory,storage};
}
function prepareFiles(payload,options){
 const {db}=options;
 const {checked,directory,storage}=validateFiles(payload,options);
 fs.mkdirSync(directory,{recursive:true,mode:0o700});
 const created=[];
 const rollback=()=>{for(const file of created)fs.rmSync(file,{force:true});};
 try{
  for(const {meta,bytes} of checked){
   const file=path.join(directory,meta.storedName);
   if(fs.existsSync(file)){
    if(!fs.lstatSync(file).isFile()||fs.lstatSync(file).isSymbolicLink()||!storage.open(fs.readFileSync(file),'attachment:'+meta.storedName).equals(bytes))throw new Error('تعارض في محتوى مرفق موجود.');
   }else{fs.writeFileSync(file,storage.seal(bytes,'attachment:'+meta.storedName),{flag:'wx',mode:0o600});created.push(file);}
  }
 }catch(error){rollback();throw error;}
 return {rollback,commitMetadata(){
  if(!checked.length)return;
  const insert=db.prepare('INSERT INTO attachment_records(stored_name,complaint_id,metadata_json) VALUES(?,?,?) ON CONFLICT(stored_name) DO UPDATE SET metadata_json=excluded.metadata_json');
  for(const {complaintId,meta} of checked)insert.run(meta.storedName,complaintId,storage.encodeJson(meta,'attachment-meta:'+meta.storedName));
 }};
}
module.exports={exportFiles,prepareFiles,validateFiles};
