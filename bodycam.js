export const BodycamEffect = (() => {
  let isRunning = false;
  let overlayDiv, noiseCanvas, noiseCtx, svgFilter;
  let animationFrameId;
  let lastNoiseUpdate = 0;
  let lastShakeUpdate = 0;
  
  let shakeCurrent = { x: 0, y: 0, r: 0 };
  let shakeTarget = { x: 0, y: 0, r: 0 };

  let originalTransform = '';
  let originalFilter = '';
  function init() {
    if (overlayDiv) return;
    
    // 1. Create SVG Filter for Chromatic Aberration and Lens Distortion
    svgFilter = document.createElement('div');
    svgFilter.innerHTML = `
      <svg style="width:0; height:0; position:absolute;">
        <filter id="bodycam-aberration" x="-10%" y="-10%" width="120%" height="120%">
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

            <feComposite in="red" in2="green" operator="arithmetic" k2="1" k3="1" result="rg"/>
            <feComposite in="rg" in2="blue" operator="arithmetic" k2="1" k3="1" result="rgb"/>

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

      // Update visible layout only at 24fps
      // Scale slightly up so shaking doesn't expose white window borders
      document.body.style.transform = `scale(1.02) translate(${shakeCurrent.x}px, ${shakeCurrent.y}px) rotate(${shakeCurrent.r}deg)`;
      
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
      
      originalTransform = document.body.style.transform;
      originalFilter = document.body.style.filter;

      // Color grade via CSS filters + SVG injection on the document body
      // saturate(0.8) contrast(1.1) combined with url(#bodycam-aberration)
      document.body.style.filter = \`saturate(0.8) contrast(1.1) url(#bodycam-aberration)\`;
      
      lastNoiseUpdate = performance.now();
      lastShakeUpdate = performance.now();
      animationFrameId = requestAnimationFrame(tick);
    },
    stop: () => {
      if (!isRunning) return;
      isRunning = false;
      overlayDiv.style.display = 'none';
      document.body.style.transform = originalTransform;
      document.body.style.filter = originalFilter;
      cancelAnimationFrame(animationFrameId);
    }
  };
})();