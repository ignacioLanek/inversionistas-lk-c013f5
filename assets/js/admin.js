/* Dashboard de administración — autenticación propia (contraseña en Propiedades del script), separada del flujo de inversionistas */
const app = $("#app");
const aToken = () => store.get("lk_admin", true);
const call = (a, d = {}) => api(a, { token: aToken(), ...d });
const TITLES = { problematica: "Problemática", solucion: "Solución", producto: "Producto", personas: "Las Personas", fit: "¿Calzamos?", modelo: "Modelo de Negocio y Mercado", traccion: "Tracción y Roadmap" };
const nice = (id) => TITLES[id] || id;
const fdate = (s) => (s ? new Date(s).toLocaleString("es-CL") : "—");

/* ── Historial: nombres legibles de cada evento ── */
const EV = {
  solicitud_acceso_sitio: ["📝", "Solicitó acceso al sitio", 1], primer_ingreso: ["👋", "Primer ingreso al sitio", 1], ingreso_recurrente: ["🔁", "Volvió al sitio", 1],
  seccion_vista: ["👁", "Vio sección", 0], diapositiva_vista: ["🖼", "Vio diapositiva", 0],
  video_play: ["▶️", "Reprodujo el video", 1], video_progreso: ["⏱", "Avance del video", 0], video_audio_activado: ["🔊", "Activó el audio del video", 0],
  fit_abierta: ["🎯", "Abrió ¿Calzamos?", 1], fit_cerrada: ["🎯", "Cerró ¿Calzamos?", 0], fit_visible_segundos: ["🎯", "Leyó ¿Calzamos?", 0], fit_cta_click: ["🎯", "Clic en «Si calzamos, conversemos»", 1],
  cta_agendar_click: ["📅", "Abrió la agenda", 1], reunion_agendada: ["📅", "Agendó reunión", 1], mensaje: ["✉️", "Envió un mensaje", 1],
  solicitud_acceso_dataroom: ["🔐", "Solicitó acceso al data room", 1], dataroom_ingreso: ["🗄", "Entró al data room", 1],
  documento_abierto: ["📄", "Abrió documento", 1], documento_descargado: ["⬇️", "Descargó documento", 1],
};
const evLabel = (t) => EV[t] || ["•", t, 0];
function evDetalle(e) {
  const t = e.tipo_evento, s = String(e.seccion || ""), d = e.duracion_segundos ? ` · ${fmtDur(e.duracion_segundos)}` : "";
  if (t === "seccion_vista") return esc(nice(s)) + d;
  if (t === "diapositiva_vista") { const [sec, n] = s.split("#"); return `${esc(nice(sec))} · diapositiva ${esc(n || "")}`; }
  if (t === "video_progreso") return esc(s) + "%";
  if (t === "mensaje") return `«${esc(s)}»`;
  if (t.startsWith("fit_")) return d.replace(" · ", "");
  return esc(s) + d;
}
/* Tabla cronológica agrupada por día. conPersona=false en la ficha de un contacto. */
function timeline(evs, conPersona) {
  if (!evs.length) return '<p class="muted">Sin eventos para estos filtros.</p>';
  let dia = "", out = "";
  evs.forEach((e) => {
    const f = new Date(e.timestamp), d = f.toLocaleDateString("es-CL", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    if (d !== dia) { if (dia) out += "</tbody></table></div>"; dia = d; out += `<h4 class="tlday">${esc(d)}</h4><div class="tablewrap"><table class="tl"><tbody>`; }
    const [ico, lab] = evLabel(e.tipo_evento);
    out += `<tr><td class="muted tlh">${f.toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" })}</td>` +
      (conPersona ? `<td><a href="#" data-c="${esc(e.email)}"><b>${esc(e.nombre || e.email)}</b></a>${e.interno ? ' <span class="chip tmchip">Equipo</span>' : ""}${e.empresa ? `<br><span class="muted">${esc(e.empresa)}</span>` : ""}</td>` : "") +
      `<td>${ico} ${esc(lab)}</td><td class="muted">${evDetalle(e)}</td></tr>`;
  });
  return out + "</tbody></table></div>";
}
function csv(evs) {
  const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = [["fecha", "correo", "nombre", "empresa", "evento", "detalle", "segundos"]].concat(evs.map((e) => [e.timestamp, e.email, e.nombre, e.empresa, evLabel(e.tipo_evento)[1], e.seccion, e.duracion_segundos || ""]));
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob(["\ufeff" + rows.map((r) => r.map(q).join(",")).join("\n")], { type: "text/csv" })), download: "historial-inversionistas.csv" });
  document.body.appendChild(a); a.click(); a.remove();
}

