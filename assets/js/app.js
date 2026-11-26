/* Flujo 1 (acceso), Flujo 2 (página) y tracking del sitio */
const LS_EMAIL = "lanek_email";
const gate = $("#gate"), site = $("#site"), bootEl = $("#boot");
const hideBoot = () => { if (bootEl) bootEl.hidden = true; };

document.querySelectorAll(".privacy-mail").forEach((n) => (n.textContent = LK.PRIVACY_EMAIL));
$("#year").textContent = new Date().getFullYear();

/* ───────── Acceso ───────── */
let needsForm = false;
const origen = () => {
  const p = new URLSearchParams(location.search);
  return p.get("utm_source") || p.get("utm_campaign") || p.get("ref") || document.referrer || "";
};

async function enter(email, extra = {}) {
  const r = await api("enter", { email, origen: origen(), ...extra });
  if (r.error) throw new Error(r.error);
  store.set("lk_site", r.token);
  store.set(LS_EMAIL, r.email);
  store.set("lk_visit", "1", true); // esta pestaña ya contó su ingreso
  return r.email;
}

const cachedContent = () => { try { return JSON.parse(store.get("lk_content") || "null"); } catch { return null; } };

async function boot() {
  // 1) token vigente → entra directo. Si hay contenido en caché se muestra al instante y se refresca en segundo plano.
  if (siteToken()) {
    const cached = cachedContent();
    if (cached && cached.length) {
      if (!store.get("lk_visit", true)) { store.set("lk_visit", "1", true); track("ingreso_recurrente"); }
      showSite(cached);
      api("contenido", { token: siteToken() }).then((r) => {
        if (r && r.secciones) {
          const fresh = JSON.stringify(r.secciones);
          if (fresh !== JSON.stringify(cached)) { store.set("lk_content", fresh); renderCards(r.secciones.filter((x) => x.id !== "fit")); }
        }
        else if (r && r.auth) { store.del("lk_site"); store.del("lk_content"); location.reload(); }
      }).catch(() => {});
      return;
    }
    const r = await api("contenido", { token: siteToken() }).catch(() => null);
    if (r && r.secciones) {
      store.set("lk_content", JSON.stringify(r.secciones));
      if (!store.get("lk_visit", true)) { store.set("lk_visit", "1", true); track("ingreso_recurrente"); }
      return showSite(r.secciones);
    }
    store.del("lk_site");
  }
  // 2) correo recordado en localStorage y ya conocido → re-entra sin pedir nada
  const saved = store.get(LS_EMAIL);
  if (saved) {
    $("#g-email").value = saved;
    try {
      const c = await api("check", { email: saved });
      if (c.needsForm === false) { await enter(saved); return boot(); }
    } catch {}
  }
  hideBoot();
  gate.hidden = false;
}

$("#gate-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = $("#g-err"), btn = $("#g-btn");
  err.textContent = "";
  const email = $("#g-email").value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return (err.textContent = "Ingresa un correo válido.");
  setBusy(btn, true, needsForm ? "Entrando…" : "Verificando…");
  try {
    if (!needsForm) {
      const c = await api("check", { email });
      if (c.error) throw new Error(c.error);
      if (c.needsForm) {
        needsForm = true;
        $("#g-extra").hidden = false;
        $("#g-email").readOnly = true;
        btn.dataset.txt = "Solicitar acceso y entrar";
        $("#g-nombre").focus();
        return;
      }
      await enter(email);
    } else {
      const nombre = $("#g-nombre").value.trim();
      if (!nombre) return (err.textContent = "Ingresa tu nombre.");
      if (!$("#g-consent").checked) return (err.textContent = "Debes aceptar para continuar.");
      await enter(email, { nombre, empresa: $("#g-empresa").value.trim(), consent: true });
    }
    gate.hidden = true;
    boot();
  } catch (ex) {
    err.textContent = ex.message || "Error de conexión. Intenta de nuevo.";
  } finally {
    setBusy(btn, false);
  }
});

/* ───────── Sitio ───────── */
function renderBody(txt) {
  return String(txt).split("\n").filter(Boolean).map((l) => {
    if (l.startsWith("STAT::")) {
      const [, n, t] = l.split("::");
      return `<div class="stat"><b>${esc(n)}</b><span>${esc(t)}</span></div>`;
    }
    if (l.startsWith("IMG::")) return `<img class="secimg" loading="lazy" src="assets/img/${esc(l.slice(5))}" alt="" />`;
    return `<p>${esc(l)}</p>`;
  }).join("");
}

