// FocusPulse Dashboard - app.js
// Autenticación con Google Identity Services + Chart.js + IA local

const API_BASE = "http://127.0.0.1:8000/api/stats";
const GOOGLE_CLIENT_ID = "789113271385-0k99ga4bvdi7g501k240tlgs3sg8vdkg.apps.googleusercontent.com";

// Paleta de colores para el gráfico
const COLORS = [
  "#6366f1", "#8b5cf6", "#ec4899", "#f43f5e", "#f97316",
  "#eab308", "#22c55e", "#14b8a6", "#06b6d4", "#3b82f6",
];

const DEFAULT_TIP =
  "Intenta aplicar la técnica Pomodoro: trabaja 25 minutos enfocado y descansa 5. Tu productividad mejora cuando alternas períodos de concentración con pausas breves.";

let chart = null;
let refreshInterval = null;

// --- Utilidades ---

function formatTime(seconds) {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins < 60) return `${mins}m ${secs}s`;
  const hours = Math.floor(mins / 60);
  const remainMins = mins % 60;
  return `${hours}h ${remainMins}m`;
}

/**
 * Decodifica un JWT (parte payload) sin librería externa.
 */
function decodeJwt(token) {
  const base64Url = token.split(".")[1];
  const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
  const jsonPayload = decodeURIComponent(
    atob(base64)
      .split("")
      .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
      .join("")
  );
  return JSON.parse(jsonPayload);
}

// --- Google Identity Services ---

function initGoogleSignIn() {
  google.accounts.id.initialize({
    client_id: GOOGLE_CLIENT_ID,
    callback: handleCredentialResponse,
  });

  google.accounts.id.renderButton(document.getElementById("google-btn"), {
    theme: "filled_blue",
    size: "large",
    shape: "pill",
    text: "signin_with",
    locale: "es",
  });
}

function handleCredentialResponse(response) {
  const payload = decodeJwt(response.credential);
  const user = {
    email: payload.email,
    name: payload.name || payload.email,
    picture: payload.picture || "",
  };

  // Guardar en localStorage
  localStorage.setItem("fp_email", user.email);
  localStorage.setItem("fp_name", user.name);
  localStorage.setItem("fp_picture", user.picture);

  showDashboard(user);
}

// --- UI: Login / Dashboard ---

function showLogin() {
  document.getElementById("login-screen").classList.remove("hidden");
  document.getElementById("dashboard-screen").classList.add("hidden");
  if (refreshInterval) clearInterval(refreshInterval);
}

function showDashboard(user) {
  document.getElementById("login-screen").classList.add("hidden");
  document.getElementById("dashboard-screen").classList.remove("hidden");

  document.getElementById("user-photo").src = user.picture;
  document.getElementById("user-email").textContent = user.email;

  // Cargar datos inmediatamente
  fetchAndRender(user.email);
  fetchAndGenerateTip(user.email);

  // Actualizar cada 30 segundos
  refreshInterval = setInterval(() => fetchAndRender(user.email), 30000);
  // Actualizar consejo cada 5 minutos
  setInterval(() => fetchAndGenerateTip(user.email), 300000);
}

function logout() {
  localStorage.removeItem("fp_email");
  localStorage.removeItem("fp_name");
  localStorage.removeItem("fp_picture");
  google.accounts.id.disableAutoSelect();
  showLogin();
}

// --- Chart.js: Gráfico de Dona ---

