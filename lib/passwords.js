'use strict';
const crypto=require('node:crypto');
const bcrypt=require('bcryptjs');
const {runScrypt,SCRYPT_OPTS}=require('./workers/offload');
const BCRYPT_PREFIX='sha256-bcrypt-v1$';
const PREFIX='sha256-scrypt-v1$';
const SALT_BYTES=16;
const KEY_BYTES=32;
// Fixed dummy hash used when the username does not exist so that the same
// scrypt work always runs and timing cannot be used to enumerate accounts.
const DUMMY_HASH=PREFIX+'2XeFq4gQck+CFsJIKzN/lg==$zU1PU1gzRAK5dJ1UeBODO/vb2ortGzkbg1ID4OT+gS0=';
// The domain-separated fixed-length input avoids bcrypt's 72-byte truncation,
// including long Arabic passwords. Legacy bcrypt hashes continue to verify.
const prepare=password=>crypto.createHash('sha256').update('complaints-password-v1\0'+password,'utf8').digest('base64');
const formatHash=(salt,key)=>PREFIX+salt.toString('base64')+'$'+key.toString('base64');
// Password hashing and verification run in the worker pool so the server keeps
// answering requests while a login or account creation is being processed.
async function hashPassword(password){
 const salt=crypto.randomBytes(SALT_BYTES);
 const key=await runScrypt(prepare(password),salt,KEY_BYTES,SCRYPT_OPTS);
 return formatHash(salt,key);
}
// Startup-only path for the bootstrap administrator: it runs before the server
// listens, so the synchronous scrypt run cannot block any request.
function hashPasswordSync(password){
 const salt=crypto.randomBytes(SALT_BYTES);
 return formatHash(salt,crypto.scryptSync(prepare(password),salt,KEY_BYTES,SCRYPT_OPTS));
}
async function verifyPassword(password,stored){
 if(typeof password!=='string')return false;
 const candidate=typeof stored==='string'&&stored.length>0?stored:DUMMY_HASH;
 try{
  if(candidate.startsWith(PREFIX)){
   const [salt,key]=candidate.slice(PREFIX.length).split('$');
   const expected=Buffer.from(key||'','base64');
   if(expected.length<16)return false;
   const actual=await runScrypt(prepare(password),Buffer.from(salt||'','base64'),expected.length,SCRYPT_OPTS);
   return actual.length===expected.length&&crypto.timingSafeEqual(actual,expected);
  }
  return candidate.startsWith(BCRYPT_PREFIX)
   ?bcrypt.compareSync(prepare(password),candidate.slice(BCRYPT_PREFIX.length))
   :bcrypt.compareSync(password,candidate);
 }catch(_){return false;}
}
module.exports={hashPassword,hashPasswordSync,verifyPassword,needsUpgrade:stored=>typeof stored==='string'&&!stored.startsWith(PREFIX),DUMMY_HASH};
