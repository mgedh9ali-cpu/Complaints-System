'use strict';

// Called only by --release-smoke on its fresh synthetic user-data profile.
async function verifyWorkflow(webContents, credentials) {
  async function exercise({ username, password }) {
    let stage = 'login';
    const assert = (condition) => { if (!condition) throw new Error('Packaged UI workflow failed: ' + stage); };
    document.querySelector('#loginUsername').value = username;
    document.querySelector('#loginPassword').value = password;
    await submitLogin({ preventDefault() {} });
    assert(Boolean(authenticatedUser));

    stage = 'intake';
    newComplaint();
    for (const [id, value] of Object.entries({cName:'بيانات اختبارية',cPhone:'0999999999',cSummary:'اختبار سير العمل للحزمة',cDetails:'سجل اصطناعي لفحص الواجهة فقط'})) {
      document.getElementById(id).value = value;
    }
    document.getElementById('cEntity').value = db.settings.entities[0];
    document.getElementById('cCategory').value = db.settings.categories[0];
    document.getElementById('cProvince').value = db.settings.provinces[0];
    await createComplaint();
    const record = db.complaints.find(c => c.summary === 'اختبار سير العمل للحزمة');
    assert(Boolean(record));
    closeModal();

    stage = 'search';
    openRegistryQueue('all');
    searchText = record.id; render();
    assert(filteredComplaints().length === 1 && document.querySelector('#content').textContent.includes(record.id));

    stage = 'referral';
    detailModal(record.id); newReferral(record.id);
    const entity = document.querySelector('#rEntity'); entity.selectedIndex = 1;
    document.querySelector('#rNote').value = 'إحالة اصطناعية';
    await saveReferral(record.id);
    assert(db.complaints.find(c => c.id === record.id).referrals.length === 1);

    stage = 'queue';
    // A previous search and closed-status filter must not hide this queue.
    searchText = 'unrelated'; statusFilter = 'closed'; dateFrom = '2099-01-01'; recordTypeFilter = 'inquiry';
    openRegistryQueue('waiting-referrals');
    assert(filteredComplaints().some(c => c.id === record.id));
    assert(document.querySelector('#content').querySelector('[data-filter-key="queue"]'));

    stage = 'referral response';
    detailModal(record.id); referralResponseModal(record.id, 0);
    document.querySelector('#referralResponse').value = 'رد جهة اصطناعي';
    await saveReferralResponse(record.id, 0);
    assert(db.complaints.find(c => c.id === record.id).referrals[0].response === 'رد جهة اصطناعي');

    stage = 'reply';
    replyEditor(record.id); document.querySelector('#replyText').value = 'مسودة رد اصطناعية';
    await saveReply(record.id);
    assert(db.complaints.find(c => c.id === record.id).reply.status === 'draft');
    assert(document.querySelector('#complaint-notes') && document.querySelector('#complaint-reply'));
    return {passed: true, checks: ['login','intake','search','queue-reset','referral','referral-response','reply-draft']};
  }
  return webContents.executeJavaScript('(' + exercise.toString() + ')(' + JSON.stringify(credentials) + ')');
}

module.exports = { verifyWorkflow };
