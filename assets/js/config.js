// ÚNICO archivo a editar tras desplegar el backend (no contiene secretos: estos valores son públicos por diseño).
window.LANEK = {
  // URL de la implementación de Apps Script (termina en /exec). En localhost usa el servidor simulado.
  API_URL: location.hostname === "localhost" ? "/api" : "https://script.google.com/macros/s/AKfycbwxNTahsFyQRbhG-E2zhO0idCBHjvOljiPegR8bFZpcjNg4IbewgwAfpvu5uhKXnTyJkg/exec",
  // ID del video de YouTube (no listado), ej. "dQw4w9WgXcQ". Vacío = muestra un placeholder.
  YT_ID: "",
  // URL de la página de reserva de Google Calendar (Programación de citas → Compartir → "Insertar"/enlace).
  CAL_URL: "",
  PRIVACY_EMAIL: "ignacio@lanek.cl",
};
