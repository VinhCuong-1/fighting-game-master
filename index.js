/**
 * index.js — Application Entry Point
 *
 * This file wires together:
 *   1. The Login UI  ->  src/auth.js
 *   2. The Lobby UI  ->  src/matchmaking.js
 *   3. The Game      ->  Leopard project + src/netcode.js
 *
 * It is the ONLY file that touches the DOM directly.
 * All networking logic lives in the src/ modules.
 */

import { Project, Sprite } from "https://unpkg.com/leopard@^1/dist/index.esm.js";

import Stage    from "./Stage/Stage.js";
import Fighter1 from "./Fighter1/Fighter1.js";
import Fighter2 from "./Fighter2/Fighter2.js";
import Hitbox1  from "./Hitbox1/Hitbox1.js";
import Hitbox2  from "./Hitbox2/Hitbox2.js";

import { login, getSession, logout, signUp, confirmSignUp } from "./src/auth.js";
import { findMatch }                  from "./src/matchmaking.js";
import { connect, sendInputs, disconnect, isConnected } from "./src/netcode.js";

// ─── Screen router ────────────────────────────────────────────────────────────

function showScreen(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  document.getElementById(id).classList.add("active");
}

// ─── Leopard project (lazy-initialised so it only starts when match begins) ──

let project = null;
let roundEnded = false;
let roundEndsAt = 0;

