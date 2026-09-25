// Shared Three.js helpers: renderer creation with DPR cap + resize + pause
// when off-screen or when the tab is hidden. Every 3D section uses this so
// the page stays smooth on phones.
import * as THREE from 'three';
export { THREE };

export function createScene(canvas, { alpha = true, antialias = true, maxDpr = 1.75, fov = 45, near = 0.1, far = 200 } = {}) {
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, alpha, antialias, powerPreference: 'high-performance' }); }
  catch (e) { console.warn('[three] WebGL unavailable', e); return null; }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxDpr));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(fov, 1, near, far);
  const clock = new THREE.Clock();
  let raf = 0, visible = false, paused = false, tick = null;

  function resize() {
    const host = canvas.parentElement || canvas;
    const w = host.clientWidth || innerWidth, h = host.clientHeight || innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize); ro.observe(canvas.parentElement || canvas); resize();

  function frame() {
    raf = 0;
    if (!visible || paused) return;
    const dt = Math.min(clock.getDelta(), 0.05);
    tick?.(dt, clock.elapsedTime);
    renderer.render(scene, camera);
    raf = requestAnimationFrame(frame);
  }
  function start() { if (!raf && visible && !paused) raf = requestAnimationFrame(frame); }
  const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) start(); }, { rootMargin: '120px' });
  io.observe(canvas);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) start(); });

  return {
    THREE, renderer, scene, camera, clock,
    /** set per-frame update */
    onTick(fn) { tick = fn; start(); },
    pause() { paused = true; }, resume() { paused = false; start(); },
    renderOnce() { renderer.render(scene, camera); },
    get size() { return renderer.getSize(new THREE.Vector2()); },
    dispose() { io.disconnect(); ro.disconnect(); cancelAnimationFrame(raf); scene.traverse(o => { o.geometry?.dispose?.(); if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose?.()); }); renderer.dispose(); },
  };
}

/** Pointer position normalized -1..1 relative to an element, smoothed. */
export function pointerTracker(el, { ease = 0.06 } = {}) {
  const target = { x: 0, y: 0 }, cur = { x: 0, y: 0 };
  const move = (e) => { const r = el.getBoundingClientRect(); target.x = ((e.clientX - r.left) / r.width) * 2 - 1; target.y = -(((e.clientY - r.top) / r.height) * 2 - 1); };
  el.addEventListener('pointermove', move, { passive: true });
  el.addEventListener('pointerleave', () => { target.x = 0; target.y = 0; });
  return { update() { cur.x += (target.x - cur.x) * ease; cur.y += (target.y - cur.y) * ease; return cur; }, get x() { return cur.x; }, get y() { return cur.y; } };
}

/** Simple glowing point sprite texture (soft circle). */
export function glowTexture(size = 64, color = '#ffffff') {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'); const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0, color); grd.addColorStop(0.35, color + 'aa'); grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd; g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