/* ── Vista: historial general (o de un correo) con filtros ── */
const H = { dias: 30, q: "", tipo: "", hitos: false, equipo: false, max: 300 };
async function historial(email) {
  const r = await cargar(email ? "Historial de " + esc(email) : "Historial general", "admin_eventos", { dias: H.dias, email: email || "" }, () => historial(email));
  if (!r) return;
  const all = r.eventos;
  const tipos = [...new Set(all.map((e) => e.tipo_evento))].sort((a, b) => evLabel(a)[1].localeCompare(evLabel(b)[1], "es"));
  app.innerHTML = bar('<button class="pill" id="back">← Contactos</button>') +
    `<h2>${email ? "Historial de " + esc(email) : "Historial general"}</h2>
    <div class="filters">
      <span>${[7, 30, 90, 0].map((d) => `<button class="pill ${H.dias === d ? "on" : ""}" data-d="${d}">${d ? d + " d" : "Todo"}</button>`).join("")}</span>
      ${email ? "" : `<input type="search" id="hq" placeholder="Buscar persona, correo o empresa…" value="${esc(H.q)}" />`}
      <select id="ht"><option value="">Todos los eventos</option>${tipos.map((t) => `<option value="${t}" ${H.tipo === t ? "selected" : ""}>${esc(evLabel(t)[1])}</option>`).join("")}</select>
      <label class="chk"><input type="checkbox" id="hh" ${H.hitos ? "checked" : ""}/> Solo hitos</label>
      ${email ? "" : `<label class="chk"><input type="checkbox" id="he" ${H.equipo ? "checked" : ""}/> Incluir equipo Lanek</label>`}
      <button class="pill" id="hcsv">Exportar CSV</button>
    </div><p class="muted" id="hcount"></p><div id="hlist"></div>`;
  wireOut(); $("#back").onclick = list;
  const draw = () => {
    const q = H.q.trim().toLowerCase();
    const evs = all.filter((e) => (email || H.equipo || !e.interno) && (!H.tipo || e.tipo_evento === H.tipo) && (!H.hitos || evLabel(e.tipo_evento)[2]) &&
      (!q || `${e.email} ${e.nombre} ${e.empresa}`.toLowerCase().includes(q)));
    $("#hcount").textContent = `${evs.length} eventos${r.total > all.length ? ` (se cargaron los ${all.length} más recientes de ${r.total})` : ""}`;
    $("#hlist").innerHTML = timeline(evs.slice(0, H.max), !email) + (evs.length > H.max ? `<p><button class="pill" id="hmore">Ver más (${evs.length - H.max} restantes)</button></p>` : "");
    const m = $("#hmore"); if (m) m.onclick = () => { H.max += 300; draw(); };
    $("#hlist").querySelectorAll("[data-c]").forEach((a) => (a.onclick = (ev) => { ev.preventDefault(); contacto(a.dataset.c); }));
    $("#hcsv").onclick = () => csv(evs);
  };
  app.querySelectorAll("[data-d]").forEach((b) => (b.onclick = () => { H.dias = Number(b.dataset.d); H.max = 300; historial(email); }));
  if ($("#hq")) $("#hq").oninput = (e) => { H.q = e.target.value; H.max = 300; draw(); };
  $("#ht").onchange = (e) => { H.tipo = e.target.value; H.max = 300; draw(); };
  $("#hh").onchange = (e) => { H.hitos = e.target.checked; H.max = 300; draw(); };
  if ($("#he")) $("#he").onchange = (e) => { H.equipo = e.target.checked; H.max = 300; draw(); };
  draw();
}

