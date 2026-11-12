/**
 * LANEK · Backend de inversionistas (Google Apps Script)
 * - Base de datos: pestañas de la Google Sheet a la que está vinculado este script
 * - Data room: Google Drive (carpeta raíz DRIVE_ROOT_ID), el script corre como TÚ (no hay links públicos)
 * - Correo OTP: MailApp · Avisos: webhook de Google Chat · Reuniones: Google Calendar
 * Instalación: ver README.md → "Backend". Luego ejecuta setup() una vez.
 */

const COLS = {
  contactos: ['email', 'nombre', 'empresa', 'acceso_sitio', 'acceso_dataroom', 'fecha_solicitud_sitio', 'fecha_solicitud_dataroom', 'consentimiento_fecha', 'consentimiento_version', 'origen', 'creado_en'],
  eventos: ['id', 'email', 'tipo_evento', 'seccion', 'duracion_segundos', 'timestamp'],
  otp: ['email', 'code_hash', 'expira', 'intentos', 'usado', 'creado_en'],
  mensajes: ['email', 'mensaje', 'creado_en'],
  contenido: ['id', 'titulo', 'resumen', 'cuerpo'],
};
const TERMS_VERSION = '2026-11-borrador';
const SITE_TTL = 30 * 24 * 3600, DR_TTL = 2 * 3600, ADMIN_TTL = 8 * 3600, MAX_FILE_BYTES = 25 * 1024 * 1024;
const CLIENT_EVENTS = ['ingreso_recurrente', 'video_play', 'video_progreso', 'video_audio_activado', 'seccion_vista', 'cta_agendar_click', 'reunion_agendada', 'fit_abierta', 'fit_cerrada', 'fit_visible_segundos', 'fit_cta_click'];

/* ───────────── utilidades ───────────── */
const props = () => PropertiesService.getScriptProperties();
const prop = (k, d) => props().getProperty(k) || d || '';
const nowIso = () => new Date().toISOString();
const normEmail = (e) => String(e || '').trim().toLowerCase();
const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) && e.length <= 254;
const clean = (s, n) => String(s == null ? '' : s).trim().slice(0, n || 200);
const bool = (v) => v === true || String(v).toUpperCase() === 'TRUE';

let _ss = null;
function db(name) {
  // Si el script no está vinculado a la Sheet, se usa la propiedad SHEET_ID
  const ss = _ss || (_ss = prop('SHEET_ID') ? SpreadsheetApp.openById(prop('SHEET_ID')) : SpreadsheetApp.getActiveSpreadsheet());
  return ss.getSheetByName(name) || ss.insertSheet(name);
}
function readAll(name) {
  const sh = db(name), last = sh.getLastRow();
  if (last < 2) return [];
  const cols = COLS[name];
  return sh.getRange(2, 1, last - 1, cols.length).getValues().map((r, i) => {
    const o = { _row: i + 2 };
    cols.forEach((c, j) => (o[c] = r[j]));
    return o;
  });
}
function append(name, obj) {
  const sh = db(name);
  const row = COLS[name].map((c) => (obj[c] === undefined ? '' : obj[c]));
  sh.appendRow(row);
  const last = sh.getLastRow();
  if (name === 'contactos') sh.getRange(last, 4, 1, 2).insertCheckboxes(); // casillas solo en filas con datos (evita ~1000 filas "vacías")
  return last;
}
function setCell(name, row, col, val) {
  db(name).getRange(row, COLS[name].indexOf(col) + 1).setValue(val);
}
function withLock(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try { return fn(); } finally { lock.releaseLock(); }
}
function getContacto(email) {
  const sh = db('contactos'), last = sh.getLastRow();
  if (last < 2) return null;
  const cell = sh.getRange(2, 1, last - 1, 1).createTextFinder(email).matchEntireCell(true).matchCase(false).findNext();
  if (!cell) return null;
  const row = cell.getRow(), vals = sh.getRange(row, 1, 1, COLS.contactos.length).getValues()[0];
  const o = { _row: row };
  COLS.contactos.forEach((c, j) => (o[c] = vals[j]));
  o.acceso_sitio = bool(o.acceso_sitio);
  o.acceso_dataroom = bool(o.acceso_dataroom);
  return o;
}
function upsertContacto(email, patch) {
  return withLock(() => {
    const c = getContacto(email);
    if (c) {
      Object.keys(patch).forEach((k) => setCell('contactos', c._row, k, patch[k]));
    } else {
      append('contactos', Object.assign({ email: email, acceso_sitio: false, acceso_dataroom: false, creado_en: nowIso() }, patch));
    }
  });
}

