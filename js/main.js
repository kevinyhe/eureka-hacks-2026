import * as THREE from "three";
import { Ring } from "./ring.js";
import { Crowd } from "./crowd.js";
import { Network } from "./network.js";

// Spring integration function for procedural ragdoll + bodycam physics
function updateSpring(pos, vel, target, tension, friction, dt) {
  vel.x += (target.x - pos.x) * tension * dt;
  vel.y += (target.y - pos.y) * tension * dt;
  vel.z += (target.z - pos.z) * tension * dt;

  vel.x *= friction;
  vel.y *= friction;
  vel.z *= friction;

  pos.x += vel.x * dt;
  pos.y += vel.y * dt;
  pos.z += vel.z * dt;
}

// Bodycam Effect Inlined
const BodycamEffect = (() => {
  let isRunning = false;
  let overlayDiv, noiseCanvas, noiseCtx, svgFilter, gameCanvas;
  let animationFrameId;
  let lastNoiseUpdate = 0;
  let lastShakeUpdate = 0;

  let shakeCurrent = { x: 0, y: 0, r: 0 };
  let shakeTarget = { x: 0, y: 0, r: 0 };

  let originalTransform = "";
  let originalFilter = "";
  function init() {
    if (overlayDiv) return;

    // Find the Three.js canvas
    gameCanvas = document.querySelector("canvas");

    // 1. Create SVG Filter for Chromatic Aberration and Lens Distortion
    svgFilter = document.createElement("div");
    svgFilter.innerHTML = `
    <svg style="width:0; height:0; position:absolute; z-index:-1;">
        <filter id="bodycam-aberration" x="-20%" y="-20%" width="140%" height="140%">
            <!-- Chromatic Aberration -->
            <feColorMatrix type="matrix" in="SourceGraphic" result="red-m"
                values="1 0 0 0 0
                        0 0 0 0 0
                        0 0 0 0 0
                        0 0 0 1 0"/>
            <feOffset dx="3" dy="0" in="red-m" result="red"/>

            <feColorMatrix type="matrix" in="SourceGraphic" result="green-m"
                values="0 0 0 0 0
                        0 1 0 0 0
                        0 0 0 0 0
                        0 0 0 1 0"/>
            <feOffset dx="0" dy="0" in="green-m" result="green"/>

            <feColorMatrix type="matrix" in="SourceGraphic" result="blue-m"
                values="0 0 0 0 0
                        0 0 0 0 0
                        0 0 1 0 0
                        0 0 0 1 0"/>
            <feOffset dx="-3" dy="0" in="blue-m" result="blue"/>

            <feComposite in="red" in2="green" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" result="rg"/>
            <feComposite in="rg" in2="blue" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" result="rgb"/>

            <!-- Mild Barrel Distortion / Wave -->
            <feTurbulence type="fractalNoise" baseFrequency="0.005" numOctaves="1" result="warp"/>
            <feDisplacementMap xChannelSelector="R" yChannelSelector="G" scale="5" in="rgb" in2="warp"/>
        </filter>
    </svg>
    `;
    document.body.appendChild(svgFilter);

    // 2. Main Overlay container
    overlayDiv = document.createElement("div");
    overlayDiv.id = "bodycam-overlay";
    Object.assign(overlayDiv.style, {
      position: "fixed",
      top: "0",
      left: "0",
      width: "100vw",
      height: "100vh",
      pointerEvents: "none",
      zIndex: "9999",
      display: "none",
    });

    // 3. Noise layer (Canvas)
    noiseCanvas = document.createElement("canvas");
    Object.assign(noiseCanvas.style, {
      position: "absolute",
      top: "0",
      left: "0",
      width: "100%",
      height: "100%",
      opacity: "0.2",
      mixBlendMode: "screen",
    });
    noiseCtx = noiseCanvas.getContext("2d");
    overlayDiv.appendChild(noiseCanvas);

    // 4. Vignette + Lens Smudge/Bloom + Color Grade Tint layer
    const shaderLayer = document.createElement("div");
    Object.assign(shaderLayer.style, {
      position: "absolute",
      top: "0",
      left: "0",
      width: "100%",
      height: "100%",
      background: `
        radial-gradient(circle at center, transparent 40%, rgba(0,0,0,1) 100%),
        radial-gradient(circle at center, rgba(255,255,255,0.12) 0%, transparent 20%),
        rgba(0, 15, 10, 0.1)
    `,
      mixBlendMode: "multiply",
    });
    overlayDiv.appendChild(shaderLayer);

    // 5. HUD Overlay
    const hudEl = document.createElement("div");
    Object.assign(hudEl.style, {
      position: "absolute",
      top: "30px",
      left: "40px",
      color: "#fff",
      fontFamily: 'monospace, "Courier New", Courier',
      fontSize: "24px",
      opacity: "0.4",
      textShadow: "1px 1px 0 #000, -1px -1px 0 #000",
    });
    hudEl.innerHTML = `
    <div style="display:flex; align-items:center; margin-bottom:10px;">
        <div id="bc-rec-dot" style="width:14px;height:14px;background:#ff3333;border-radius:50%;margin-right:12px;"></div>
        <span>REC</span>
        <div style="margin-left:30px; width:45px; height:18px; border:2px solid #fff; position:relative;">
        <div style="position:absolute; right:-6px; top:3px; height:8px; width:4px; background:#fff;"></div>
        <div style="height:100%; width:75%; background:#fff;"></div>
        </div>
    </div>
    <div id="bc-time">00:00:00</div>
    `;
    overlayDiv.appendChild(hudEl);

    document.body.appendChild(overlayDiv);

    window.addEventListener("resize", handleResize);
    handleResize();
  }

  function handleResize() {
    if (noiseCanvas) {
      noiseCanvas.width = window.innerWidth;
      noiseCanvas.height = window.innerHeight;
    }
  }

  let noisePattern;
  let tileCanvas_memoized, imgData_memoized;
  function renderNoise() {
    if (!noiseCtx) return;
    const w = noiseCanvas.width;
    const h = noiseCanvas.height;

    const patSize = 256;

    if (!tileCanvas_memoized) {
      tileCanvas_memoized = document.createElement("canvas");
      tileCanvas_memoized.width = tileCanvas_memoized.height = patSize;
      imgData_memoized = noiseCtx.createImageData(patSize, patSize);
    }

    const data = imgData_memoized.data;

    // Generate noise onto a small tile to save performance
    // and reuse memory
    for (let i = 0; i < data.length; i += 4) {
      const val = Math.random() * 255;
      data[i] = val;
      data[i + 1] = val;
      data[i + 2] = val;
      data[i + 3] = 255;
    }

    tileCanvas_memoized.getContext("2d").putImageData(imgData_memoized, 0, 0);

    const pattern = noiseCtx.createPattern(tileCanvas_memoized, "repeat");
    noiseCtx.fillStyle = pattern;
    noiseCtx.fillRect(0, 0, w, h);
  }

  function tick(time) {
    if (!isRunning) return;
    animationFrameId = requestAnimationFrame(tick);

    // Smooth Lerp Shake internally at 60fps
    shakeCurrent.x += (shakeTarget.x - shakeCurrent.x) * 0.1;
    shakeCurrent.y += (shakeTarget.y - shakeCurrent.y) * 0.1;
    shakeCurrent.r += (shakeTarget.r - shakeCurrent.r) * 0.1;

    // 24fps update loop for visuals
    const dt = time - lastNoiseUpdate;
    if (dt > 1000 / 24) {
      renderNoise();

      const dot = document.getElementById("bc-rec-dot");
      if (dot)
        dot.style.opacity = Math.floor(time / 600) % 2 === 0 ? "1" : "0.1";

      const timeEl = document.getElementById("bc-time");
      if (timeEl) {
        const d = new Date();
        timeEl.textContent = d.toTimeString().split(" ")[0];
      }

      // Apply the shake only to the overlay, so it doesn't break the body's layout or split screen setup
      overlayDiv.style.transform = `scale(1.04) translate(${shakeCurrent.x}px, ${shakeCurrent.y}px) rotate(${shakeCurrent.r}deg)`;

      lastNoiseUpdate = time;
    }

    if (time - lastShakeUpdate > 80 + Math.random() * 120) {
      shakeTarget.x = (Math.random() - 0.5) * 8; // �4px
      shakeTarget.y = (Math.random() - 0.5) * 8; // �4px
      shakeTarget.r = (Math.random() - 0.5) * 0.2; // �0.1deg
      lastShakeUpdate = time;
    }
  }

  return {
    start: () => {
      if (isRunning) return;
      init();
      isRunning = true;
      overlayDiv.style.display = "block";

      if (gameCanvas) {
        originalTransform = gameCanvas.style.transform;
        originalFilter = gameCanvas.style.filter;
        gameCanvas.style.filter = `saturate(0.8) contrast(1.1) url(#bodycam-aberration)`;
      }

      lastNoiseUpdate = performance.now();
      lastShakeUpdate = performance.now();
      animationFrameId = requestAnimationFrame(tick);
    },
    stop: () => {
      if (!isRunning) return;
      isRunning = false;
      overlayDiv.style.display = "none";
      if (gameCanvas) {
        gameCanvas.style.transform = originalTransform;
        gameCanvas.style.filter = originalFilter;
      }
      overlayDiv.style.transform = "none";
      cancelAnimationFrame(animationFrameId);
    },
  };
})();

