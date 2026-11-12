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

/* ── Indicadores de carga: giro + barra (indeterminada o con avance) y aviso si se demora ── */
const loaderHTML = (msg, det) => `<div class="loader" role="status" aria-live="polite"><span class="spin" aria-hidden="true"></span><p class="lmsg">${esc(msg)}</p><div class="bar${det ? " det" : ""}" aria-hidden="true"><i></i></div><p class="muted lslow" hidden>Sigue cargando, puede tardar unos segundos más…</p></div>`;
function slowHint(el, ms = 6000) { const t = setTimeout(() => { const s = el.querySelector(".lslow"); if (s) s.hidden = false; }, ms); return () => clearTimeout(t); }
function setProgress(el, pct, msg) { const i = el.querySelector(".bar i"), m = el.querySelector(".lmsg"); if (i) i.style.width = Math.max(4, Math.min(100, pct)) + "%"; if (m && msg) m.textContent = msg; }
/* Botón ocupado: deshabilitado + giro + texto de estado; al terminar vuelve a su texto original. */
function setBusy(btn, on, label) {
  if (!btn) return;
  if (on) { btn.dataset.txt = btn.dataset.txt || btn.textContent; btn.disabled = true; btn.classList.add("busy"); if (label) btn.textContent = label; }
  else { btn.disabled = false; btn.classList.remove("busy"); if (btn.dataset.txt) { btn.textContent = btn.dataset.txt; delete btn.dataset.txt; } }
}