/* ───────────── sesiones firmadas (HMAC) ───────────── */
function secret() {
  let s = prop('SESSION_SECRET');
  if (!s) { s = Utilities.getUuid() + Utilities.getUuid() + Utilities.getUuid(); props().setProperty('SESSION_SECRET', s); }
  return s;
}
function hmac(data) {
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(data, secret()));
}
function signToken(kind, email, secs) {
  const body = Utilities.base64EncodeWebSafe(JSON.stringify({ k: kind, e: email, x: Date.now() + secs * 1000 }));
  return body + '.' + hmac(body);
}
function safeEq(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
function readToken(token, kind) {
  if (!token || String(token).indexOf('.') < 0) return null;
  const parts = String(token).split('.');
  if (!safeEq(parts[1], hmac(parts[0]))) return null;
  try {
    const p = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString());
    if (p.k !== kind || p.x < Date.now()) return null;
    return p.e;
  } catch (e) { return null; }
}
function need(token, kind) {
  const e = readToken(token, kind);
  if (!e) throw new Error('AUTH');
  return e;
}
/** Sesión de data room válida Y permiso aún vigente (revocar en la Sheet corta el acceso). */
function needDr(token) {
  const email = need(token, 'dr');
  const c = getContacto(email);
  if (!c || !c.acceso_dataroom) throw new Error('AUTH');
  return email;
}
function otpHash(email, code) {
  const d = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, email + ':' + code + ':' + secret());
  return d.map((b) => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
}

/* ───────────── eventos + notificaciones ───────────── */
function isSensitive(text) {
  try { return new RegExp(prop('SENSITIVE_REGEX', 'ucc|contrato|financier|balance|estados? financ'), 'i').test(text); } catch (e) { return false; }
}
function gchat(text) {
  const url = prop('GCHAT_WEBHOOK');
  if (!url) return;
  try {
    UrlFetchApp.fetch(url, { method: 'post', contentType: 'application/json; charset=UTF-8', payload: JSON.stringify({ text: text }), muteHttpExceptions: true });
  } catch (e) { console.error('gchat', e); }
}
function recentEvents(n) {
  const sh = db('eventos'), last = sh.getLastRow();
  if (last < 2) return [];
  const start = Math.max(2, last - n + 1);
  return sh.getRange(start, 1, last - start + 1, 6).getValues().map((r) => ({ id: r[0], email: r[1], tipo_evento: r[2], seccion: r[3], duracion_segundos: r[4], timestamp: String(r[5]) }));
}
function hasEvent(email, tipo) {
  const sh = db('eventos'), last = sh.getLastRow();
  if (last < 2) return false;
  const v = sh.getRange(2, 2, last - 1, 2).getValues();
  for (let i = 0; i < v.length; i++) if (v[i][0] === email && v[i][1] === tipo) return true;
  return false;
}
function registrar(email, tipo, o) {
  o = o || {};
  if (o.dedupeMin) {
    const since = new Date(Date.now() - o.dedupeMin * 60000).toISOString();
    if (recentEvents(300).some((e) => e.email === email && e.tipo_evento === tipo && e.timestamp >= since)) return null;
  }
  const id = withLock(() => {
    const sh = db('eventos');
    const row = sh.getLastRow() + 1;
    const dur = o.duracion != null ? Math.max(0, Math.min(Math.round(o.duracion), 14400)) : '';
    sh.getRange(row, 1, 1, 6).setValues([[row, email, tipo, o.seccion || '', dur, nowIso()]]);
    return row;
  });
  try { notificar(email, tipo, o.seccion); } catch (e) { console.error(e); }
  return id;
}
const NOTIFICA = ['solicitud_acceso_sitio', 'solicitud_acceso_dataroom', 'primer_ingreso', 'reunion_agendada', 'dataroom_ingreso', 'documento_abierto', 'fit_abierta'];
/** Registra varios eventos de un mismo usuario con UNA escritura y un solo candado (seguimiento por lotes). */
function registrarVarios(email, lista) {
  if (!lista.length) return 0;
  withLock(() => {
    const sh = db('eventos'), start = sh.getLastRow() + 1, ts = nowIso();
    const rows = lista.map((o, i) => [start + i, email, o.tipo, o.seccion || '', o.duracion != null ? Math.max(0, Math.min(Math.round(o.duracion), 14400)) : '', ts]);
    sh.getRange(start, 1, rows.length, 6).setValues(rows);
  });
  lista.forEach((o) => { try { notificar(email, o.tipo, o.seccion); } catch (e) { console.error(e); } });
  return lista.length;
}
function notificar(email, tipo, seccion) {
  if (NOTIFICA.indexOf(tipo) < 0) return; // evita leer la hoja en cada evento de seguimiento
  if (tipo === 'documento_abierto' && !(seccion && isSensitive(seccion))) return;
  const c = getContacto(email) || {};
  const quien = (c.nombre || '(sin nombre)') + (c.empresa ? ' · ' + c.empresa : '') + ' <' + email + '>';
  if (tipo === 'solicitud_acceso_sitio') gchat('🆕 *Nueva solicitud de acceso al sitio*\n' + quien + (c.origen ? '\nOrigen: ' + c.origen : ''));
  else if (tipo === 'solicitud_acceso_dataroom') gchat('🔐 *Solicitud de acceso al data room* — pendiente de aprobación\n' + quien);
  else if (tipo === 'primer_ingreso') gchat('👀 *Primer ingreso de un prospecto*\n' + quien);
  else if (tipo === 'reunion_agendada') gchat('📅 *Reunión agendada*\n' + quien);
  else if (tipo === 'fit_abierta') gchat('🎯 ' + (c.nombre || email) + ' abrió ¿Calzamos contigo?');
  else if (tipo === 'dataroom_ingreso') gchat('🗄️ *Ingreso al data room*\n' + quien);
  else if (tipo === 'documento_abierto' && seccion && isSensitive(seccion)) gchat('⚠️ *Documento sensible abierto*\n' + seccion + '\n' + quien);
}