// 1. Setup Scene, Renderer
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111111); // Night/arena background

const ring = new Ring();
ring.init(scene);

const crowd = new Crowd();
crowd.init(scene);

const renderer = new THREE.WebGLRenderer({
  antialias: false,
  powerPreference: "high-performance",
});
renderer.setSize(window.innerWidth, window.innerHeight);
// Hardcode lowered resolution to heavily optimize the split screen rendering
renderer.setPixelRatio(0.25);
renderer.shadowMap.enabled = true;
// Enable scissor test to allow rendering multiple views
renderer.setScissorTest(true);
document.body.appendChild(renderer.domElement);

// ------------------------------------------------------------
// ACTION AND ANIMATION CONFIG
// ------------------------------------------------------------
const GLOVE_IDLE_L = new THREE.Vector3(-0.35, 1.08, 0.36);
const GLOVE_IDLE_R = new THREE.Vector3(0.35, 1.08, 0.36);
const NECK_BASE = new THREE.Vector3(0, 1.34, 0);
const HEAD_CENTER_OFFSET = new THREE.Vector3(0, 0.28, 0);
const MAX_NECK_ROTATION = THREE.MathUtils.degToRad(30);
const MAX_NECK_OFFSET = 0.035;
const STAMINA_MAX = 100;
const STAMINA_LOW_THRESHOLD = 35;
const STAMINA_REGEN_IDLE = 26;
const STAMINA_REGEN_BUSY = 5;
const COMBO_HITS_FOR_BONUS = 3;
const DAZED_DAMAGE_THRESHOLD = 14;
const HEAL_AMOUNT = 20;

const ACTIONS = {
  idle: {
    duration: 0,
    l: GLOVE_IDLE_L,
    r: GLOVE_IDLE_R,
    damage: 0,
    staminaCost: 0,
  },
  jab: {
    duration: 0.35,
    l: new THREE.Vector3(-0.08, 1.22, 1.9),
    r: GLOVE_IDLE_R,
    damage: 5,
    staminaCost: 10,
  },
  hook: {
    duration: 0.4,
    l: GLOVE_IDLE_L,
    r: new THREE.Vector3(-0.62, 1.22, 1.28),
    damage: 15,
    staminaCost: 34,
  },
  uppercut: {
    duration: 0.35,
    l: GLOVE_IDLE_L,
    r: new THREE.Vector3(0.08, 1.95, 1.22),
    damage: 20,
    staminaCost: 50,
  },
  block: {
    duration: 0.5,
    l: new THREE.Vector3(-0.26, 1.78, 0.52),
    r: new THREE.Vector3(0.26, 1.78, 0.52),
    damage: 0,
    staminaCost: 25,
  },
  dodge: {
    duration: 0.26,
    l: new THREE.Vector3(-0.42, 1.22, 0.3),
    r: new THREE.Vector3(0.42, 1.22, 0.3),
    damage: 0,
    staminaCost: 33,
  },
  backDodge: {
    duration: 0.3,
    l: new THREE.Vector3(-0.34, 1.32, 0.28),
    r: new THREE.Vector3(0.34, 1.32, 0.28),
    damage: 0,
    staminaCost: 33,
  },
  heal: {
    duration: 3.0,
    l: new THREE.Vector3(-0.2, 1.6, 0.4),
    r: new THREE.Vector3(0.2, 1.6, 0.4),
    damage: 0,
    staminaCost: -100,
  },
};

const clamp01 = (value) => THREE.MathUtils.clamp(value, 0, 1);
const mix = (a, b, t) => THREE.MathUtils.lerp(a, b, clamp01(t));
const easeInOut = (t) => {
  t = clamp01(t);
  return t * t * (3 - 2 * t);
};
const easeOutCubic = (t) => 1 - Math.pow(1 - clamp01(t), 3);
const pulse = (progress, peak = 0.5) => {
  progress = clamp01(progress);
  if (progress < peak) return easeOutCubic(progress / peak);
  return 1 - easeInOut((progress - peak) / (1 - peak));
};
const clampVectorLength = (vector, maxLength) => {
  if (vector.lengthSq() > maxLength * maxLength) {
    vector.setLength(maxLength);
    return true;
  }
  return false;
};
const randomBetween = (min, max) => min + Math.random() * (max - min);
const getRandomPunchOffset = (action) => {
  if (action === "jab") {
    return new THREE.Vector3(
      randomBetween(-0.11, 0.11),
      randomBetween(-0.08, 0.01),
      randomBetween(-0.04, 0.07),
    );
  }
  if (action === "hook") {
    return new THREE.Vector3(
      randomBetween(-0.14, 0.14),
      randomBetween(-0.01, 0.05),
      randomBetween(-0.07, 0.09),
    );
  }
  if (action === "uppercut") {
    return new THREE.Vector3(
      randomBetween(-0.12, 0.12),
      randomBetween(-0.06, 0.07),
      randomBetween(-0.07, 0.09),
    );
  }
  return new THREE.Vector3();
};
function getHitConfirmPosition(punchOffset) {
  return {
    x: THREE.MathUtils.clamp(
      50 + punchOffset.x * 70 + randomBetween(-12, 12),
      22,
      78,
    ),
    y: THREE.MathUtils.clamp(
      50 - punchOffset.y * 70 + randomBetween(-10, 10),
      28,
      72,
    ),
  };
}
const getLowStaminaRatio = (stamina) =>
  clamp01(stamina / STAMINA_LOW_THRESHOLD);

