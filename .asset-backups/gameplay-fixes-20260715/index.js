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

import { login, getSession, logout } from "./src/auth.js";
import { findMatch }                  from "./src/matchmaking.js";
import { connect, sendInputs, disconnect, isConnected } from "./src/netcode.js";

// ─── Screen router ────────────────────────────────────────────────────────────

function showScreen(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  document.getElementById(id).classList.add("active");
}

// ─── Leopard project (lazy-initialised so it only starts when match begins) ──

let project = null;

function buildProject() {
  const stage = new Stage({ costumeNumber: 8 });

  const sprites = {
    Fighter1: new Fighter1({
      x: -150, y: -120,
      direction: 90,
      rotationStyle: Sprite.RotationStyle.ALL_AROUND,
      costumeNumber: 2,
      size: 175, visible: true, layerOrder: 2,
    }),
    Hitbox1: new Hitbox1({
      x: -163, y: -144,
      direction: 90,
      rotationStyle: Sprite.RotationStyle.ALL_AROUND,
      costumeNumber: 1,
      size: 100, visible: false, layerOrder: 4,
    }),
    Fighter2: new Fighter2({
      x: 150, y: -120,
      direction: 90,
      rotationStyle: Sprite.RotationStyle.ALL_AROUND,
      costumeNumber: 1,
      size: 175, visible: true, layerOrder: 1,
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
  const loop = () => {
    if (!project || !isConnected()) return;

    const stage = project.stage;
    const localFighter = mySlot === 1 ? project.sprites.Fighter1 : project.sprites.Fighter2;
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

  [["p1-health", project.sprites.Fighter1.vars.health], ["p2-health", project.sprites.Fighter2.vars.health]].forEach(([id, value]) => {
    const bar = document.getElementById(id);
    if (bar) bar.style.width = `${Math.max(0, Math.min(100, value))}%`;
  });
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

    // Switch to game screen
    showScreen("screen-game");

    // Build and attach the Leopard project
    project = buildProject();
    project.attach("#project");

    // Set the local player slot so fighters know who to control
    project.stage.vars.myPlayerSlot = match.playerSlot;

    // Connect WebSocket to the assigned game server
    connect(match.wsEndpoint, match.roomId, match.playerSlot, session.idToken, {
      onMatchStart(slot) {
        console.log("[game] Match started! You are Player", slot);
        project.greenFlag();
        startNetcodeLoop(slot);
      },
      onOpponentInputs(inputs) {
        // Write opponent inputs into stage vars for the physics engine to read
        if (match.playerSlot === 1) {
          project.stage.vars.p2Inputs = inputs;
        } else {
          project.stage.vars.p1Inputs = inputs;
        }
      },
      onMatchEnd(winner) {
        console.log("[game] Match over. Winner:", winner);
        disconnect();
        // TODO: show a match-end result screen here
        setTimeout(() => showScreen("screen-lobby"), 3000);
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