/* ───────────── HTTP ───────────── */
function doGet() { return out({ ok: true, servicio: 'lanek-inversionistas' }); }
function out(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

function doPost(e) {
  let res;
  try {
    const b = JSON.parse(e.postData.contents);
    const fn = ROUTES[b.action];
    if (!fn) throw new Error('BAD');
    res = fn(b);
  } catch (err) {
    const m = String(err && err.message);
    res = m === 'AUTH' ? { error: 'Sesión inválida o expirada', auth: true } : m === 'BAD' ? { error: 'Solicitud inválida' } : { error: m.indexOf('LIMIT:') === 0 ? m.slice(6) : 'Error interno' };
    if (m !== 'AUTH' && m !== 'BAD' && m.indexOf('LIMIT:') !== 0) console.error(err && err.stack);
  }
  return out(res);
}

const ROUTES = {
  /* ── acceso al sitio ── */
  check: (b) => {
    const email = normEmail(b.email);
    if (!validEmail(email)) return { error: 'Correo inválido' };
    const c = getContacto(email);
    return { needsForm: !(c && (c.acceso_sitio || c.fecha_solicitud_sitio)) };
  },
  enter: (b) => {
    const email = normEmail(b.email);
    if (!validEmail(email)) return { error: 'Correo inválido' };
    const c = getContacto(email);
    if (!(c && (c.acceso_sitio || c.fecha_solicitud_sitio))) {
      const nombre = clean(b.nombre, 120);
      if (!nombre || b.consent !== true) return { error: 'Falta nombre o consentimiento' };
      const now = nowIso();
      upsertContacto(email, { nombre: nombre, empresa: clean(b.empresa, 120), origen: clean(b.origen, 120) || (c && c.origen) || '', fecha_solicitud_sitio: now, consentimiento_fecha: now, consentimiento_version: TERMS_VERSION });
      registrar(email, 'solicitud_acceso_sitio');
    }
    registrar(email, hasEvent(email, 'primer_ingreso') ? 'ingreso_recurrente' : 'primer_ingreso');
    return { ok: true, token: signToken('site', email, SITE_TTL), email: email };
  },
  contenido: (b) => {
    need(b.token, 'site');
    const cache = CacheService.getScriptCache(), hit = cache.get('contenido_v1');
    if (hit) return { secciones: JSON.parse(hit) };
    const secciones = readAll('contenido').map((r) => ({ id: r.id, titulo: r.titulo, resumen: r.resumen, cuerpo: String(r.cuerpo) }));
    try { cache.put('contenido_v1', JSON.stringify(secciones), 300); } catch (e) {}
    return { secciones: secciones };
  },
  track: (b) => {
    const email = need(b.token, 'site');
    if (CLIENT_EVENTS.indexOf(b.tipo_evento) < 0) return { error: 'Evento no permitido' };
    const id = registrar(email, b.tipo_evento, { seccion: clean(b.seccion, 200), duracion: typeof b.duracion_segundos === 'number' ? b.duracion_segundos : undefined, dedupeMin: b.tipo_evento === 'reunion_agendada' ? 10 : 0 });
    return { id: id };
  },
  track_batch: (b) => {
    const email = need(b.token, 'site');
    const lista = (Array.isArray(b.events) ? b.events : []).slice(0, 60)
      .filter((e) => e && CLIENT_EVENTS.indexOf(e.tipo_evento) >= 0 && e.tipo_evento !== 'reunion_agendada')
      .map((e) => ({ tipo: e.tipo_evento, seccion: clean(e.seccion, 200), duracion: typeof e.duracion_segundos === 'number' ? e.duracion_segundos : undefined }));
    return { ok: true, n: registrarVarios(email, lista) };
  },
  track_dur: (b) => {
    const email = (readToken(b.token, 'dr') || readToken(b.token, 'site'));
    if (!email) throw new Error('AUTH');
    const id = Number(b.id), sh = db('eventos');
    if (id >= 2 && id <= sh.getLastRow() && sh.getRange(id, 2).getValue() === email) sh.getRange(id, 5).setValue(Math.max(0, Math.min(Math.round(Number(b.duracion_segundos) || 0), 14400)));
    return { ok: true };
  },
  mensaje: (b) => {
    const email = need(b.token, 'site');
    const txt = clean(b.mensaje, 2000);
    if (txt.length < 3) return { error: 'Mensaje vacío' };
    append('mensajes', { email: email, mensaje: txt, creado_en: nowIso() });
    const c = getContacto(email) || {};
    gchat('✉️ *Mensaje directo*\n' + (c.nombre || '') + ' <' + email + '>\n> ' + txt);
    return { ok: true };
  },
  privacy_delete: (b) => { const email = need(b.token, 'site'); eliminarContacto(email); gchat('🗑️ Un contacto ejerció su derecho de eliminación de datos (registro borrado).'); return { ok: true }; },

  /* ── data room ── */
  dr_request: (b) => {
    const email = normEmail(b.email), nombre = clean(b.nombre, 120);
    if (!validEmail(email) || !nombre) return { error: 'Faltan datos' };
    const c = getContacto(email);
    if (c && c.acceso_dataroom) return { ok: true, approved: true };
    const first = !(c && c.fecha_solicitud_dataroom);
    const now = nowIso();
    upsertContacto(email, Object.assign({ fecha_solicitud_dataroom: (c && c.fecha_solicitud_dataroom) || now }, c && c.nombre ? {} : { nombre: nombre, empresa: clean(b.empresa, 120) }, c && c.consentimiento_fecha ? {} : { consentimiento_fecha: now, consentimiento_version: TERMS_VERSION }));
    if (first) registrar(email, 'solicitud_acceso_dataroom');
    return { ok: true };
  },
  dr_otp_send: (b) => {
    const email = normEmail(b.email);
    if (!validEmail(email)) return { error: 'Correo inválido' };
    const c = getContacto(email);
    if (!c || !c.acceso_dataroom) return { status: 'denied', requested: !!(c && c.fecha_solicitud_dataroom) };
    const since = new Date(Date.now() - 3600000).toISOString();
    if (readAll('otp').filter((r) => r.email === email && String(r.creado_en) >= since).length >= 5) throw new Error('LIMIT:Demasiados intentos. Prueba en una hora.');
    const code = ('000000' + Math.floor(Math.random() * 1000000)).slice(-6);
    append('otp', { email: email, code_hash: otpHash(email, code), expira: new Date(Date.now() + 600000).toISOString(), intentos: 0, usado: false, creado_en: nowIso() });
    MailApp.sendEmail({
      to: email,
      subject: 'Tu código de acceso al data room de Lanek: ' + code,
      name: 'Lanek',
      htmlBody: '<div style="font-family:Arial,sans-serif;max-width:420px"><h2 style="color:#1170ee;margin:0 0 8px">Lanek · Data room</h2><p>Usa este código para acceder. Vence en 10 minutos.</p><p style="font-size:32px;letter-spacing:6px;font-weight:700;color:#0b1b3a">' + code + '</p><p style="color:#667">Si no lo solicitaste, ignora este correo.</p></div>',
    });
    return { status: 'sent' };
  },
  dr_otp_verify: (b) => {
    const email = normEmail(b.email), code = String(b.code || '').replace(/\D/g, '');
    if (code.length !== 6) return { error: 'Código inválido' };
    const c = getContacto(email);
    if (!c || !c.acceso_dataroom) return { error: 'Sin acceso' };
    const now = nowIso();
    const rows = readAll('otp').filter((r) => r.email === email && !bool(r.usado) && String(r.expira) > now);
    const row = rows[rows.length - 1];
    if (!row || Number(row.intentos) >= 5) return { error: 'Código vencido. Solicita uno nuevo.' };
    if (!safeEq(row.code_hash, otpHash(email, code))) { setCell('otp', row._row, 'intentos', Number(row.intentos) + 1); return { error: 'Código incorrecto' }; }
    setCell('otp', row._row, 'usado', true);
    registrar(email, 'dataroom_ingreso');
    return { ok: true, token: signToken('dr', email, DR_TTL) };
  },
  dr_session: (b) => { try { return { authed: !!needDr(b.token) }; } catch (e) { return { authed: false }; } },
  /** Árbol completo del data room en una sola llamada: el navegador navega y busca localmente (sin esperas por carpeta). */
  dr_tree: (b) => {
    needDr(b.token);
    const idx = b.refresh === true ? buildIndex() : driveIndex();
    return { rootId: idx.rootId, items: idx.items.map((n) => ({ id: n.id, name: n.name, isFolder: n.isFolder, mime: n.mime, size: n.size || 0, parent: n.parent, path: n.path })) };
  },
  /** Entrega el archivo (base64) solo si la sesión es válida y el archivo está dentro del data room.
   *  Archivos grandes: el navegador pide tramos en paralelo (b.part = 0,1,2…); cada tramo lee solo su rango de bytes. */
  dr_open: (b) => {
    const email = needDr(b.token);
    const id = String(b.id), node = driveIndex().items.filter((n) => n.id === id && !n.isFolder)[0];
    let file = null, name, mime, size, ruta;
    if (node) { name = node.name; mime = node.mime; size = node.size || 0; ruta = (node.path ? node.path + ' / ' : '') + node.name; }
    else { // archivo nuevo aún no indexado
      file = DriveApp.getFileById(id);
      if (!insideRoot(file)) throw new Error('AUTH');
      name = file.getName(); mime = file.getMimeType(); size = file.getSize(); ruta = pathOf(file); buildIndex();
    }
    const native = mime.indexOf('application/vnd.google-apps') === 0, dl = b.mode === 'download';
    const log = () => (dl ? (registrar(email, 'documento_descargado', { seccion: ruta }), null) : registrar(email, 'documento_abierto', { seccion: ruta }));
    if (!native && size > MAX_FILE_BYTES) return { error: 'Archivo demasiado grande para vista previa. Pide el enlace al equipo.' };

    if (b.part != null && !native) { // ── por tramos
      const part = Math.max(0, Math.floor(Number(b.part))), from = part * DR_CHUNK;
      if (from >= size) throw new Error('Tramo inválido');
      const to = Math.min(size, from + DR_CHUNK) - 1;
      const got = driveRange(id, from, to) || { bytes: (file || DriveApp.getFileById(id)).getBlob().getBytes().slice(from, to + 1), total: size };
      const out = { part: part, data: Utilities.base64Encode(got.bytes) };
      if (part === 0) { out.name = name; out.mime = mime; out.total = got.total || size; out.eventoId = log(); }
      return out;
    }
    file = file || DriveApp.getFileById(id);
    const bytes = (native ? file.getAs('application/pdf') : file.getBlob()).getBytes();
    if (bytes.length > MAX_FILE_BYTES) return { error: 'Archivo demasiado grande para vista previa. Pide el enlace al equipo.' };
    return { name: name + (native ? '.pdf' : ''), mime: native ? 'application/pdf' : mime, data: Utilities.base64Encode(bytes), eventoId: log() };
  },

  /* ── admin ── */
  admin_login: (b) => {
    const cache = CacheService.getScriptCache();
    const fails = Number(cache.get('adm_fail') || 0);
    if (fails >= 5) throw new Error('LIMIT:Demasiados intentos. Espera unos minutos.');
    const pw = prop('ADMIN_PASSWORD');
    if (!pw || !safeEq(String(b.password || ''), pw)) { cache.put('adm_fail', String(fails + 1), 300); return { error: 'Credenciales inválidas' }; }
    cache.remove('adm_fail');
    return { token: signToken('admin', 'admin', ADMIN_TTL) };
  },
  admin_list: (b) => {
    need(b.token, 'admin');
    const agg = {};
    readEventos(new Date(0)).forEach((e) => {
      const a = agg[e.email] || (agg[e.email] = { seg: 0, visitas: 0, last: '' });
      a.seg += Number(e.duracion_segundos) || 0;
      if (e.tipo_evento === 'primer_ingreso' || e.tipo_evento === 'ingreso_recurrente') a.visitas++;
      if (e.timestamp > a.last) a.last = e.timestamp;
    });
    return { contactos: readAll('contactos').map((c) => Object.assign(plain(c), { acceso_sitio: bool(c.acceso_sitio), acceso_dataroom: bool(c.acceso_dataroom) }, { agg: agg[c.email] || { seg: 0, visitas: 0, last: '' } })) };
  },
  admin_set: (b) => {
    need(b.token, 'admin');
    if (['acceso_sitio', 'acceso_dataroom'].indexOf(b.field) < 0) return { error: 'Campo inválido' };
    const c = getContacto(normEmail(b.email));
    if (!c) return { error: 'No existe' };
    setCell('contactos', c._row, b.field, b.value === true);
    return { ok: true };
  },
  admin_delete: (b) => { need(b.token, 'admin'); eliminarContacto(normEmail(b.email)); return { ok: true }; },
  admin_contacto: (b) => {
    need(b.token, 'admin');
    const email = normEmail(b.email), c = getContacto(email);
    if (!c) return { error: 'No existe' };
    return { contacto: plain(c), eventos: readEventos(new Date(0)).filter((e) => e.email === email) };
  },
  admin_agregado: (b) => {
    need(b.token, 'admin');
    const dias = Math.min(Math.max(Number(b.dias) || 30, 1), 365);
    return Object.assign({ dias: dias }, resumen(readEventos(new Date(Date.now() - dias * 86400000))));
  },
};

/* ───────────── helpers ───────────── */
function plain(c) { const o = {}; COLS.contactos.forEach((k) => (o[k] = c[k] instanceof Date ? c[k].toISOString() : c[k])); return o; }
function readEventos(since) {
  const iso = since.toISOString();
  return readAll('eventos').map((r) => ({ id: r.id, email: r.email, tipo_evento: r.tipo_evento, seccion: String(r.seccion), duracion_segundos: Number(r.duracion_segundos) || 0, timestamp: String(r.timestamp) })).filter((e) => e.timestamp >= iso);
}
function eliminarContacto(email) {
  withLock(() => {
    const c = getContacto(email);
    if (c) db('contactos').deleteRow(c._row);
    [['eventos', 2], ['otp', 1], ['mensajes', 1]].forEach((p) => {
      const sh = db(p[0]), last = sh.getLastRow();
      if (last < 2) return;
      const col = sh.getRange(2, p[1], last - 1, 1).getValues();
      for (let i = col.length - 1; i >= 0; i--) if (col[i][0] === email) sh.deleteRow(i + 2);
    });
  });
}
function resumen(evs) {
  const sec = {}, docs = {}, vis = {}, volvieron = {}, active = {}, v = { play: {}, p25: {}, p50: {}, p75: {}, p100: {}, audio: {} }, fit = { llegaron: {}, abrieron: {}, cta: {}, seg: 0 };
  let total = 0;
  evs.forEach((e) => {
    active[e.email] = 1;
    if (e.tipo_evento === 'primer_ingreso' || e.tipo_evento === 'ingreso_recurrente') vis[e.email] = 1;
    if (e.tipo_evento === 'ingreso_recurrente') volvieron[e.email] = 1;
    if (e.tipo_evento === 'seccion_vista' && e.seccion) {
      const s = sec[e.seccion] || (sec[e.seccion] = { seg: 0, vistas: 0, p: {} });
      s.seg += e.duracion_segundos; s.vistas++; s.p[e.email] = 1; total += e.duracion_segundos;
    }
    if (e.tipo_evento === 'seccion_vista' && e.seccion === 'fit') fit.llegaron[e.email] = 1;
    if (e.tipo_evento === 'fit_abierta') fit.abrieron[e.email] = 1;
    if (e.tipo_evento === 'fit_cta_click') fit.cta[e.email] = 1;
    if (e.tipo_evento === 'fit_visible_segundos') fit.seg += e.duracion_segundos;
    if (e.tipo_evento === 'documento_abierto' && e.seccion) docs[e.seccion] = (docs[e.seccion] || 0) + 1;
    if (e.tipo_evento === 'video_play') v.play[e.email] = 1;
    if (e.tipo_evento === 'video_audio_activado') v.audio[e.email] = 1;
    if (e.tipo_evento === 'video_progreso') { const k = { '25': 'p25', '50': 'p50', '75': 'p75', '100': 'p100' }[e.seccion]; if (k) v[k][e.email] = 1; }
  });
  const n = (o) => Object.keys(o).length;
  return {
    visitantes: n(vis), volvieron: Object.keys(volvieron), promedioSeg: n(active) ? total / n(active) : 0, totalSeg: total,
    secciones: Object.keys(sec).map((k) => ({ nombre: k, seg: sec[k].seg, vistas: sec[k].vistas, personas: n(sec[k].p) })).sort((a, b) => b.seg - a.seg),
    docs: Object.keys(docs).map((k) => [k, docs[k]]).sort((a, b) => b[1] - a[1]),
    fit: { llegaron: n(fit.llegaron), abrieron: n(fit.abrieron), cta: n(fit.cta), seg: fit.seg, quienes: Object.keys(fit.abrieron) },
    video: { play: n(v.play), p25: n(v.p25), p50: n(v.p50), p75: n(v.p75), p100: n(v.p100), audio: n(v.audio) },
  };
}
const fmtDur = (s) => (s >= 60 ? Math.floor(s / 60) + 'm ' + Math.round(s % 60) + 's' : Math.round(s) + 's');

/* ───────────── Drive ───────────── */
function rootFolder() { return DriveApp.getFolderById(prop('DRIVE_ROOT_ID')); }
function insideRoot(item) {
  const rootId = prop('DRIVE_ROOT_ID');
  let cur = item;
  for (let i = 0; i < 15; i++) {
    if (cur.getId() === rootId) return true;
    const ps = cur.getParents();
    if (!ps.hasNext()) return false;
    cur = ps.next();
  }
  return false;
}
function pathOf(item) {
  const rootId = prop('DRIVE_ROOT_ID'), names = [item.getName()];
  let cur = item;
  for (let i = 0; i < 15; i++) {
    const ps = cur.getParents();
    if (!ps.hasNext()) break;
    cur = ps.next();
    if (cur.getId() === rootId) break;
    names.unshift(cur.getName());
  }
  return names.join(' / ');
}
/** Lee un rango de bytes de un archivo por la API REST de Drive (mucho más rápido que getBlob() de todo el archivo). null si falla. */
const DR_CHUNK = 700000;
function driveRange(id, from, to) {
  try {
    const r = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(id) + '?alt=media&supportsAllDrives=true',
      { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken(), Range: 'bytes=' + from + '-' + to }, muteHttpExceptions: true });
    const c = r.getResponseCode(), h = r.getHeaders(), cr = String(h['Content-Range'] || h['content-range'] || '').match(/\/(\d+)$/);
    if (c !== 200 && c !== 206) return null;
    const bytes = r.getContent();
    return { bytes: c === 200 && from > 0 ? bytes.slice(from, to + 1) : bytes, total: cr ? Number(cr[1]) : null };
  } catch (e) { return null; }
}
/** Diagnóstico (ejecutar a mano en el editor): mide dónde se va el tiempo al abrir el archivo más grande del data room. */
function diagRapidez() {
  const t = () => Date.now(); let t0 = t();
  const idx = driveIndex(); console.log('índice', t() - t0, 'ms,', idx.items.length, 'elementos');
  const big = idx.items.filter((n) => !n.isFolder && n.size <= MAX_FILE_BYTES).sort((a, b) => (/deck/i.test(b.name) - /deck/i.test(a.name)) || (b.size || 0) - (a.size || 0))[0];
  console.log('archivo', big.name, big.size);
  t0 = t(); const f = DriveApp.getFileById(big.id); console.log('getFileById', t() - t0, 'ms');
  t0 = t(); const bytes = f.getBlob().getBytes(); console.log('getBlob().getBytes()', t() - t0, 'ms');
  t0 = t(); Utilities.base64Encode(bytes); console.log('base64 (todo)', t() - t0, 'ms');
  t0 = t(); const r = driveRange(big.id, 0, DR_CHUNK - 1); console.log('rango 1,5 MB (REST)', t() - t0, 'ms', r ? r.bytes.length + ' bytes, total ' + r.total : 'FALLÓ');
}
/** Índice plano del data room (id, nombre, carpeta padre, ruta, tamaño). Cacheado 6 h y reconstruido cada hora por trigger. */
const IDX_TTL = 21600;
function buildIndex() {
  const rootId = rootFolder().getId(), out = [];
  (function walk(folder, path) {
    const pid = folder.getId();
    const fs = folder.getFolders();
    while (fs.hasNext()) { const f = fs.next(); out.push({ id: f.getId(), name: f.getName(), isFolder: true, mime: 'folder', path: path, parent: pid }); walk(f, path ? path + ' / ' + f.getName() : f.getName()); }
    const fl = folder.getFiles();
    while (fl.hasNext()) { const f = fl.next(); out.push({ id: f.getId(), name: f.getName(), isFolder: false, mime: f.getMimeType(), size: f.getSize(), path: path, parent: pid }); }
  })(rootFolder(), '');
  const cache = CacheService.getScriptCache(), str = JSON.stringify({ rootId: rootId, items: out }), size = 90000, chunks = Math.ceil(str.length / size);
  if (chunks <= 40) {
    for (let k = 0; k < chunks; k++) cache.put('idx2_' + k, str.substr(k * size, size), IDX_TTL);
    cache.put('idx2_n', String(chunks), IDX_TTL);
  }
  return { rootId: rootId, items: out };
}
function driveIndex() {
  const cache = CacheService.getScriptCache(), n = Number(cache.get('idx2_n') || 0);
  if (n) {
    const keys = []; for (let k = 0; k < n; k++) keys.push('idx2_' + k);
    const got = cache.getAll(keys), parts = keys.map((k) => got[k]);
    if (parts.every((x) => x)) return JSON.parse(parts.join(''));
  }
  return buildIndex();
}
function reconstruirIndice() { buildIndex(); }

