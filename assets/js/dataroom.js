/* Flujo 3: data room (OTP por correo + navegador de Drive + visor PDF sin descarga directa) */
const DataRoom = (() => {
  let root, email = "", opts = {};
  const drToken = () => store.get("lk_dr", true);
  const post = (a, d) => api(a, { token: drToken(), ...d });

  function view(html) { root.innerHTML = html; }

  const authed = () => (opts.onAuthed ? opts.onAuthed() : browser());
  async function init(el, defaultEmail, options = {}) {
    root = el; email = defaultEmail; opts = options;
    if (drToken()) return authed(); // la validez se comprueba en la primera llamada real (evita un viaje extra de ~2 s)
    if (opts.onNoAuth) return opts.onNoAuth();
    stepEmail();
  }

  function stepEmail(msg = "") {
    view(`<form id="f"><p class="muted">Te enviaremos un código de 6 dígitos al correo autorizado.</p>
      <input type="email" id="e" required value="${esc(email)}" placeholder="tu@correo.com" />
      <p class="err">${esc(msg)}</p><button class="btn">Enviar código</button></form>`);
    $("#f", root).onsubmit = async (ev) => {
      ev.preventDefault();
      email = $("#e", root).value.trim().toLowerCase();
      setBusy($("button", root), true, "Enviando código…");
      const r = await api("dr_otp_send", { email }).catch(() => ({ error: "Error de conexión" }));
      if (r.error) return stepEmail(r.error);
      if (r.status === "sent") return stepOtp(r.devCode);
      r.requested ? view("<p>Tu solicitud ya está registrada. Un administrador la revisará y te avisaremos cuando esté aprobada.</p>") : stepRequest();
    };
  }

  function stepRequest() {
    view(`<form id="f"><p>Este correo aún no tiene acceso al data room. Solicítalo y un administrador lo revisará.</p>
      <input value="${esc(email)}" readonly /><input id="n" required placeholder="Nombre" /><input id="c" placeholder="Empresa" />
      <p class="err" id="er"></p><button class="btn">Solicitar acceso</button></form>`);
    $("#f", root).onsubmit = async (ev) => {
      ev.preventDefault();
      setBusy($("button", root), true, "Enviando…");
      const r = await api("dr_request", { email, nombre: $("#n", root).value, empresa: $("#c", root).value }).catch(() => ({ error: "Error de conexión" }));
      setBusy($("button", root), false);
      r.error ? ($("#er", root).textContent = r.error) : view("<p>Tu solicitud está registrada. Un administrador la revisará y te avisaremos cuando esté aprobada.</p>");
    };
  }

  function stepOtp(devCode) {
    view(`<form id="f"><p>Enviamos un código a <b>${esc(email)}</b>. Vence en 10 minutos.</p>
      ${devCode ? `<p class="muted">[modo desarrollo] código: <b>${esc(devCode)}</b></p>` : ""}
      <input id="o" class="otp" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="\\d{6}" required placeholder="000000" />
      <p class="err" id="er"></p>
      <div class="row"><button class="btn">Entrar</button><button type="button" id="re" class="btn btn-ghost">Reenviar</button></div></form>`);
    $("#o", root).focus();
    $("#re", root).onclick = () => stepEmail();
    $("#f", root).onsubmit = async (ev) => {
      ev.preventDefault();
      setBusy($("button", root), true, "Verificando…");
      const r = await api("dr_otp_verify", { email, code: $("#o", root).value }).catch(() => ({ error: "Error de conexión" }));
      if (r.error) { setBusy($("button", root), false); return ($("#er", root).textContent = r.error); }
      store.set("lk_dr", r.token, true);
      view(loaderHTML("Entrando al data room…"));
      authed();
    };
  }

  /* ── navegador: el árbol completo llega en UNA llamada y se navega/busca localmente ── */
  let tree = null, rootId = "", byParent = {}, byId = {}, folder = "", q = "", timer;
  function expired() { store.del("lk_dr", true); if (opts.onNoAuth) return opts.onNoAuth(); stepEmail("Tu sesión expiró. Solicita un nuevo código."); }

  function browser() {
    view(`<div class="row" style="justify-content:space-between;align-items:center;gap:.6rem"><input type="search" id="q" class="search" placeholder="Buscar documentos…" style="flex:1;margin:0" />
      <button type="button" id="rf" class="pill" title="Volver a leer Drive">Actualizar</button></div>
      <nav id="crumbs" class="crumbs"></nav><p id="er" class="err"></p><ul id="files" class="files"></ul>`);
    $("#q", root).oninput = (e) => { q = e.target.value; clearTimeout(timer); timer = setTimeout(render, 120); };
    $("#rf", root).onclick = () => loadTree(true);
    folder = ""; q = "";
    loadPdfJs().catch(() => {}); // precarga el visor mientras el usuario navega
    loadTree(false);
  }

  async function loadTree(refresh) {
    const list = $("#files", root);
    list.innerHTML = `<li>${loaderHTML(refresh ? "Actualizando documentos…" : "Cargando documentos…")}</li>`;
    const stop = slowHint(list);
    const r = await post("dr_tree", { refresh: !!refresh }).catch(() => ({ error: "Error de conexión" }));
    stop();
    if (r.auth) return expired();
    if (r.error) { list.innerHTML = ""; return ($("#er", root).textContent = r.error); }
    $("#er", root).textContent = "";
    tree = r.items; rootId = r.rootId; byParent = {}; byId = {};
    tree.forEach((n) => { byId[n.id] = n; (byParent[n.parent] = byParent[n.parent] || []).push(n); });
    render();
  }

  const sortItems = (a) => a.slice().sort((x, y) => (y.isFolder - x.isFolder) || x.name.localeCompare(y.name, "es", { numeric: true }));
  function render() {
    if (!tree) return;
    const list = $("#files", root), term = q.trim().toLowerCase();
    const cur = folder || rootId;
    const crumbs = [];
    for (let id = cur, n = 0; id && n < 15; n++) {
      if (id === rootId) { crumbs.unshift({ id: "", name: "Data room" }); break; }
      const f = byId[id]; if (!f) break;
      crumbs.unshift({ id, name: f.name }); id = f.parent;
    }
    const items = term.length >= 2
      ? sortItems(tree.filter((n) => n.name.toLowerCase().includes(term))).slice(0, 100)
      : sortItems(byParent[cur] || []);
    $("#crumbs", root).innerHTML = term.length >= 2 ? "" : crumbs.map((c, i) => `${i ? " / " : ""}<button class="linklike" data-id="${esc(c.id)}">${esc(c.name)}</button>`).join("");
    $("#crumbs", root).querySelectorAll("button").forEach((b) => (b.onclick = () => { folder = b.dataset.id; render(); }));
    list.innerHTML = items.length ? items.map((it) => `
      <li><button data-id="${esc(it.id)}" data-folder="${it.isFolder}">
        <span class="ico">${it.isFolder ? "📁" : it.mime === "application/pdf" ? "📄" : "📎"}</span>
        <span class="fname">${esc(it.name)}${term.length >= 2 && it.path ? `<small>${esc(it.path)}</small>` : ""}</span>
        <span class="muted">${it.size ? (it.size > 1e6 ? (it.size / 1e6).toFixed(1) + " MB" : Math.max(1, Math.round(it.size / 1e3)) + " KB") : ""}</span>
      </button></li>`).join("") : '<li class="muted">Sin resultados</li>';
    list.querySelectorAll("button").forEach((b) => (b.onclick = () => {
      if (b.dataset.folder === "true") { folder = b.dataset.id; $("#q", root).value = ""; q = ""; render(); }
      else openDoc(b.dataset.id);
    }));
  }

  /* ── visor ── */
  const b64ToBytes = (b64) => { const s = atob(b64), n = s.length, u = new Uint8Array(n); for (let i = 0; i < n; i++) u[i] = s.charCodeAt(i); return u; };
  const CHUNK = 700000; // debe coincidir con DR_CHUNK del servidor
  /* Trae el archivo. Si es grande, lo pide en tramos paralelos (mucho más rápido que un único bloque) y informa el avance. */
  async function fetchDoc(id, mode, onProgress) {
    const it = byId[id], size = it ? it.size : 0, native = it && it.mime.indexOf("application/vnd.google-apps") === 0;
    const whole = async () => { const r = await post("dr_open", { id, mode }); if (r.data) r.bytes = b64ToBytes(r.data); return r; };
    if (native || !size || size <= CHUNK) return whole();
    const n = Math.ceil(size / CHUNK), parts = new Array(n);
    let next = 0, done = 0, fail = null, meta = null;
    const one = async (i) => {
      for (let k = 0; k < 3; k++) {
        const r = await post("dr_open", { id, mode, part: i }).catch(() => ({ error: "Error de conexión" }));
        if (r.auth || (r.error && r.error !== "Error de conexión")) return r;
        if (!r.error) return r;
      }
      return { error: "Error de conexión" };
    };
    const worker = async () => {
      while (!fail) {
        const i = next++; if (i >= n) return;
        const r = await one(i);
        if (r.auth || r.error) { fail = r; return; }
        parts[i] = b64ToBytes(r.data); if (i === 0) meta = r;
        onProgress && onProgress(++done, n);
      }
    };
    await Promise.all(Array.from({ length: Math.min(12, n) }, worker));
    if (fail) return fail;
    const total = parts.reduce((a, p) => a + p.length, 0);
    if (meta.total && meta.total !== total) return whole(); // el archivo cambió desde el último índice
    const bytes = new Uint8Array(total); let o = 0;
    parts.forEach((p) => { bytes.set(p, o); o += p.length; });
    return { name: meta.name, mime: meta.mime, eventoId: meta.eventoId, bytes };
  }
  let pdfjsReady;
  function loadPdfJs() {
    pdfjsReady = pdfjsReady || new Promise((ok, ko) => {
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
      s.onload = () => { pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js"; ok(); };
      s.onerror = ko;
      document.head.appendChild(s);
    });
    return pdfjsReady;
  }

  async function openDoc(id) {
    const modal = document.createElement("div");
    modal.className = "modal";
    modal.innerHTML = '<div class="modalbar"><b>Abriendo documento…</b><span><span class="stat" id="st"></span> <button class="pill" id="dl" disabled>Descargar</button><button class="pill" id="cl">Cerrar ✕</button></span></div><div class="viewer" id="vw"><div class="center-msg" id="ld">' + loaderHTML("Descargando documento…", true) + '</div></div>';
    document.body.appendChild(modal);
    document.body.style.overflow = "hidden";
    const t0 = Date.now();
    let eventoId = null, blobUrl = null, doc = null;
    const close = () => {
      if (eventoId) api("track_dur", { token: drToken(), id: eventoId, duracion_segundos: (Date.now() - t0) / 1000 }, { keepalive: true }).catch(() => {});
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      modal.remove(); document.body.style.overflow = "";
      window.removeEventListener("pagehide", close);
    };
    $("#cl", modal).onclick = close;
    window.addEventListener("pagehide", close);

    const ld = $("#ld", modal), stopHint = slowHint(ld, 8000), small = !(byId[id] && byId[id].size > CHUNK);
    if (small) ld.querySelector(".bar").classList.remove("det");
    const r = await fetchDoc(id, "view", (d, n) => setProgress(ld, (d / n) * 100, `Descargando documento… ${Math.round((d / n) * 100)} %`)).catch(() => ({ error: "Error de conexión" }));
    stopHint();
    if (r.auth) { close(); return expired(); }
    const vw = $("#vw", modal);
    if (r.error) { vw.innerHTML = `<p class="err center-msg">${esc(r.error)}</p>`; return; }
    eventoId = r.eventoId;
    $("b", modal).textContent = r.name;
    const bytes = r.bytes;
    blobUrl = URL.createObjectURL(new Blob([bytes], { type: r.mime }));
    doc = { name: r.name, mime: r.mime };

    $("#dl", modal).disabled = false;
    $("#dl", modal).onclick = async () => {
      const btn = $("#dl", modal); setBusy(btn, true, "Descargando…");
      const d = await fetchDoc(id, "download").catch(() => ({ error: "Error de conexión" }));
      setBusy(btn, false);
      if (d.error) return alert(d.error);
      const u = URL.createObjectURL(new Blob([d.bytes], { type: d.mime }));
      const a = Object.assign(document.createElement("a"), { href: u, download: d.name });
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 5000);
    };

    if (r.mime === "application/pdf") {
      try {
        vw.innerHTML = '<div class="center-msg">' + loaderHTML("Preparando documento…") + "</div>";
        await loadPdfJs();
        const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
        vw.innerHTML = "";
        const st = $("#st", modal);
        const w = Math.min(vw.clientWidth - 16, 900), dpr = Math.min(window.devicePixelRatio || 1, 2);
        for (let n = 1; n <= pdf.numPages; n++) {
          const page = await pdf.getPage(n);
          const base = page.getViewport({ scale: 1 });
          const vp = page.getViewport({ scale: (w / base.width) * dpr });
          const c = document.createElement("canvas");
          c.width = vp.width; c.height = vp.height; c.style.width = w + "px";
          vw.appendChild(c);
          await page.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
          if (st) st.textContent = n < pdf.numPages ? `Página ${n} de ${pdf.numPages}…` : "";
        }
      } catch { vw.innerHTML = '<p class="err center-msg">No se pudo mostrar el PDF. Usa «Descargar».</p>'; }
    } else if (r.mime.startsWith("image/")) {
      vw.innerHTML = `<img src="${blobUrl}" alt="${esc(r.name)}" style="max-width:100%;margin:auto" />`;
    } else {
      vw.innerHTML = '<p class="muted center-msg">Sin vista previa para este tipo de archivo. Usa «Descargar».</p>';
    }
  }

  return { init };
})();