function renderChart(data) {
  const canvas = document.getElementById("doughnut-chart");
  const emptyMsg = document.getElementById("chart-empty");
  const ctx = canvas.getContext("2d");

  const domains = Object.keys(data);
  const seconds = Object.values(data);

  if (domains.length === 0) {
    emptyMsg.classList.remove("hidden");
    if (chart) { chart.destroy(); chart = null; }
    return;
  }

  emptyMsg.classList.add("hidden");
  if (chart) chart.destroy();

  chart = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: domains,
      datasets: [{
        data: seconds,
        backgroundColor: COLORS.slice(0, domains.length),
        borderColor: "#1e293b",
        borderWidth: 2,
      }],
    },
    options: {
      responsive: true,
      plugins: {
        legend: {
          position: "bottom",
          labels: { color: "#cbd5e1", padding: 16, font: { size: 12 } },
        },
        tooltip: {
          callbacks: {
            label: (context) => {
              const total = context.dataset.data.reduce((a, b) => a + b, 0);
              const pct = ((context.raw / total) * 100).toFixed(1);
              return ` ${context.label}: ${formatTime(context.raw)} (${pct}%)`;
            },
          },
        },
      },
    },
  });
}

function renderStats(data) {
  const list = document.getElementById("stats-list");
  const domains = Object.entries(data);

  if (domains.length === 0) {
    list.innerHTML = '<li class="text-slate-500">Sin datos disponibles aún.</li>';
    return;
  }

  domains.sort((a, b) => b[1] - a[1]);
  const totalSeconds = domains.reduce((sum, [, s]) => sum + s, 0);

  list.innerHTML = domains
    .map(([domain, seconds], i) => {
      const pct = ((seconds / totalSeconds) * 100).toFixed(1);
      const color = COLORS[i % COLORS.length];
      return `
        <li class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span class="w-2.5 h-2.5 rounded-full" style="background:${color}"></span>
            <span>${domain}</span>
          </div>
          <span class="text-slate-400">${formatTime(seconds)} (${pct}%)</span>
        </li>`;
    })
    .join("");
}

// --- Fetch de datos ---

// Dominios considerados de productividad/desarrollo
const PRODUCTIVE_DOMAINS = [
  "github.com", "gitlab.com", "bitbucket.org",
  "stackoverflow.com", "stackexchange.com",
  "developer.mozilla.org", "docs.google.com",
  "notion.so", "linear.app", "jira.atlassian.com",
  "figma.com", "vercel.com", "netlify.com",
  "aws.amazon.com", "cloud.google.com",
  "learn.microsoft.com", "udemy.com", "coursera.org",
  "freecodecamp.org", "medium.com", "dev.to",
];

// Dominios considerados de redes sociales/distracción
const SOCIAL_DOMAINS = [
  "youtube.com", "twitter.com", "x.com",
  "instagram.com", "facebook.com", "tiktok.com",
  "reddit.com", "twitch.tv", "netflix.com",
  "snapchat.com", "pinterest.com",
];

/**
 * Evalúa las insignias basado en los datos de navegación.
 */
