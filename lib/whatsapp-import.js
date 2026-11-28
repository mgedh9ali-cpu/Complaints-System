'use strict';
// Pure, local-only WhatsApp export parsing; no I/O, network or automatic record creation.
function parseWhatsAppExport(raw, {dateOrder="dmy"}={}) {
  if(typeof raw!=="string"||!raw.trim()||raw.length>2_000_000)throw new Error("ملف المحادثة فارغ أو يتجاوز الحد المسموح");
  if(!["dmy","mdy"].includes(dateOrder))throw new Error("ترتيب تاريخ غير صالح");
  const normalizeDigits=s=>s.replace(/[٠-٩۰-۹]/g,c=>String("٠١٢٣٤٥٦٧٨٩".includes(c)?"٠١٢٣٤٥٦٧٨٩".indexOf(c):"۰۱۲۳۴۵۶۷۸۹".indexOf(c)));
  const messages=[], unparsed=[];
  const head=/^\[?(\d{1,4}[./-]\d{1,2}[./-]\d{1,4})[،,]?\s+(\d{1,2}:\d{2}(?::\d{2})?(?:\s*(?:AM|PM|ص|م))?)\]?\s*(?:[-–]\s*)?(.*)$/i;
  for(const original of raw.replace(/^\uFEFF/,"").split(/\r?\n/)){
    const line=original.replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g,"").replace(/\u202f/g," ");
    const match=normalizeDigits(line).match(head);
    if(match){
      const rest=line.match(/^\[?[\d٠-٩۰-۹./-]+[،,]?\s+[\d٠-٩۰-۹:]+(?:\s*(?:AM|PM|ص|م))?\]?\s*(?:[-–]\s*)?(.*)$/i)?.[1]??match[3];
      const split=rest.indexOf(": ");
      const [x,y,z]=match[1].split(/[./-]/).map(Number);
      let [year,month,day]=match[1].split(/[./-]/)[0].length===4?[x,y,z]:[z,dateOrder==="dmy"?y:x,dateOrder==="dmy"?x:y];
      if(year<100)year+=2000;
      const date=new Date(Date.UTC(year,month-1,day));
      const iso=year>=2000&&year<=2100&&date.getUTCFullYear()===year&&date.getUTCMonth()===month-1&&date.getUTCDate()===day?date.toISOString().slice(0,10):null;
      messages.push({id:messages.length+1,dateRaw:match[1],date:iso,timeRaw:match[2],sender:split>0?rest.slice(0,split):null,text:split>0?rest.slice(split+2):rest});
    }else if(messages.length){messages[messages.length-1].text+="\n"+line;}else if(line.trim()){unparsed.push(line);}
  }
  if(!messages.length)throw new Error("لم يتم التعرف على صيغة التصدير");
  for(const m of messages){
    const attachment=m.text.match(/(?:^|\n)([^/\\\n<>:]{1,180}\.(?:opus|ogg|m4a|aac|mp3|wav|pdf|png|jpe?g|webp|gif|docx?|xlsx?|mp4))(?=\s*(?:\(|$))/i);
    const iosAttachment = m.text.match(/^<\s*(?:attached|مرفق)\s*[:：]\s*([^<>/\\\n]{1,180})>/i);
    m.attachmentName = iosAttachment?.[1].trim() || attachment?.[1]?.trim() || null;
    m.audio=Boolean(m.attachmentName&&/\.(opus|ogg|m4a|aac|mp3|wav)$/i.test(m.attachmentName));
    m.mediaOmitted = /^(?:<?(?:media omitted|تم حذف الوسائط|الوسائط غير مضمّنة|audio omitted|تم حذف الصوت)>?)[ .]*$/i.test(m.text.trim());
    m.audio ||= m.mediaOmitted && /audio omitted|تم حذف الصوت/i.test(m.text);
  }
  return {messages,unparsed,firstVisibleDate:messages[0].date,requiresReview:true};
}

