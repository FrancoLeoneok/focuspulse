// FocusPulse - Popup (Autenticación + Modo Enfoque)

const loginSection = document.getElementById("login-section");
const userSection = document.getElementById("user-section");
const btnLogin = document.getElementById("btn-login");
const btnLogout = document.getElementById("btn-logout");
const userPhoto = document.getElementById("user-photo");
const userName = document.getElementById("user-name");
const userEmail = document.getElementById("user-email");
const statusMsg = document.getElementById("status-msg");

// Modo Enfoque
const focusInactive = document.getElementById("focus-inactive");
const focusActive = document.getElementById("focus-active");
const btnFocus = document.getElementById("btn-focus");
const btnStopFocus = document.getElementById("btn-stop-focus");
const focusTimer = document.getElementById("focus-timer");

let timerInterval = null;

// --- Auth UI ---

function showLoggedIn(user) {
  loginSection.classList.add("hidden");
  userSection.classList.remove("hidden");
  userName.textContent = user.name || "Usuario";
  userEmail.textContent = user.email;
  userPhoto.src = user.picture || "";
  statusMsg.textContent = "Rastreando tu actividad...";
}

function showLoggedOut() {
  loginSection.classList.remove("hidden");
  userSection.classList.add("hidden");
  statusMsg.textContent = "Conecta tu cuenta para rastrear tu actividad.";
}

async function checkExistingUser() {
  const result = await chrome.storage.local.get(["usuario_id", "user_name", "user_picture"]);
  if (result.usuario_id) {
    showLoggedIn({
      email: result.usuario_id,
      name: result.user_name,
      picture: result.user_picture,
    });
    checkFocusMode();
  } else {
    showLoggedOut();
  }
}

async function login() {
  try {
    btnLogin.disabled = true;
    btnLogin.textContent = "Conectando...";

    const token = await new Promise((resolve, reject) => {
      chrome.identity.getAuthToken({ interactive: true }, (token) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(token);
        }
      });
    });

    const response = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) throw new Error("Error al obtener perfil de Google.");

    const userInfo = await response.json();

    await chrome.storage.local.set({
      usuario_id: userInfo.email,
      user_name: userInfo.name || userInfo.email,
      user_picture: userInfo.picture || "",
    });

    showLoggedIn({
      email: userInfo.email,
      name: userInfo.name,
      picture: userInfo.picture,
    });

    checkFocusMode();
    console.log("[FocusPulse] Login exitoso:", userInfo.email);
  } catch (error) {
    console.error("[FocusPulse] Error en login:", error);
    statusMsg.textContent = "Error al iniciar sesión. Intenta de nuevo.";
    btnLogin.disabled = false;
    btnLogin.textContent = "Iniciar sesión con Google";
  }
}

async function logout() {
  try {
    const token = await new Promise((resolve) => {
      chrome.identity.getAuthToken({ interactive: false }, (token) => {
        resolve(token);
      });
    });

    if (token) {
      chrome.identity.removeCachedAuthToken({ token });
      await fetch(`https://accounts.google.com/o/oauth2/revoke?token=${token}`);
    }
  } catch (e) {
    console.warn("[FocusPulse] Error al revocar token:", e);
  }

  await chrome.storage.local.remove(["usuario_id", "user_name", "user_picture"]);
  showLoggedOut();
  console.log("[FocusPulse] Sesión cerrada.");
}

// --- Modo Enfoque ---

function formatTimer(ms) {
  if (ms <= 0) return "00:00";
  const totalSecs = Math.ceil(ms / 1000);
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function startTimerDisplay(endTime) {
  if (timerInterval) clearInterval(timerInterval);

  function update() {
    const remaining = endTime - Date.now();
    if (remaining <= 0) {
      focusTimer.textContent = "00:00";
      showFocusInactive();
      clearInterval(timerInterval);
      return;
    }
    focusTimer.textContent = formatTimer(remaining);
  }

  update();
  timerInterval = setInterval(update, 1000);
}

function showFocusActive(endTime) {
  focusInactive.classList.add("hidden");
  focusActive.classList.remove("hidden");
  startTimerDisplay(endTime);
}

function showFocusInactive() {
  focusActive.classList.add("hidden");
  focusInactive.classList.remove("hidden");
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

async function checkFocusMode() {
  const result = await chrome.storage.local.get(["modo_enfoque", "focus_end_time"]);
  if (result.modo_enfoque && result.focus_end_time > Date.now()) {
    showFocusActive(result.focus_end_time);
  } else {
    showFocusInactive();
  }
}

async function startFocusMode() {
  const durationMs = 25 * 60 * 1000; // 25 minutos
  const endTime = Date.now() + durationMs;

  await chrome.storage.local.set({
    modo_enfoque: true,
    focus_end_time: endTime,
  });

  showFocusActive(endTime);
  console.log("[FocusPulse] Modo Enfoque iniciado. Termina en 25 min.");
}

async function stopFocusMode() {
  await chrome.storage.local.set({ modo_enfoque: false, focus_end_time: 0 });
  chrome.runtime.sendMessage({ action: "disable_focus_mode" });
  showFocusInactive();
  console.log("[FocusPulse] Modo Enfoque desactivado manualmente.");
}

// --- Event Listeners ---

btnLogin.addEventListener("click", login);
btnLogout.addEventListener("click", logout);
btnFocus.addEventListener("click", startFocusMode);
btnStopFocus.addEventListener("click", stopFocusMode);

// Inicializar
checkExistingUser();
