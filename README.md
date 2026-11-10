# Lanek · Sitio privado para inversionistas

Sitio **estático** (GitHub Pages) + backend en **Google Apps Script** (Sheets = base de datos, Drive = data room, MailApp = códigos, Calendar, Chat). Todo gratis con tu Google Workspace.

```
index.html · admin.html · terminos.html   ← sitio (GitHub Pages)
assets/js/config.js                       ← único archivo a editar tras desplegar
apps-script/Code.gs                       ← backend (se pega en Apps Script)
dev/server.mjs                            ← simulador local: node dev/server.mjs → http://localhost:8787
_nextjs/                                  ← versión anterior (Vercel/Supabase), archivada, no se publica
```

## Backend (≈10 min, una sola vez)
1. Crea una **Google Sheet** nueva (ej. "Lanek · Inversionistas DB") → **Extensiones → Apps Script**.
2. Pega el contenido de `apps-script/Code.gs`. En *Configuración del proyecto* activa "Mostrar appsscript.json" y pega `apps-script/appsscript.json`.
3. **Propiedades de la secuencia de comandos** (Configuración → abajo) → agrega:
   - `DRIVE_ROOT_ID` = ID de la carpeta raíz del data room en Drive (lo que va después de `/folders/` en la URL).
   - `GCHAT_WEBHOOK` = URL del webhook del space (Chat → Apps e integraciones → Webhooks).
   - Opcionales: `ADMIN_PASSWORD` (si no, `setup()` genera una y la muestra en el registro), `SUMMARY_HOUR` (hora del resumen diario, default 18), `SENSITIVE_REGEX`.
4. Ejecuta la función **`setup`** (autoriza los permisos: Sheets, Drive, Correo, Calendar, Chat/UrlFetch). Crea pestañas, checkboxes de permisos, contenido inicial y los triggers (resumen diario + detección de reuniones).
5. **Implementar → Nueva implementación → Aplicación web** · Ejecutar como: *Yo* · Quién tiene acceso: *Cualquier persona*. Copia la URL `/exec`.
6. En `assets/js/config.js` pega esa URL en `API_URL`, el ID del video de YouTube (no listado) en `YT_ID` y la URL de tu página de citas de Google Calendar en `CAL_URL`. Commit + push.

Cada vez que cambies `Code.gs`: Implementar → **Administrar implementaciones → editar → Nueva versión** (la URL se mantiene).

## Operación
- **Aprobar accesos**: dashboard `admin.html` (contraseña = `ADMIN_PASSWORD`) o directo en la pestaña `contactos` de la Sheet (casillas `acceso_sitio` / `acceso_dataroom`).
- **Contenido de las 6 tarjetas**: pestaña `contenido` de la Sheet. Una línea = un párrafo; `STAT::36%::texto` cifra destacada; `IMG::archivo.jpg` imagen de `assets/img/`. El contenido NO está en el repo público: solo se entrega tras ingresar.
- **Reuniones**: crea una *Programación de citas* en Google Calendar → compártela → pega el enlace en `CAL_URL`. Un trigger cada 10 min detecta reservas nuevas y avisa a Chat.
- **Video**: sube a YouTube como *No listado*, con subtítulos en español (el reproductor los activa por defecto).
- **Dominio propio**: añade un archivo `CNAME` con `inversionistas.lanek.cl` y en tu DNS un CNAME a `<usuario>.github.io`.

## Límites a conocer
- **Repo público**: GitHub Pages gratis exige repo público. No hay secretos en él (la URL `/exec` es pública por diseño); lo sensible vive detrás del backend.
- **Sin "URL firmada" real**: Apps Script no puede servir binarios por URL, así que el archivo viaja en base64 solo si la sesión del data room es válida y el archivo está dentro de la carpeta raíz. Se muestra con PDF.js (sin botón de descarga propio), pero un usuario técnico podría capturarlo: es disuasión, no DRM. Archivos > 25 MB no se previsualizan.
- **Marca de agua**: no incluida en esta versión (requiere procesar PDF en servidor).
- **Cuotas Apps Script** (cuenta Workspace): ~1.500 correos/día, 6 h de ejecución/día: sobra para esta escala. La latencia por llamada es ~1 s.
- Identificación del sitio solo por correo (como se pidió): lo sensible está en el data room con OTP.
- Ley 21.719: consentimiento con fecha y versión guardados, "Eliminar mis datos" borra el registro. Falta texto legal definitivo (`terminos.html` es plantilla) y política de retención.
