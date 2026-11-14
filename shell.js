// shell.js - Lightweight PWA shell & non-destructive Service Worker update listener
(function() {
  var SHELL_VERSION = 'mygym-core-v8.0.1';

  // Active workout check & reload loop guard
  var isWorkoutActive = false;
  try {
    var actData = localStorage.getItem('lift_act') || localStorage.getItem('act');
    if (actData && actData !== 'null' && JSON.parse(actData)) isWorkoutActive = true;
  } catch(_) {}

  var reloadAttempts = 0;
  try { reloadAttempts = parseInt(sessionStorage.getItem('mygym_reload_attempts') || '0', 10); } catch(_) {}

  // Safe manual reload helper
  window.__reloadApp = function() {
    window.location.href = window.location.origin + window.location.pathname + '?t=' + Date.now();
  };

  // Immediate Cache Purge & Force Upgrade on Shell Version Mismatch
  var cachedVersion = null;
  try { cachedVersion = localStorage.getItem('mygym_shell_version'); } catch(_) {}

  if (cachedVersion !== SHELL_VERSION) {
    try { localStorage.setItem('mygym_shell_version', SHELL_VERSION); } catch(_) {}
    if ('caches' in window) {
      caches.keys().then(function(keys) {
        return Promise.all(
          keys.filter(function(k) {
            return k.startsWith('mygym-core-') && k !== SHELL_VERSION;
          }).map(function(k) {
            return caches.delete(k);
          })
        );
      }).catch(function() {});
    }

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then(function(regs) {
        regs.forEach(function(r) { try { r.update(); } catch(_) {} });
      }).catch(function() {});
    }

    if (!isWorkoutActive && reloadAttempts < 2) {
      try { sessionStorage.setItem('mygym_reload_attempts', String(reloadAttempts + 1)); } catch(_) {}
      window.location.href = window.location.origin + window.location.pathname + '?t=' + Date.now();
    }
  } else {
    try { sessionStorage.removeItem('mygym_reload_attempts'); } catch(_) {}
  }

  // Service Worker update listener: notify user non-destructively without wiping caches
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('controllerchange', function() {
      if (!isWorkoutActive) {
        if (typeof window.toast === 'function') {
          window.toast('Update ready — tap to reload', 6000);
        }
      }
    });
  }
})();