/* ───────────── triggers ───────────── */
function resumenDiario() {
  const r = resumen(readEventos(new Date(Date.now() - 86400000)));
  const top = r.secciones.slice(0, 3).map((s) => '• ' + s.nombre + ': ' + fmtDur(s.seg) + ' (' + s.personas + ' pers.)').join('\n') || '• (sin datos)';
  gchat('📊 *Resumen diario Lanek — inversionistas*\nVisitas del día: ' + r.visitantes + '\nTiempo promedio por visitante: ' + fmtDur(r.promedioSeg) + '\nSecciones más vistas:\n' + top + '\nAbrieron la sección de fit: ' + (r.fit.quienes.length ? r.fit.quienes.join(', ') : 'nadie') + '\nProspectos que volvieron: ' + (r.volvieron.length ? r.volvieron.join(', ') : 'ninguno'));
}
/** Detecta reservas nuevas de la página de citas de Google Calendar y las registra como reunion_agendada. */
function revisarReuniones() {
  const last = Number(prop('LAST_CAL_CHECK', String(Date.now() - 3600000)));
  const me = normEmail(Session.getEffectiveUser().getEmail()), filtro = prop('CAL_TITLE_FILTER').toLowerCase();
  CalendarApp.getDefaultCalendar().getEvents(new Date(Date.now() - 86400000), new Date(Date.now() + 120 * 86400000)).forEach((ev) => {
    if (ev.getDateCreated().getTime() <= last) return;
    ev.getGuestList().forEach((g) => {
      const email = normEmail(g.getEmail());
      if (!validEmail(email) || email === me) return;
      if (filtro && ev.getTitle().toLowerCase().indexOf(filtro) < 0) return; // opcional: propiedad CAL_TITLE_FILTER (título de tu página de citas)
      if (!getContacto(email)) return; // solo prospectos que ya ingresaron al sitio; nunca crea contactos desde el calendario
      registrar(email, 'reunion_agendada', { dedupeMin: 10 });
    });
  });
  props().setProperty('LAST_CAL_CHECK', String(Date.now()));
}