function getStaminaDamageScale(stamina) {
  const staminaRatio = getLowStaminaRatio(stamina);
  return stamina >= STAMINA_LOW_THRESHOLD ? 1 : 0.1 + staminaRatio * 0.9;
}

function getStaminaDurationScale(stamina) {
  const staminaRatio = getLowStaminaRatio(stamina);
  return stamina >= STAMINA_LOW_THRESHOLD ? 1 : 1 + (1 - staminaRatio) * 0.75;
}

function getComboDamageMultiplier(player) {
  if (player.state.comboHits < COMBO_HITS_FOR_BONUS - 1) return 1;
  return 1 + player.state.comboHits * 0.333;
}

function updateStaminaUi(player) {
  if (!player.uiStamina) return;
  const width = THREE.MathUtils.clamp(player.state.stamina, 0, STAMINA_MAX);
  player.uiStamina.style.width = `${width}%`;
}

function updateComboUi(player) {
  if (!player.uiCombo) return;
  const width = Math.min(
    100,
    (player.state.comboHits / COMBO_HITS_FOR_BONUS) * 100,
  );
  player.uiCombo.style.width = `${width}%`;
}

function updateCombatUi(player) {
  updateStaminaUi(player);
  updateComboUi(player);
}

function registerLandedHit(attacker, defender) {
  attacker.state.comboHits = Math.min(attacker.state.comboHits + 1, 8);
  defender.state.comboHits = 0;
  updateComboUi(attacker);
  updateComboUi(defender);
}

function registerSuccessfulDodge(defender, attacker) {
  defender.state.comboHits = Math.max(
    defender.state.comboHits,
    COMBO_HITS_FOR_BONUS,
  );
  defender.state.stamina = Math.min(defender.state.stamina + 30, STAMINA_MAX);
  attacker.state.comboHits = 0;
  updateComboUi(defender);
  updateComboUi(attacker);
}

function getActionPose(
  action,
  progress,
  time,
  dodgeSide = 1,
  punchOffset = new THREE.Vector3(),
) {
  const pose = {
    l: GLOVE_IDLE_L.clone(),
    r: GLOVE_IDLE_R.clone(),
    headOffset: new THREE.Vector3(0, Math.sin(time * 4.2) * 0.006, 0),
    headRot: new THREE.Vector3(
      Math.sin(time * 2.6) * 0.018,
      Math.sin(time * 2.1) * 0.022,
      Math.sin(time * 2.9) * 0.016,
    ),
    avatarOffset: new THREE.Vector3(),
    bodyRot: new THREE.Vector3(),
    gloveLerpSpeed: 0.58,
  };

  if (action === "idle") {
    pose.l.y += Math.sin(time * 9) * 0.12;
    pose.r.y += Math.cos(time * 9.5) * 0.12;
    return pose;
  }

  if (action === "jab") {
    const extend = pulse(progress, 0.42);
    const windup = Math.sin(clamp01(progress / 0.28) * Math.PI) * (1 - extend);

    pose.l.lerp(new THREE.Vector3(-0.46, 1.05, 0.14), windup);
    pose.l.lerp(ACTIONS.jab.l.clone().add(punchOffset), extend);
    pose.r.lerp(new THREE.Vector3(0.24, 1.3, 0.54), 0.45 + extend * 0.25);
    pose.headOffset.set(0, 0, -0.01 * extend);
    pose.headRot.set(-0.03 * extend, 0.1 * extend, 0.04 * extend);
    pose.avatarOffset.set(0, 0, 0.04 * extend);
    pose.bodyRot.set(-0.04 * extend, 0.14 * extend, -0.04 * extend);
    pose.gloveLerpSpeed = 0.7;
    return pose;
  }

  if (action === "hook") {
    const extend = pulse(progress, 0.56);
    const windup = Math.sin(clamp01(progress / 0.32) * Math.PI) * (1 - extend);
    const sweep = easeInOut(clamp01((progress - 0.08) / 0.58));
    const hookArc = new THREE.Vector3(
      mix(0.62, -0.66, sweep),
      1.18 + Math.sin(sweep * Math.PI) * 0.18,
      0.42 + extend * 0.92,
    );

    pose.r.lerp(new THREE.Vector3(0.66, 1.15, 0.14), windup);
    pose.r.lerp(hookArc.add(punchOffset), extend);
    pose.l.lerp(new THREE.Vector3(-0.2, 1.36, 0.6), 0.5 + extend * 0.25);
    pose.headOffset.set(0, 0, -0.01 * extend);
    pose.headRot.set(-0.02 * extend, -0.18 * extend, -0.16 * extend);
    pose.avatarOffset.set(-0.05 * extend, 0, 0.03 * extend);
    pose.bodyRot.set(-0.02 * extend, -0.32 * extend, 0.12 * extend);
    pose.gloveLerpSpeed = 0.64;
    return pose;
  }

  if (action === "uppercut") {
    const drive = pulse(progress, 0.58);
    const dip =
      Math.sin(clamp01(progress / 0.42) * Math.PI) * (1 - drive * 0.45);

    pose.r.lerp(new THREE.Vector3(0.45, 0.72, 0.12), dip);
    pose.r.lerp(ACTIONS.uppercut.r.clone().add(punchOffset), drive);
    pose.l.lerp(new THREE.Vector3(-0.18, 1.36, 0.62), 0.45 + drive * 0.3);
    pose.headOffset.set(0, -0.02 * dip, -0.01);
    pose.headRot.set(0.16 * dip - 0.1 * drive, 0.04 * drive, 0.05 * drive);
    pose.avatarOffset.set(0, -0.08 * dip, 0.02 * drive);
    pose.bodyRot.set(0.18 * dip - 0.2 * drive, 0.08 * drive, -0.05 * drive);
    pose.gloveLerpSpeed = 0.66;
    return pose;
  }

  if (action === "block") {
    const cover = progress >= 0.98 ? 1 : pulse(progress, 0.5);
    pose.l.lerp(ACTIONS.block.l, cover);
    pose.r.lerp(ACTIONS.block.r, cover);
    pose.headOffset.set(0, 0.01 * cover, -0.01 * cover);
    pose.headRot.set(0.05 * cover, 0, 0);
    pose.avatarOffset.set(0, 0, 0);
    pose.bodyRot.set(0.02 * cover, 0, 0);
    return pose;
  }

  if (action === "dodge") {
    const slip = pulse(progress, 0.48);
    pose.l.lerp(ACTIONS.dodge.l, slip);
    pose.r.lerp(ACTIONS.dodge.r, slip);
    pose.avatarOffset.set(dodgeSide * 0.22 * slip, -0.1 * slip, -0.06 * slip);
    pose.headOffset.set(0, -0.3 * slip, -0.4 * slip);
    pose.headRot.set(
      0.2 * slip,
      -dodgeSide * 0.5 * slip,
      -dodgeSide * 0.6 * slip,
    );
    pose.bodyRot.set(
      0.08 * slip,
      -dodgeSide * 0.5 * slip,
      -dodgeSide * 0.6 * slip,
    );
    pose.gloveLerpSpeed = 0.62;
    return pose;
  }

  if (action === "backDodge") {
    const lean = pulse(progress, 0.48);
    pose.l.lerp(ACTIONS.backDodge.l, lean);
    pose.r.lerp(ACTIONS.backDodge.r, lean);
    pose.avatarOffset.set(0, -0.04 * lean, -0.2 * lean);
    pose.headOffset.set(0, -0.5 * lean, -0.4 * lean);
    pose.headRot.set(-0.4 * lean, 0, 0);
    pose.bodyRot.set(-0.78 * lean, 0, 0);
    pose.gloveLerpSpeed = 0.64;
    return pose;
  }

  if (action === "heal") {
    const lift = pulse(progress, 0.52);
    pose.l.lerp(ACTIONS.heal.l, lift);
    pose.r.lerp(ACTIONS.heal.r, lift);
    pose.headOffset.set(0, 0.02 * lift, 0.01 * lift);
    pose.headRot.set(-0.14 * lift, 0, 0);
    pose.avatarOffset.set(0, 0.02 * lift, 0);
    return pose;
  }

  return pose;
}

