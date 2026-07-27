// FocusPulse - Background Service Worker
// Rastrea el dominio activo, tiempo de permanencia, inactividad y envío al servidor

let currentDomain = null;
let startTime = null;
let accumulatedSeconds = 0;
let isIdle = false;

// Almacena datos pendientes de envío: { dominio: segundosAcumulados }
let pendingData = {};

// Alerta de distracción: dominios que ya recibieron notificación en esta sesión
const notifiedDomains = new Set();

// Umbral de distracción: 20 minutos (1200 segundos)
const DISTRACTION_THRESHOLD_SECONDS = 20 * 60;

// Dominios considerados de distracción/entretenimiento
const DISTRACTION_DOMAINS = [
  "youtube.com",
  "twitter.com",
  "x.com",
  "instagram.com",
  "facebook.com",
  "tiktok.com",
  "reddit.com",
  "twitch.tv",
  "netflix.com",
];

/**
 * Extrae el dominio principal de una URL.
 * Ej: "https://youtube.com/watch?v=123" -> "youtube.com"
 */
function extractDomain(url) {
  try {
    const hostname = new URL(url).hostname;
    return hostname.replace(/^www\./, "");
  } catch (e) {
    return null;
  }
}

/**
 * Pausa el tracking: acumula el tiempo transcurrido desde startTime.
 */
function pauseTracking() {
  if (currentDomain && startTime) {
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    accumulatedSeconds += elapsed;
    startTime = null;
    console.log(`[FocusPulse] Tracking pausado para ${currentDomain} | Acumulado: ${accumulatedSeconds}s`);
  }
}

/**
 * Reanuda el tracking: reinicia startTime para seguir contando.
 */
function resumeTracking() {
  if (currentDomain) {
    startTime = Date.now();
    console.log(`[FocusPulse] Tracking reanudado para ${currentDomain}`);
  }
}

/**
 * Registra el tiempo acumulado del dominio actual en pendingData.
 */
function flushCurrentDomain() {
  if (!currentDomain) return;

  let total = accumulatedSeconds;
  if (startTime) {
    total += Math.round((Date.now() - startTime) / 1000);
  }

  if (total > 0) {
    pendingData[currentDomain] = (pendingData[currentDomain] || 0) + total;
  }
}

/**
 * Verifica si el dominio actual es de distracción.
 */
function isDistractionDomain(domain) {
  if (!domain) return false;
  return DISTRACTION_DOMAINS.some(
    (d) => domain === d || domain.endsWith("." + d)
  );
}

/**
 * Verifica si el usuario lleva más de 20 min en un sitio de distracción.
 * Lanza una notificación nativa una sola vez por sesión en ese dominio.
 */
function checkDistractionAlert() {
  if (!currentDomain || !startTime || isIdle) return;

  // Solo verificar si es un sitio de distracción
  if (!isDistractionDomain(currentDomain)) return;

  // Solo notificar una vez por dominio por sesión
  if (notifiedDomains.has(currentDomain)) return;

  const totalTime = accumulatedSeconds + Math.round((Date.now() - startTime) / 1000);

  if (totalTime >= DISTRACTION_THRESHOLD_SECONDS) {
    chrome.notifications.create(`distraction-${currentDomain}`, {
      type: "basic",
      iconUrl: "assets/icons/icon.png",
      title: "¡Atención!",
      message: `Llevas más de 20 minutos en ${currentDomain}. ¿Volvemos al flujo?`,
    });

    notifiedDomains.add(currentDomain);
    console.log(`[FocusPulse] Alerta de distracción enviada para ${currentDomain}`);
  }
}

/**
 * Procesa la pestaña activa: extrae el dominio y registra el tiempo.
 */
function trackActiveTab(tab) {
  if (!tab || !tab.url) return;

  const domain = extractDomain(tab.url);
  if (!domain) return;

  // Si cambió el dominio, registrar tiempo del anterior
  if (currentDomain && currentDomain !== domain) {
    flushCurrentDomain();
    console.log(`[FocusPulse] Dominio anterior: ${currentDomain} | Tiempo total: ${accumulatedSeconds}s`);
  }

  // Actualizar dominio activo si cambió
  if (currentDomain !== domain) {
    currentDomain = domain;
    accumulatedSeconds = 0;
    startTime = isIdle ? null : Date.now();
    console.log(`[FocusPulse] Dominio activo: ${currentDomain}`);
  }
}

/**
 * Obtiene el usuario_id (email) guardado en chrome.storage.local.
 * Retorna null si no hay usuario logueado.
 */
async function getUsuarioId() {
  const result = await chrome.storage.local.get("usuario_id");
  return result.usuario_id || null;
}

/**
 * Envía los datos acumulados al servidor local vía POST.
 * Solo envía si hay un usuario logueado (email en storage).
 */
