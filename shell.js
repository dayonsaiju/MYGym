// shell.js - Self-healing force cache clear & auto-reload for iOS Safari PWA
(function() {
  var SHELL_VERSION = 'mygym-core-v7.0.0';
  var cachedVersion = null;
  try { cachedVersion = localStorage.getItem('mygym_shell_version'); } catch(_) {}
  if (cachedVersion !== SHELL_VERSION) {
    // Active workout reload guard: never reload while workout is in progress
    var isWorkoutActive = false;
    try {
      var actData = localStorage.getItem('lift_act') || localStorage.getItem('act');
      if (actData && actData !== 'null' && JSON.parse(actData)) isWorkoutActive = true;
    } catch(_) {}
    if (isWorkoutActive) return;

    // Anti-reload loop protection using sessionStorage
    var reloadAttempts = 0;
    try { reloadAttempts = parseInt(sessionStorage.getItem('mygym_reload_attempts') || '0', 10); } catch(_) {}
    if (reloadAttempts >= 1) {
      try { sessionStorage.removeItem('mygym_reload_attempts'); } catch(_) {}
      try { localStorage.setItem('mygym_shell_version', SHELL_VERSION); } catch(_) {}
      return;
    }
    try { sessionStorage.setItem('mygym_reload_attempts', String(reloadAttempts + 1)); } catch(_) {}

    if ('caches' in window) {
      caches.keys().then(function(keys) {
        return Promise.all(keys.map(function(k) { return caches.delete(k); }));
      }).then(function() {
        try { localStorage.setItem('mygym_shell_version', SHELL_VERSION); } catch(_) {}
        if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
          navigator.serviceWorker.getRegistrations().then(function(regs) {
            for (var i = 0; i < regs.length; i++) {
              regs[i].unregister();
            }
          });
        }
        if (cachedVersion) {
          window.location.href = window.location.origin + window.location.pathname + '?t=' + Date.now();
        }
      }).catch(function() {
        try { localStorage.setItem('mygym_shell_version', SHELL_VERSION); } catch(_) {}
      });
    } else {
      try { localStorage.setItem('mygym_shell_version', SHELL_VERSION); } catch(_) {}
    }
  } else {
    try { sessionStorage.removeItem('mygym_reload_attempts'); } catch(_) {}
  }
})();