function showSite(todas) {
  hideBoot();
  gate.hidden = true;
  site.hidden = false;
  const fitData = todas.find((s) => s.id === "fit");
  renderCards(todas.filter((s) => s.id !== "fit"));
  initVideo();
  initMeeting();
  initFit(fitData);
  initDataRoom();
}

/* Tarjetas de las seis secciones (se vuelven a dibujar si llega contenido nuevo) */
function renderCards(secciones) {
  $("#cards").innerHTML = secciones.map((s, i) => `
    <article class="card section" id="sec-${esc(s.id)}" data-id="${esc(s.id)}">
      <button class="sechead" aria-expanded="false">
        <span class="num">${i + 1}</span>
        <span><h3>${esc(s.titulo)}</h3><small>${esc(s.resumen)}</small></span>
        <span class="chev" aria-hidden="true">+</span>
      </button>
      <div class="secbody${s.slides && s.slides.length ? " has-slides" : ""}" hidden>${s.slides && s.slides.length ? "" : renderBody(s.cuerpo)}</div>
    </article>`).join("");

  document.querySelectorAll(".section").forEach((card, idx) => {
    const head = $(".sechead", card), body = $(".secbody", card), sec = secciones[idx];
    let viewer = null;
    head.addEventListener("click", () => {
      const open = body.hidden;
      body.hidden = !open;
      if (open && sec.slides && sec.slides.length) { viewer = viewer || slideViewer(body, sec); viewer.focus(); }
      head.setAttribute("aria-expanded", String(open));
      $(".chev", card).textContent = open ? "–" : "+";
    });
    trackSection(card, card.dataset.id);
  });
  SlideImgs.prefetch(secciones);
}

/* ───────── Imágenes de diapositivas: memoria → caché del navegador → servidor (y precarga en segundo plano) ───────── */
const SlideImgs = (() => {
  const mem = {}, CN = "lk-slides-v1";
  const key = (sec, s) => `${location.origin}/__lk_slide/${encodeURIComponent(sec)}/${s.n}/${encodeURIComponent(s.k || "0")}`;
  const cache = () => (window.caches ? caches.open(CN) : Promise.reject());
  function get(sec, s) {
    const k = key(sec, s);
    return (mem[k] = mem[k] || (async () => {
      let blob = null;
      try { const r = await (await cache()).match(k); if (r) blob = await r.blob(); } catch {}
      if (!blob) {
        const r = await api("deck_img", { token: siteToken(), seccion: sec, n: s.n });
        if (!r || !r.data) throw new Error((r && r.error) || "Error");
        blob = new Blob([b64Bytes(r.data)], { type: r.mime });
        if (s.k) cache().then((c) => c.put(k, new Response(blob, { headers: { "Content-Type": r.mime } }))).catch(() => {});
      }
      return URL.createObjectURL(blob);
    })().catch((e) => { delete mem[k]; throw e; }));
  }
  /* Precarga: primero la diapositiva 1 de cada sección, luego el resto (2 a la vez). Borra versiones viejas. */
  let sig = "";
  function prefetch(secciones) {
    const valid = new Set(), first = [], rest = [];
    secciones.forEach((sec) => (sec.slides || []).forEach((s, i) => { valid.add(key(sec.id, s)); (i ? rest : first).push([sec.id, s]); }));
    cache().then(async (c) => { for (const req of await c.keys()) if (!valid.has(req.url)) c.delete(req); }).catch(() => {});
    const conn = navigator.connection || {}, light = conn.saveData || /2g/.test(conn.effectiveType || "");
    const queue = light ? first : first.concat(rest);
    const now = queue.map(([sec, s]) => key(sec, s)).join("|");
    if (!queue.length || now === sig) return; sig = now;
    const worker = async () => { while (queue.length) { const [sec, s] = queue.shift(); await get(sec, s).catch(() => {}); } };
    setTimeout(() => { worker(); worker(); }, 1200);
  }
  return { get, prefetch };
})();