async function sendDataToServer() {
  // Verificar que haya un usuario logueado
  const usuarioId = await getUsuarioId();
  if (!usuarioId) {
    console.log("[FocusPulse] Sin usuario logueado. No se envían datos.");
    return;
  }

  // Incluir el dominio actual antes de enviar
  flushCurrentDomain();

  if (Object.keys(pendingData).length === 0) {
    console.log("[FocusPulse] Sin datos para enviar.");
    return;
  }

  // Enviar cada dominio como un request individual al endpoint
  const domains = Object.entries(pendingData);
  let allSent = true;

  for (const [dominio, segundos] of domains) {
    const payload = {
      usuario_id: usuarioId,
      dominio,
      segundos,
    };

    console.log("[FocusPulse] Enviando:", JSON.stringify(payload));

    try {
      const response = await fetch("http://127.0.0.1:8000/api/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        console.log(`[FocusPulse] Datos enviados para ${dominio}.`);
      } else {
        console.warn(`[FocusPulse] Error del servidor: ${response.status}`);
        allSent = false;
      }
    } catch (e) {
      console.error("[FocusPulse] Error al enviar datos:", e);
      allSent = false;
    }
  }

  if (allSent) {
    pendingData = {};
  }

  // Reiniciar conteo del dominio actual (ya se envió)
  accumulatedSeconds = 0;
  if (currentDomain && !isIdle) {
    startTime = Date.now();
  }
}

// --- Listeners ---

// Detectar cuando se cambia de pestaña
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    trackActiveTab(tab);
  } catch (e) {
    console.error("[FocusPulse] Error al obtener pestaña activa:", e);
  }
});

// --- Modo Enfoque: Bloqueo de sitios de distracción ---

const BLOCKED_DOMAINS = DISTRACTION_DOMAINS; // Reutilizar la misma lista

/**
 * Verifica si una URL pertenece a un dominio bloqueado.
 */
function isBlockedDomain(url) {
  const domain = extractDomain(url);
  if (!domain) return false;
  return BLOCKED_DOMAINS.some(
    (blocked) => domain === blocked || domain.endsWith("." + blocked)
  );
}

/**
 * Verifica si el Modo Enfoque está activo y no ha expirado.
 */
async function isFocusModeActive() {
  const result = await chrome.storage.local.get(["modo_enfoque", "focus_end_time"]);
  if (!result.modo_enfoque || !result.focus_end_time) return false;

  if (Date.now() >= result.focus_end_time) {
    // El tiempo terminó, desactivar
    await chrome.storage.local.set({ modo_enfoque: false, focus_end_time: 0 });
    // Notificar al usuario
    chrome.notifications.create("focus-end", {
      type: "basic",
      iconUrl: "assets/icons/icon.png",
      title: "FocusPulse",
      message: "¡Tiempo de enfoque completado! Buen trabajo. Tómate un descanso.",
    });
    console.log("[FocusPulse] Modo Enfoque terminado (25 min completados).");
    return false;
  }

  return true;
}

// Interceptar navegación para bloquear sitios durante Modo Enfoque
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // Tracking de dominio activo (funcionalidad existente)
  if (changeInfo.status === "complete" && tab.active) {
    trackActiveTab(tab);
  }

  // Bloqueo de Modo Enfoque
  if (changeInfo.url || changeInfo.status === "loading") {
    const url = changeInfo.url || tab.url;
    if (!url) return;

    const focusActive = await isFocusModeActive();
    if (focusActive && isBlockedDomain(url)) {
      const blockedUrl = chrome.runtime.getURL("blocked.html");
      chrome.tabs.update(tabId, { url: blockedUrl });
      console.log(`[FocusPulse] Bloqueado: ${url}`);
    }
  }
});

// Escuchar mensajes del popup/blocked.html
chrome.runtime.onMessage.addListener((message) => {
  if (message.action === "disable_focus_mode") {
    console.log("[FocusPulse] Modo Enfoque desactivado por el usuario.");
  }
});

// Verificar expiración del Modo Enfoque periódicamente
setInterval(async () => {
  await isFocusModeActive(); // Esto desactiva automáticamente si expiró
}, 10000);

// --- Envío periódico de datos cada 30 segundos ---

// Configurar umbral de inactividad a 3 minutos (180 segundos)
chrome.idle.setDetectionInterval(180);

chrome.idle.onStateChanged.addListener((newState) => {
  console.log(`[FocusPulse] Estado de actividad: ${newState}`);

  if (newState === "idle" || newState === "locked") {
    isIdle = true;
    pauseTracking();
  } else if (newState === "active") {
    isIdle = false;
    resumeTracking();
  }
});

// --- Envío periódico de datos cada 30 segundos ---
setInterval(() => {
  sendDataToServer();
}, 30000);

// Log periódico del tiempo en el dominio actual (cada 5 segundos)
setInterval(() => {
  if (currentDomain && startTime && !isIdle) {
    const total = accumulatedSeconds + Math.round((Date.now() - startTime) / 1000);
    console.log(`[FocusPulse] Dominio activo: ${currentDomain} | Tiempo acumulado: ${total}s`);

    // Verificar si lleva demasiado tiempo en un sitio de distracción
    checkDistractionAlert();
  }
}, 5000);
