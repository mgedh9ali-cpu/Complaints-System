'use strict';

// Called only by --release-smoke on its fresh synthetic user-data profile.
// Exercise the same DOM controls as the operator; the UI's private module stays private.
async function verifyWorkflow(webContents, credentials) {
  async function exercise({ username, password }) {
    let stage = 'login';
    const assert = condition => { if (!condition) throw new Error('Packaged UI workflow failed: ' + stage); };
    const find = selector => document.querySelector(selector);
    const click = selector => { const button=find(selector);assert(button&&!button.disabled);button.click(); };
    const fill = (selector,value) => { const input=find(selector);assert(input);input.value=value;input.dispatchEvent(new Event('input',{bubbles:true})); };
    const until = async check => {
      const deadline=Date.now()+15000;
      while(!(await check())){
        assert(Date.now()<deadline);
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

    stage = 'referral';
    click('[data-action="referral-create"]');
    await until(()=>find('#rEntity'));
    fill('#rEntity',find('#rEntity option[value]:not([value=""])').value);
    fill('#rNote','إحالة اصطناعية');
    click('[data-action="save-referral"]');
    await until(async()=>((await records()).find(c=>c.id===id)?.referrals||[]).length===1);
    await until(()=>!find('#modalRoot').dataset.open&&find('[data-action="referral-response"]'));

    stage = 'queue';
    click('.nav-link[data-page="complaints"]');
    await until(()=>find('#statusFilter'));
    find('#statusFilter').value='closed';find('#statusFilter').dispatchEvent(new Event('change',{bubbles:true}));
    find('#dateFrom').value='2099-01-01';find('#dateFrom').dispatchEvent(new Event('change',{bubbles:true}));
    click('[data-action="filter-record-type"][data-value="inquiry"]');
    click('.nav-link[data-page="dashboard"]');
    await until(()=>find('[data-action="registry-queue"][data-queue="waiting-referrals"]'));
    click('[data-action="registry-queue"][data-queue="waiting-referrals"]');
    await until(()=>find('[data-filter-key="queue"]')&&find('#content').textContent.includes(id));
    assert(find('#statusFilter').value==='all'&&find('#dateFrom').value==='');

    stage = 'referral response';
    click('[data-action="detail"][data-id="'+id+'"]');
    await until(()=>find('[data-action="referral-response"][data-index="0"]'));
    click('[data-action="referral-response"][data-index="0"]');
    await until(()=>find('#referralResponse'));
    fill('#referralResponse','رد جهة اصطناعي');click('[data-action="save-referral-response"]');
    await until(async()=>(await records()).find(c=>c.id===id)?.referrals[0]?.response==='رد جهة اصطناعي');
    await until(()=>!find('#modalRoot').dataset.open&&find('#content').textContent.includes('رد جهة اصطناعي'));

    stage = 'reply';
    assert(!find('#complaint-reply'));
    click('.nav-link[data-page="replies"]');
    await until(()=>find('#content [data-action="new-reply"]'));
    click('#content [data-action="new-reply"]');
    fill('#replyComplaint',id);
    click('[data-action="reply-next"]');
    await until(()=>find('#replyText'));
    fill('#replyText','مسودة رد اصطناعية');click('[data-action="save-reply"]');
    await until(async()=>(await records()).find(c=>c.id===id)?.reply?.status==='draft');
    await until(()=>!find('#modalRoot').dataset.open&&find('#content').textContent.includes('مسودة رد اصطناعية'));
    return {passed:true,checks:['login','intake','search','queue-reset','referral','referral-response','reply-draft']};
  }
  return webContents.executeJavaScript('(' + exercise.toString() + ')(' + JSON.stringify(credentials) + ')');
}

module.exports = { verifyWorkflow };
