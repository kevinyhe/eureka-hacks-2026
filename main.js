import * as THREE from "three";

// Bodycam Effect Inlined
const BodycamEffect = (() => {
  let isRunning = false;
  let overlayDiv, noiseCanvas, noiseCtx, svgFilter, gameCanvas;
  let animationFrameId;
  let lastNoiseUpdate = 0;
  let lastShakeUpdate = 0;
  
  let shakeCurrent = { x: 0, y: 0, r: 0 };
  let shakeTarget = { x: 0, y: 0, r: 0 };

  let originalTransform = '';
  let originalFilter = '';
  function init() {
    if (overlayDiv) return;
    
    // Find the Three.js canvas
    gameCanvas = document.querySelector('canvas');

    // 1. Create SVG Filter for Chromatic Aberration and Lens Distortion
    svgFilter = document.createElement('div');
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
    overlayDiv = document.createElement('div');
    overlayDiv.id = 'bodycam-overlay';
    Object.assign(overlayDiv.style, {
      position: 'fixed',
      top: '0', left: '0', width: '100vw', height: '100vh',
      pointerEvents: 'none',
      zIndex: '9999',
      display: 'none'
    });

    // 3. Noise layer (Canvas)
    noiseCanvas = document.createElement('canvas');
    Object.assign(noiseCanvas.style, {
      position: 'absolute', top: '0', left: '0', width: '100%', height: '100%', 
      opacity: '0.2',
      mixBlendMode: 'screen'
    });
    noiseCtx = noiseCanvas.getContext('2d');
    overlayDiv.appendChild(noiseCanvas);

    // 4. Vignette + Lens Smudge/Bloom + Color Grade Tint layer
    const shaderLayer = document.createElement('div');
    Object.assign(shaderLayer.style, {
      position: 'absolute', top: '0', left: '0', width: '100%', height: '100%',
      background: `
        radial-gradient(circle at center, transparent 40%, rgba(0,0,0,0.65) 100%),
        radial-gradient(circle at center, rgba(255,255,255,0.06) 0%, transparent 20%),
        rgba(0, 15, 10, 0.1)
      `,
      mixBlendMode: 'multiply'
    });
    overlayDiv.appendChild(shaderLayer);

    // 5. HUD Overlay
    const hudEl = document.createElement('div');
    Object.assign(hudEl.style, {
      position: 'absolute', top: '30px', left: '40px',
      color: '#fff', fontFamily: 'monospace, "Courier New", Courier', fontSize: '24px',
      opacity: '0.4', textShadow: '1px 1px 0 #000, -1px -1px 0 #000'
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

    window.addEventListener('resize', handleResize);
    handleResize();
  }

  function handleResize() {
    if (noiseCanvas) {
      noiseCanvas.width = window.innerWidth;
      noiseCanvas.height = window.innerHeight;
    }
  }

  function renderNoise() {
    if (!noiseCtx) return;
    const w = noiseCanvas.width;
    const h = noiseCanvas.height;
    
    // Generate noise onto a small tile to save performance
    const patSize = 256;
    const imgData = noiseCtx.createImageData(patSize, patSize);
    const data = imgData.data;
    for (let i = 0; i < data.length; i += 4) {
      const val = Math.random() * 255;
      data[i] = val;
      data[i+1] = val;
      data[i+2] = val;
      data[i+3] = 255;
    }
    
    const tileCanvas = document.createElement('canvas');
    tileCanvas.width = tileCanvas.height = patSize;
    tileCanvas.getContext('2d').putImageData(imgData, 0, 0);

    const pattern = noiseCtx.createPattern(tileCanvas, 'repeat');
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
      
      const dot = document.getElementById('bc-rec-dot');
      if (dot) dot.style.opacity = Math.floor(time / 600) % 2 === 0 ? '1' : '0.1';

      const timeEl = document.getElementById('bc-time');
      if (timeEl) {
        const d = new Date();
        timeEl.textContent = d.toTimeString().split(' ')[0];
      }

      // Apply the shake ONLY to the game canvas and the overlay, so it doesn't break the body's layout
      if (gameCanvas) {
        gameCanvas.style.transform = \`scale(1.04) translate(\${shakeCurrent.x}px, \${shakeCurrent.y}px) rotate(\${shakeCurrent.r}deg)\`;
      }
      overlayDiv.style.transform = \`scale(1.04) translate(\${shakeCurrent.x}px, \${shakeCurrent.y}px) rotate(\${shakeCurrent.r}deg)\`;
      
      lastNoiseUpdate = time;
    }

    // Camera Shake Target update (random every 80 - 200ms)
    if (time - lastShakeUpdate > 80 + Math.random() * 120) {
      shakeTarget.x = (Math.random() - 0.5) * 8; // ±4px
      shakeTarget.y = (Math.random() - 0.5) * 8; // ±4px
      shakeTarget.r = (Math.random() - 0.5) * 0.2; // ±0.1deg
      lastShakeUpdate = time;
    }
  }

  return {
    start: () => {
      if (isRunning) return;
      init();
      isRunning = true;
      overlayDiv.style.display = 'block';
      
      if (gameCanvas) {
        originalTransform = gameCanvas.style.transform;
        originalFilter = gameCanvas.style.filter;
        gameCanvas.style.filter = \`saturate(0.8) contrast(1.1) url(#bodycam-aberration)\`;
      }
      
      lastNoiseUpdate = performance.now();
      lastShakeUpdate = performance.now();
      animationFrameId = requestAnimationFrame(tick);
    },
    stop: () => {
      if (!isRunning) return;
      isRunning = false;
      overlayDiv.style.display = 'none';
      if (gameCanvas) {
        gameCanvas.style.transform = originalTransform;
        gameCanvas.style.filter = originalFilter;
      }
      overlayDiv.style.transform = 'none';
      cancelAnimationFrame(animationFrameId);
    }
  };
})();

// 1. Setup Scene, Renderer
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb); // Sky blue background

// Add a simple arena floor
const floorGeo = new THREE.PlaneGeometry(20, 20);
const floorMat = new THREE.MeshStandardMaterial({
  color: 0x88aa88,
  roughness: 0.8,
});
const floor = new THREE.Mesh(floorGeo, floorMat);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

// Add lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);

const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
dirLight.position.set(5, 10, 5);
dirLight.castShadow = true;
dirLight.shadow.mapSize.width = 1024;
dirLight.shadow.mapSize.height = 1024;
scene.add(dirLight);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.shadowMap.enabled = true;
// Enable scissor test to allow rendering multiple views
renderer.setScissorTest(true);
document.body.appendChild(renderer.domElement);

// ------------------------------------------------------------
// ACTION AND ANIMATION CONFIG
// ------------------------------------------------------------
const GLOVE_IDLE_L = new THREE.Vector3(-0.35, 1.0, 0.3);
const GLOVE_IDLE_R = new THREE.Vector3(0.35, 1.0, 0.3);

const ACTIONS = {
  idle:     { duration: 0,   l: GLOVE_IDLE_L, r: GLOVE_IDLE_R, damage: 0 },
  jab:      { duration: 0.3, l: new THREE.Vector3(-0.1, 1.2, 2.0), r: GLOVE_IDLE_R, damage: 5 },
  hook:     { duration: 0.5, l: GLOVE_IDLE_L, r: new THREE.Vector3(-0.4, 1.2, 1.8), damage: 15 },
  uppercut: { duration: 0.6, l: GLOVE_IDLE_L, r: new THREE.Vector3(0.1, 2.0, 1.6), damage: 20 },
  block:    { duration: 0.4, l: new THREE.Vector3(-0.15, 1.3, 0.6), r: new THREE.Vector3(0.15, 1.3, 0.6), damage: 0 },
  heal:     { duration: 0.8, l: new THREE.Vector3(-0.2, 1.6, 0.4), r: new THREE.Vector3(0.2, 1.6, 0.4), damage: 0 }
};

// 2. Setup Players (Wii-like avatars: Head, Body, disconnected Gloves)
const createPlayer = (color, domHpId, domFlashId) => {
  const rootGroup = new THREE.Group();
  const avatarGroup = new THREE.Group();
  rootGroup.add(avatarGroup);

  const mat = new THREE.MeshStandardMaterial({ 
    color: color, 
    roughness: 0.4,
    transparent: true,
    opacity: 1.0 
  });
  const gloveMat = new THREE.MeshStandardMaterial({
    color: 0xcc0000,
    roughness: 0.2,
  });

  // Head (Sphere)
  const headGeo = new THREE.SphereGeometry(0.35, 32, 32);
  const head = new THREE.Mesh(headGeo, mat);
  head.position.y = 1.6;
  head.castShadow = true;
  avatarGroup.add(head);

  // Body (Capsule)
  const bodyGeo = new THREE.CapsuleGeometry(0.25, 0.5, 4, 16);
  const body = new THREE.Mesh(bodyGeo, mat);
  body.position.y = 0.9;
  body.castShadow = true;
  avatarGroup.add(body);

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

  return { rootGroup, avatarGroup, head, body, leftGlove, rightGlove, baseColor: color, uiHp: document.getElementById(domHpId), uiFlash: document.getElementById(domFlashId), state: { action: "idle", timer: 0, hitLanded: false, health: 100, shakeTimer: 0 } };
};

// Player 1 (Red)
const player1 = createPlayer(0xff3333, "hp-p1", "flash-p1");
player1.rootGroup.position.set(0, 0, 1.2);
player1.rootGroup.rotation.y = Math.PI; // Face Player 2
scene.add(player1.rootGroup);

// Player 2 (Blue)
const player2 = createPlayer(0x3333ff, "hp-p2", "flash-p2");
player2.rootGroup.position.set(0, 0, -1.2);
// Player 2 faces +z by default, looking towards Player 1
scene.add(player2.rootGroup);

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
  let shakeOffset1 = new THREE.Vector3(0,0,0);
  let shakeOffset2 = new THREE.Vector3(0,0,0);

  if (player1.state.shakeTimer > 0) {
    shakeOffset1.set((Math.random()-0.5)*0.2, (Math.random()-0.5)*0.2, (Math.random()-0.5)*0.2);
  }
  if (player2.state.shakeTimer > 0) {
    shakeOffset2.set((Math.random()-0.5)*0.2, (Math.random()-0.5)*0.2, (Math.random()-0.5)*0.2);
  }

  camera1.position.set(player1.rootGroup.position.x + shakeOffset1.x, 2.2 + shakeOffset1.y, player1.rootGroup.position.z + 2.0 + shakeOffset1.z); // 2.0 units behind P1 global
  camera1.lookAt(player2.rootGroup.position.x, 1.2, player2.rootGroup.position.z);

  camera2.position.set(player2.rootGroup.position.x + shakeOffset2.x, 2.2 + shakeOffset2.y, player2.rootGroup.position.z - 2.0 + shakeOffset2.z); // 2.0 units behind P2 global
  camera2.lookAt(player1.rootGroup.position.x, 1.2, player1.rootGroup.position.z);
}

// ------------------------------------------------------------
// INPUT HANDLING
// ------------------------------------------------------------
window.addEventListener("keydown", (e) => {
  const setAction = (p, action) => {
      // Allow overriding idle, or interrupting if we want
      if (p.state.action === "idle") {
          p.state.action = action;
          p.state.timer = ACTIONS[action].duration;
          p.state.hitLanded = false; // reset hit flag
      }
  };

  switch(e.key.toLowerCase()) {
      // Player 1 controls
      case 'q': setAction(player1, 'jab'); break;
      case 'w': setAction(player1, 'hook'); break;
      case 'e': setAction(player1, 'uppercut'); break;
      case 'r': setAction(player1, 'block'); break;
      case 't': setAction(player1, 'heal'); break;

      // Player 2 controls
      case 'u': setAction(player2, 'jab'); break;
      case 'i': setAction(player2, 'hook'); break;
      case 'o': setAction(player2, 'uppercut'); break;
      case 'p': setAction(player2, 'block'); break;
      case '[': setAction(player2, 'heal'); break;
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
    p.head.material.opacity = 0.2;
    p.body.material.transparent = true;
    p.body.material.opacity = 0.2;
    // Move front character down and keep normal scale
    p.avatarGroup.position.y = -0.5;
    p.avatarGroup.scale.set(1.0, 1.0, 1.0);
  } else {
    p.head.material.transparent = false;
    p.head.material.opacity = 1.0;
    p.body.material.transparent = false;
    p.body.material.opacity = 1.0;
    // Enemy returns to normal Y but scales up
    p.avatarGroup.position.y = 0;
    p.avatarGroup.scale.set(1.4, 1.4, 1.4);
  }
}

function triggerHitNode(defender, damage) {
  if (defender.state.action === "block") return; // No damage if blocking!

  defender.state.health = Math.max(0, defender.state.health - damage);
  defender.uiHp.style.width = defender.state.health + "%";
  defender.state.shakeTimer = 0.2; // 0.2 seconds of screen shake
  
  // Flash material white temporarily
  defender.head.material.color.setHex(0xffffff);
  defender.body.material.color.setHex(0xffffff);
  setTimeout(() => {
    defender.head.material.color.setHex(defender.baseColor);
    defender.body.material.color.setHex(defender.baseColor);
  }, 100);

  // Screen space flash effect
  defender.uiFlash.style.opacity = "1";
  setTimeout(() => {
    defender.uiFlash.style.opacity = "0";
  }, 150);
}

function processActions(p, defender, time, deltaTime) {
  if (p.state.shakeTimer > 0) {
    p.state.shakeTimer -= deltaTime;
  }

  if (p.state.action !== "idle") {
    p.state.timer -= deltaTime;
    
    // Check hit logic at peak extension (timer is about half of duration)
    const act = ACTIONS[p.state.action];
    const progress = 1.0 - (p.state.timer / act.duration);
    
    if (progress > 0.4 && progress < 0.6 && !p.state.hitLanded && act.damage > 0) {
      triggerHitNode(defender, act.damage);
      p.state.hitLanded = true;
    }

    // Heal logic
    if (p.state.action === "heal" && progress > 0.5 && !p.state.hitLanded) {
       p.state.health = Math.min(100, p.state.health + 20);
       p.uiHp.style.width = p.state.health + "%";
       p.state.hitLanded = true; // Use flag to prevent multi-heal
    }

    if (p.state.timer <= 0) {
      p.state.action = "idle";
    }
  }

  let targetL = GLOVE_IDLE_L.clone();
  let targetR = GLOVE_IDLE_R.clone();

  if (p.state.action === "idle") {
    targetL.y += Math.sin(time * 5) * 0.1;
    targetR.y += Math.cos(time * 5) * 0.1;
  } else {
    // Interpolate punch extension
    const act = ACTIONS[p.state.action];
    const progress = 1.0 - (p.state.timer / act.duration);
    
    // Smooth out and back curve
    const extension = Math.sin(progress * Math.PI);

    targetL.lerp(act.l, extension);
    targetR.lerp(act.r, extension);
  }

  // Smooth lerp visually
  const lerpSpeed = 0.3;
  p.leftGlove.position.lerp(targetL, lerpSpeed);
  p.rightGlove.position.lerp(targetR, lerpSpeed);
}

// 5. Render Loop with Split Screen
const clock = new THREE.Clock();
let previousTime = 0;

function animate() {
  requestAnimationFrame(animate);

  const time = clock.getElapsedTime();
  const deltaTime = time - previousTime; // Safe delta calc
  previousTime = time;
  
  updateCameras();

  // Process Gloves and Hit Detection
  processActions(player1, player2, time, deltaTime);
  processActions(player2, player1, time, deltaTime);

  // Render Split Screen
  const w = window.innerWidth;
  const h = window.innerHeight;
  const halfW = Math.floor(w / 2);

  // ---- RENDER LEFT HALF (Player 1 View) ----
  renderer.setViewport(0, 0, halfW, h);
  renderer.setScissor(0, 0, halfW, h);
  renderer.setClearColor(0x87ceeb);
  renderer.clear();
  
  // Set View States for Camera 1
  setPlayerViewMode(player1, true); // P1 is front
  setPlayerViewMode(player2, false); // P2 is enemy
  
  renderer.render(scene, camera1);

  // ---- RENDER RIGHT HALF (Player 2 View) ----
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

// Start the bodycam effect AFTER renderer and canvas exist
BodycamEffect.start();
