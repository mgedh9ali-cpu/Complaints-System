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

test('matches iOS voice references and explicit omitted audio without mislabeling conversation text', () => {
  const parsed = parseWhatsAppExport([
    '[28/11/2026, 10:34:01] مواطن: <attached: 00000009-AUDIO-2026-11-28-10-34-01.opus>',
    '[28/11/2026, 10:34:02] المكتب: audio omitted',
    '[28/11/2026, 10:34:03] مواطن: ظهر نص <Media omitted> على الشاشة'
  ].join('\n'));
  assert.equal(parsed.messages[0].attachmentName, '00000009-AUDIO-2026-11-28-10-34-01.opus');
  assert.equal(parsed.messages[0].audio, true);
  assert.equal(parsed.messages[1].audio, true);
  assert.equal(parsed.messages[2].mediaOmitted, false);
  const result = summarizeWhatsAppExport(parsed, {
    citizenSender: 'مواطن', transcripts: { 1: 'قدمت الطلب من أسبوع', 2: 'أرسل رقم الطلب' }
  });
  assert.match(result.summary, /قدمت الطلب من أسبوع/);
  assert.doesNotMatch(result.summary, /أرسل رقم الطلب/);
  assert.match(result.details, /مقتطفات من الطرف الآخر\nأرسل رقم الطلب/);
  assert.deepEqual(result.untranscribedAudio, []);
});

test('retains late updates and substantive voice evidence in longer chats', () => {
  const parsed = parseWhatsAppExport([
    '28/11/2026, 10:00 - مواطن: السلام عليكم',
    ...Array.from({ length: 8 }, (_, i) => '28/11/2026, 10:0' + (i + 1) + ' - مواطن: رسالة متابعة ' + i),
    '28/11/2026, 10:09 - مواطن: PTT-20261128-WA0001.opus (file attached)',
    '28/11/2026, 10:10 - مواطن: هذه آخر الملاحظات'
  ].join('\n'));
  const result = summarizeWhatsAppExport(parsed, { citizenSender: 'مواطن', transcripts: { 10: 'رقم الطلب 1234' } });
  assert.equal(result.evidence.length, 5);
  assert.match(result.summary, /رقم الطلب 1234/);
  assert.match(result.summary, /هذه آخر الملاحظات/);
  assert.doesNotMatch(result.summary, /السلام عليكم/);
});
