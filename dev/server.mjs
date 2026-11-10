// Servidor de DESARROLLO: sirve el sitio estático y ejecuta el Code.gs REAL con servicios de Google simulados en memoria.
// Uso: node dev/server.mjs   →  http://localhost:8787   (admin: contraseña "lanek-dev")
import http from "http";
import fs from "fs";
import path from "path";
import vm from "vm";
import crypto from "crypto";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT || 8787);

/* ── Hojas simuladas ── */
const sheets = new Map();
class Range {
  constructor(sh, r, c, nr, nc) { Object.assign(this, { sh, r, c, nr, nc }); }
  _cell(i, j) { return (this.sh.rows[this.r - 1 + i] || [])[this.c - 1 + j]; }
  getValues() { return Array.from({ length: this.nr }, (_, i) => Array.from({ length: this.nc }, (_, j) => this._cell(i, j) ?? "")); }
  getValue() { return this._cell(0, 0) ?? ""; }
  setValues(v) { v.forEach((row, i) => row.forEach((x, j) => this._set(i, j, x))); return this; }
  setValue(x) { this._set(0, 0, x); return this; }
  _set(i, j, x) { const R = this.r - 1 + i; while (this.sh.rows.length <= R) this.sh.rows.push([]); this.sh.rows[R][this.c - 1 + j] = x; }
  clearContent() { for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) this._set(i, j, ""); return this; }
  createTextFinder(t) {
    const f = { cs: false, whole: false };
    const self = this;
    const o = {
      matchEntireCell(b) { f.whole = b; return o; }, matchCase(b) { f.cs = b; return o; },
      findNext() {
        for (let i = 0; i < self.nr; i++) {
          const v = String(self._cell(i, 0) ?? "");
          if ((f.whole ? v.toLowerCase() === t.toLowerCase() : v.includes(t)) ) return { getRow: () => self.r + i };
        }
        return null;
      },
    };
    return o;
  }
  setNumberFormat() { return this; } insertCheckboxes() { return this; } setFontWeight() { return this; } setBackground() { return this; }
}
const mkSheet = (name) => {
  const sh = { name, rows: [], getLastRow() { let n = this.rows.length; while (n > 0 && this.rows[n - 1].every((x) => x === "" || x === undefined)) n--; return n; },
    getRange(r, c, nr = 1, nc = 1) { return new Range(sh, r, c, nr, nc); },
    appendRow(a) { sh.rows[sh.getLastRow()] = a; }, deleteRow(r) { sh.rows.splice(r - 1, 1); }, setFrozenRows() {} };
  return sh;
};
const ss = { getSheetByName: (n) => sheets.get(n) || null, insertSheet: (n) => (sheets.set(n, mkSheet(n)), sheets.get(n)) };

/* ── Drive simulado: Data room / (Finanzas, Legal) con el PDF de demo ── */
const pdf = fs.existsSync(path.join(root, "dev/demo.pdf")) ? fs.readFileSync(path.join(root, "dev/demo.pdf")) : Buffer.from("%PDF-1.4\n%%EOF");
const FT = {};
const node = (id, name, mime, parent) => (FT[id] = { id, name, mime, parent });
node("root", "Data room", "folder", null);
node("f1", "1. Corporativo", "folder", "root"); node("f2", "2. Finanzas", "folder", "root"); node("f3", "3. Legal", "folder", "root");
node("d1", "Pitch Deck Lanek.pdf", "application/pdf", "f1");
node("d2", "Estados financieros 2025.pdf", "application/pdf", "f2");
node("d3", "Contrato UCC.pdf", "application/pdf", "f3");
const asFolder = (n) => ({ getId: () => n.id, getName: () => n.name, getParents: () => it(n.parent ? [asFolder(FT[n.parent])] : []),
  getFolders: () => it(Object.values(FT).filter((x) => x.parent === n.id && x.mime === "folder").map(asFolder)),
  getFiles: () => it(Object.values(FT).filter((x) => x.parent === n.id && x.mime !== "folder").map(asFile)) });
