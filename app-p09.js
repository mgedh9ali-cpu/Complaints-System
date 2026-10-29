api('/api/auth/me').then(async result=>{authenticatedUser=result.user;const stored=await api('/api/state');db=stored.state||cleanState();stateRevision=Number.isSafeInteger(stored.revision)?stored.revision:0;stateConflict=false;stateLoaded=true;updateSignedInUi();render();refreshManagedUsers();}).catch(()=>{showLogin();});
})();
