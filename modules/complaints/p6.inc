ent);
    complaint.status=undo.from;complaint.updated=now;
    complaint.timeline.unshift({event:'تراجع عن تغيير الحالة',by:username||'system',at:now,detail:'أعيدت الحالة إلى '+undo.from});
    statusUndos.delete(complaintId);
    const nextRevision=(Number(revision)||0)+1;
    persistState(state,userId,now,nextRevision,[{action:'complaint_status_undo',id:complaintId,details:{to:undo.from}}]);
    return {ok:true,complaint,revision:nextRevision};
  }

  function addReferral({complaintId,body,userId,username}){
    const {state,revision}=readState();
    const idx=findIndex(state,complaintId);
    if(idx<0)return {ok:false,status:404,error:'الشكوى غير موجودة.'};
    const complaint={...state.complaints[idx]};
    const now=new Date().toISOString();
    const referral={entity:body.entity||'',note:body.note||'',sent:now,due:body.due||null,response:null,by:username||null};
    complaint.referrals=[...(complaint.referrals||[]),referral];
    complaint.updated=now;
    complaint.timeline.unshift({event:'إحالة',by:username||'system',at:now,detail:referral.entity});
    state.complaints[idx]=complaint;
    const nextRevision=(Number(revision)||0)+1;
    persistState(state,userId,now,nextRevision,[{action:'complaint_referral_added',id:complaintId,details:{entity:referral.entity}}]);
    return {ok:true,complaint,revision:nextRevision};
  }

  function recordReferralResponse({complaintId,index,response,userId,username}){
    const {state,revision}=readState();
    const idx=findIndex(state,complaintId);
    if(idx<0)return {ok:false,status:404,error:'الشكوى غير موجودة.'};
    const complaint={...state.complaints[idx]};
    if(!complaint.referrals||!complaint.referrals[index])return {ok:false,status:404,error:'الإحالة غير موجودة.'};
    const now=new Date().toISOString();
    complaint.referrals=complaint.referrals.slice();
    complaint.referrals[index]={...complaint.referrals[index],response:response||'',respondedAt:now,respondedBy:username||null};
    complaint.updated=now;
    complaint.timeline.unshift({event:'رد جهة',by:username||'system',at:now,detail:complaint.referrals[index].entity});
    state.complaints[idx]=complaint;
    const nextRevision=(Number(revision)||0)+1;
    persistState(state,userId,now,nextRevision,[{action:'complaint_referral_response',id:complaintId,details:{index}}]);
    return {ok:true,complaint,revision:nextRevision};
  }

  function linkDuplicate({complaintId,originalId,userId,username}){
    const {state,revision}=readState();
    const idx=findIndex(state,complaintId);
    if(idx<0)return {ok:false,status:404,error:'الشكوى غير موجودة.'};
    const complaint={...state.complaints[idx]};
    const now=new Date().toISOString();
    complaint.duplicateOf=originalId;
    complaint.updated=now;
    complaint.timeline.unshift({event:'ربط كمكررة',by:username||'system',at:now,detail:originalId});
    state.complaints[idx]=complaint;
    const nextRevision=(Number(revision)||0)+1;
    persistState(state,userId,now,nextRevision,[{action:'complaint_linked_duplicate',id:complaintId,details:{originalId}}]);
    return {ok:true,complaint,revision:nextRevision};
  }

  function actOnReply({complaintId,action,body,userId,username}){
    const {state,revision}=readState();
    const idx=findIndex(state,complaintId);
    if(idx<0)return {ok:false,status:404,error:'الشكوى غير موجودة.'};
    const complaint={...state.complaints[idx]};
    const now=new Date().toISOString();
    complaint.reply=complaint.reply?{...complaint.reply}:{};
    if(action==='draft'||action==='save'){
      complaint.reply.text=body?.text||complaint.reply.text||'';
      complaint.reply.status='draft';
      complaint.reply.updatedAt=now;
    } else if(action==='review'){
      complaint.reply.status='review';
    } else if(action==='approve'){
      complaint.reply.status='approved';
      complaint.reply.approvedAt=now;
      complaint.reply.approvedBy=username||null;
    } else if(action==='sent'){
      complaint.reply.status='sent';
      complaint.reply.sentAt=now;
    }
    complaint.updated=now;
    complaint.timeline.unshift({event:'رد: '+action,by:username||'system',at:now,detail:''});
    state.complaints[idx]=complaint;
    const nextRevision=(Number(revision)||0)+1;
    persistState(state,userId,now,nextRevision,[{action:'complaint_reply_'+action,id:complaintId}]);
    return {ok:true,complaint,revision:nextRevision};
  }

  function runReminders({admin}){
    const {state,revision}=readState();
    const now=new Date();
    const events=[];
    for(const c of state.complaints||[]){
      if(!c||c.archivedAt||['closed','cancelled','draft'].includes(c.status))continue;
      const due=c.due?new Date(c.due):null;
      let kind=null;
      if(due && now>due && !c.lastEscalationAt) kind='escalation';
      else if(isIncomplete(c) && !c.completionReminderStopped && !c.lastCompletionReminderAt) kind='completion';
      if(!kind)continue;
      if(kind==='completion')c.lastCompletionReminderAt=now.toISOString();
      if(kind==='escalation')c.lastEscalationAt=now.toISOString();
      state.notifications.unshift({id:Date.now()+Math.random(),title:kind==='escalation'?'تصعيد مهلة':'تذكير استكمال',
          body: c.id, date: now.toISOString(), read: false, targetRole: kind === 'escalation' ? 'admin' : null });
        events.push({ action: kind === 'completion' ? 'completion_reminded' : 'complaint_escalated', id: c.id,
          details: { at: now.toISOString(), targetRole: kind === 'escalation' ? 'admin' : null } });
      }
    }
    if (events.length) persistState(state, admin.id, now.toISOString(), revision + 1, events);
    return events.length;
  }

  return {
    readState,
    saveState,
    createComplaint,
    updateComplaint,
    deleteComplaint,
    archiveComplaint,
    changeStatus,
    undoStatus,
    addReferral,
    recordReferralResponse,
    linkDuplicate,
    actOnReply,
    runReminders,
    ALLOWED_TRANSITIONS,
    REASON_REQUIRED,
    STATUS_LABELS
  };
}

module.exports = { createComplaintsService, ALLOWED_TRANSITIONS, REASON_REQUIRED };