/* ───────────── instalación (ejecutar UNA vez) ───────────── */
function setup() {
  Object.keys(COLS).forEach((name) => {
    const sh = db(name), cols = COLS[name];
    sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold').setBackground('#eef2f7');
    sh.setFrozenRows(1);
    sh.getRange(2, 1, 1000, cols.length).setNumberFormat('@'); // texto plano: evita que Sheets convierta fechas/códigos
  });
  const ct = db('contactos');
  ct.getRange(2, 4, 1000, 2).setNumberFormat('General'); // acceso_sitio y acceso_dataroom: las casillas se agregan al crear cada contacto
  seedContenido(false);
  asegurarFit();
  secret();
  if (!prop('ADMIN_PASSWORD')) props().setProperty('ADMIN_PASSWORD', Utilities.getUuid().slice(0, 13));
  if (!prop('SUMMARY_HOUR')) props().setProperty('SUMMARY_HOUR', '18');
  if (!prop('SENSITIVE_REGEX')) props().setProperty('SENSITIVE_REGEX', 'ucc|contrato|financier|balance|estados? financ');
  instalarTriggers();
  const faltan = ['DRIVE_ROOT_ID', 'GCHAT_WEBHOOK'].filter((k) => !prop(k));
  Logger.log('✅ Listo. ADMIN_PASSWORD actual: ' + prop('ADMIN_PASSWORD') + ' (cámbiala en Configuración del proyecto → Propiedades de secuencia de comandos).');
  if (faltan.length) Logger.log('⚠️ Falta definir en Propiedades: ' + faltan.join(', '));
  Logger.log('Siguiente paso: Implementar → Nueva implementación → Aplicación web (Ejecutar como: Yo · Acceso: Cualquier persona) y copiar la URL /exec.');
}
function instalarTriggers() {
  ScriptApp.getProjectTriggers().forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('resumenDiario').timeBased().atHour(Number(prop('SUMMARY_HOUR', '18'))).everyDays(1).create();
  ScriptApp.newTrigger('revisarReuniones').timeBased().everyMinutes(10).create();
  ScriptApp.newTrigger('reconstruirIndice').timeBased().everyHours(1).create(); // mantiene tibio el índice del data room
}
/** Carga el contenido inicial de las secciones. Con overwrite=true reemplaza lo existente. */
function seedContenido(overwrite) {
  const sh = db('contenido');
  if (sh.getLastRow() > 1 && !overwrite) return;
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, 4).clearContent();
  const rows = DEFAULT_CONTENIDO.map((r) => [r.id, r.titulo, r.resumen, r.cuerpo]);
  sh.getRange(2, 1, rows.length, 4).setValues(rows);
}