// 2. Setup Players (Wii-like avatars: Head, Body, disconnected Gloves)
const createPlayer = (
  color,
  domHpId,
  domStaminaId,
  domComboId,
  domHitConfirmId,
  domDazedId,
  domFlashId,
  domBlackoutId,
  gloveColor = color,
) => {
  const rootGroup = new THREE.Group();
  const avatarGroup = new THREE.Group();
  rootGroup.add(avatarGroup);

  const mat = new THREE.MeshStandardMaterial({
    color: color,
    roughness: 0.4,
    transparent: true,
    opacity: 1.0,
  });
  const gloveMat = new THREE.MeshStandardMaterial({
    color: gloveColor,
    roughness: 0.2,
  });

  const bodyGroup = new THREE.Group();
  avatarGroup.add(bodyGroup);

  const headPivot = new THREE.Group();
  headPivot.position.copy(NECK_BASE);
  bodyGroup.add(headPivot);

  // Head (Sphere)
  const headGeo = new THREE.SphereGeometry(0.35, 32, 32);
  const head = new THREE.Mesh(headGeo, mat);
  head.position.copy(HEAD_CENTER_OFFSET);
  head.castShadow = true;
  headPivot.add(head);

  // Body (Capsule)
  const bodyGeo = new THREE.CapsuleGeometry(0.25, 0.5, 4, 16);
  const body = new THREE.Mesh(bodyGeo, mat);
  body.position.y = 0.9;
  body.castShadow = true;
  bodyGroup.add(body);

  // Gloves
  const gloveGeo = new THREE.SphereGeometry(0.2, 32, 32);

  const leftGlove = new THREE.Mesh(gloveGeo, gloveMat);
  leftGlove.position.copy(GLOVE_IDLE_L);
  leftGlove.castShadow = true;
  rootGroup.add(leftGlove);

  const rightGlove = new THREE.Mesh(gloveGeo, gloveMat);
  rightGlove.position.copy(GLOVE_IDLE_R);
  rightGlove.castShadow = true;
  rootGroup.add(rightGlove);

  return {
    rootGroup,
    avatarGroup,
    bodyGroup,
    headPivot,
    head,
    body,
    leftGlove,
    rightGlove,
    baseColor: color,
    uiHp: document.getElementById(domHpId),
    uiStamina: document.getElementById(domStaminaId),
    uiCombo: document.getElementById(domComboId),
    uiHitConfirm: document.getElementById(domHitConfirmId),
    uiDazed: document.getElementById(domDazedId),
    uiFlash: document.getElementById(domFlashId),
    physics: {
      camPos: new THREE.Vector3(),
      camVel: new THREE.Vector3(),
      camTarget: new THREE.Vector3(),
      camRot: new THREE.Vector3(), // using Vector3 for Euler angles xyz
      camRotVel: new THREE.Vector3(),
      camRotTarget: new THREE.Vector3(),
      lookOffset: new THREE.Vector3(),
      lookVel: new THREE.Vector3(),
      lookTarget: new THREE.Vector3(),
      avatarOffset: new THREE.Vector3(),
      avatarVel: new THREE.Vector3(),
      avatarTarget: new THREE.Vector3(),
      spineRot: new THREE.Vector3(),
      spineVel: new THREE.Vector3(),
      spineTarget: new THREE.Vector3(),
      headOffset: new THREE.Vector3(),
      headVel: new THREE.Vector3(),
      headTarget: new THREE.Vector3(),
      headRot: new THREE.Vector3(),
      headRotVel: new THREE.Vector3(),
      headRotTarget: new THREE.Vector3(),
    },
    uiBlackout: document.getElementById(domBlackoutId),
    state: {
      action: "idle",
      timer: 0,
      actionDuration: 0,
      hitLanded: false,
      punchOffset: new THREE.Vector3(),
      attackDamageScale: 1,
      stamina: STAMINA_MAX,
      comboHits: 0,
      dodgeSide: 1,
      health: 100,
      shakeTimer: 0,
      camChaosTimer: 0,
      hitConfirmTimeout: null,
      dazedTimeout: null,
      blackoutTimeout: null,
      isKnockedOut: false,
    },
  };
};

// Player 1 (Red)
const player1 = createPlayer(
  0xff3333,
  "hp-p1",
  "stamina-p1",
  "combo-p1",
  "hit-confirm-p1",
  "dazed-p1",
  "flash-p1",
  "blackout-p1",
  0xcc0000,
);
player1.rootGroup.position.set(0, 0, 1.2);
player1.rootGroup.rotation.y = Math.PI; // Face Player 2
scene.add(player1.rootGroup);
updateCombatUi(player1);

// Player 2 (Blue)
const player2 = createPlayer(
  0x3333ff,
  "hp-p2",
  "stamina-p2",
  "combo-p2",
  "hit-confirm-p2",
  "dazed-p2",
  "flash-p2",
  "blackout-p2",
  0x3333ff,
);
player2.rootGroup.position.set(0, 0, -1.2);
// Player 2 faces +z by default, looking towards Player 1
scene.add(player2.rootGroup);
updateCombatUi(player2);

// 3. Setup Cameras
const aspect = window.innerWidth / 2 / window.innerHeight;
const camera1 = new THREE.PerspectiveCamera(60, aspect, 0.1, 100);
const camera2 = new THREE.PerspectiveCamera(60, aspect, 0.1, 100);

// Camera 1 (Behind Player 1, looking at Player 2)
// We add it to the scene and manually position it so scaling the avatar doesn't break it
scene.add(camera1);