function login(msg = "") {
  app.innerHTML = `<form id="f" class="card gate" style="margin:10vh auto"><h1>Admin · Lanek</h1>
    <input type="password" id="pw" placeholder="Contraseña" autofocus /><p class="err">${esc(msg)}</p><button class="btn">Entrar</button>
    <p style="text-align:center;margin:1rem 0 0"><a href="index.html">← Volver al sitio</a></p></form>`;
  $("#f").onsubmit = async (e) => {
    e.preventDefault();
    setBusy($("button", app), true, "Entrando…");
    const r = await api("admin_login", { password: $("#pw").value }).catch(() => ({ error: "Error de conexión" }));
    if (r.error) return login(r.error);
    store.set("lk_admin", r.token, true);
    list();
  };
}

const bar = (right = "") => `<header class="adminbar"><h1 style="color:var(--ink-900)">Inversionistas · Admin</h1><nav><a class="pill" href="index.html">← Sitio</a>${right}
  <button class="pill" id="out">Salir</button></nav></header>`;
/* Carga con indicador; si falla muestra el error con «Reintentar» (antes volvía a la lista sin avisar). */
async function cargar(titulo, accion, datos, reintentar) {
  app.innerHTML = bar('<button class="pill" id="back">← Contactos</button>') + `<h2>${titulo}</h2>` + loaderHTML("Cargando…");
  wireOut(); $("#back").onclick = list;
  const stop = slowHint(app);
  const r = await call(accion, datos).catch(() => ({ error: "Error de conexión" }));
  stop();
  if (r.auth) { login("Sesión expirada"); return null; }
  if (r.error) {
    app.innerHTML = bar('<button class="pill" id="back">← Contactos</button>') + `<h2>${titulo}</h2><p class="err">No se pudo cargar: ${esc(r.error)}</p><button class="pill" id="retry">Reintentar</button>`;
    wireOut(); $("#back").onclick = list; $("#retry").onclick = reintentar;
    return null;
  }
  return r;
}
function wireOut() { $("#out").onclick = () => { store.del("lk_admin", true); login(); }; }

async function list() {
  const r = await cargar("Contactos", "admin_list", {}, list);
  if (!r) return;
  const equipo = r.contactos.filter((c) => c.interno).length;
  r.contactos = r.contactos.filter((c) => !c.interno).concat(r.contactos.filter((c) => c.interno)); // equipo al final
  const pend = r.contactos.filter((c) => !c.interno && (c.fecha_solicitud_sitio && !c.acceso_sitio) || (c.fecha_solicitud_dataroom && !c.acceso_dataroom)).length;
  const perm = (c, f) => `<button class="pill ${c[f] ? "on" : "off"}" data-e="${esc(c.email)}" data-f="${f}" data-v="${c[f]}">${c[f] ? "Aprobado · revocar" : "Aprobar"}</button>
    ${!c[f] && c["fecha_solicitud_" + f.slice(7)] ? `<div class="muted">solicitó ${esc(String(c["fecha_solicitud_" + f.slice(7)]).slice(0, 10))}</div>` : ""}`;
  app.innerHTML = bar('<button class="pill" id="hist">Historial</button><button class="pill" id="agg">Vista agregada</button>') +
    `<p class="muted">${r.contactos.length - equipo} prospectos · ${pend} con solicitudes pendientes${equipo ? ` · ${equipo} del equipo Lanek (sin avisos ni estadísticas)` : ""}</p>
    <div class="tablewrap"><table><thead><tr><th>Contacto</th><th>Sitio</th><th>Data room</th><th>Visitas</th><th>Tiempo</th><th>Última actividad</th></tr></thead><tbody>
    ${r.contactos.filter((c) => !c.interno).reverse().concat(r.contactos.filter((c) => c.interno)).map((c) => `<tr${c.interno ? ' class="tm"' : ""}>
      <td><a href="#" data-c="${esc(c.email)}"><b>${esc(c.nombre || "—")}</b></a>${c.interno ? ' <span class="chip tmchip">Equipo</span>' : ""}<br><span class="muted">${esc(c.email)}${c.empresa ? " · " + esc(c.empresa) : ""}</span></td>
      <td>${perm(c, "acceso_sitio")}</td><td>${perm(c, "acceso_dataroom")}</td>
      <td>${c.agg.visitas}</td><td>${fmtDur(c.agg.seg)}</td><td class="muted">${fdate(c.agg.last)}</td></tr>`).join("")}</tbody></table></div>`;
  wireOut();
  $("#agg").onclick = () => agregado(30);
  $("#hist").onclick = () => historial();
  app.querySelectorAll("[data-f]").forEach((b) => (b.onclick = async () => {
    b.disabled = true;
    const r = await call("admin_set", { email: b.dataset.e, field: b.dataset.f, value: b.dataset.v !== "true" });
    if (r && r.avisado) alert("Acceso aprobado. Le enviamos un correo a " + b.dataset.e + " avisándole que ya puede entrar al data room.");
    list();
  }));
  app.querySelectorAll("[data-c]").forEach((a) => (a.onclick = (e) => { e.preventDefault(); contacto(a.dataset.c); }));
}

