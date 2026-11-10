/* Flujo 3: data room (OTP por correo + navegador de Drive + visor PDF sin descarga directa) */
const DataRoom = (() => {
  let root, email = "";
  const drToken = () => store.get("lk_dr", true);
  const post = (a, d) => api(a, { token: drToken(), ...d });

  function view(html) { root.innerHTML = html; }

  async function init(el, defaultEmail) {
    root = el; email = defaultEmail;
    if (drToken()) {
      const s = await api("dr_session", { token: drToken() }).catch(() => ({}));
      if (s.authed) return browser();
      store.del("lk_dr", true);
    }
    stepEmail();
  }

  function stepEmail(msg = "") {
    view(`<form id="f"><p class="muted">Te enviaremos un código de 6 dígitos al correo autorizado.</p>
      <input type="email" id="e" required value="${esc(email)}" placeholder="tu@correo.com" />
      <p class="err">${esc(msg)}</p><button class="btn">Enviar código</button></form>`);
    $("#f", root).onsubmit = async (ev) => {
      ev.preventDefault();
      email = $("#e", root).value.trim().toLowerCase();
      const btn = $("button", root); btn.disabled = true;
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
      const r = await api("dr_request", { email, nombre: $("#n", root).value, empresa: $("#c", root).value });
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
      const r = await api("dr_otp_verify", { email, code: $("#o", root).value });
      if (r.error) return ($("#er", root).textContent = r.error);
      store.set("lk_dr", r.token, true);
      browser();
    };
  }

  /* ── navegador ── */
  let folder = "", q = "", timer;
  function expired() { store.del("lk_dr", true); stepEmail("Tu sesión expiró. Solicita un nuevo código."); }

  function browser() {
    view(`<input type="search" id="q" class="search" placeholder="Buscar documentos…" />
      <nav id="crumbs" class="crumbs"></nav><p id="er" class="err"></p><ul id="files" class="files"></ul>`);
    $("#q", root).oninput = (e) => { q = e.target.value; clearTimeout(timer); timer = setTimeout(load, 300); };
    folder = ""; q = "";
    load();
  }

  async function load() {
    const list = $("#files", root);
    list.innerHTML = '<li class="muted">Cargando…</li>';
    const r = await post("dr_list", { folder, q: q.trim().length >= 2 ? q.trim() : "" }).catch(() => ({ error: "Error de conexión" }));
    if (r.auth) return expired();
    if (r.error) return ($("#er", root).textContent = r.error);
    $("#crumbs", root).innerHTML = (r.breadcrumb || []).map((c, i) => `${i ? " / " : ""}<button class="linklike" data-id="${i ? esc(c.id) : ""}">${esc(c.name)}</button>`).join("");
    $("#crumbs", root).querySelectorAll("button").forEach((b) => (b.onclick = () => { folder = b.dataset.id; $("#q", root).value = ""; q = ""; load(); }));
    list.innerHTML = r.items.length ? r.items.map((it) => `
      <li><button data-id="${esc(it.id)}" data-folder="${it.isFolder}">
        <span class="ico">${it.isFolder ? "📁" : it.mime === "application/pdf" ? "📄" : "📎"}</span>
        <span class="fname">${esc(it.name)}${it.path ? `<small>${esc(it.path)}</small>` : ""}</span>
        <span class="muted">${it.size ? (it.size > 1e6 ? (it.size / 1e6).toFixed(1) + " MB" : Math.max(1, Math.round(it.size / 1e3)) + " KB") : ""}</span>
      </button></li>`).join("") : '<li class="muted">Sin resultados</li>';
    list.querySelectorAll("button").forEach((b) => (b.onclick = () => {
      if (b.dataset.folder === "true") { folder = b.dataset.id; $("#q", root).value = ""; q = ""; load(); }
      else openDoc(b.dataset.id);
    }));
  }

  /* ── visor ── */
  const b64ToBytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
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
    modal.innerHTML = '<div class="modalbar"><b>Cargando…</b><span><button class="pill" id="dl" disabled>Descargar</button><button class="pill" id="cl">Cerrar ✕</button></span></div><div class="viewer" id="vw"><p class="muted center-msg">Cargando documento…</p></div>';
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

    const r = await post("dr_open", { id }).catch(() => ({ error: "Error de conexión" }));
    if (r.auth) { close(); return expired(); }
    const vw = $("#vw", modal);
    if (r.error) { vw.innerHTML = `<p class="err center-msg">${esc(r.error)}</p>`; return; }
    eventoId = r.eventoId;
    $("b", modal).textContent = r.name;
    const bytes = b64ToBytes(r.data);
    blobUrl = URL.createObjectURL(new Blob([bytes], { type: r.mime }));
    doc = { name: r.name, mime: r.mime };

    $("#dl", modal).disabled = false;
    $("#dl", modal).onclick = async () => {
      const d = await post("dr_open", { id, mode: "download" });
      if (d.error) return alert(d.error);
      const u = URL.createObjectURL(new Blob([b64ToBytes(d.data)], { type: d.mime }));
      const a = Object.assign(document.createElement("a"), { href: u, download: d.name });
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 5000);
    };

    if (r.mime === "application/pdf") {
      try {
        await loadPdfJs();
        const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
        vw.innerHTML = "";
        const w = Math.min(vw.clientWidth - 16, 900), dpr = window.devicePixelRatio || 1;
        for (let n = 1; n <= pdf.numPages; n++) {
          const page = await pdf.getPage(n);
          const base = page.getViewport({ scale: 1 });
          const vp = page.getViewport({ scale: (w / base.width) * dpr });
          const c = document.createElement("canvas");
          c.width = vp.width; c.height = vp.height; c.style.width = w + "px";
          vw.appendChild(c);
          await page.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
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