// Camera 2 (Behind Player 2, looking at Player 1)
scene.add(camera2);

// Function to update cameras based on player positions
function updateCameras() {
  // Player 1 View - Sit slightly left shoulder
  const p1WorldPos = player1.rootGroup.position;
  const p1TargetPos = player2.rootGroup.position;
  camera1.position.set(
    p1WorldPos.x - 0.6 + player1.physics.camPos.x,
    2.125 + player1.physics.camPos.y,
    p1WorldPos.z + 1.0 + player1.physics.camPos.z,
  );
  camera1.lookAt(
    p1TargetPos.x + player1.physics.lookOffset.x,
    1.2 + player1.physics.lookOffset.y,
    p1TargetPos.z + player1.physics.lookOffset.z,
  );
  // Apply procedural rotation shake
  camera1.rotation.x += player1.physics.camRot.x * 0.6;
  camera1.rotation.y += player1.physics.camRot.y * 0.6;
  camera1.rotation.z += player1.physics.camRot.z * 0.6;

  // p2 viewpoint
  const p2WorldPos = player2.rootGroup.position;
  const p2TargetPos = player1.rootGroup.position;
  camera2.position.set(
    p2WorldPos.x + 0.6 + player2.physics.camPos.x,
    2.125 + player2.physics.camPos.y,
    p2WorldPos.z - 1.0 + player2.physics.camPos.z,
  );
  camera2.lookAt(
    p2TargetPos.x + player2.physics.lookOffset.x,
    1.2 + player2.physics.lookOffset.y,
    p2TargetPos.z + player2.physics.lookOffset.z,
  );
  camera2.rotation.x += player2.physics.camRot.x * 0.6;
  camera2.rotation.y += player2.physics.camRot.y * 0.6;
  camera2.rotation.z += player2.physics.camRot.z * 0.6;
}

// ------------------------------------------------------------
// INPUT HANDLING
// ------------------------------------------------------------
const isDodgeAction = (action) => action === "dodge" || action === "backDodge";

const setAction = (p, action) => {
  // Allow overriding idle, or interrupting if we want
  if (
    (p.state.action === "idle" || p.state.action === "block") &&
    !p.state.isKnockedOut
  ) {
    if (action === "block" && p.state.action === "block") {
      // If we are already blocking, release the block
      p.state.action = "idle";
      p.state.timer = 0;
      return;
    }
    const act = ACTIONS[action];
    const staminaCost = act.staminaCost || 0;
    const staminaAfterCost = THREE.MathUtils.clamp(
      p.state.stamina - staminaCost,
      0,
      STAMINA_MAX,
    );
    const durationScale =
      act.damage > 0 ? getStaminaDurationScale(staminaAfterCost) : 1;

    if (action === "dodge") p.state.dodgeSide *= -1;
    p.state.action = action;
    p.state.actionDuration = act.duration * durationScale;
    p.state.timer = p.state.actionDuration;
    p.state.hitLanded = false; // reset hit flag
    p.state.punchOffset = getRandomPunchOffset(action);
    p.state.attackDamageScale =
      act.damage > 0 ? getStaminaDamageScale(staminaAfterCost) : 1;
    p.state.stamina = staminaAfterCost;
    updateStaminaUi(p);
  }
};

const NETWORK_ACTION_MAP = {
  jab: "jab",
  punch_jab: "jab",
  hook: "hook",
  punch_hook: "hook",
  uppercut: "uppercut",
  punch_uppercut: "uppercut",
  dodge_left: "dodge_left",
  dodge_right: "dodge_right",
  dodge_down: "backDodge",
  dodge_back: "backDodge",
  backdodge: "backDodge",
  back_dodge: "backDodge",
  block: "block",
  block_start: "block_start",
  block_end: "block_end",
};

const NETWORK_PLAYER_MAP = {
  p1: player1,
  p2: player2,
};

const networkParams = new URLSearchParams(window.location.search);
const networkServerIp =
  networkParams.get("serverIp") || networkParams.get("server");
const networkP1Id = networkParams.get("p1");
const networkP2Id = networkParams.get("p2");
const serverRelayEnabled = networkParams.get("serverRelay") !== "0";
const serverWsUrl =
  networkParams.get("ws") ||
  `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/ws`;
const debugLiveEnabled = networkParams.get("debugLive") !== "0";
const ACTIVE_ROOM_STORAGE_KEY = "wiiBoxing.activeRoomCode";

let currentRoomCode = null;
let liveDebugWindow = null;
const networkSenderToPlayer = new Map();

function resolveSlotPlayer(slot) {
  const normalized = String(slot || "")
    .trim()
    .toLowerCase();
  if (["p1", "player1", "1", "red", "left"].includes(normalized)) {
    return player1;
  }
  if (["p2", "player2", "2", "blue", "right"].includes(normalized)) {
    return player2;
  }
  return null;
}

function resolveNetworkPlayer(id, data) {
  const slotPlayer =
    resolveSlotPlayer(data?.playerId) ||
    resolveSlotPlayer(data?.player) ||
    resolveSlotPlayer(data?.side);
  if (slotPlayer) return slotPlayer;

  if (networkP1Id && id === networkP1Id) return player1;
  if (networkP2Id && id === networkP2Id) return player2;

  if (!id) return null;

  if (networkSenderToPlayer.has(id)) {
    return networkSenderToPlayer.get(id);
  }

  const claimedPlayers = new Set(networkSenderToPlayer.values());
  if (!claimedPlayers.has(player1)) {
    networkSenderToPlayer.set(id, player1);
    return player1;
  }
  if (!claimedPlayers.has(player2)) {
    networkSenderToPlayer.set(id, player2);
    return player2;
  }

  return null;
}

function normalizeNetworkAction(data) {
  const rawAction = String(
    data?.action || data?.move || data?.type || "",
  ).toLowerCase();
  if (!rawAction) return null;
  return NETWORK_ACTION_MAP[rawAction] || null;
}

function applyNetworkAction(player, normalizedAction) {
  if (!player || !normalizedAction) return;

  if (normalizedAction === "dodge_left") {
    player.state.dodgeSide = -1;
    setAction(player, "dodge");
    return;
  }

  if (normalizedAction === "dodge_right") {
    player.state.dodgeSide = 1;
    setAction(player, "dodge");
    return;
  }

  if (normalizedAction === "block_start") {
    if (player.state.action !== "block") setAction(player, "block");
    return;
  }

  if (normalizedAction === "block_end") {
    if (player.state.action === "block") setAction(player, "block");
    return;
  }

  if (normalizedAction === "block") {
    if (player.state.action !== "block") setAction(player, "block");
    return;
  }

  if (normalizedAction === "backDodge") {
    setAction(player, "backDodge");
    return;
  }

  setAction(player, normalizedAction);
}

function buildLiveDebugUrl(roomCode) {
  const url = new URL("/test.html", window.location.origin);
  if (roomCode) url.searchParams.set("room", roomCode);
  return url.toString();
}