async function startRound() {
  roundEnded = false;
  roundEndsAt = 0;
  project.stage.vars.roundActive = 0;
  document.getElementById("round-result").classList.remove("visible");
  const timer = document.getElementById("round-timer");

  for (let seconds = 3; seconds > 0; seconds--) {
    if (roundEnded) return;
    timer.textContent = String(seconds);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  if (roundEnded) return;
  project.stage.vars.roundActive = 1;
  roundEndsAt = Date.now() + 60_000;
  updateHud();
}

function winnerFromHealth() {
  const p1Health = project.sprites.Fighter1.vars.health;
  const p2Health = project.sprites.Fighter2.vars.health;
  if (p1Health === p2Health) return null;
  return p1Health > p2Health ? 1 : 2;
}

function finishRound(winner, reason) {
  if (roundEnded) return;
  roundEnded = true;
  roundEndsAt = 0;
  if (project) project.stage.vars.roundActive = 0;
  disconnect();

  const endSound = new Audio("./assets/sounds/endMatch.wav");
  endSound.play().catch(() => {});

  const result = document.getElementById("round-result");
  const title = document.getElementById("round-result-title");
  const detail = document.getElementById("round-result-detail");
  title.textContent = winner === 1 ? "HUMAN WINS" : winner === 2 ? "DEMON WINS" : "DRAW";
  detail.textContent = reason === "time" ? "Time is up" : reason === "health" ? "CONGRATULATIONS!!!" : "Opponent disconnected";
  result.classList.add("visible");
}

function _hashRoomId(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function buildProject(roomId) {
  const stageIndex = roomId ? _hashRoomId(roomId) % 4 : Math.floor(Math.random() * 4);
  const stage = new Stage({ costumeNumber: 8 + stageIndex });

  const sprites = {
    Fighter1: new Fighter1({
      x: -150, y: -120,
      direction: 90,
      rotationStyle: Sprite.RotationStyle.DONT_ROTATE,
      costumeNumber: 2,
      size: 300, visible: true, layerOrder: 2,
    }),
    Hitbox1: new Hitbox1({
      x: -163, y: -144,
      direction: 90,
      rotationStyle: Sprite.RotationStyle.LEFT_RIGHT,
      costumeNumber: 1,
      size: 100, visible: false, layerOrder: 4,
    }),
    Fighter2: new Fighter2({
      x: 150, y: -120,
      direction: 90,
      rotationStyle: Sprite.RotationStyle.DONT_ROTATE,
      costumeNumber: 1,
      size: 300, visible: true, layerOrder: 1,
    }),
    Hitbox2: new Hitbox2({
      x: 0, y: 0,
      direction: 90,
      rotationStyle: Sprite.RotationStyle.ALL_AROUND,
      costumeNumber: 1,
      size: 100, visible: false, layerOrder: 3,
    }),
  };

  return new Project(stage, sprites, { frameRate: 30 });
}

// ─── Netcode frame loop ───────────────────────────────────────────────────────
// Runs every animation frame once the game is active.
// Reads local fighter inputs and ships them to the server.

function startNetcodeLoop(mySlot) {
  const slot = Number(mySlot);
  const loop = () => {
    if (!project || !isConnected()) {
      requestAnimationFrame(loop);
      return;
    }

    const stage = project.stage;
    const localFighter = slot === 1 ? project.sprites.Fighter1 : project.sprites.Fighter2;
    const localInputs = localFighter.getInputs ? localFighter.getInputs() : null;

    if (localInputs) {
      sendInputs(localInputs);
    }

    updateHud();
    requestAnimationFrame(loop);
  };

  requestAnimationFrame(loop);
}

// ─── Login screen ─────────────────────────────────────────────────────────────

function updateHud() {
  if (!project) return;

  const p1Health = project.sprites.Fighter1.vars.health;
  const p2Health = project.sprites.Fighter2.vars.health;
  [["p1-health", p1Health], ["p2-health", p2Health]].forEach(([id, value]) => {
    const bar = document.getElementById(id);
    if (bar) bar.style.width = `${Math.max(0, Math.min(100, value))}%`;
  });

  const timer = document.getElementById("round-timer");
  if (!roundEnded && roundEndsAt) {
    const seconds = Math.max(0, Math.ceil((roundEndsAt - Date.now()) / 1000));
    timer.textContent = seconds;
    if (seconds === 0) finishRound(winnerFromHealth(), "time");
  }

  if (!roundEnded && (p1Health <= 0 || p2Health <= 0)) {
    finishRound(p1Health === p2Health ? null : p1Health > p2Health ? 1 : 2, "health");
  }
}
const loginBtn   = document.getElementById("btn-login");
const loginError = document.getElementById("login-error");
const loginStatus = document.getElementById("login-status");

function setLoginError(msg) {
  loginError.textContent = msg;
  loginError.classList.add("visible");
}

loginBtn.addEventListener("click", async () => {
  const username = document.getElementById("input-username").value.trim();
  const password = document.getElementById("input-password").value;

  loginError.classList.remove("visible");
  loginStatus.textContent = "Logging in...";
  loginBtn.disabled = true;

  try {
    const session = await login(username, password);

    // Populate lobby with player info
    document.getElementById("lobby-username").textContent = session.username;
    document.getElementById("lobby-avatar").textContent =
      session.username.charAt(0).toUpperCase();

    loginStatus.textContent = "";
    showScreen("screen-lobby");
  } catch (err) {
    setLoginError(err.message);
    loginStatus.textContent = "";
  } finally {
    loginBtn.disabled = false;
  }
});

// Allow Enter key to submit login
document.getElementById("input-password").addEventListener("keydown", (e) => {
  if (e.key === "Enter") loginBtn.click();
});

// ─── Toggle password visibility ──────────────────────────────────────────────

document.querySelectorAll(".toggle-pw").forEach((btn) => {
  btn.addEventListener("click", () => {
    const input = document.getElementById(btn.dataset.target);
    if (input.type === "password") {
      input.type = "text";
      btn.innerHTML = "&#128064;"; // open eye
    } else {
      input.type = "password";
      btn.innerHTML = "&#128065;"; // closed eye
    }
  });
});

// ─── Sign Up / Confirm forms ─────────────────────────────────────────────────

function showLoginForm() {
  document.getElementById("login-form").style.display = "";
  document.getElementById("signup-form").style.display = "none";
  document.getElementById("confirm-form").style.display = "none";
}

function showSignUpForm() {
  document.getElementById("login-form").style.display = "none";
  document.getElementById("signup-form").style.display = "";
  document.getElementById("confirm-form").style.display = "none";
}

function showConfirmForm() {
  document.getElementById("login-form").style.display = "none";
  document.getElementById("signup-form").style.display = "none";
  document.getElementById("confirm-form").style.display = "";
}

// Toggle links
document.getElementById("btn-show-signup").addEventListener("click", showSignUpForm);
document.getElementById("btn-show-login").addEventListener("click", showLoginForm);
document.getElementById("btn-back-login").addEventListener("click", showLoginForm);

// Sign Up button
const signupBtn = document.getElementById("btn-signup");
const signupError = document.getElementById("signup-error");
const signupStatus = document.getElementById("signup-status");
let _pendingUsername = null;

signupBtn.addEventListener("click", async () => {
  const username = document.getElementById("input-signup-username").value.trim();
  const email = document.getElementById("input-signup-email").value.trim();
  const password = document.getElementById("input-signup-password").value;

  signupError.classList.remove("visible");

  // Client-side validation — show clear error before calling Cognito
  const missing = [];
  if (password.length < 8) missing.push("at least 8 characters");
  if (!/[A-Z]/.test(password)) missing.push("1 uppercase letter (A-Z)");
  if (!/[a-z]/.test(password)) missing.push("1 lowercase letter (a-z)");
  if (!/[0-9]/.test(password)) missing.push("1 number (0-9)");
  if (!/[^A-Za-z0-9]/.test(password)) missing.push("1 special character (!@#$...)");

  if (missing.length > 0) {
    signupError.textContent = "Password needs: " + missing.join(", ");
    signupError.classList.add("visible");
    return;
  }

  signupStatus.textContent = "Creating account...";
  signupBtn.disabled = true;

  try {
    await signUp(username, email, password);
    _pendingUsername = username;
    signupStatus.textContent = "";
    showConfirmForm();
    document.getElementById("confirm-status").textContent =
      "A verification code was sent to " + email;
  } catch (err) {
    signupError.textContent = err.message;
    signupError.classList.add("visible");
    signupStatus.textContent = "";
  } finally {
    signupBtn.disabled = false;
  }
});

// Confirm button
const confirmBtn = document.getElementById("btn-confirm");
const confirmError = document.getElementById("confirm-error");
const confirmStatus = document.getElementById("confirm-status");

confirmBtn.addEventListener("click", async () => {
  const code = document.getElementById("input-confirm-code").value.trim();

  confirmError.classList.remove("visible");
  confirmStatus.textContent = "Confirming...";
  confirmBtn.disabled = true;

  try {
    await confirmSignUp(_pendingUsername, code);
    confirmStatus.textContent = "";
    _pendingUsername = null;
    showLoginForm();
    loginStatus.textContent = "Account confirmed! You can now log in.";
  } catch (err) {
    confirmError.textContent = err.message;
    confirmError.classList.add("visible");
    confirmStatus.textContent = "";
  } finally {
    confirmBtn.disabled = false;
  }
});

// ─── Password requirements real-time check ───────────────────────────────────

const signupPasswordInput = document.getElementById("input-signup-password");
const reqLength = document.getElementById("req-length");
const reqUpper = document.getElementById("req-upper");
const reqLower = document.getElementById("req-lower");
const reqNumber = document.getElementById("req-number");
const reqSpecial = document.getElementById("req-special");

function checkPasswordReqs(val) {
  const checks = [
    { el: reqLength, met: val.length >= 8 },
    { el: reqUpper,  met: /[A-Z]/.test(val) },
    { el: reqLower,  met: /[a-z]/.test(val) },
    { el: reqNumber, met: /[0-9]/.test(val) },
    { el: reqSpecial, met: /[^A-Za-z0-9]/.test(val) },
  ];
  checks.forEach(({ el, met }) => el.classList.toggle("met", met));
  return checks.every(({ met }) => met);
}

signupPasswordInput.addEventListener("input", () => {
  checkPasswordReqs(signupPasswordInput.value);
});

// ─── Lobby screen ─────────────────────────────────────────────────────────────

const playBtn     = document.getElementById("btn-play");
const cancelBtn   = document.getElementById("btn-cancel");
const lobbyIdle   = document.getElementById("lobby-idle");
const lobbySearch = document.getElementById("lobby-searching");
const searchStatus = document.getElementById("search-status");
const lobbyError  = document.getElementById("lobby-error");

let matchmakingAborted = false;

function setSearching(searching) {
  lobbyIdle.style.display   = searching ? "none"  : "block";
  lobbySearch.style.display = searching ? "block" : "none";
  lobbyError.classList.remove("visible");
}

playBtn.addEventListener("click", async () => {
  const session = getSession();
  if (!session) { showScreen("screen-login"); return; }

  matchmakingAborted = false;
  setSearching(true);

  try {
    const match = await findMatch(session.idToken, session.userId, (msg) => {
      if (matchmakingAborted) throw new Error("Cancelled");
      searchStatus.textContent = msg;
    });

    // ── Match found! ─────────────────────────────────────────────────
    setSearching(false);

    const playerSlot = Number(match.playerSlot);
    const wsEndpoint = match.wsEndpoint || "";
    if (!match.roomId || (playerSlot !== 1 && playerSlot !== 2) || !wsEndpoint) {
      throw new Error(
        `Bad match payload: roomId=${match.roomId} slot=${match.playerSlot} ws=${wsEndpoint}`
      );
    }

    // Switch to game screen
    showScreen("screen-game");

    // Clear old match result overlay
    document.getElementById("round-result").classList.remove("visible");
    document.getElementById("round-timer").textContent = "…";

    // Build and attach the Leopard project (same map for both players)
    project = buildProject(match.roomId);
    project.attach("#project");

    // Set the local player slot so fighters know who to control
    project.stage.vars.myPlayerSlot = playerSlot;

    console.log("[game] matched", {
      roomId: match.roomId,
      playerSlot,
      wsEndpoint,
    });

    // Connect WebSocket to the assigned game server
    connect(wsEndpoint, match.roomId, playerSlot, session.idToken, {
      onMatchStart(slot) {
        const yourSlot = Number(slot);
        console.log("[game] Match started! You are Player", yourSlot);
        project.stage.vars.myPlayerSlot = yourSlot;
        project.stage.vars.p1Inputs = { left: 0, right: 0, jump: 0, attack: 0 };
        project.stage.vars.p2Inputs = { left: 0, right: 0, jump: 0, attack: 0 };
        project.greenFlag();
        startRound();
        startNetcodeLoop(yourSlot);
      },
      onOpponentInputs(inputs) {
        const slot = Number(project.stage.vars.myPlayerSlot);
        if (slot === 1) {
          project.stage.vars.p2Inputs = inputs;
        } else {
          project.stage.vars.p1Inputs = inputs;
        }
      },
      onMatchEnd(winner) {
        console.log("[game] Match over. Winner:", winner);
        finishRound(winner, "disconnect");
      },
    });

  } catch (err) {
    if (matchmakingAborted) {
      setSearching(false);
      return;
    }
    lobbyError.textContent = err.message;
    lobbyError.classList.add("visible");
    setSearching(false);
  }
});

cancelBtn.addEventListener("click", () => {
  matchmakingAborted = true;
  setSearching(false);
});

document.getElementById("btn-return-lobby").addEventListener("click", () => {
  roundEnded = true;
  roundEndsAt = 0;
  disconnect();
  project = null;
  matchmakingAborted = false;
  showScreen("screen-lobby");
});
