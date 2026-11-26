'use strict';

// Called only by --release-smoke on its fresh synthetic user-data profile.
// Exercise the same DOM controls as the operator; the UI's private module stays private.
async function verifyWorkflow(webContents, credentials) {
  async function exercise({ username, password }) {
    let stage = 'login';
    const assert = (condition, detail='') => { if (!condition) throw new Error('Packaged UI workflow failed: ' + stage + (detail ? ' — ' + detail : '')); };
    const find = selector => document.querySelector(selector);
    const click = selector => { const button=find(selector);assert(button&&!button.disabled&&!button.closest('[hidden]')&&button.getClientRects().length>0,'Control missing, hidden or disabled: '+selector);button.click(); };
    const fill = (selector,value) => { const input=find(selector);assert(input);input.value=value;input.dispatchEvent(new Event('input',{bubbles:true})); };
    const until = async (check, detail='Expected UI state did not appear') => {
      const deadline=Date.now()+15000;
      while(!(await check())){
        assert(Date.now()<deadline,detail);
        await new Promise(resolve=>setTimeout(resolve,100));
      }
    };
    const records = async () => {
      const response=await fetch('/api/state',{credentials:'same-origin',cache:'no-store'});
      assert(response.ok);return (await response.json()).state.complaints;
    };
    await until(()=>find('#loginForm')&&find('#loginForm button[type="submit"]'));
    fill('#loginUsername',username);fill('#loginPassword',password);
    find('#loginForm').requestSubmit();
    await until(()=>document.body.dataset.signedIn==='true'&&find('#loginOverlay').hidden);

    stage = 'intake';
    click('#headerCreateButton');
    await until(()=>find('#newComplaintForm'));
    click('#modalRoot .intake-save-actions [data-action="close-modal"]');
    await until(()=>!find('#modalRoot').dataset.open);
    assert((await records()).length===0);
    click('#headerCreateButton');
    await until(()=>find('#newComplaintForm'));
    click('[data-action="intake-pick-type"][data-type="contact"]');
    find('#intakeAdditional').open=true;
    for (const [id,value] of Object.entries({cName:'بيانات اختبارية',cPhone:'0999999999',cSummary:'اختبار سير العمل للحزمة',cDetails:'سجل اصطناعي لفحص الواجهة فقط'}))fill('#'+id,value);
    fill('#cEntity',find('#intakeEntities option').value);
    fill('#cCategory',find('#intakeCategories option').value);
    fill('#cProvince',find('#cProvince option[value]:not([value=""])').value);
    fill('#cRelatedToCurrent','yes');
    click('[data-action="save-complaint"]');
    await until(()=>find('.intake-saved-id bdi'));
    const id=find('.intake-saved-id bdi').textContent.trim();
    assert((await records()).some(c=>c.id===id&&c.status==='new'&&c.recordType==='contact'&&c.relatedToCurrent==='yes'));
    click('[data-action="close-modal"]');

    stage = 'search';
    click('[data-action="filter-record-type"][data-value="contact"]');
    fill('#complaintSearch',id);
    await until(()=>find('.registry-summary strong')?.textContent==='1'&&find('#content').textContent.includes(id));
    click('[data-action="detail"][data-id="'+id+'"]');
    await until(()=>find('.complaint-page')?.dataset.complaintId===id);

    stage = 'save changes';
    assert(!find('#complaint-actions')&&!find('#complaint-timeline')&&!find('.floating-actions'),'Removed sections must not reappear');
    click('#content [data-action="edit-complaint"]');
    await until(()=>find('#editComplaintForm'));
    fill('#editSummary','اختبار حفظ التعديلات');
    fill('#editProvince','');fill('#editCategory','');fill('#editEntity','');fill('#editDetails','');
    click('#modalRoot [data-action="save-complaint-edit"]');
    await until(async()=>(await records()).some(c=>c.id===id&&c.summary==='اختبار حفظ التعديلات'&&!c.province&&!c.category&&!c.entity&&!c.details),'Save changed subject with optional fields cleared');
    await until(()=>!find('#modalRoot').dataset.open&&find('#content h1')?.textContent==='اختبار حفظ التعديلات');

    stage = 'referral';
    click('[data-action="referral-create"]');
    await until(()=>find('#rEntity'));
    fill('#rEntity',find('#rEntity option[value]:not([value=""])').value);
    fill('#rNote','إحالة اصطناعية');
    click('[data-action="save-referral"]');
    await until(async()=>((await records()).find(c=>c.id===id)?.referrals||[]).length===1);
    await until(()=>!find('#modalRoot').dataset.open&&find('#content [data-action="complaint-more"]'));

    stage = 'queue';
    click('.nav-link[data-page="complaints"]');
    await until(()=>find('#statusFilter'));
    find('#statusFilter').value='closed';find('#statusFilter').dispatchEvent(new Event('change',{bubbles:true}));
    find('#dateFrom').value='2099-01-01';find('#dateFrom').dispatchEvent(new Event('change',{bubbles:true}));
    click('[data-action="filter-record-type"][data-value="inquiry"]');
    // The referral shortcut was deliberately removed from the dashboard. The
    // waiting-record queue is still available as a visible registry filter.
    const waitingQueue='#content [data-action="registry-queue"][data-queue="waiting-referrals"]';
    await until(()=>find(waitingQueue),'Waiting-for-response filter in registry');
    click(waitingQueue);
    await until(()=>find('[data-filter-key="queue"]')&&find('#content').textContent.includes(id));
    assert(find('#statusFilter').value==='all'&&find('#dateFrom').value==='');

    stage = 'referral response';
    click('[data-action="detail"][data-id="'+id+'"]');
    click('#content [data-action="complaint-more"]');
    await until(()=>find('[data-action="open-record-referrals"]'));
    click('[data-action="open-record-referrals"]');
    await until(()=>find('[data-action="referral-response"][data-index="0"]'));
    click('[data-action="referral-response"][data-index="0"]');
    await until(()=>find('#referralResponse'));
    fill('#referralResponse','رد جهة اصطناعي');click('[data-action="save-referral-response"]');
    await until(async()=>(await records()).find(c=>c.id===id)?.referrals[0]?.response==='رد جهة اصطناعي');
    await until(()=>!find('#modalRoot').dataset.open);
    click('#content [data-action="complaint-more"]');
    click('[data-action="open-record-referrals"]');
    await until(()=>find('#modalRoot').textContent.includes('رد جهة اصطناعي'));
    click('#modalRoot .modal-close');

    stage = 'reply';
    assert(!find('#complaint-reply'));
    // The standalone replies navigation entry is hidden by design. Enter the
    // same page through the visible registry approval filter instead.
    click('.nav-link[data-page="complaints"]');
    await until(()=>find('#content [data-goto="replies"]'),'Registry approval filter');
    click('#content [data-goto="replies"]');
    await until(()=>find('#content [data-action="new-reply"]'),'Reply creation action');
    click('#content [data-action="new-reply"]');
    fill('#replyComplaint',id);
    click('[data-action="reply-next"]');
    await until(()=>find('#replyText'));
    fill('#replyText','مسودة رد اصطناعية');click('[data-action="save-reply"]');
    await until(async()=>(await records()).find(c=>c.id===id)?.reply?.status==='draft');
    await until(()=>!find('#modalRoot').dataset.open&&find('#content').textContent.includes('مسودة رد اصطناعية'));
    return {passed:true,checks:['login','intake','search','save-changes','queue-reset','referral','referral-response','reply-draft']};
  }
  return webContents.executeJavaScript('(' + exercise.toString() + ')(' + JSON.stringify(credentials) + ')');
}

module.exports = { verifyWorkflow };
