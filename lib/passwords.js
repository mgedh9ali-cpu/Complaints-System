'use strict';
const crypto=require('node:crypto');
const bcrypt=require('bcryptjs');
const PREFIX='sha256-bcrypt-v1$';
// Fixed dummy hash (cost 12) used when the username does not exist so that
// bcrypt always runs and timing cannot be used to enumerate accounts.
const DUMMY_HASH=PREFIX+'$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewY5GyYIeWEvbK5e';
// The domain-separated fixed-length input avoids bcrypt's 72-byte truncation,
// including long Arabic passwords. Legacy bcrypt hashes continue to verify.
const prepare=password=>crypto.createHash('sha256').update('complaints-password-v1\0'+password,'utf8').digest('base64');
const hashPassword=password=>PREFIX+bcrypt.hashSync(prepare(password),12);
function verifyPassword(password,stored){
 if(typeof password!=='string')return false;
 const candidate=typeof stored==='string'&&stored.length>0?stored:DUMMY_HASH;
 try{
  return candidate.startsWith(PREFIX)
   ?bcrypt.compareSync(prepare(password),candidate.slice(PREFIX.length))
   :bcrypt.compareSync(password,candidate);
 }catch(_){return false;}
}
module.exports={hashPassword,verifyPassword,needsUpgrade:stored=>typeof stored==='string'&&!stored.startsWith(PREFIX),DUMMY_HASH};