async function contacto(email) {
  const hP = call("admin_eventos", { email, dias: 0 }).catch(() => ({}));
  const r = await cargar(esc(email), "admin_contacto", { email }, () => contacto(email));
  if (!r) return;
  const h = await hP;
  const ev = r.eventos, visitas = ev.filter((e) => ["primer_ingreso", "ingreso_recurrente"].includes(e.tipo_evento));
  const secs = {};
  ev.filter((e) => e.tipo_evento === "seccion_vista").forEach((e) => { const s = (secs[e.seccion] ||= { seg: 0, n: 0 }); s.seg += e.duracion_segundos; s.n++; });
  const docs = ev.filter((e) => e.tipo_evento.startsWith("documento_")).reverse();
  const total = Object.values(secs).reduce((a, s) => a + s.seg, 0);
  const c = r.contacto;
  const fe = (t) => ev.filter((e) => e.tipo_evento === t);
  const fit = { llego: ev.some((e) => e.tipo_evento === "seccion_vista" && e.seccion === "fit"), abierta: fe("fit_abierta").length, abierto: fe("fit_cerrada").reduce((a, e) => a + e.duracion_segundos, 0), visible: fe("fit_visible_segundos").reduce((a, e) => a + e.duracion_segundos, 0), cta: fe("fit_cta_click").length };
  app.innerHTML = bar('<button class="pill" id="back">← Contactos</button>') +
    `<h2>${esc(c.nombre || c.email)}</h2><p class="muted">${esc(c.email)}${c.empresa ? " · " + esc(c.empresa) : ""}${c.origen ? " · origen: " + esc(c.origen) : ""}</p>
    <div class="row"><button class="pill off" id="del">Eliminar datos de este contacto</button></div>
    <div class="grid3"><div class="gstat"><b>${visitas.length}</b>visitas</div><div class="gstat"><b>${fmtDur(total)}</b>tiempo en secciones</div><div class="gstat"><b>${docs.filter((d) => d.tipo_evento === "documento_abierto").length}</b>documentos abiertos</div></div>
    <h3>¿Calzamos? (sección de fit)</h3>
    <div class="grid3"><div class="gstat"><b>${fit.llego ? "Sí" : "No"}</b>llegó a la sección</div><div class="gstat"><b>${fit.abierta}</b>veces abierta${fit.abierta ? ` · ${fmtDur(fit.abierto)} abierta` : ""}</div><div class="gstat"><b>${fmtDur(fit.visible)}</b>visible estando abierta</div></div>
    <p class="muted">Clics en «Si calzamos, conversemos»: ${fit.cta}</p>
    <h3>Historial de visitas</h3><ul class="clean">${visitas.slice().reverse().map((v) => `<li>${fdate(v.timestamp)} — ${v.tipo_evento === "primer_ingreso" ? "primer ingreso" : "volvió"}</li>`).join("") || "<li>—</li>"}</ul>
    <h3>Secciones más vistas</h3><ul class="clean">${Object.entries(secs).sort((a, b) => b[1].seg - a[1].seg).map(([k, s]) => `<li>${esc(nice(k))}: ${fmtDur(s.seg)} (${s.n} vistas)</li>`).join("") || "<li>—</li>"}</ul>
    <h3>Documentos</h3><ul class="clean">${docs.map((d) => `<li>${fdate(d.timestamp)} — ${d.tipo_evento === "documento_descargado" ? "⬇ " : ""}${esc(d.seccion)}${d.duracion_segundos ? ` (${fmtDur(d.duracion_segundos)})` : ""}</li>`).join("") || "<li>—</li>"}</ul>
    <h3 style="display:flex;justify-content:space-between;align-items:center;gap:1rem">Historial completo <button class="pill" id="fullh">Abrir con filtros</button></h3>
    ${timeline(h.eventos || [], false)}`;
  wireOut();
  $("#back").onclick = list;
  $("#fullh").onclick = () => { H.dias = 0; H.tipo = ""; H.hitos = false; historial(email); };
  $("#del").onclick = async () => { if (confirm(`¿Eliminar definitivamente a ${email} y todos sus eventos?`)) { await call("admin_delete", { email }); list(); } };
}

