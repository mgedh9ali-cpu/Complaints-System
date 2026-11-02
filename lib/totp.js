'use strict';
const crypto=require('node:crypto');
const ALPHABET='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32(bytes){let bits=0,value=0,output='';for(const byte of bytes){value=(value<<8)|byte;bits+=8;while(bits>=5){output+=ALPHABET[(value>>>(bits-5))&31];bits-=5;}}if(bits)output+=ALPHABET[(value<<(5-bits))&31];return output;}
function decode(secret){let bits=0,value=0;const bytes=[];for(const letter of String(secret).replace(/=+$/,'')){const n=ALPHABET.indexOf(letter);if(n<0)throw new Error('Invalid TOTP secret.');value=(value<<5)|n;bits+=5;if(bits>=8){bytes.push((value>>>(bits-8))&255);bits-=8;}}return Buffer.from(bytes);}
function codeForStep(secret,step){const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(step));const hash=crypto.createHmac('sha1',decode(secret)).update(counter).digest();const offset=hash[hash.length-1]&15;return String((hash.readUInt32BE(offset)&0x7fffffff)%1000000).padStart(6,'0');}
function verifyTotp(secret,code,{now=Date.now(),lastStep=-1}={}){if(typeof code!=='string'||!/^\d{6}$/.test(code)||!Number.isFinite(now)||now<0)return null;const current=Math.floor(now/30000);for(const step of [current,current-1,current+1]){if(step<0||step<=lastStep)continue;const expected=Buffer.from(codeForStep(secret,step));if(crypto.timingSafeEqual(expected,Buffer.from(code)))return step;}return null;}
const generateSecret=()=>base32(crypto.randomBytes(20));
const recoveryHash=(userId,code)=>crypto.createHash('sha256').update(userId+'\0'+String(code).trim()).digest('hex');
module.exports={base32,codeForStep,verifyTotp,generateSecret,recoveryHash};