function openLiveDebugSide(roomCode) {
  const url = buildLiveDebugUrl(roomCode);
  const features =
    "popup=yes,width=420,height=900,left=0,top=0,resizable=yes,scrollbars=yes";

  if (liveDebugWindow && !liveDebugWindow.closed) {
    liveDebugWindow.location.href = url;
    liveDebugWindow.focus();
    return;
  }

  liveDebugWindow = window.open(url, "live-debug", features);
}

function ensureLiveDebugButton() {
  if (!debugLiveEnabled) return;
  if (document.getElementById("open-live-debug")) return;

  const button = document.createElement("button");
  button.id = "open-live-debug";
  button.type = "button";
  button.textContent = "Open Live Debug";
  Object.assign(button.style, {
    position: "fixed",
    top: "12px",
    right: "12px",
    zIndex: "120",
    padding: "10px 14px",
    border: "none",
    borderRadius: "8px",
    background: "rgba(0, 0, 0, 0.7)",
    color: "#fff",
    fontWeight: "700",
    cursor: "pointer",
  });
  button.addEventListener("click", () => openLiveDebugSide(currentRoomCode));
  document.body.appendChild(button);
}

function connectRendererToServerRelay() {
  ensureLiveDebugButton();

  const connect = () => {
    const ws = new WebSocket(serverWsUrl);

    ws.addEventListener("open", () => {
      ws.send(
        JSON.stringify({
          type: "display:create_room",
          data: {},
          t: Date.now(),
        }),
      );
    });

    ws.addEventListener("message", (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }

      if (message?.type === "room:created") {
        currentRoomCode = message?.data?.roomCode || null;
        if (currentRoomCode) {
          try {
            window.localStorage.setItem(
              ACTIVE_ROOM_STORAGE_KEY,
              currentRoomCode,
            );
          } catch {
            // Storage might be blocked in hardened browser modes.
          }
        }

        if (liveDebugWindow && !liveDebugWindow.closed) {
          liveDebugWindow.postMessage(
            { type: "renderer:roomCode", roomCode: currentRoomCode },
            window.location.origin,
          );
        }
        return;
      }

      if (message?.type !== "player:action_relay") return;

      const player = resolveNetworkPlayer(null, message.data);
      const normalizedAction = normalizeNetworkAction(message.data);
      applyNetworkAction(player, normalizedAction);
    });

    ws.addEventListener("close", () => {
      setTimeout(connect, 1500);
    });

    ws.addEventListener("error", () => {
      // reconnect is handled by the close callback
    });
  };

  connect();
}

if (serverRelayEnabled) {
  connectRendererToServerRelay();
}

if (networkServerIp) {
  Network.onData = (id, data) => {
    const player = resolveNetworkPlayer(id, data);
    const normalizedAction = normalizeNetworkAction(data);
    applyNetworkAction(player, normalizedAction);
  };

  try {
    Network.init(networkServerIp);
    console.info("[network] connected to", networkServerIp);
  } catch (error) {
    console.error("[network] failed to initialize", error);
  }
}

window.addEventListener("keydown", (e) => {
  switch (e.key.toLowerCase()) {
    // Player 1 controls
    case "q":
      setAction(player1, "jab");
      break;
    case "w":
      setAction(player1, "hook");
      break;
    case "e":
      setAction(player1, "uppercut");
      break;
    case "r":
      setAction(player1, "block");
      break;
    case "a":
      setAction(player1, "dodge");
      break;
    case "s":
      setAction(player1, "backDodge");
      break;

    // Player 2 controls
    case "u":
      setAction(player2, "jab");
      break;
    case "i":
      setAction(player2, "hook");
      break;
    case "o":
      setAction(player2, "uppercut");
      break;
    case "p":
      setAction(player2, "block");
      break;
    case "j":
      setAction(player2, "dodge");
      break;
    case "k":
      setAction(player2, "backDodge");
      break;
  }
});

// 4. Handle Window Resize
window.addEventListener("resize", () => {
  const w = window.innerWidth;
  const h = window.innerHeight;

  renderer.setSize(w, h);

  const newAspect = w / 2 / h;

  camera1.aspect = newAspect;
  camera1.updateProjectionMatrix();

  camera2.aspect = newAspect;
  camera2.updateProjectionMatrix();
});

function setPlayerViewMode(p, isFront) {
  if (isFront) {
    p.head.material.transparent = true;
    p.head.material.opacity = 0.6;
    p.body.material.transparent = true;
    p.body.material.opacity = 0.6;
    // Move front character down and keep normal scale
    // p.avatarGroup.position.y = -0.5;
    p.avatarGroup.scale.set(1.0, 1.0, 1.0);
  } else {
    p.head.material.transparent = true;
    p.head.material.opacity = 1.0;
    p.body.material.transparent = true;
    p.body.material.opacity = 1.0;
    // Enemy scales up for the opponent camera.
    p.avatarGroup.scale.set(1.4, 1.4, 1.4);
  }
}
function triggerBlackout(player, intensity, durationMs) {
  if (!player.uiBlackout) return;
  player.uiBlackout.style.opacity = `${THREE.MathUtils.clamp(intensity, 0, 0.98)}`;
  if (player.state.blackoutTimeout) {
    clearTimeout(player.state.blackoutTimeout);
    player.state.blackoutTimeout = null;
  }
  if (durationMs > 0) {
    player.state.blackoutTimeout = setTimeout(() => {
      player.uiBlackout.style.opacity = "0";
      player.state.blackoutTimeout = null;
    }, durationMs);
  }
}

function triggerHitConfirm(player, punchOffset) {
  if (!player.uiHitConfirm) return;

  const position = getHitConfirmPosition(punchOffset);
  player.uiHitConfirm.style.setProperty("--hit-x", `${position.x}%`);
  player.uiHitConfirm.style.setProperty("--hit-y", `${position.y}%`);
  player.uiHitConfirm.classList.remove("active");
  void player.uiHitConfirm.offsetWidth;
  player.uiHitConfirm.classList.add("active");

  if (player.state.hitConfirmTimeout) {
    clearTimeout(player.state.hitConfirmTimeout);
  }
  player.state.hitConfirmTimeout = setTimeout(() => {
    player.uiHitConfirm.classList.remove("active");
    player.state.hitConfirmTimeout = null;
  }, 430);
}

function triggerDazed(player, damage) {
  if (!player.uiDazed) return;

  const duration = Math.min(
    4000,
    2000 + Math.max(0, damage - DAZED_DAMAGE_THRESHOLD) * 120,
  );
  const blur = Math.min(
    24,
    12 + Math.max(0, damage - DAZED_DAMAGE_THRESHOLD) * 2,
  );

  player.uiDazed.style.transition = "none";
  player.uiDazed.style.opacity = ""; // remove inline opacity so .active kicks in
  player.uiDazed.classList.remove("active");
  void player.uiDazed.offsetWidth;

  player.uiDazed.style.setProperty("--dazed-duration", `${duration}ms`);
  player.uiDazed.style.setProperty("--dazed-blur", `${blur}px`);
  player.uiDazed.classList.add("active");
  void player.uiDazed.offsetWidth;
  player.uiDazed.style.transition = "";

  requestAnimationFrame(() => {
    player.uiDazed.style.opacity = "0";
    player.uiDazed.style.setProperty("--dazed-blur", "0px");
  });

  if (player.state.dazedTimeout) {
    clearTimeout(player.state.dazedTimeout);
  }
  player.state.dazedTimeout = setTimeout(() => {
    player.uiDazed.classList.remove("active");
    player.uiDazed.style.opacity = "";
    player.uiDazed.style.setProperty("--dazed-blur", "0px");
    player.state.dazedTimeout = null;
  }, duration);
}

