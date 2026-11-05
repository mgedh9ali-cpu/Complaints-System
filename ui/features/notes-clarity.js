/** Clarify internal notes vs external reply on detail page. */
(function(){
  function enhance(){
    if(typeof complaintDetailPage !== 'function') return false;
    if(complaintDetailPage.__notesClarity) return true;
    const orig = complaintDetailPage;
    function wrapped(){
      let html = orig.apply(this, arguments);
      if(typeof html !== 'string') return html;
      html = html.replace(
        '<h3>الملاحظات الداخلية</h3>',
        '<h3>الملاحظات الداخلية <span class="pill" style="font-size:10px;background:#f3e8d0;color:#5c4a1e;border:1px solid #d9c48a">للفريق فقط — ليست ردًا للمشتكي</span></h3>'
      );
      html = html.replace(
        '<h3>الرد الخارجي</h3>',
        '<h3>الرد الخارجي <span class="pill" style="font-size:10px;background:#e8f0fa;color:#1e4a7a;border:1px solid #b7c9e0">يُرسل للمشتكي بعد الاعتماد</span></h3>'
      );
      return html;
    }
    wrapped.__notesClarity = true;
    if(orig.__nextStepWrapped) wrapped.__nextStepWrapped = true;
    complaintDetailPage = wrapped;
    return true;
  }
  if(!enhance()){
    document.addEventListener('DOMContentLoaded', enhance);
    setTimeout(enhance, 0);
    setTimeout(enhance, 80);
  }
})();
