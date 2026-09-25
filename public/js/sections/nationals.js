// 05 · THE NATIONALS FILE — night stadium (Three.js) + the case file of a selection that never came.
import { createScene, glowTexture, pointerTracker, THREE } from '../core/three-utils.js';

const LABELS = ['Loading…', 'Still loading…', 'Buffering…', 'Selector on lunch break…', 'Checking the pass footage again…', 'Loading…'];

export default {
  id: 'nationals',
  title: 'The Nationals File',
  mount(el, ctx) {
    const { profile, esc, gsap, ScrollTrigger, sfx, eggs, fx, motion, toast } = ctx;
    const first = (profile.first_name || profile.name.split(' ')[0]).toUpperCase();
    const nick = (profile.nickname || 'SIR').toUpperCase();

    el.classList.add('sec-full');
    el.innerHTML = `
      <div class="nat-bg" aria-hidden="true">
        <canvas class="nat-canvas"></canvas>
        <div class="nat-fallback" hidden>
          <svg class="nat-fallback-svg" viewBox="0 0 1200 700" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
            <defs>
              <radialGradient id="nat-fl" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#fff" stop-opacity=".9"/><stop offset=".3" stop-color="#d9f2ff" stop-opacity=".35"/><stop offset="1" stop-color="#d9f2ff" stop-opacity="0"/></radialGradient>
              <linearGradient id="nat-beam" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d9f2ff" stop-opacity=".22"/><stop offset="1" stop-color="#d9f2ff" stop-opacity="0"/></linearGradient>
              <linearGradient id="nat-pitch" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0d4a24"/><stop offset="1" stop-color="#062a14"/></linearGradient>
            </defs>
            <rect width="1200" height="700" fill="#03060c"/>
            <ellipse cx="600" cy="470" rx="620" ry="190" fill="#141a26"/>
            <ellipse cx="600" cy="460" rx="560" ry="160" fill="#0d121b"/>
            <ellipse cx="600" cy="450" rx="500" ry="135" fill="#161d2a"/>
            <ellipse cx="600" cy="452" rx="430" ry="110" fill="#0b0f16"/>
            <ellipse cx="600" cy="462" rx="380" ry="88" fill="url(#nat-pitch)"/>
            <ellipse cx="600" cy="462" rx="380" ry="88" fill="none" stroke="rgba(255,255,255,.35)" stroke-width="2"/>
            <ellipse cx="600" cy="462" rx="70" ry="18" fill="none" stroke="rgba(255,255,255,.35)" stroke-width="2"/>
            <line x1="600" y1="374" x2="600" y2="550" stroke="rgba(255,255,255,.35)" stroke-width="2"/>
            <g class="nat-fallback-crowd"></g>
            <g stroke="#2a3345" stroke-width="6" stroke-linecap="round">
              <line x1="150" y1="420" x2="150" y2="130"/><line x1="1050" y1="420" x2="1050" y2="130"/><line x1="330" y1="330" x2="330" y2="90"/><line x1="870" y1="330" x2="870" y2="90"/>
            </g>
            <g fill="url(#nat-beam)"><polygon points="150,130 600,470 100,470"/><polygon points="1050,130 1100,470 600,470"/><polygon points="330,90 700,470 300,470"/><polygon points="870,90 900,470 500,470"/></g>
            <g><circle cx="150" cy="130" r="70" fill="url(#nat-fl)"/><circle cx="1050" cy="130" r="70" fill="url(#nat-fl)"/><circle cx="330" cy="90" r="60" fill="url(#nat-fl)"/><circle cx="870" cy="90" r="60" fill="url(#nat-fl)"/></g>
            <g class="nat-fallback-board"><rect x="470" y="150" width="260" height="120" rx="6" fill="#05070c" stroke="#2ee56b" stroke-width="2"/>
              <text x="600" y="190" text-anchor="middle" fill="#2ee56b" font-family="JetBrains Mono, monospace" font-size="18" letter-spacing="2">MISSION: NATIONALS</text>
              <text x="600" y="220" text-anchor="middle" fill="#ff3b3b" font-family="JetBrains Mono, monospace" font-size="18" letter-spacing="2" class="nat-fallback-status">STATUS: NOT SELECTED</text>
              <text x="600" y="255" text-anchor="middle" fill="#fff" font-family="JetBrains Mono, monospace" font-size="24" letter-spacing="3">90:00 +5</text></g>
            <circle cx="600" cy="462" r="11" fill="#fff"/><circle cx="600" cy="462" r="11" fill="none" stroke="#111" stroke-width="1.5"/><circle cx="596" cy="458" r="3" fill="#111"/><circle cx="604" cy="465" r="3" fill="#111"/>
          </svg>
        </div>
        <div class="nat-haze"></div>
      </div>
      <div class="container nat-wrap">
        <div class="nat-grid">
          <div class="nat-copy">
            <span class="eyebrow">CASE FILE · NATIONALS</span>
            <h2 class="display h1 nat-title">THE NATIONALS<br><span class="nat-title-2">FILE</span></h2>
            <div class="nat-stamp-wrap" aria-live="polite"><span class="stamp nat-stamp">NOT SELECTED</span></div>
            <p class="lead nat-line nat-line-1" data-reveal>Somewhere, a selector is still wondering what happened to that pass.</p>
            <p class="nat-line nat-line-2 mono" data-reveal>National selection arc: <span class="nat-line-2-status">currently loading...</span></p>
            <div class="nat-loader" data-reveal role="progressbar" aria-label="National selection progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
              <div class="nat-loader-top mono"><span class="nat-loader-label">Loading…</span><span class="nat-loader-pct tabular">0%</span></div>
              <div class="nat-loader-track"><div class="nat-loader-fill"></div></div>
              <div class="nat-loader-hint mono muted">ETA: undefined. Like his defensive positioning.</div>
            </div>
          </div>
          <div class="nat-board-wrap" data-reveal>
            <div class="nat-board mono" aria-label="Stadium scoreboard">
              <div class="nat-board-top"><span class="nat-board-live"><i class="dot"></i> LIVE</span><span>NATIONAL TRIALS · FINAL DAY</span></div>
              <div class="nat-board-row"><span class="nat-board-k">MISSION</span><span class="nat-board-v">NATIONALS</span></div>
              <div class="nat-board-row"><span class="nat-board-k">PLAYER</span><span class="nat-board-v">${esc(first)} “${esc(nick)}”</span></div>
              <div class="nat-board-row"><span class="nat-board-k">STATUS</span><span class="nat-board-v nat-board-status bad">NOT SELECTED</span></div>
              <div class="nat-board-row"><span class="nat-board-k">PASSES RECEIVED</span><span class="nat-board-v">1 (perfect)</span></div>
              <div class="nat-board-row"><span class="nat-board-k">PASSES CONTROLLED</span><span class="nat-board-v bad">0</span></div>
              <div class="nat-board-clock display"><span>90:00</span><span class="nat-board-added">+5</span></div>
              <div class="nat-board-foot"><span>SELECTOR: STILL WAITING</span><span class="nat-board-note">Statistics are 100% fabricated by his friends.</span></div>
              <button class="nat-egg" type="button" aria-label="select for nationals" title="select for nationals">select</button>
            </div>
          </div>
        </div>
      </div>`;

    const $ = (s) => el.querySelector(s);
    const canvas = $('.nat-canvas'), fallback = $('.nat-fallback');
    const stampEl = $('.nat-stamp'), boardStatus = $('.nat-board-status'), fill = $('.nat-loader-fill'), pct = $('.nat-loader-pct'), label = $('.nat-loader-label'), loader = $('.nat-loader');

    // Shared "world state" that both the 3D scene and the fallback read.
    const world = { selected: false, gold: 0, progress: 0, built: false, three: null, redrawBoard: null };

    // ── Fallback: static SVG stadium ──────────────────────────
    function buildFallback() {
      canvas.hidden = true; fallback.hidden = false;
      const crowd = fallback.querySelector('.nat-fallback-crowd');
      const cols = ['#5a6c8f', '#7a4e5c', '#4d7c6a', '#8b8ea3', '#3f5a86', '#a35b6b'];
      let html = '';
      for (let i = 0; i < 700; i++) {
        const a = Math.random() * Math.PI * 2, r = 0.72 + Math.random() * 0.26;
        const x = 600 + Math.cos(a) * 620 * r, y = 462 + Math.sin(a) * 175 * r - 14;
        if (y > 462 + 80 * r) continue;
        html += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="1.6" fill="${cols[i % cols.length]}" opacity="${(0.4 + Math.random() * 0.6).toFixed(2)}"/>`;
      }
      crowd.innerHTML = html;
    }

    // ── Three.js night stadium ────────────────────────────────
    function buildScene() {
      const three = createScene(canvas, { fov: 42, maxDpr: 1.5, far: 400 });
      if (!three) return null;
      const { scene, camera } = three;
      scene.fog = new THREE.FogExp2(0x03060c, 0.0075);

      // Lights: cold floodlight white + faint ambient
      scene.add(new THREE.AmbientLight(0x3a4a70, 1.4));
      scene.add(new THREE.HemisphereLight(0x9fc4ff, 0x04120a, 0.6));

      // Pitch (canvas texture with lines)
      const pc = document.createElement('canvas'); pc.width = 1024; pc.height = 660;
      const g = pc.getContext('2d');
      const grad = g.createLinearGradient(0, 0, 0, 660); grad.addColorStop(0, '#0d4a24'); grad.addColorStop(1, '#083019'); g.fillStyle = grad; g.fillRect(0, 0, 1024, 660);
      for (let i = 0; i < 12; i++) if (i % 2) { g.fillStyle = 'rgba(255,255,255,.035)'; g.fillRect(i * (1024 / 12), 0, 1024 / 12, 660); }
      g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 5; g.strokeRect(40, 40, 944, 580);
      g.beginPath(); g.moveTo(512, 40); g.lineTo(512, 620); g.stroke();
      g.beginPath(); g.arc(512, 330, 90, 0, Math.PI * 2); g.stroke();
      g.strokeRect(40, 160, 160, 340); g.strokeRect(824, 160, 160, 340); g.strokeRect(40, 240, 60, 180); g.strokeRect(924, 240, 60, 180);
      const pitchTex = new THREE.CanvasTexture(pc); pitchTex.colorSpace = THREE.SRGBColorSpace; pitchTex.anisotropy = 4;
      const pitch = new THREE.Mesh(new THREE.PlaneGeometry(64, 41), new THREE.MeshLambertMaterial({ map: pitchTex }));
      pitch.rotation.x = -Math.PI / 2; scene.add(pitch);
      // Surrounding ground (track / concrete)
      const ground = new THREE.Mesh(new THREE.CircleGeometry(78, 48), new THREE.MeshLambertMaterial({ color: 0x141821 }));
      ground.rotation.x = -Math.PI / 2; ground.position.y = -0.05; scene.add(ground);

      // Stadium bowl: three conical tiers + separator rings
      const tierMat = new THREE.MeshLambertMaterial({ color: 0x28304a, side: THREE.DoubleSide });
      const tiers = [{ rb: 46, rt: 62, y: 0, h: 9 }, { rb: 63, rt: 80, y: 10.5, h: 9.5 }, { rb: 81, rt: 96, y: 21.5, h: 9 }];
      const stands = [];
      for (const t of tiers) {
        const geo = new THREE.CylinderGeometry(t.rt, t.rb, t.h, 56, 1, true);
        const m = new THREE.Mesh(geo, tierMat); m.position.y = t.y + t.h / 2; scene.add(m); stands.push({ ...t });
        const ring = new THREE.Mesh(new THREE.RingGeometry(t.rt - 0.2, t.rt + 1.8, 56), new THREE.MeshBasicMaterial({ color: 0x3a4460, side: THREE.DoubleSide }));
        ring.rotation.x = -Math.PI / 2; ring.position.y = t.y + t.h; scene.add(ring);
        const lip = new THREE.Mesh(new THREE.TorusGeometry(t.rt + 0.8, 0.18, 6, 72), new THREE.MeshBasicMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.45 }));
        lip.rotation.x = Math.PI / 2; lip.position.y = t.y + t.h + 0.02; scene.add(lip);
      }
      // Roof ring
      const roof = new THREE.Mesh(new THREE.RingGeometry(84, 104, 64), new THREE.MeshLambertMaterial({ color: 0x0b0f17, side: THREE.DoubleSide }));
      roof.rotation.x = -Math.PI / 2; roof.position.y = 40; scene.add(roof);
      // Perimeter wall / ad boards glow
      const boards = new THREE.Mesh(new THREE.CylinderGeometry(45.5, 45.5, 1.2, 56, 1, true), new THREE.MeshBasicMaterial({ color: 0x2ee56b, transparent: true, opacity: 0.35, side: THREE.DoubleSide }));
      boards.position.y = 0.6; scene.add(boards);

      // Crowd particles on the tiers (shader with flicker + gold flash)
      const COUNT = 7000;
      const pos = new Float32Array(COUNT * 3), col = new Float32Array(COUNT * 3), seed = new Float32Array(COUNT);
      const palette = [[0.45, 0.55, 0.85], [0.85, 0.4, 0.5], [0.4, 0.75, 0.6], [0.9, 0.92, 1.0], [0.35, 0.5, 0.9], [0.75, 0.75, 0.85], [1.0, 0.5, 0.4], [0.95, 0.85, 0.5]];
      for (let i = 0; i < COUNT; i++) {
        const t = tiers[Math.floor(Math.random() * tiers.length)], u = Math.random(), a = Math.random() * Math.PI * 2;
        const r = t.rb + (t.rt - t.rb) * u - 0.6;
        pos[i * 3] = Math.cos(a) * r; pos[i * 3 + 1] = t.y + u * t.h + 0.6 + Math.random() * 0.4; pos[i * 3 + 2] = Math.sin(a) * r;
        const c = palette[Math.floor(Math.random() * palette.length)]; const v = 0.7 + Math.random() * 0.5;
        col[i * 3] = c[0] * v; col[i * 3 + 1] = c[1] * v; col[i * 3 + 2] = c[2] * v; seed[i] = Math.random() * 100;
      }
      const cgeo = new THREE.BufferGeometry();
      cgeo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); cgeo.setAttribute('color', new THREE.BufferAttribute(col, 3)); cgeo.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
      const cmat = new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uGold: { value: 0 }, uScale: { value: three.renderer.getPixelRatio() } },
        vertexShader: `attribute float seed; attribute vec3 color; uniform float uTime; uniform float uGold; uniform float uScale; varying vec3 vC; varying float vA;
          void main(){ float f = 0.55 + 0.45 * sin(uTime * (1.5 + fract(seed) * 3.0) + seed * 7.0); float flash = step(0.985, fract(sin(seed * 12.9898 + floor(uTime * 6.0)) * 43758.5453));
            vec3 gold = vec3(1.0, 0.8, 0.3) * (0.9 + 0.6 * sin(uTime * 12.0 + seed)); vC = mix(color * (0.6 + 0.4 * f) + flash * 0.9, gold, uGold); vA = 0.75 + 0.25 * f;
            vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = (3.2 + flash * 2.0 + uGold * 1.5) * uScale * (150.0 / -mv.z); gl_Position = projectionMatrix * mv; }`,
        fragmentShader: `varying vec3 vC; varying float vA; void main(){ vec2 d = gl_PointCoord - 0.5; if (dot(d, d) > 0.25) discard; gl_FragColor = vec4(vC, vA); }`,
        transparent: true, depthWrite: false,
      });
      const crowd = new THREE.Points(cgeo, cmat); scene.add(crowd);

      // Floodlight towers
      const flare = glowTexture(128, '#e8f4ff');
      const mastMat = new THREE.MeshLambertMaterial({ color: 0x3a4152 });
      const beamMat = new THREE.MeshBasicMaterial({ color: 0xcfe6ff, transparent: true, opacity: 0.045, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
      const flares = [];
      [[-70, -52], [70, -52], [-70, 52], [70, 52]].forEach(([x, z]) => {
        const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.9, 52, 8), mastMat); mast.position.set(x, 26, z); scene.add(mast);
        const head = new THREE.Mesh(new THREE.BoxGeometry(7, 3.5, 1.2), new THREE.MeshBasicMaterial({ color: 0xf4fbff })); head.position.set(x, 53, z); head.lookAt(0, 0, 0); scene.add(head);
        const spot = new THREE.SpotLight(0xdff0ff, 900, 260, 0.5, 0.55, 1.2); spot.position.set(x, 53, z); spot.target.position.set(0, 0, 0); scene.add(spot); scene.add(spot.target);
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: flare, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.95 })); sp.scale.set(22, 22, 1); sp.position.set(x, 53, z); scene.add(sp); flares.push(sp);
        const len = Math.hypot(x, 53, z);
        const beam = new THREE.Mesh(new THREE.ConeGeometry(30, len, 24, 1, true), beamMat);
        beam.position.set(x / 2, 26.5, z / 2); beam.lookAt(0, 0, 0); beam.rotateX(-Math.PI / 2); scene.add(beam);
      });

      // Scoreboard (canvas texture)
      const bc = document.createElement('canvas'); bc.width = 1024; bc.height = 512; const bg = bc.getContext('2d');
      const boardTex = new THREE.CanvasTexture(bc); boardTex.colorSpace = THREE.SRGBColorSpace;
      let blink = true;
      const drawBoard = () => {
        bg.fillStyle = '#05070c'; bg.fillRect(0, 0, 1024, 512);
        bg.strokeStyle = world.selected ? '#2ee56b' : '#2ee56b'; bg.lineWidth = 8; bg.strokeRect(12, 12, 1000, 488);
        bg.fillStyle = 'rgba(46,229,107,.08)'; for (let y = 0; y < 512; y += 6) bg.fillRect(0, y, 1024, 2);
        bg.font = 'bold 60px "JetBrains Mono", monospace'; bg.textAlign = 'center'; bg.textBaseline = 'middle';
        bg.fillStyle = '#2ee56b'; bg.shadowColor = '#2ee56b'; bg.shadowBlur = 24; bg.fillText('MISSION: NATIONALS', 512, 110);
        bg.fillStyle = world.selected ? '#2ee56b' : '#ff3b3b'; bg.shadowColor = bg.fillStyle; bg.fillText(world.selected ? 'STATUS: SELECTED ✔' : 'STATUS: NOT SELECTED', 512, 215);
        bg.fillStyle = '#ffffff'; bg.shadowColor = '#9fd8ff'; bg.font = 'bold 150px "Bebas Neue", "JetBrains Mono", monospace';
        bg.fillText(blink ? '90:00' : '90 00', 470, 380); bg.font = 'bold 70px "Bebas Neue", monospace'; bg.fillStyle = '#ffcc4d'; bg.shadowColor = '#ffcc4d'; bg.fillText('+5', 780, 400);
        bg.shadowBlur = 0; bg.font = '28px "JetBrains Mono", monospace'; bg.fillStyle = '#8a8a9c'; bg.fillText(world.selected ? 'SELECTOR: FINALLY' : 'SELECTOR: STILL THINKING', 512, 470);
        boardTex.needsUpdate = true;
      };
      drawBoard(); world.redrawBoard = drawBoard;
      const board = new THREE.Mesh(new THREE.PlaneGeometry(34, 17), new THREE.MeshBasicMaterial({ map: boardTex }));
      board.position.set(0, 34, -72); board.lookAt(0, 20, 0); scene.add(board);
      const boardFrame = new THREE.Mesh(new THREE.BoxGeometry(36, 19, 1.5), new THREE.MeshLambertMaterial({ color: 0x0b0f17 }));
      boardFrame.position.copy(board.position).add(new THREE.Vector3(0, 0, -0.9)); boardFrame.quaternion.copy(board.quaternion); scene.add(boardFrame);
      const boardGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(128, '#2ee56b'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.35 }));
      boardGlow.scale.set(60, 34, 1); boardGlow.position.copy(board.position).add(new THREE.Vector3(0, 0, 1)); scene.add(boardGlow);

      // Football on the centre spot under its own spotlight
      const kc = document.createElement('canvas'); kc.width = 256; kc.height = 128; const kg = kc.getContext('2d');
      kg.fillStyle = '#f4f4f8'; kg.fillRect(0, 0, 256, 128); kg.fillStyle = '#15151a';
      for (let y = 0; y < 4; y++) for (let x = 0; x < 8; x++) if ((x + y) % 2 === 0) { kg.beginPath(); kg.arc(x * 32 + 16, y * 32 + 16, 11, 0, Math.PI * 2); kg.fill(); }
      const ballTex = new THREE.CanvasTexture(kc); ballTex.colorSpace = THREE.SRGBColorSpace;
      const ball = new THREE.Mesh(new THREE.SphereGeometry(1.3, 28, 18), new THREE.MeshStandardMaterial({ map: ballTex, roughness: 0.55, metalness: 0.05 }));
      ball.position.set(0, 1.3, 0); scene.add(ball);
      const ballShadow = new THREE.Mesh(new THREE.CircleGeometry(1.5, 24), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55 }));
      ballShadow.rotation.x = -Math.PI / 2; ballShadow.position.y = 0.02; scene.add(ballShadow);
      const ballSpot = new THREE.SpotLight(0xffffff, 700, 80, 0.32, 0.6, 1.4); ballSpot.position.set(0, 30, 6); ballSpot.target = ball; scene.add(ballSpot);
      const ballBeam = new THREE.Mesh(new THREE.ConeGeometry(7, 30, 24, 1, true), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.08, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
      ballBeam.position.set(0, 15, 3); ballBeam.lookAt(0, 30, 6); ballBeam.rotateX(Math.PI / 2); scene.add(ballBeam);
      const ballHalo = new THREE.Mesh(new THREE.RingGeometry(2.2, 7, 32), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false }));
      ballHalo.rotation.x = -Math.PI / 2; ballHalo.position.y = 0.03; scene.add(ballHalo);

      // Camera: slow orbit + scroll dolly + pointer parallax
      const ptr = pointerTracker(el, { ease: 0.05 });
      const camState = { angle: 0.6 };
      camera.position.set(0, 26, 70);
      let boardTimer = setInterval(() => { blink = !blink; drawBoard(); }, 600);
      three.onTick((dt, t) => {
        camState.angle += dt * 0.06;
        const p = ptr.update();
        const dolly = world.progress; // 0 far → 1 close
        const radius = 84 - dolly * 36, height = 34 - dolly * 16;
        const a = camState.angle + p.x * 0.18;
        camera.position.x += (Math.cos(a) * radius - camera.position.x) * 0.06;
        camera.position.z += (Math.sin(a) * radius - camera.position.z) * 0.06;
        camera.position.y += (height + p.y * 4 - camera.position.y) * 0.06;
        camera.lookAt(0, 6 + p.y * 1.5, 0);
        cmat.uniforms.uTime.value = t; cmat.uniforms.uGold.value = world.gold;
        ball.rotation.y = t * 0.35; ball.rotation.x = Math.sin(t * 0.5) * 0.15;
        ballHalo.material.opacity = 0.08 + Math.sin(t * 2) * 0.03;
        flares.forEach((f, i) => { const s = 22 + Math.sin(t * 1.7 + i) * 1.6; f.scale.set(s, s, 1); });
        boardGlow.material.opacity = 0.28 + Math.sin(t * 1.3) * 0.06 + world.gold * 0.4;
      });
      three.disposeAll = () => { clearInterval(boardTimer); three.dispose(); };
      return three;
    }

    // Scroll-driven dolly progress (scrubbed) — a plain object, so no pinning.
    gsap.to(world, { progress: 1, ease: 'none', scrollTrigger: { trigger: el, start: 'top bottom', end: 'bottom top', scrub: 0.8 } });

    // ── Loading bar that never finishes ───────────────────────
    let labelTimer = 0;
    function startLoader() {
      const obj = { v: 0 };
      const setV = (v) => { fill.style.width = v + '%'; pct.textContent = Math.floor(v) + '%'; loader.setAttribute('aria-valuenow', Math.floor(v)); };
      if (motion.reduced) { setV(99); label.textContent = 'Still loading…'; return; }
      gsap.timeline()
        .to(obj, { v: 62, duration: 2.2, ease: 'power2.out', onUpdate: () => setV(obj.v) })
        .to(obj, { v: 87, duration: 2.6, ease: 'power1.inOut', onUpdate: () => setV(obj.v) }, '+=0.6')
        .to(obj, { v: 96, duration: 2.4, ease: 'power1.out', onUpdate: () => setV(obj.v) }, '+=0.8')
        .to(obj, { v: 99, duration: 5, ease: 'power1.out', onUpdate: () => setV(obj.v) }, '+=0.5');
      let i = 0;
      labelTimer = setInterval(() => { i = (i + 1) % LABELS.length; gsap.fromTo(label, { opacity: 0, y: 4 }, { opacity: 1, y: 0, duration: 0.3 }); label.textContent = LABELS[i]; }, 2200);
    }

    // ── Stamp slam ────────────────────────────────────────────
    gsap.set(stampEl, { scale: 3, opacity: 0, rotate: -8 });
    function slamStamp() {
      gsap.to(stampEl, { scale: 1, opacity: 0.95, rotate: -8, duration: 0.45, ease: 'power4.in', onComplete: () => { sfx.play('boom'); motion.shake(el.querySelector('.nat-copy'), { intensity: 9, duration: 0.5 }); if (!motion.reduced) { const r = stampEl.getBoundingClientRect(); fx.burst({ x: r.left + r.width / 2, y: r.top + r.height / 2, count: 24, color: '#ff3b3b', power: 9 }); } } });
    }

    // ── Build lazily when the section enters ──────────────────
    ctx.onSectionEnter(el, () => {
      if (!world.built) {
        world.built = true;
        const three = motion.reduced ? null : buildScene();
        if (three) world.three = three; else buildFallback();
      }
      slamStamp();
      startLoader();
    });
    // If the visitor switches to reduced motion after the scene exists, fall back to the static stadium.
    motion.onChange((r) => { if (r && world.three) { world.three.disposeAll?.(); world.three = null; buildFallback(); } });

    // ── Easter egg: microscopic "select for nationals" button ─
    const egg = $('.nat-egg');
    egg.addEventListener('click', () => { eggs.unlock('nationals-btn'); });
    let eggBusy = false;
    eggs.onUnlock('nationals-btn', () => {
      if (eggBusy) return; eggBusy = true;
      world.selected = true; world.redrawBoard?.();
      boardStatus.textContent = 'SELECTED ✔'; boardStatus.classList.replace('bad', 'ok');
      fallback.querySelector('.nat-fallback-status').textContent = 'STATUS: SELECTED ✔'; fallback.querySelector('.nat-fallback-status').setAttribute('fill', '#2ee56b');
      el.classList.add('is-selected');
      sfx.play('crowd'); sfx.play('fanfare');
      const r = stampEl.getBoundingClientRect();
      fx.confetti({ x: r.left + r.width / 2, y: r.top + r.height / 2, count: 180, colors: ['#ffcc4d', '#2ee56b', '#ffffff', '#fff3b0'], power: 16 });
      gsap.to(world, { gold: 1, duration: 0.4, yoyo: true, repeat: 5, ease: 'sine.inOut' });
      gsap.timeline()
        .to(stampEl, { scale: 0, rotate: 30, opacity: 0, duration: 0.25, ease: 'power3.in', onComplete: () => { stampEl.textContent = 'SELECTED'; stampEl.classList.add('is-ok'); } })
        .to(stampEl, { scale: 1, rotate: -8, opacity: 0.95, duration: 0.5, ease: 'elastic.out(1, 0.5)', onStart: () => { sfx.play('boom'); motion.shake(el.querySelector('.nat-copy'), { intensity: 8, duration: 0.4 }); } });
      $('.nat-line-2-status').textContent = 'COMPLETE?!';
      setTimeout(() => {
        world.selected = false; world.redrawBoard?.(); world.gold = 0;
        boardStatus.textContent = 'NOT SELECTED'; boardStatus.classList.replace('ok', 'bad');
        fallback.querySelector('.nat-fallback-status').textContent = 'STATUS: NOT SELECTED'; fallback.querySelector('.nat-fallback-status').setAttribute('fill', '#ff3b3b');
        el.classList.remove('is-selected');
        $('.nat-line-2-status').textContent = 'currently loading...';
        gsap.timeline()
          .to(stampEl, { scale: 0, opacity: 0, duration: 0.2, ease: 'power3.in', onComplete: () => { stampEl.textContent = 'NOT SELECTED'; stampEl.classList.remove('is-ok'); } })
          .to(stampEl, { scale: 1, opacity: 0.95, rotate: -8, duration: 0.35, ease: 'power4.out', onStart: () => { sfx.play('error'); motion.shake(el.querySelector('.nat-copy'), { intensity: 6, duration: 0.35 }); } });
        toast.show({ icon: '🫠', title: 'Just kidding. Still unnational.', body: 'The selector has been notified. He laughed.', duration: 4200 });
        eggBusy = false;
      }, 3000);
    });
  },
};
