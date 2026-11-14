// shell.js - Lightweight PWA shell & non-destructive Service Worker update listener
(function() {
  var SHELL_VERSION = 'mygym-core-v7.2.0';
  try { localStorage.setItem('mygym_shell_version', SHELL_VERSION); } catch(_) {}

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
