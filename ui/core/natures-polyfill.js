/* natures + filter polyfill */
(function () {
  try {
    if (typeof categoryFilter === 'undefined') {
      window.categoryFilter = 'all';
    }
  } catch (e) {
    var categoryFilter = 'all';
  }
  try {
    if (typeof natureFilter === 'undefined') {
      window.natureFilter = 'all';
    }
  } catch (e2) {
    var natureFilter = 'all';
  }
  // Ensure seed and runtime settings include natures defaults
  var DEFAULT_NATURES = ['سوق معاملة', 'عصبية', 'إهمال خدمة', 'تأخير معاملة', 'سوء معاملة', 'استفسار', 'أخرى'];
  function ensureNatures() {
    try {
      if (typeof seed !== 'undefined' && seed.settings && !Array.isArray(seed.settings.natures)) {
        seed.settings.natures = DEFAULT_NATURES.slice();
        seed.settings.natureDescriptions = seed.settings.natureDescriptions || {};
      }
      if (typeof db !== 'undefined' && db.settings) {
        if (!Array.isArray(db.settings.natures) || !db.settings.natures.length) {
          db.settings.natures = DEFAULT_NATURES.slice();
        }
        db.settings.natureDescriptions = db.settings.natureDescriptions || {};
      }
    } catch (err) {}
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureNatures);
  } else {
    ensureNatures();
  }
  setTimeout(ensureNatures, 0);
  setTimeout(ensureNatures, 500);
})();