function getCameraHitMirror(player) {
  const forwardZ = new THREE.Vector3(0, 0, 1).applyQuaternion(
    player.rootGroup.quaternion,
  ).z;

  // Camera offsets are world-space, so mirror them for the opposite view.
  return forwardZ < 0 ? 1 : -1;
}

let recentHits = [];

let crowdInstance = crowd;

function triggerHitNode(attacker, defender, baseDamage, attackType = "jab") {
  if (isDodgeAction(defender.state.action)) {
    registerSuccessfulDodge(defender, attacker);
    return;
  }
  let comboMultiplier;
  if (defender.state.action === "block") {
    comboMultiplier = 0.5;
  } else {
    comboMultiplier = getComboDamageMultiplier(attacker);
  }

  const damage =
    baseDamage * attacker.state.attackDamageScale * comboMultiplier;

  triggerHitConfirm(attacker, attacker.state.punchOffset);
  if (damage >= DAZED_DAMAGE_THRESHOLD) {
    triggerDazed(defender, damage);
  }

  defender.state.health = Math.max(0, defender.state.health - damage);
  defender.uiHp.style.width = defender.state.health + "%";
  defender.state.shakeTimer = 0.35;
  const cameraHitMirror = getCameraHitMirror(defender);

  // Handle Crowd reactions
  crowdInstance.react(damage / 20);
  // recentHits.push(Date.now());
  // recentHits = recentHits.filter(t => Date.now() - t < 2000);
  // if (recentHits.length >= 3) {
  //     crowdInstance.setState('WILD');
  // }

  // trigger physically based on the attack received
  let hitPower = damage / 20; // 0 to 1 based on damage max

  // Apply physical impulse to the defender's camera and spine
  let camImpulseX = (Math.random() - 0.5) * 18.0 * hitPower;
  let camImpulseY = (Math.random() - 0.5) * 16.0 * hitPower;
  let camImpulseZ = (Math.random() - 0.5) * 24.0 * hitPower;
  let spineImpulseX = 0;
  let spineImpulseZ = 0;
  let spineImpulseY = 0;

  if (attackType === "jab") {
    spineImpulseX = -5.0 * hitPower; // Bend backwards slightly
    spineImpulseZ = camImpulseX * -0.2; // Twist sideways
    camImpulseZ = -2 * hitPower;
  } else if (attackType === "hook") {
    camImpulseX = 7.0 * hitPower;
    spineImpulseZ = camImpulseX * -0.6; // Twist sideways
    camImpulseZ = 3 * hitPower;
  } else if (attackType === "uppercut") {
    camImpulseY = -13.0 * hitPower;
    camImpulseX = (Math.random() - 0.5) * 12.0 * hitPower;
    spineImpulseY = Math.random() - 0.5 - 15.0 * hitPower;
    spineImpulseX = -12.4 * hitPower; // Bend backwards heavily
    camImpulseZ = 8 * hitPower;
  }

  const mirroredCamImpulseX = camImpulseX * cameraHitMirror;
  const mirroredCamImpulseZ = camImpulseZ * cameraHitMirror;

  defender.physics.camVel.x += mirroredCamImpulseX;
  defender.physics.camVel.y += camImpulseY;
  defender.physics.camVel.z += mirroredCamImpulseZ;
  defender.physics.camRotVel.z += mirroredCamImpulseX * 0.5;
  defender.physics.camRotVel.x += camImpulseY * 0.26;
  defender.physics.camRotVel.y += camImpulseY * 0.37;

  defender.physics.spineVel.x += spineImpulseX;
  defender.physics.spineVel.z += spineImpulseZ;
  defender.physics.spineVel.y += spineImpulseY;

  defender.physics.avatarVel.x += camImpulseX * 0.035;
  defender.physics.avatarVel.y += camImpulseY * 0.02;
  defender.physics.avatarVel.z += camImpulseZ * 0.035;
  defender.physics.headVel.x += camImpulseX * 0.18;
  defender.physics.headVel.y +=
    attackType === "uppercut" ? hitPower * 2.8 : hitPower * 0.45;
  defender.physics.headVel.z += camImpulseZ * 0.16;
  defender.physics.headRotVel.x +=
    attackType === "uppercut" ? -hitPower * 3.4 : hitPower * 0.7;
  defender.physics.headRotVel.y -= camImpulseX * 0.24;
  defender.physics.headRotVel.z -= camImpulseX * 0.34;

  if (defender.state.health <= 0 && !defender.state.isKnockedOut) {
    defender.state.isKnockedOut = true;
    defender.physics.spineTarget.set(-Math.PI / 2, 0, 0); // Knocked out, lay flat on ground
    defender.physics.spineVel.x = -50;
    defender.physics.avatarVel.z -= 10;
    defender.physics.headVel.y -= 18;
    defender.physics.headRotVel.x -= 16;
    defender.physics.camVel.y -= 45;
    defender.physics.camRotVel.x -= 30;
    triggerBlackout(defender, 1, 0);
    crowdInstance.setState("KNOCKOUT_REACTION");
  } else {
    triggerBlackout(
      defender,
      0.05 + hitPower * 0.35,
      45 + Math.floor(hitPower * 90),
    );
  }

  // Screen space flash effect
  defender.uiFlash.style.opacity = "1";
  setTimeout(() => {
    defender.uiFlash.style.opacity = "0";
  }, 75);

  registerLandedHit(attacker, defender);
}