/*
 * Formato de "cuerpo" (se edita directo en la pestaña "contenido" de la Sheet):
 *   - Cada línea es un párrafo.
 *   - "STAT::36%::texto" muestra una cifra destacada.
 *   - "IMG::torre-control.jpg" muestra una imagen del sitio.
 */
/** Tarjeta "¿Calzamos?" (se guarda en la pestaña contenido, id "fit"; no está en el repo público). Sintaxis: BLOQUE::ETIQUETA::texto ( || = salto de línea ). */
const FIT_ROW = { id: 'fit', titulo: '¿Calzamos?', resumen: 'Cosas que creemos que debes tener en cuenta:', cuerpo: [
  'BLOQUE::ETAPA::Empresa con ingresos recurrentes y creciente lanzando a mercado un nuevo producto global y escalable, el cual esta logrando las primeras ventas. Ronda puente vía SAFE, con cap y descuento para acelerar la entrada al mercado Chileno. Próxima Ronda será en 15 a 18 meses más (Pre Serie A) para consolidar chile y comenzar expansión por LATAM',
  'BLOQUE::TESIS::Healthtech B2B: Plataform de software e inteligencia clínica vendidos a prestadores de salud.||No somos B2C, ni dispositivos médicos, ni biotecnología.',
  'BLOQUE::GEOGRAFÍA Y HORIZONTE::LATAM hispanohablante, partiendo por Chile. Ventana base de salida 2033-2034. Hacia 2030, con operación en tres países, se abre un punto de inflexión de liquidez: una salida anticipada es posible, pero no es el supuesto de planificación.',
  'BLOQUE::DÓNDE ESTÁ EL RIESGO::El riesgo es comercial y de adopción institucional, no tecnológico ni clínico. El producto existe, el problema está validado y tenemos contratos firmados. Lo que falta probar es la velocidad de venta en un sector de ciclos largos y obtener evidencia con casos de negocio relevantes.',
].join('\n') };
/** Agrega la fila "fit" si no existe (idempotente). Ejecutar una vez tras actualizar el código. */
function asegurarFit() {
  if (readAll('contenido').some((r) => r.id === 'fit')) return;
  const sh = db('contenido');
  sh.getRange(sh.getLastRow() + 1, 1, 1, 4).setValues([[FIT_ROW.id, FIT_ROW.titulo, FIT_ROW.resumen, FIT_ROW.cuerpo]]);
}
const DEFAULT_CONTENIDO = [
  { id: 'problematica', titulo: 'Problemática', resumen: 'Más personas que esperan una cama.', cuerpo: [
    'El sistema de salud enfrenta un déficit crítico de camas hospitalarias, lo que genera largas listas de espera, saturación en hospitales y limita el acceso a una atención oportuna y de calidad.',
    'STAT::36%::de las camas existentes hoy en LATAM están en déficit',
    'IMG::desafio-pasillo.jpg',
    '[Completar con datos del deck: cifras de Chile, fuentes, costo del problema.]'].join('\n') },
  { id: 'solucion', titulo: 'Solución', resumen: 'Una nueva forma de ampliar la capacidad de atención.', cuerpo: [
    '¿Y si pudiéramos atender a más pacientes sin construir más camas? La tecnología permite llevar la atención más allá del hospital, conectando la monitorización remota con la hospitalización domiciliaria.',
    'STAT::25%::aumento de disponibilidad de camas',
    'STAT::80%::más económica que una cama hospitalaria',
    'STAT::5x::más pacientes por profesional (una enfermera gestiona hasta 5x más pacientes)',
    'Liberar camas → aumento del uso de quirófano: el 75% de las utilidades de un hospital proviene de la actividad en quirófano.'].join('\n') },
  { id: 'producto', titulo: 'Producto', resumen: 'Plataforma Inteligente de Hospital en Casa.', cuerpo: [
    'Lanek Home: una plataforma para apoyar la hospitalización domiciliaria mediante monitorización remota, información clínica y herramientas que facilitan el seguimiento de pacientes.',
    'Atención en casa y monitoreo remoto · Torre de control.',
    'IMG::torre-control.jpg',
    '[Completar con capturas, flujos clínicos y diferenciadores del deck.]'].join('\n') },
  { id: 'personas', titulo: 'Las Personas', resumen: 'El equipo detrás de Lanek.', cuerpo: '[Contenido del deck — equipo fundador, clínico y asesores.]' },
  { id: 'modelo', titulo: 'Modelo de Negocio y Mercado', resumen: 'Cómo generamos ingresos y tamaño de mercado.', cuerpo: '[Contenido del deck — modelo de negocio y mercado.]' },
  { id: 'traccion', titulo: 'Tracción y Roadmap', resumen: 'Hitos logrados y próximos pasos.', cuerpo: '[Contenido del deck — tracción y roadmap.]' },
];