/* ───────── Visor de diapositivas (dentro de cada tarjeta): diapositiva, controles y notas ───────── */
function slideViewer(box, sec) {
  const slides = sec.slides, n = slides.length, seen = new Set();
  let i = 0, ticket = 0;
  box.innerHTML = `
    <div class="sv" tabindex="0" role="region" aria-roledescription="presentación" aria-label="Diapositivas: ${esc(sec.titulo)}">
      <div class="sv-stage">
        <img class="sv-img" alt="" hidden />
        <div class="sv-load"><span class="spin" aria-hidden="true"></span><span class="sr">Cargando diapositiva…</span></div>
        <button type="button" class="sv-arrow sv-prev" aria-label="Diapositiva anterior"><span aria-hidden="true">‹</span></button>
        <button type="button" class="sv-arrow sv-next" aria-label="Diapositiva siguiente"><span aria-hidden="true">›</span></button>
      </div>
      <div class="sv-bar">
        <button type="button" class="pill sv-reset" aria-label="Volver a la primera diapositiva">↺ Reiniciar</button>
        <span class="sv-count" aria-live="polite"></span>
        <button type="button" class="pill sv-full-btn" aria-pressed="false">⤢ Ampliar</button>
      </div>
      <div class="sv-notes" aria-live="polite"></div>
    </div>`;
  const root = $(".sv", box), img = $(".sv-img", box), load = $(".sv-load", box), notes = $(".sv-notes", box);
  const fetchImg = (k) => SlideImgs.get(sec.id, slides[k]);
  async function show(k) {
    i = Math.max(0, Math.min(n - 1, k));
    const t = ++ticket;
    $(".sv-count", box).textContent = `${i + 1} / ${n}`;
    $(".sv-prev", box).disabled = i === 0;
    $(".sv-next", box).disabled = i === n - 1;
    $(".sv-reset", box).disabled = i === 0;
    const txt = String(slides[i].notas || "").trim();
    notes.hidden = !txt;
    notes.innerHTML = txt.split(/\n|\|\|/).filter(Boolean).map((l) => `<p>${esc(l)}</p>`).join("");
    if (!seen.has(i)) { seen.add(i); track("diapositiva_vista", { seccion: `${sec.id}#${i + 1}` }); }
    load.hidden = false; load.classList.remove("err");
    load.innerHTML = '<span class="spin" aria-hidden="true"></span><span class="sr">Cargando diapositiva…</span>';
    [i + 1, i + 2].filter((x) => x < n).forEach((x) => fetchImg(x).catch(() => {})); // precarga las siguientes
    try {
      const url = await fetchImg(i);
      if (t !== ticket) return;
      img.src = url; img.alt = `Diapositiva ${i + 1} de ${n} · ${sec.titulo}`; img.hidden = false; load.hidden = true;
    } catch {
      if (t !== ticket) return;
      img.hidden = true; load.classList.add("err");
      load.innerHTML = '<p class="err">No se pudo cargar la diapositiva.</p><button type="button" class="pill">Reintentar</button>';
      $("button", load).onclick = () => show(i);
    }
  }
  $(".sv-prev", box).onclick = () => show(i - 1);
  $(".sv-next", box).onclick = () => show(i + 1);
  $(".sv-reset", box).onclick = () => show(0);
  /* Ampliar: la misma presentación a pantalla completa (sirve en iPhone, donde no hay fullscreen de elementos) */
  const fullBtn = $(".sv-full-btn", box);
  const setFull = (on) => {
    root.classList.toggle("sv-full", on);
    document.body.classList.toggle("sv-lock", on);
    fullBtn.textContent = on ? "✕ Cerrar" : "⤢ Ampliar";
    fullBtn.setAttribute("aria-pressed", String(on));
    root.focus({ preventScroll: true });
    track("diapositiva_vista", { seccion: `${sec.id}#ampliar` });
  };
  fullBtn.onclick = () => setFull(!root.classList.contains("sv-full"));
  root.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && root.classList.contains("sv-full")) { e.preventDefault(); setFull(false); return; }
    if (e.key === "ArrowRight" || e.key === "PageDown") { e.preventDefault(); show(i + 1); }
    else if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); show(i - 1); }
    else if (e.key === "Home") { e.preventDefault(); show(0); }
    else if (e.key === "End") { e.preventDefault(); show(n - 1); }
  });
  let x0 = null;
  root.addEventListener("touchstart", (e) => { x0 = e.touches[0].clientX; }, { passive: true });
  root.addEventListener("touchend", (e) => { if (x0 == null) return; const dx = e.changedTouches[0].clientX - x0; x0 = null; if (Math.abs(dx) > 45) show(i + (dx < 0 ? 1 : -1)); });
  show(0);
  return { focus: () => root.focus({ preventScroll: true }) };
}

