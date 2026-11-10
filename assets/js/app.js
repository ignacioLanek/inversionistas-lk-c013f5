/* Flujo 1 (acceso), Flujo 2 (página) y tracking del sitio */
const LS_EMAIL = "lanek_email";
const gate = $("#gate"), site = $("#site");

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

async function boot() {
  // 1) token vigente → entra directo
  if (siteToken()) {
    const r = await api("contenido", { token: siteToken() }).catch(() => null);
    if (r && r.secciones) {
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
  gate.hidden = false;
}

$("#gate-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = $("#g-err"), btn = $("#g-btn");
  err.textContent = "";
  const email = $("#g-email").value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return (err.textContent = "Ingresa un correo válido.");
  btn.disabled = true;
  try {
    if (!needsForm) {
      const c = await api("check", { email });
      if (c.error) throw new Error(c.error);
      if (c.needsForm) {
        needsForm = true;
        $("#g-extra").hidden = false;
        $("#g-email").readOnly = true;
        btn.textContent = "Solicitar acceso y entrar";
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
    btn.disabled = false;
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

function showSite(secciones) {
  gate.hidden = true;
  site.hidden = false;
  $("#cards").innerHTML = secciones.map((s, i) => `
    <article class="card section" id="sec-${esc(s.id)}" data-id="${esc(s.id)}">
      <button class="sechead" aria-expanded="false">
        <span class="num">${i + 1}</span>
        <span><h3>${esc(s.titulo)}</h3><small>${esc(s.resumen)}</small></span>
        <span class="chev" aria-hidden="true">+</span>
      </button>
      <div class="secbody" hidden>${renderBody(s.cuerpo)}</div>
    </article>`).join("");

  document.querySelectorAll(".section").forEach((card) => {
    const head = $(".sechead", card), body = $(".secbody", card);
    head.addEventListener("click", () => {
      const open = body.hidden;
      body.hidden = !open;
      head.setAttribute("aria-expanded", String(open));
      $(".chev", card).textContent = open ? "–" : "+";
    });
    trackSection(card, card.dataset.id);
  });

  initVideo();
  initMeeting();
  DataRoom.init($("#dr-body"), store.get(LS_EMAIL) || "");
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
  document.addEventListener("visibilitychange", () => { if (document.hidden) flush(); else if (visible) since = Date.now(); });
  window.addEventListener("pagehide", flush);
}

/* ───────── Video YouTube (autoplay mudo + subtítulos) ───────── */
function initVideo() {
  const box = $("#video");
  if (!LK.YT_ID) {
    box.classList.add("placeholder");
    box.textContent = "Video micro-pitch (configura YT_ID en assets/js/config.js)";
    return;
  }
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
      ? `<iframe src="${esc(LK.CAL_URL)}" title="Agenda de reunión" loading="lazy"></iframe>`
      : '<p class="err">Configura CAL_URL en assets/js/config.js</p>';
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
