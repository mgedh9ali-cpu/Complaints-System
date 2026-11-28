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
    m.attachmentName=attachment?.[1]?.trim()||null;
    m.audio=Boolean(m.attachmentName&&/\.(opus|ogg|m4a|aac|mp3|wav)$/i.test(m.attachmentName));
    m.mediaOmitted=/(?:<media omitted>|<تم حذف الوسائط>|الوسائط غير مضمّنة|audio omitted|تم حذف الصوت)/i.test(m.text);
  }
  return {messages,unparsed,firstVisibleDate:messages[0].date,requiresReview:true};
}

function summarizeWhatsAppExport(parsed,{citizenSender,transcripts={}}={}){
  if(typeof citizenSender!=="string"||!citizenSender.trim())throw new Error("حدد مرسل الشكوى قبل إنشاء الملخص");
  const items=parsed.messages.filter(m=>m.sender===citizenSender);
  if(!items.length)throw new Error("المرسل غير موجود");
  const evidence=items.flatMap(m=>{
    if(m.audio||m.mediaOmitted||m.attachmentName){
      const t=Object.hasOwn(transcripts,m.id)?transcripts[m.id]:null;
      return m.audio&&typeof t==="string"&&t.trim()?[{id:m.id,text:t.trim(),source:"transcript"}]:[];
    }
    return m.text.trim()?[{id:m.id,text:m.text.trim(),source:"message"}]:[];
  });
  const all=evidence.map(e=>e.text).join("\n");
  const type=/شكوى|أشتكي|اشتكي|تظلم/.test(all)?"complaint":/استفسار|استعلم|استعلام|هل يمكن|متى/.test(all)?"inquiry":null;
  const relevant=evidence.filter(e=>! /^(?:السلام عليكم|مرحبا|شكرا|شكراً|وعليكم السلام)[\s!.،]*$/.test(e.text));
  const extracts=(relevant.length?relevant:evidence).slice(0,5).map(e=>({...e,text:e.text.slice(0,500)}));
  const phone=/^\+?[\d٠-٩۰-۹][\d٠-٩۰-۹ ()-]{6,25}$/.test(citizenSender)?citizenSender:null;
  return {suggestedType:type,phone,firstVisibleDate:items[0].date,summary:extracts.map(e=>e.text).join("\n"),evidence:extracts,untranscribedAudio:items.filter(m=>m.audio&&!(Object.hasOwn(transcripts,m.id)&&typeof transcripts[m.id]==="string"&&transcripts[m.id].trim())).map(m=>m.id),omittedMedia:items.filter(m=>m.mediaOmitted).map(m=>m.id),requiresReview:true};
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseWhatsAppExport, summarizeWhatsAppExport };
}
