// Sirve apps-script/Code.gs en localhost:8790 para pegarlo en el editor de Apps Script (uso local de desarrollo).
import http from "http"; import fs from "fs"; import path from "path"; import { fileURLToPath } from "url";
const file = path.join(path.dirname(fileURLToPath(import.meta.url)), "../apps-script/Code.gs");
http.createServer((q, s) => { s.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Private-Network": "true" }); s.end(fs.readFileSync(file, "utf8")); }).listen(8790);
