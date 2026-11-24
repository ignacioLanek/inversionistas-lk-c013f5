// ÚNICO archivo a editar tras desplegar el backend (no contiene secretos: estos valores son públicos por diseño).
window.LANEK = {
  // URL de la implementación de Apps Script (termina en /exec). En localhost usa el servidor simulado.
  API_URL: location.hostname === "localhost" ? "/api" : "https://script.google.com/macros/s/AKfycbwxNTahsFyQRbhG-E2zhO0idCBHjvOljiPegR8bFZpcjNg4IbewgwAfpvu5uhKXnTyJkg/exec",
  // ID del video de YouTube (no listado), ej. "dQw4w9WgXcQ". Vacío = muestra un placeholder.
  YT_ID: "",
  // Página de reserva de Google Calendar ("Lanek Invest"). CAL_URL se inserta en el sitio (?gv=true); CAL_LINK es el enlace corto de respaldo.
  CAL_URL: "https://calendar.google.com/calendar/appointments/schedules/AcZssZ3OyrGgUdZ1UFGqNaVk5ffUgledQHEJuq-54k8Nf40NTir9GqtN30No3IeonYIrn72M1_XQ-OVx?gv=true&hl=es",
  CAL_LINK: "https://calendar.app.google/pjgcvJbFxePcTc69A",
  PRIVACY_EMAIL: "ignacio@lanek.cl",
};
