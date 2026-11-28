'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {parseWhatsAppExport, summarizeWhatsAppExport} = require('../lib/whatsapp-import');
const raw = [
  '28/11/2026, 10:30 - +963999000000: السلام عليكم',
  '28/11/2026, 10:31 - +963999000000: لدي شكوى بشأن تأخير المعاملة',
  'تفاصيل إضافية',
  '28/11/2026, 10:32 - المكتب: تم الاستلام',
  '28/11/2026, 10:33 - +963999000000: PTT-20261128-WA0001.opus (file attached)',
  '28/11/2026, 10:34 - +963999000000: <Media omitted>'
].join('\n');
test('parses multiline exports, identifies voice notes and missing media',()=>{
  const p=parseWhatsAppExport(raw);
  assert.equal(p.messages.length,5);
  assert.equal(p.firstVisibleDate,'2026-11-28');
  assert.match(p.messages[1].text,/تفاصيل إضافية/);
  assert.equal(p.messages[3].audio,true);
  assert.equal(p.messages[4].mediaOmitted,true);
});
test('summarizes citizen evidence only and flags untranscribed voice',()=>{
  const p=parseWhatsAppExport(raw);
  const s=summarizeWhatsAppExport(p,{citizenSender:'+963999000000'});
  assert.equal(s.suggestedType,'complaint');
  assert.deepEqual(s.untranscribedAudio,[4]);
  assert.deepEqual(s.omittedMedia,[5]);
  assert.doesNotMatch(s.summary,/تم الاستلام/);
  assert.equal(s.requiresReview,true);
});
test('incorporates supplied transcripts without inventing missing information',()=>{
  const s=summarizeWhatsAppExport(parseWhatsAppExport(raw),{citizenSender:'+963999000000',transcripts:{4:'راجعت الدائرة مرتين'}});
  assert.match(s.summary,/راجعت الدائرة مرتين/);
  assert.deepEqual(s.untranscribedAudio,[]);
  assert.equal(s.evidence.find(e=>e.id===4).source,'transcript');
});
test('supports Arabic digits and bracketed dates, rejects unknown input',()=>{
  const p=parseWhatsAppExport('[٢٨/١١/٢٠٢٦، ١٠:٣٠ ص] مواطن: استفسار عن موعد');
  assert.equal(p.firstVisibleDate,'2026-11-28');
  assert.equal(p.messages[0].text,'استفسار عن موعد');
  assert.throws(()=>parseWhatsAppExport('not an export'));
  assert.throws(()=>summarizeWhatsAppExport(p));
});