/* ───────── ¿Calzamos? (acordeón accesible) ───────── */
function initFit(d) {
  const card = $(".fit"), btn = $("#fit-btn"), panel = $("#fit-panel");
  if (!d) return ($("#fit").hidden = true);
  const blocks = String(d.cuerpo).split("\n").filter((l) => l.startsWith("BLOQUE::")).map((l) => {
    const [, label, ...rest] = l.split("::");
    return `<div class="fitblock"><span class="lbl">${esc(label)}</span><p>${rest.join("::").split("||").map(esc).join("<br>")}</p></div>`;
  }).join("");
  panel.innerHTML = `<h3>${esc(d.titulo)}</h3><p class="muted">${esc(d.resumen)}</p><div class="fitgrid">${blocks}</div>
    <a href="#reunion" id="fit-cta" class="fit-cta">Si calzamos, conversemos</a>`;

  let openedAt = null, vis = false, since = null, visTotal = 0;
  const stopVis = () => { if (since != null) { visTotal += (Date.now() - since) / 1000; since = null; } };
  const flushVis = () => { stopVis(); if (visTotal >= 1) track("fit_visible_segundos", { duracion_segundos: Math.round(visTotal) }); visTotal = 0; };
  const startVis = () => { if (openedAt && vis && !document.hidden && since == null) since = Date.now(); };

  function set(open, silent) {
    if (open === !panel.hidden) return;
    panel.hidden = !open;
    btn.setAttribute("aria-expanded", String(open));
    $("#fit-hint-txt").textContent = open ? "Ver menos" : "Ver más";
    if (open) { openedAt = Date.now(); if (!silent) track("fit_abierta", { seccion: "fit" }); startVis(); }
    else if (openedAt) {
      flushVis();
      track("fit_cerrada", { seccion: "fit", duracion_segundos: Math.round((Date.now() - openedAt) / 1000) });
      openedAt = null;
    }
  }
  btn.addEventListener("click", () => set(panel.hidden));
  $("#fit-cta", panel).addEventListener("click", (e) => {
    track("fit_cta_click", { seccion: "fit" });
    e.preventDefault();
    $("#reunion").scrollIntoView({ behavior: "smooth" });
  });
  // tiempo con la sección visible mientras está abierta
  new IntersectionObserver(([e]) => { vis = e.isIntersecting; if (vis) startVis(); else stopVis(); }, { threshold: 0.3 }).observe(card);
  onHide(() => { flushVis(); if (openedAt) { track("fit_cerrada", { seccion: "fit", duracion_segundos: Math.round((Date.now() - openedAt) / 1000) }); openedAt = null; } });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) startVis(); });
  trackSection(card, "fit"); // llegó hasta la sección (seccion_vista · fit)
  const openFromHash = () => { if (location.hash === "#fit") { set(true); card.scrollIntoView(); } };
  openFromHash();
  window.addEventListener("hashchange", openFromHash);
}

/* ───────── Data room en ventana emergente ───────── */
function initDataRoom() {
  const modal = $("#dr-modal"), link = $("#open-dr");
  let started = false, lastFocus = null;
  const goPage = () => (location.href = "dataroom.html");
  const open = () => {
    if (store.get("lk_dr", true)) return goPage(); // ya tiene sesión de data room → directo a la página
    lastFocus = document.activeElement;
    modal.hidden = false;
    document.body.style.overflow = "hidden";
    if (!started) { started = true; DataRoom.init($("#dr-body"), store.get(LS_EMAIL) || "", { onAuthed: goPage }); }
    setTimeout(() => ($("input", modal) || $("#dr-close")).focus(), 50);
  };
  const close = () => { modal.hidden = true; document.body.style.overflow = ""; if (lastFocus) lastFocus.focus(); };
  link.addEventListener("click", (e) => { e.preventDefault(); open(); });
  $("#dr-close").addEventListener("click", close);
  modal.addEventListener("mousedown", (e) => { if (e.target === modal) close(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !modal.hidden && !$(".modal")) close(); });
  if (location.hash === "#dataroom") open();
}