async function agregado(dias) {
  const r = await cargar(`Vista agregada · últimos ${dias} días`, "admin_agregado", { dias }, () => agregado(dias));
  if (!r) return;
  const by = Object.fromEntries(r.secciones.map((s) => [s.nombre, s]));
  const ids = [...new Set([...Object.keys(TITLES), ...Object.keys(by)])];
  const rows = ids.map((id) => ({ id, ...(by[id] || { seg: 0, vistas: 0, personas: 0 }) })).sort((a, b) => b.seg - a.seg);
  const max = Math.max(1, ...rows.map((x) => x.seg)), v = r.video, pct = (n) => (v.play ? Math.round((n / v.play) * 100) : 0);
  app.innerHTML = bar('<button class="pill" id="back">← Contactos</button>') +
    `<h2>Vista agregada · últimos ${dias} días</h2><p>${[7, 30, 90].map((d) => `<button class="pill" data-d="${d}">${d} d</button>`).join("")}</p>
    <h3>Secciones (de más a menos vista)</h3>
    ${rows.map((x) => `<div class="bar"><span>${esc(nice(x.id))}</span><div><i style="width:${(x.seg / max) * 100}%"></i></div><span class="muted">${fmtDur(x.seg)} · ${x.personas} pers.</span></div>`).join("")}
    <h3 style="margin-top:1.5rem">Video: retención</h3>
    <div class="grid3">${[["Reprodujeron", v.play], ["Llegaron al 25%", v.p25], ["50%", v.p50], ["75%", v.p75], ["100%", v.p100], ["Activaron audio", v.audio]].map(([k, n]) => `<div class="gstat"><b>${n}</b>${k}${k !== "Reprodujeron" ? ` · ${pct(n)}%` : ""}</div>`).join("")}</div>
    <p class="muted">Abandono: ${v.play ? 100 - pct(v.p100) : 0}% no llegó al final.</p>
    <h3>¿Calzamos? (fit)</h3>
    <div class="grid3">${[["Llegaron a la sección", r.fit.llegaron], ["La abrieron", r.fit.abrieron], ["Clic en «conversemos»", r.fit.cta]].map(([k, n]) => `<div class="gstat"><b>${n}</b>${k}</div>`).join("")}</div>
    <p class="muted">La abrieron ${r.fit.llegaron ? Math.min(100, Math.round((r.fit.abrieron / r.fit.llegaron) * 100)) : 0}% de quienes llegaron hasta ahí · ${fmtDur(r.fit.seg)} de lectura acumulada.</p>
    <h3>Documentos más abiertos</h3><ul class="clean">${r.docs.slice(0, 15).map(([n, c]) => `<li>${esc(n)} — ${c}</li>`).join("") || "<li>—</li>"}</ul>`;
  wireOut();
  $("#back").onclick = list;
  app.querySelectorAll("[data-d]").forEach((b) => (b.onclick = () => agregado(Number(b.dataset.d))));
}

aToken() ? list() : login();