const asFile = (n) => ({ getId: () => n.id, getName: () => n.name, getMimeType: () => n.mime, getSize: () => pdf.length, getLastUpdated: () => new Date(),
  getParents: () => it([asFolder(FT[n.parent])]), getBlob: () => ({ getBytes: () => [...pdf] }), getAs: () => ({ getBytes: () => [...pdf] }) });
const it = (arr) => { let i = 0; return { hasNext: () => i < arr.length, next: () => arr[i++] }; };

/* ── Servicios de Apps Script simulados ── */
const propsStore = { ADMIN_PASSWORD: "lanek-dev", DRIVE_ROOT_ID: "root", GCHAT_WEBHOOK: "http://simulado", SESSION_SECRET: crypto.randomBytes(24).toString("hex") };
const cacheStore = new Map();
const sandbox = {
  console, Date, Math, JSON, String, Number, Object, Array, RegExp, Error, Set, Promise,
  SpreadsheetApp: { getActiveSpreadsheet: () => ss },
  PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => propsStore[k] ?? null, setProperty: (k, v) => (propsStore[k] = v) }) },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  CacheService: { getScriptCache: () => ({ get: (k) => cacheStore.get(k) ?? null, put: (k, v) => cacheStore.set(k, v), remove: (k) => cacheStore.delete(k) }) },
  Utilities: {
    getUuid: () => crypto.randomUUID(),
    base64EncodeWebSafe: (x) => (typeof x === "string" ? Buffer.from(x) : Buffer.from(x)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_"),
    base64DecodeWebSafe: (s) => [...Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64")],
    base64Encode: (bytes) => Buffer.from(bytes).toString("base64"),
    computeHmacSha256Signature: (d, k) => [...crypto.createHmac("sha256", k).update(d).digest()],
    computeDigest: (_a, s) => [...crypto.createHash("sha256").update(s).digest()],
    DigestAlgorithm: { SHA_256: 1 },
    newBlob: (bytes) => ({ getDataAsString: () => Buffer.from(bytes).toString("utf8") }),
  },
  MailApp: { sendEmail: (m) => { const c = m.htmlBody.match(/>(\d{6})</)?.[1]; console.log(`[correo → ${m.to}] código: ${c}`); sandbox.__lastCode = c; } },
  UrlFetchApp: { fetch: (u, o) => console.log("[gchat]", JSON.parse(o.payload).text.replace(/\n/g, " | ")) },
  ContentService: { MimeType: { JSON: "json" }, createTextOutput: (t) => ({ t, setMimeType() { return this; } }) },
  DriveApp: { getFolderById: (id) => asFolder(FT[id]), getFileById: (id) => asFile(FT[id]) },
  ScriptApp: { getProjectTriggers: () => [], deleteTrigger() {}, newTrigger: () => { const t = { timeBased: () => t, atHour: () => t, everyDays: () => t, everyMinutes: () => t, create() {} }; return t; } },
  CalendarApp: { getDefaultCalendar: () => ({ getEvents: () => [] }) },
  Session: { getEffectiveUser: () => ({ getEmail: () => "owner@lanek.cl" }) },
  Logger: { log: console.log },
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(root, "apps-script/Code.gs"), "utf8"), sandbox);
vm.runInContext("setup()", sandbox);
console.log("Backend simulado listo (setup() ejecutado).");

const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml" };
http.createServer((req, res) => {
  if (req.url.startsWith("/api")) {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      sandbox.__e = { postData: { contents: body } };
      try {
        const out = JSON.parse(vm.runInContext("doPost(__e).t", sandbox));
        if (out.status === "sent") out.devCode = sandbox.__lastCode; // solo en desarrollo
        res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(out));
      } catch (e) { console.error(e); res.writeHead(500); res.end("{}"); }
    });
    return;
  }
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p === "/") p = "/index.html";
  const f = path.join(root, p);
  if (!f.startsWith(root) || f.includes("/_nextjs") || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end("404"); }
  res.writeHead(200, { "Content-Type": mime[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
}).listen(PORT, () => console.log(`http://localhost:${PORT}`));