function evaluarInsignias(data) {
  const container = document.getElementById("badges-container");
  const entries = Object.entries(data);

  if (entries.length === 0) {
    container.innerHTML = '<p class="text-slate-500 text-sm col-span-full">Navega un poco más para desbloquear insignias.</p>';
    return;
  }

  const totalSeconds = entries.reduce((sum, [, s]) => sum + s, 0);

  // Calcular tiempo en dominios productivos
  const productiveSeconds = entries
    .filter(([domain]) => PRODUCTIVE_DOMAINS.some((pd) => domain === pd || domain.endsWith("." + pd)))
    .reduce((sum, [, s]) => sum + s, 0);

  // Calcular tiempo en redes sociales
  const socialSeconds = entries
    .filter(([domain]) => SOCIAL_DOMAINS.some((sd) => domain === sd || domain.endsWith("." + sd)))
    .reduce((sum, [, s]) => sum + s, 0);

  // Definir insignias
  const badges = [
    {
      id: "racha-foco",
      icon: "🥇",
      title: "Racha de Foco",
      description: "Más de 2 horas en sitios de desarrollo/productividad",
      unlocked: productiveSeconds >= 7200,
      progress: Math.min(100, Math.round((productiveSeconds / 7200) * 100)),
    },
    {
      id: "mente-zen",
      icon: "🧘",
      title: "Mente Zen",
      description: "Redes sociales por debajo del 10% del tiempo total",
      unlocked: totalSeconds > 0 && (socialSeconds / totalSeconds) < 0.10,
      progress: totalSeconds > 0
        ? Math.min(100, Math.round(((1 - socialSeconds / totalSeconds) / 0.9) * 100))
        : 0,
    },
  ];

  container.innerHTML = badges
    .map((badge) => {
      if (badge.unlocked) {
        return `
          <div class="bg-gradient-to-br from-amber-900/40 to-yellow-900/30 border border-amber-600/50 rounded-2xl p-5 shadow-lg">
            <div class="flex items-center gap-3 mb-2">
              <span class="text-3xl">${badge.icon}</span>
              <div>
                <h3 class="font-semibold text-amber-200">${badge.title}</h3>
                <p class="text-xs text-amber-300/80">${badge.description}</p>
              </div>
            </div>
            <div class="mt-3 flex items-center gap-2">
              <div class="flex-1 h-2 bg-amber-900/50 rounded-full overflow-hidden">
                <div class="h-full bg-amber-400 rounded-full" style="width:100%"></div>
              </div>
              <span class="text-xs text-amber-300 font-semibold">✓</span>
            </div>
          </div>`;
      } else {
        return `
          <div class="bg-slate-800/60 border border-slate-700 rounded-2xl p-5 shadow-lg opacity-60 grayscale">
            <div class="flex items-center gap-3 mb-2">
              <span class="text-3xl">🔒</span>
              <div>
                <h3 class="font-semibold text-slate-400">${badge.title}</h3>
                <p class="text-xs text-slate-500">${badge.description}</p>
              </div>
            </div>
            <div class="mt-3 flex items-center gap-2">
              <div class="flex-1 h-2 bg-slate-700 rounded-full overflow-hidden">
                <div class="h-full bg-slate-500 rounded-full" style="width:${badge.progress}%"></div>
              </div>
              <span class="text-xs text-slate-500">${badge.progress}%</span>
            </div>
          </div>`;
      }
    })
    .join("");
}

// --- Metas y Límites Diarios ---

// Variables de estado para metas (leídas de localStorage)
let metaMinutos = parseInt(localStorage.getItem("fp_goal_productive") || "240");
let limiteMinutos = parseInt(localStorage.getItem("fp_goal_distraction") || "60");
const GOAL_STEP_MINUTES = 30;

function saveGoals() {
  localStorage.setItem("fp_goal_productive", metaMinutos.toString());
  localStorage.setItem("fp_goal_distraction", limiteMinutos.toString());
}