function processActions(p, defender, time, deltaTime) {
  if (p.state.shakeTimer > 0) {
    p.state.shakeTimer -= deltaTime;
  }

  let activeAction = p.state.action;
  let actionProgress = 0;

  if (activeAction !== "idle" && !p.state.isKnockedOut) {
    const act = ACTIONS[activeAction];
    const actionDuration = p.state.actionDuration || act.duration;
    p.state.timer = Math.max(0, p.state.timer - deltaTime);
    actionProgress =
      actionDuration > 0 ? clamp01(1.0 - p.state.timer / actionDuration) : 1.0;

    if (
      actionProgress > 0.4 &&
      actionProgress < 0.62 &&
      !p.state.hitLanded &&
      act.damage > 0
    ) {
      triggerHitNode(p, defender, act.damage, activeAction);
      p.state.hitLanded = true;
    }

    if (p.state.timer <= 0 && activeAction !== "block") {
      p.state.action = "idle";
      p.state.actionDuration = 0;
      p.state.attackDamageScale = 1;
      activeAction = "idle";
      actionProgress = 0;
    } else if (activeAction === "block") {
      actionProgress = 1.0;
      p.state.health = Math.min(100, p.state.health + 6.0 * deltaTime);
      p.uiHp.style.width = p.state.health + "%";
    }
  }

  if (!p.state.isKnockedOut && p.state.stamina < STAMINA_MAX) {
    const staminaRegen =
      activeAction === "idle"
        ? STAMINA_REGEN_IDLE
        : activeAction === "block"
          ? 5
          : STAMINA_REGEN_BUSY;
    p.state.stamina = Math.min(
      STAMINA_MAX,
      p.state.stamina + staminaRegen * deltaTime,
    );
    updateStaminaUi(p);
  }

  const pose = getActionPose(
    activeAction,
    actionProgress,
    time,
    p.state.dodgeSide,
    p.state.punchOffset,
  );

  if (!p.state.isKnockedOut) {
    p.physics.avatarTarget.copy(pose.avatarOffset);
    p.physics.spineTarget.copy(pose.bodyRot);
    p.physics.headTarget.copy(pose.headOffset);
    p.physics.headRotTarget.copy(pose.headRot);
  } else {
    p.physics.avatarTarget.set(0, 0, -0.18);
    p.physics.headTarget.set(0, 0.1, -0.015);
    p.physics.headRotTarget.set(-MAX_NECK_ROTATION, 0, 0.08);
    pose.l.set(-0.4, 0, -1);
    pose.r.set(0.4, 0, -1);
  }
  clampVectorLength(p.physics.headTarget, MAX_NECK_OFFSET);
  clampVectorLength(p.physics.headRotTarget, MAX_NECK_ROTATION);

  p.state.camChaosTimer -= deltaTime;
  const isTakingHit = p.state.shakeTimer > 0;
  const chaosScale = isTakingHit ? 1.8 : 0.35;
  if (p.state.camChaosTimer <= 0) {
    p.physics.camTarget.set(
      (Math.random() - 0.5) * 0.7 * chaosScale,
      (Math.random() - 0.5) * 0.5 * chaosScale,
      (Math.random() - 0.5) * 0.45 * chaosScale,
    );
    p.physics.camRotTarget.set(
      (Math.random() - 0.5) * 0.55 * chaosScale,
      (Math.random() - 0.5) * 0.65 * chaosScale,
      (Math.random() - 0.5) * 0.35 * chaosScale,
    );
    p.physics.lookTarget.set(
      (Math.random() - 0.5) * 2.2 * chaosScale,
      (Math.random() - 0.5) * 1.2 * chaosScale,
      (Math.random() - 0.5) * 2.2 * chaosScale,
    );
    p.state.camChaosTimer = p.state.isKnockedOut
      ? 0.03 + Math.random() * 0.05
      : isTakingHit
        ? 0.05 + Math.random() * 0.12
        : 0.12 + Math.random() * 0.22;
  }

  // --- Physics Update (Virtual Ragdoll / Camera Springs) ---
  // Return to target quickly with friction
  updateSpring(
    p.physics.camPos,
    p.physics.camVel,
    p.physics.camTarget,
    45.0,
    0.82,
    deltaTime,
  );
  updateSpring(
    p.physics.lookOffset,
    p.physics.lookVel,
    p.physics.lookTarget,
    13.0,
    0.78,
    deltaTime,
  );
  updateSpring(
    p.physics.camRot,
    p.physics.camRotVel,
    p.physics.camRotTarget,
    14.0,
    0.8,
    deltaTime,
  );
  updateSpring(
    p.physics.avatarOffset,
    p.physics.avatarVel,
    p.physics.avatarTarget,
    p.state.isKnockedOut ? 42.0 : 72.0,
    p.state.isKnockedOut ? 0.62 : 0.74,
    deltaTime,
  );
  updateSpring(
    p.physics.spineRot,
    p.physics.spineVel,
    p.physics.spineTarget,
    p.state.isKnockedOut ? 78.0 : 56.0,
    p.state.isKnockedOut ? 0.62 : 0.73,
    deltaTime,
  );
  updateSpring(
    p.physics.headOffset,
    p.physics.headVel,
    p.physics.headTarget,
    p.state.isKnockedOut ? 52.0 : 88.0,
    p.state.isKnockedOut ? 0.64 : 0.7,
    deltaTime,
  );
  updateSpring(
    p.physics.headRot,
    p.physics.headRotVel,
    p.physics.headRotTarget,
    p.state.isKnockedOut ? 48.0 : 86.0,
    p.state.isKnockedOut ? 0.64 : 0.68,
    deltaTime,
  );
  if (clampVectorLength(p.physics.headOffset, MAX_NECK_OFFSET)) {
    p.physics.headVel.multiplyScalar(0.35);
  }
  if (clampVectorLength(p.physics.headRot, MAX_NECK_ROTATION)) {
    p.physics.headRotVel.multiplyScalar(0.35);
  }

  p.avatarGroup.rotation.set(0, 0, 0);
  p.bodyGroup.rotation.set(
    p.physics.spineRot.x,
    p.physics.spineRot.y,
    p.physics.spineRot.z,
  );
  p.headPivot.position.copy(NECK_BASE).add(p.physics.headOffset);
  p.headPivot.rotation.set(
    p.physics.headRot.x,
    p.physics.headRot.y,
    p.physics.headRot.z,
  );
  p.avatarGroup.position.copy(p.physics.avatarOffset);
  if (
    (activeAction === "idle" || activeAction === "block") &&
    !p.state.isKnockedOut
  ) {
    p.avatarGroup.position.y += Math.sin(time * 10) * 0.06;
  }

  // Smooth lerp visually
  p.leftGlove.position.lerp(
    pose.l.clone().add(p.physics.avatarOffset),
    pose.gloveLerpSpeed,
  );
  p.rightGlove.position.lerp(
    pose.r.clone().add(p.physics.avatarOffset),
    pose.gloveLerpSpeed,
  );
}

// 5. Render Loop with Split Screen
const clock = new THREE.Clock();
let previousTime = 0;

function animate() {
  requestAnimationFrame(animate);

  const time = clock.getElapsedTime();
  const deltaTime = Math.min(time - previousTime, 0.1); // Safe delta calc max 0.1
  previousTime = time;

  processActions(player1, player2, time, deltaTime);
  processActions(player2, player1, time, deltaTime);

  ring.update(deltaTime);
  crowdInstance.update(deltaTime);

  updateCameras();

  // Render Split Screen
  const w = window.innerWidth;
  const h = window.innerHeight;
  const halfW = Math.floor(w / 2);

  // p1 view
  renderer.setViewport(0, 0, halfW, h);
  renderer.setScissor(0, 0, halfW, h);
  renderer.setClearColor(0x87ceeb);
  renderer.clear();

  // cam 1
  setPlayerViewMode(player1, true); // P1 is front
  setPlayerViewMode(player2, false); // P2 is enemy

  renderer.render(scene, camera1);

  // p2 view
  renderer.setViewport(halfW, 0, halfW, h);
  renderer.setScissor(halfW, 0, halfW, h);
  renderer.setClearColor(0x87ceeb);
  renderer.clear();

  // Set View States for Camera 2
  setPlayerViewMode(player2, true); // P2 is front
  setPlayerViewMode(player1, false); // P1 is enemy

  renderer.render(scene, camera2);
}

// Start rendering
animate();

// Start the bodycam effect after renderer and canvas exist
BodycamEffect.start();
