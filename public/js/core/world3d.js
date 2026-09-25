// WORLD 3D — a global Three.js layer over the whole page: glowing floating
// objects, particle streams, scroll-driven camera, pointer parallax and a
// palette that recolors to each section's accent. Screen-blended so it
// glows over every section without touching their layouts.
import { THREE, glowTexture } from './three-utils.js';
import { state } from './state.js';
import { motion } from './motion.js';

const PALETTE = {
  hero: ['#38e8ff', '#c6ff3d', '#ff3d8f'], archives: ['#38e8ff', '#8b5cff', '#ffffff'], scouting: ['#2ee56b', '#c6ff3d', '#ffffff'], pass: ['#2ee56b', '#ff3b3b', '#ffffff'],
  nationals: ['#2ee56b', '#ffcc4d', '#38e8ff'], awards: ['#ffcc4d', '#ff8a3d', '#ffffff'], gaming: ['#8b5cff', '#ff3d8f', '#38e8ff'], anime: ['#ff3d8f', '#ffcc4d', '#8b5cff'],
  academics: ['#9fd8ff', '#ffffff', '#38e8ff'], gym: ['#ff8a3d', '#ff3b3b', '#ffcc4d'], food: ['#ff8a3d', '#ffcc4d', '#ff3d8f'], roast: ['#ff3b3b', '#ff8a3d', '#ffcc4d'],
  evidence: ['#ffcc4d', '#ff3b3b', '#ffffff'], timeline: ['#d8c8a8', '#ffcc4d', '#ffffff'], boss: ['#ff3b3b', '#8b5cff', '#ffcc4d'], ai: ['#c6ff3d', '#2ee56b', '#38e8ff'],
  compliment: ['#ffffff', '#ff3d8f', '#ffcc4d'], cake: ['#ffcc4d', '#ff3d8f', '#38e8ff'], messages: ['#38e8ff', '#c6ff3d', '#ff3d8f'], ending: ['#ffcc4d', '#ff3d8f', '#38e8ff'],
};

