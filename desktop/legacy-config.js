'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {createStorageCodec}=require('../lib/storage-codec');
const {writeRecoveryKey}=require('./recovery');
function parseConfig(text){
 const values={};
 for(const line of text.split(/\r?\n/)){
  const match=line.match(/^\s*([A-Z_]+)\s*=(.*)$/);
  if(match)values[match[1]]=match[2].trim().replace(/^(['"])(.*)\1$/,'$2');
 }
 return values;
}
function upgradeLegacyConfig(envPath,databasePath){
 const original=fs.readFileSync(envPath,'utf8'),values=parseConfig(original);
 if(Object.hasOwn(values,'DATA_KEY')&&Object.hasOwn(values,'BACKUP_SECRET'))return {changed:false};
 const session=values.SESSION_SECRET;
 const valid=value=>typeof value==='string'&&value.length>=32&&!/[\r\n\0]/.test(value)&&!/^replace[-_ ]with\b|^change[-_ ]me\b/i.test(value);
 if(!valid(session))throw new Error('تعذر ترقية إعدادات الحماية القديمة؛ مفتاح الجلسة غير صالح.');
 const storageKey=Object.hasOwn(values,'DATA_KEY')?values.DATA_KEY:session;
 const legacyBackup=Object.hasOwn(values,'BACKUP_SECRET')?values.BACKUP_SECRET:session;
 if(!valid(storageKey)||!valid(legacyBackup))throw new Error('مفتاح الحماية القديم غير صالح؛ لم تتغير الإعدادات.');
 if(fs.existsSync(databasePath)){
  const db=new (require('better-sqlite3'))(databasePath,{readonly:true,fileMustExist:true});
  try{
   if(db.pragma('quick_check',{simple:true})!=='ok')throw new Error('قاعدة البيانات تحتاج إلى فحص؛ لم تتغير مفاتيحها.');
   if(db.prepare("SELECT name FROM sqlite_master WHERE name='storage_metadata'").get()){
    const metadata=db.prepare('SELECT key_check FROM storage_metadata WHERE id=1').get();
    if(metadata&&createStorageCodec(storageKey).decodeJson(metadata.key_check,'key-check')!=='complaints-storage-v1')throw new Error('تعذر التحقق من مفتاح البيانات القديم.');
   }
  }finally{db.close();}
 }
 const fresh=()=>crypto.randomBytes(48).toString('base64url');
 const nextSession=fresh();
 const backupKey=legacyBackup===storageKey||legacyBackup===nextSession?fresh():legacyBackup;
 const backupPath=envPath+'.before-key-upgrade';
 if(fs.existsSync(backupPath)){
  if(fs.readFileSync(backupPath,'utf8')!==original)throw new Error('توجد نسخة إعدادات مختلفة؛ لم تُستبدل.');
 }else fs.writeFileSync(backupPath,original,{flag:'wx',mode:0o600});
 // Old backups retain their original recovery key; only future backups use the new key.
 if(backupKey!==legacyBackup)writeRecoveryKey(path.join(path.dirname(envPath),'legacy-backup-recovery-key.json'),legacyBackup);
 let updated=original.split(/\r?\n/).filter(line=>!/^\s*(SESSION_SECRET|DATA_KEY|BACKUP_SECRET)\s*=/.test(line)).join('\n');
 updated+='\nSESSION_SECRET='+nextSession+'\nDATA_KEY='+storageKey+'\nBACKUP_SECRET='+backupKey+'\n';
 const temporary=envPath+'.'+crypto.randomUUID()+'.tmp';
 try{
  fs.writeFileSync(temporary,updated,{flag:'wx',mode:0o600});
  if(fs.readFileSync(envPath,'utf8')!==original)throw new Error('تغيّرت الإعدادات أثناء الترقية؛ أعد المحاولة.');
  fs.renameSync(temporary,envPath);
 }finally{fs.rmSync(temporary,{force:true});}
 return {changed:true,legacyRecoveryKeySaved:backupKey!==legacyBackup};
}
module.exports={upgradeLegacyConfig,parseConfig};
