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
function track(tipo_evento, extra = {}) {
  const token = siteToken();
  if (!token) return;
  api("track", { token, tipo_evento, ...extra }, { keepalive: true }).catch(() => {});
}
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const $ = (sel, root = document) => root.querySelector(sel);
const fmtDur = (s) => (s >= 60 ? `${Math.floor(s / 60)}m ${Math.round(s % 60)}s` : `${Math.round(s)}s`);
