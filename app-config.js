/* AirRO Water — runtime config.
   Auto-detects where the backend API lives so the SAME files work both on your
   computer (local dev) and on the VPS (production), with no edits needed:

   - Local dev  (opened at http://localhost:8765): talks to the API on :4000.
   - Production (opened at https://yourdomain.com): talks to the API on the
     SAME domain under /api/v1 (Nginx proxies it to the Node backend).

   To force a specific API URL, set window.AIRRO_API_BASE before this file runs. */
(function () {
  if (window.AIRRO_API_BASE) return;                       // explicit override wins
  var host = location.hostname;
  var isLocal = host === 'localhost' || host === '127.0.0.1' || host === '';
  window.AIRRO_API_BASE = isLocal
    ? 'http://localhost:4000/api/v1'                        // local dev backend
    : location.origin + '/api/v1';                         // same-origin in production
})();