function formatGoalDisplay(minutes) {
  if (minutes <= 0) return "0m";
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function refreshGoalUI() {
  document.getElementById("goal-prod-value").textContent = formatGoalDisplay(metaMinutos);
  document.getElementById("goal-dist-value").textContent = formatGoalDisplay(limiteMinutos);
  updateGoalBars(currentTableData || {});
}

function initGoalControls() {
  // Mostrar valores iniciales
  document.getElementById("goal-prod-value").textContent = formatGoalDisplay(metaMinutos);
  document.getElementById("goal-dist-value").textContent = formatGoalDisplay(limiteMinutos);

  // Productividad: sumar
  document.getElementById("goal-prod-plus").onclick = function () {
    metaMinutos = Math.min(720, metaMinutos + GOAL_STEP_MINUTES);
    saveGoals();
    refreshGoalUI();
  };

  // Productividad: restar
  document.getElementById("goal-prod-minus").onclick = function () {
    metaMinutos = Math.max(0, metaMinutos - GOAL_STEP_MINUTES);
    saveGoals();
    refreshGoalUI();
  };

  // Distracción: sumar
  document.getElementById("goal-dist-plus").onclick = function () {
    limiteMinutos = Math.min(480, limiteMinutos + GOAL_STEP_MINUTES);
    saveGoals();
    refreshGoalUI();
  };

  // Distracción: restar
  document.getElementById("goal-dist-minus").onclick = function () {
    limiteMinutos = Math.max(0, limiteMinutos - GOAL_STEP_MINUTES);
    saveGoals();
    refreshGoalUI();
  };
}

function updateGoalBars(data) {
  const entries = Object.entries(data || {});

  // Calcular tiempo productivo
  const productiveSeconds = entries
    .filter(([domain]) => PRODUCTIVE_DOMAINS.some((pd) => domain === pd || domain.endsWith("." + pd)))
    .reduce((sum, [, s]) => sum + s, 0);

  // Calcular tiempo en distracciones
  const socialSeconds = entries
    .filter(([domain]) => SOCIAL_DOMAINS.some((sd) => domain === sd || domain.endsWith("." + sd)))
    .reduce((sum, [, s]) => sum + s, 0);

  // Barra de productividad
  const prodGoalSeconds = metaMinutos * 60;
  const prodPct = prodGoalSeconds > 0 ? Math.min(100, Math.round((productiveSeconds / prodGoalSeconds) * 100)) : 0;
  document.getElementById("bar-productive").style.width = `${prodPct}%`;
  document.getElementById("bar-prod-label").textContent = `${prodPct}%`;
  document.getElementById("prod-detail").textContent = `${formatTime(productiveSeconds)} de ${formatGoalDisplay(metaMinutos)}`;

  // Barra de distracciones
  const distGoalSeconds = limiteMinutos * 60;
  const distPct = distGoalSeconds > 0 ? Math.min(100, Math.round((socialSeconds / distGoalSeconds) * 100)) : 0;
  document.getElementById("bar-distraction").style.width = `${distPct}%`;
  document.getElementById("bar-dist-label").textContent = `${distPct}%`;
  document.getElementById("dist-detail").textContent = `${formatTime(socialSeconds)} de ${formatGoalDisplay(limiteMinutos)}`;

  // Alerta si se alcanza el límite
  const distAlert = document.getElementById("dist-alert");
  const distContainer = document.getElementById("distraction-container");

  if (distPct >= 100 && distGoalSeconds > 0) {
    distAlert.classList.remove("hidden");
    distContainer.classList.add("bg-red-950/30", "rounded-xl", "p-3", "-m-3", "border", "border-red-900/50");
  } else {
    distAlert.classList.add("hidden");
    distContainer.classList.remove("bg-red-950/30", "rounded-xl", "p-3", "-m-3", "border", "border-red-900/50");
  }
}

// --- Tabla de Sitios Web ---

let currentTableData = {};

/**
 * Renderiza la tabla de sitios web con el orden especificado.
 */
function renderSitesTable(data, sortOrder = "desc") {
  const tbody = document.getElementById("sites-table-body");
  const entries = Object.entries(data);

  if (entries.length === 0) {
    tbody.innerHTML = '<tr><td colspan="2" class="py-4 text-center text-slate-500">Sin datos disponibles aún.</td></tr>';
    return;
  }

  // Ordenar según el filtro
  if (sortOrder === "desc") {
    entries.sort((a, b) => b[1] - a[1]);
  } else {
    entries.sort((a, b) => a[1] - b[1]);
  }

  tbody.innerHTML = entries
    .map(([domain, seconds]) => {
      return `
        <tr class="border-b border-slate-700/50 hover:bg-slate-700/30 transition">
          <td class="py-3">${domain}</td>
          <td class="py-3 text-right text-slate-400">${formatTime(seconds)}</td>
        </tr>`;
    })
    .join("");
}

async function fetchAndRender(email) {
  const statusIndicator = document.getElementById("status-indicator");
  const statusText = document.getElementById("status-text");

  try {
    const response = await fetch(`${API_BASE}/${encodeURIComponent(email)}`);
    const json = await response.json();
    const data = json.datos || {};

    renderChart(data);
    renderStats(data);
    evaluarInsignias(data);
    currentTableData = data;
    const sortSelect = document.getElementById("sort-select");
    renderSitesTable(data, sortSelect.value);
    updateGoalBars(data);

    statusIndicator.className = "inline-block w-2 h-2 rounded-full bg-emerald-400";
    statusText.textContent = "En vivo";
  } catch (error) {
    console.error("[FocusPulse] Error al obtener datos:", error);
    statusIndicator.className = "inline-block w-2 h-2 rounded-full bg-red-400";
    statusText.textContent = "Sin conexión";
  }
}

// --- IA Local (window.ai / chrome.aiOriginTrial) ---

async function getAISession() {
  if (typeof window !== "undefined" && window.ai && window.ai.languageModel) {
    const capabilities = await window.ai.languageModel.capabilities();
    if (capabilities.available === "readily") {
      return await window.ai.languageModel.create();
    }
  }

  if (typeof chrome !== "undefined" && chrome.aiOriginTrial && chrome.aiOriginTrial.languageModel) {
    const capabilities = await chrome.aiOriginTrial.languageModel.capabilities();
    if (capabilities.available === "readily") {
      return await chrome.aiOriginTrial.languageModel.create();
    }
  }

  return null;
}

async function generateAITip(data) {
  const tipElement = document.getElementById("ai-tip");
  const domains = Object.entries(data);

  if (domains.length === 0) {
    tipElement.textContent = DEFAULT_TIP;
    return;
  }

  const totalSeconds = domains.reduce((sum, [, s]) => sum + s, 0);
  const summary = domains
    .sort((a, b) => b[1] - a[1])
    .map(([domain, seconds]) => {
      const pct = ((seconds / totalSeconds) * 100).toFixed(1);
      return `${domain}: ${formatTime(seconds)} (${pct}%)`;
    })
    .join(", ");

  const prompt = `Eres un asistente de productividad amigable. El usuario pasó su tiempo en estos sitios web: ${summary}. Genera un resumen de exactamente 2 oraciones con un consejo de productividad personalizado y amigable en español.`;

  try {
    const session = await getAISession();
    if (!session) {
      tipElement.textContent = DEFAULT_TIP;
      return;
    }

    const result = await session.prompt(prompt);
    tipElement.textContent = result || DEFAULT_TIP;
    if (session.destroy) session.destroy();
  } catch (error) {
    console.warn("[FocusPulse] Error con IA local:", error);
    tipElement.textContent = DEFAULT_TIP;
  }
}

async function fetchAndGenerateTip(email) {
  try {
    const response = await fetch(`${API_BASE}/${encodeURIComponent(email)}`);
    const json = await response.json();
    const data = json.datos || {};
    await generateAITip(data);
  } catch (error) {
    console.warn("[FocusPulse] No se pudo generar consejo de IA:", error);
    document.getElementById("ai-tip").textContent = DEFAULT_TIP;
  }
}

// --- Inicialización ---

document.addEventListener("DOMContentLoaded", () => {
  // Botón de logout
  document.getElementById("btn-logout").addEventListener("click", logout);

  // Filtro de la tabla
  document.getElementById("sort-select").addEventListener("change", (e) => {
    renderSitesTable(currentTableData, e.target.value);
  });

  // Inicializar controles de metas
  initGoalControls();

  // Verificar sesión existente
  const savedEmail = localStorage.getItem("fp_email");
  if (savedEmail) {
    showDashboard({
      email: savedEmail,
      name: localStorage.getItem("fp_name") || savedEmail,
      picture: localStorage.getItem("fp_picture") || "",
    });
  }

  // Inicializar Google Sign-In (puede tardar en cargar el script)
  if (typeof google !== "undefined" && google.accounts) {
    initGoogleSignIn();
  } else {
    // Esperar a que cargue el script de Google
    window.addEventListener("load", () => {
      if (typeof google !== "undefined" && google.accounts) {
        initGoogleSignIn();
      }
    });
  }
});