function summarizeWhatsAppExport(parsed,{citizenSender,transcripts={}}={}){
  if(typeof citizenSender!=="string"||!citizenSender.trim())throw new Error("حدد مرسل الشكوى قبل إنشاء الملخص");
  const items=parsed.messages.filter(m=>m.sender===citizenSender);
  if(!items.length)throw new Error("المرسل غير موجود");
  function transcriptFor(message) {
    const text = Object.hasOwn(transcripts, message.id) ? transcripts[message.id] : null;
    return typeof text === 'string' ? text.trim() : '';
  }
  function evidenceFrom(messages) {
    return messages.flatMap(message => {
      const text = message.audio ? transcriptFor(message) :
        message.mediaOmitted || message.attachmentName ? '' : message.text.trim();
      return text ? [{
        id: message.id,
        text,
        source: message.audio ? 'transcript' : 'message'
      }] : [];
    });
  }

  const evidence = evidenceFrom(items);
  const complaint = /شكوى|أشتكي|اشتكي|تظلم/;
  const inquiry = /استفسار|استعلم|استعلام|هل يمكن|متى/;
  const type = evidence.some(item => complaint.test(item.text)) ? 'complaint' :
    evidence.some(item => inquiry.test(item.text)) ? 'inquiry' : null;
  const extracts = pickWhatsAppExcerpts(evidence, 5);
  const participants = new Set(parsed.messages.map(message => message.sender).filter(Boolean));
  const replies = participants.size === 2 ? pickWhatsAppExcerpts(evidenceFrom(
    parsed.messages.filter(message => message.sender && message.sender !== citizenSender)
  ), 3) : [];
  const phone = /^\+?[\d٠-٩۰-۹][\d٠-٩۰-۹ ()-]{6,25}$/.test(citizenSender) ? citizenSender : null;
  const summary = extracts.map(item => item.text).join('\n');
  const details = [
    summary && 'مقتطفات من رسائل مقدم الطلب\n' + summary,
    replies.length && 'مقتطفات من الطرف الآخر\n' + replies.map(item => item.text).join('\n')
  ].filter(Boolean).join('\n\n');
  return {
    suggestedType: type,
    phone,
    firstVisibleDate: items[0].date,
    summary,
    details,
    evidence: extracts,
    untranscribedAudio: parsed.messages.filter(m => m.audio && !transcriptFor(m)).map(m => m.id),
    omittedMedia: parsed.messages.filter(m => m.mediaOmitted).map(m => m.id),
    requiresReview: true
  };
}

function pickWhatsAppExcerpts(evidence, limit) {
  const seen = new Set();
  const candidates = evidence.filter(item => {
    const key = item.text.replace(/\s+/g, ' ');
    if (seen.has(key) || /^(?:السلام عليكم|مرحبا|مرحباً|شكرا|شكراً|وعليكم السلام)[\s!.،]*$/.test(key)) return false;
    seen.add(key);
    return true;
  });
  if (candidates.length <= limit) return candidates.map(shorten);
  // Keep the first substantive message and latest update. Prioritize voice
  // transcripts, requests and identifiers for the remaining excerpts.
  const priority = item => Number(item.source === 'transcript') * 2 +
    Number(/شكوى|استفسار|طلب|معاملة|بلاغ|راجع|الموعد|رقم|متى/.test(item.text)) * 2 +
    Number(/[0-9٠-٩۰-۹]{3}/.test(item.text));
  const middle = candidates.slice(1, -1).sort((a, b) => priority(b) - priority(a));
  return [candidates[0], ...middle.slice(0, limit - 2), candidates.at(-1)]
    .sort((a, b) => a.id - b.id).map(shorten);

  function shorten(item) {
    return { ...item, text: item.text.length <= 500 ? item.text : item.text.slice(0, 499) + '…' };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseWhatsAppExport, summarizeWhatsAppExport };
}
