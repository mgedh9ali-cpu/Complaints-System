'use strict';
const crypto=require('node:crypto');
const {runScrypt,SCRYPT_OPTS}=require('./workers/offload');
const FORMAT='complaints-encrypted-sync-v1';
async function deriveKey(password,salt){
 if(typeof password!=='string'||password.length<16||password.length>200)throw new Error('أدخل عبارة مرور لنقل البيانات بين 16 و200 حرف.');
 return runScrypt(password,salt,32,SCRYPT_OPTS);
}
async function sealPackage(payload,password){
 const salt=crypto.randomBytes(16),iv=crypto.randomBytes(12);
 const key=await deriveKey(password,salt);
 const cipher=crypto.createCipheriv('aes-256-gcm',key,iv);
 cipher.setAAD(Buffer.from(FORMAT));
 const bytes=Buffer.from(JSON.stringify(payload));
 if(bytes.length>32*1024*1024)throw new Error('الحزمة أكبر من 32MB؛ استخدم النسخة الكاملة لنقل الأرشيف.');
 const data=Buffer.concat([cipher.update(bytes),cipher.final()]);
 return {format:FORMAT,salt:salt.toString('base64'),iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:data.toString('base64')};
}
async function openPackage(envelope,password){
 if(envelope?.format!==FORMAT||typeof envelope.data!=='string'||envelope.data.length>48*1024*1024)throw new Error('يلزم ملف مزامنة مشفر صالح.');
 const salt=Buffer.from(envelope.salt||'','base64'),iv=Buffer.from(envelope.iv||'','base64'),tag=Buffer.from(envelope.tag||'','base64');
 if(salt.length!==16||iv.length!==12||tag.length!==16)throw new Error('ترويسة المزامنة غير صالحة.');
 const key=await deriveKey(password,salt);
 const decipher=crypto.createDecipheriv('aes-256-gcm',key,iv);
 decipher.setAAD(Buffer.from(FORMAT));
 decipher.setAuthTag(tag);
 try{
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.data,'base64')),decipher.final()]).toString('utf8'));
 }catch(_){throw new Error('تعذر التحقق من الملف أو عبارة المرور.');}
}
module.exports={sealPackage,openPackage};