/* seccion_vista: tiempo con ≥50% de la tarjeta visible y pestaña activa */
function trackSection(el, id) {
  let since = null, total = 0, visible = false;
  const stop = () => { if (since != null) { total += (Date.now() - since) / 1000; since = null; } };
  const flush = () => { stop(); if (total >= 2) track("seccion_vista", { seccion: id, duracion_segundos: Math.round(total) }); total = 0; };
  new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    if (visible && !document.hidden) since = Date.now(); else flush();
  }, { threshold: 0.5 }).observe(el);
  onHide(flush);
  document.addEventListener("visibilitychange", () => { if (!document.hidden && visible) since = Date.now(); });
}

/* ───────── Video YouTube (autoplay mudo + subtítulos) ───────── */
function initVideo() {
  const box = $("#video");
  if (!LK.YT_ID) return; // sin video aún: se muestra solo el hero
  $("#video-sec").hidden = false;
  box.innerHTML = '<div id="yt"></div><button id="unmute" class="btn unmute" hidden>🔊 Activar audio</button>';
  const boot = () => {
    let played = false, timer = null;
    const done = new Set();
    const player = new YT.Player("yt", {
      videoId: LK.YT_ID,
      width: "100%", height: "100%",
      playerVars: { autoplay: 1, mute: 1, playsinline: 1, rel: 0, modestbranding: 1, cc_load_policy: 1, cc_lang_pref: "es", hl: "es" },
      events: {
        onReady: () => { $("#unmute").hidden = false; },
        onStateChange: (ev) => {
          if (ev.data === YT.PlayerState.PLAYING) {
            if (!played) { played = true; track("video_play"); }
            timer = timer || setInterval(() => {
              const d = player.getDuration();
              if (!d) return;
              const pct = (player.getCurrentTime() / d) * 100;
              for (const t of [25, 50, 75]) if (pct >= t && !done.has(t)) { done.add(t); track("video_progreso", { seccion: String(t) }); }
            }, 1000);
          }
          if (ev.data === YT.PlayerState.ENDED && !done.has(100)) { done.add(100); track("video_progreso", { seccion: "100" }); }
        },
      },
    });
    $("#unmute").addEventListener("click", () => {
      player.unMute(); player.setVolume(100);
      $("#unmute").hidden = true;
      track("video_audio_activado");
    });
  };
  if (window.YT && YT.Player) boot();
  else { window.onYouTubeIframeAPIReady = boot; const s = document.createElement("script"); s.src = "https://www.youtube.com/iframe_api"; document.head.appendChild(s); }
}

/* ───────── Reunión (Google Calendar) + mensaje directo ───────── */
function initMeeting() {
  $("#btn-agendar").addEventListener("click", () => {
    track("cta_agendar_click");
    const cal = $("#cal");
    cal.hidden = false;
    cal.innerHTML = LK.CAL_URL
      ? `<div class="calbox"><div class="calload">${loaderHTML("Cargando horarios disponibles…")}</div><iframe src="${esc(LK.CAL_URL)}" title="Agenda de reunión con Lanek"></iframe></div>
         <p class="muted calalt">¿No ves los horarios? <a href="${esc(LK.CAL_LINK || LK.CAL_URL)}" target="_blank" rel="noopener">Abrir la agenda en una pestaña nueva ↗</a></p>`
      : '<p class="err">Configura CAL_URL en assets/js/config.js</p>';
    const fr = $("iframe", cal);
    if (fr) fr.addEventListener("load", () => { const l = $(".calload", cal); if (l) l.remove(); });
    $("#cta-actions").hidden = true;
  });
  $("#btn-msg").addEventListener("click", () => { $("#msg-form").hidden = false; $("#cta-actions").hidden = true; });
  $("#msg-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const r = await api("mensaje", { token: siteToken(), mensaje: $("#msg-text").value });
    if (!r.error) { $("#msg-form").hidden = true; $("#msg-ok").hidden = false; }
  });
}

$("#btn-delete").addEventListener("click", async () => {
  if (!confirm("Se eliminarán tu registro y todos tus datos. ¿Continuar?")) return;
  const r = await api("privacy_delete", { token: siteToken() });
  if (!r.error) { localStorage.clear(); sessionStorage.clear(); location.reload(); }
});

boot();
