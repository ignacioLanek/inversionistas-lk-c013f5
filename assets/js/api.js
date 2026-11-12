// Cliente del backend (Apps Script). Se envía como text/plain para evitar preflight CORS.
const LK = window.LANEK;
const store = {
  get: (k, s) => { try { return (s ? sessionStorage : localStorage).getItem(k); } catch { return null; } },
  set: (k, v, s) => { try { (s ? sessionStorage : localStorage).setItem(k, v); } catch {} },
  del: (k, s) => { try { (s ? sessionStorage : localStorage).removeItem(k); } catch {} },
};

async function api(action, data = {}, opts = {}) {
  const res = await fetch(LK.API_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action, ...data }),
    keepalive: !!opts.keepalive,
    redirect: "follow",
  });
  return res.json();
}

const siteToken = () => store.get("lk_site");
/* Seguimiento por lotes: una sola llamada cada ~5 s (o al ocultar/cerrar la pestaña) en vez de una por evento. */
const trackQueue = [];
let trackTimer = null;
function flushTrack() {
  clearTimeout(trackTimer); trackTimer = null;
  const token = siteToken();
  if (!token || !trackQueue.length) return;
  api("track_batch", { token, events: trackQueue.splice(0) }, { keepalive: true }).catch(() => {});
}
function track(tipo_evento, extra = {}) {
  if (!siteToken()) return;
  trackQueue.push({ tipo_evento, ...extra });
  if (!trackTimer) trackTimer = setTimeout(flushTrack, 5000);
}
/* Los cierres de medición (tiempo en sección, etc.) se registran con onHide para que corran ANTES del envío final. */
const hideHooks = [];
const onHide = (fn) => hideHooks.push(fn);
const runHide = () => { hideHooks.forEach((f) => { try { f(); } catch {} }); flushTrack(); };
document.addEventListener("visibilitychange", () => { if (document.hidden) runHide(); });
window.addEventListener("pagehide", runHide);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const $ = (sel, root = document) => root.querySelector(sel);
const fmtDur = (s) => (s >= 60 ? `${Math.floor(s / 60)}m ${Math.round(s % 60)}s` : `${Math.round(s)}s`);