export function initWorld3D() {
  if (motion.reduced || innerWidth < 700) return null;
  const canvas = document.createElement('canvas'); canvas.className = 'world3d'; canvas.setAttribute('aria-hidden', 'true'); document.body.appendChild(canvas);
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' }); } catch { canvas.remove(); return null; }
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.25));
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 100); camera.position.z = 16;
  const resize = () => { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); };
  addEventListener('resize', resize, { passive: true }); resize();

  scene.add(new THREE.AmbientLight(0xffffff, 0.5));
  const key = new THREE.PointLight(0xffffff, 60, 60); key.position.set(6, 8, 10); scene.add(key);
  const rim = new THREE.PointLight(0x38e8ff, 40, 60); rim.position.set(-8, -4, 6); scene.add(rim);

  // ── floating objects ──────────────────────────────────────
  const group = new THREE.Group(); scene.add(group);
  const geos = [
    new THREE.IcosahedronGeometry(0.9, 1),          // football-ish
    new THREE.TorusKnotGeometry(0.55, 0.18, 96, 12), // knot
    new THREE.TorusGeometry(0.8, 0.16, 16, 48),      // ring
    new THREE.OctahedronGeometry(0.8, 0),             // gem
    new THREE.ConeGeometry(0.6, 1.3, 6),              // trophy-ish
    new THREE.BoxGeometry(0.9, 0.9, 0.9),             // crate
  ];
  const objs = [];
  const mats = [];
  for (let i = 0; i < 18; i++) {
    const wire = i % 3 === 0;
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x38e8ff, emissiveIntensity: 0.6, roughness: 0.3, metalness: 0.6, wireframe: wire, transparent: true, opacity: wire ? 0.5 : 0.6 });
    mats.push(m);
    const mesh = new THREE.Mesh(geos[i % geos.length], m);
    mesh.position.set((Math.random() - 0.5) * 30, (Math.random() - 0.5) * 18, (Math.random() - 0.5) * 12 - 2);
    mesh.rotation.set(Math.random() * 6, Math.random() * 6, 0);
    const s = 0.3 + Math.random() * 0.5; mesh.scale.setScalar(s);
    mesh.userData = { base: mesh.position.clone(), spin: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(0.6), phase: Math.random() * 6, amp: 0.4 + Math.random() * 0.8 };
    group.add(mesh); objs.push(mesh);
  }

  // ── particle streams ───────────────────────────────────────
  const N = 900; const pos = new Float32Array(N * 3), vel = new Float32Array(N);
  for (let i = 0; i < N; i++) { pos[i * 3] = (Math.random() - 0.5) * 40; pos[i * 3 + 1] = (Math.random() - 0.5) * 24; pos[i * 3 + 2] = (Math.random() - 0.5) * 16 - 4; vel[i] = 0.3 + Math.random(); }
  const pgeo = new THREE.BufferGeometry(); pgeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const pmat = new THREE.PointsMaterial({ size: 0.28, map: glowTexture(64, '#ffffff'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.7, color: 0x38e8ff });
  const points = new THREE.Points(pgeo, pmat); scene.add(points);

  // ── palette that follows the active section ───────────────
  const target = PALETTE.hero.map(c => new THREE.Color(c)); const cur = target.map(c => c.clone());
  state.on('section', (id) => { const p = PALETTE[id] || PALETTE.hero; p.forEach((c, i) => target[i].set(c)); });

  // ── pointer + scroll ───────────────────────────────────────
  let px = 0, py = 0, tx = 0, ty = 0, scrollT = 0;
  addEventListener('pointermove', (e) => { tx = (e.clientX / innerWidth) * 2 - 1; ty = -((e.clientY / innerHeight) * 2 - 1); }, { passive: true });
  addEventListener('scroll', () => { scrollT = scrollY / Math.max(1, document.documentElement.scrollHeight - innerHeight); }, { passive: true });

  let raf = 0, last = performance.now(), running = true, burst = 0;
  const clock = new THREE.Clock();
  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (!running || document.hidden || now - last < 1000 / 45) return; // ~45 fps cap
    last = now; const t = clock.getElapsedTime();
    px += (tx - px) * 0.04; py += (ty - py) * 0.04;
    cur.forEach((c, i) => c.lerp(target[i], 0.03));
    key.color.copy(cur[0]); rim.color.copy(cur[1]); pmat.color.copy(cur[2]);
    objs.forEach((o, i) => {
      const u = o.userData; o.rotation.x += u.spin.x * 0.016; o.rotation.y += u.spin.y * 0.016;
      o.position.y = u.base.y + Math.sin(t * 0.6 + u.phase) * u.amp - scrollT * 6;
      o.position.x = u.base.x + Math.cos(t * 0.4 + u.phase) * 0.6 + px * (1.5 + (i % 4));
      o.material.emissive.copy(cur[i % 3]); o.material.color.copy(cur[(i + 1) % 3]).lerp(new THREE.Color(0xffffff), 0.5);
      if (burst > 0) o.scale.setScalar(o.scale.x * 1.02);
      else o.scale.lerp(new THREE.Vector3(1, 1, 1).multiplyScalar(0.3 + ((i * 37) % 10) / 20), 0.05);
    });
    burst = Math.max(0, burst - 1);
    const arr = pgeo.attributes.position.array;
    for (let i = 0; i < N; i++) { arr[i * 3 + 1] += vel[i] * 0.02; if (arr[i * 3 + 1] > 12) arr[i * 3 + 1] = -12; }
    pgeo.attributes.position.needsUpdate = true;
    points.rotation.y = t * 0.03 + px * 0.2; points.position.y = -scrollT * 4;
    group.rotation.y = px * 0.15 + scrollT * 1.2; group.rotation.x = py * 0.1;
    camera.position.x += (px * 1.5 - camera.position.x) * 0.05; camera.position.y += (py * 1 - camera.position.y) * 0.05; camera.lookAt(0, 0, 0);
    renderer.render(scene, camera);
  }
  raf = requestAnimationFrame(frame);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) last = 0; });
  motion.onChange((reduced) => { running = !reduced; canvas.style.display = reduced ? 'none' : ''; });

  return { pulse() { burst = 20; }, dispose() { cancelAnimationFrame(raf); renderer.dispose(); canvas.remove(); } };
}
