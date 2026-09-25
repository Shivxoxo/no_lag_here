// Global 2D particle layer (confetti, bursts, floating emoji). One canvas,
// one rAF loop that only runs while particles exist.
const canvas = document.getElementById('fx');
const ctx = canvas.getContext('2d');
let parts = [], running = false, dpr = 1, W = 0, H = 0;

function resize() { dpr = Math.min(window.devicePixelRatio || 1, 2); W = canvas.width = innerWidth * dpr; H = canvas.height = innerHeight * dpr; }
addEventListener('resize', resize, { passive: true }); resize();

function loop() {
  if (!parts.length) { running = false; ctx.clearRect(0, 0, W, H); return; }
  ctx.clearRect(0, 0, W, H);
  const now = performance.now();
  parts = parts.filter(p => now - p.born < p.life);
  for (const p of parts) {
    const t = (now - p.born) / p.life;
    p.vx *= p.drag; p.vy = p.vy * p.drag + p.g; p.x += p.vx; p.y += p.vy; p.rot += p.vr;
    ctx.save(); ctx.globalAlpha = p.fadeIn ? Math.min(1, t * 6) * (1 - Math.max(0, (t - 0.7) / 0.3)) : 1 - t;
    ctx.translate(p.x * dpr, p.y * dpr); ctx.rotate(p.rot); ctx.scale(dpr, dpr);
    if (p.emoji) { ctx.font = `${p.size}px system-ui, "Apple Color Emoji", "Segoe UI Emoji"`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(p.emoji, 0, 0); }
    else if (p.shape === 'circle') { ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2); ctx.fill(); }
    else { ctx.fillStyle = p.color; ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2); }
    ctx.restore();
  }
  requestAnimationFrame(loop);
}
function add(p) { parts.push(p); if (!running) { running = true; requestAnimationFrame(loop); } }
const reduced = () => document.documentElement.classList.contains('reduced');

export const fx = {
  /** Confetti burst from a point (defaults to screen center). */
  confetti({ x = innerWidth / 2, y = innerHeight / 2, count = 120, spread = 1, colors = ['#c6ff3d', '#38e8ff', '#ff3d8f', '#ffcc4d', '#8b5cff', '#ffffff'], power = 14, gravity = 0.35 } = {}) {
    if (reduced()) count = Math.min(count, 30);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2 * spread - Math.PI / 2 * (2 - spread); const v = Math.random() * power + 4;
      add({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 4, g: gravity, drag: 0.985, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3, size: Math.random() * 8 + 6, color: colors[i % colors.length], shape: Math.random() < 0.3 ? 'circle' : 'rect', born: performance.now(), life: 2600 + Math.random() * 1500 });
    }
  },
  /** Radial spark burst */
  burst({ x, y, count = 40, color = '#c6ff3d', power = 10, size = 4, life = 900 } = {}) {
    for (let i = 0; i < count; i++) { const a = (i / count) * Math.PI * 2 + Math.random() * 0.3; const v = Math.random() * power + 2; add({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: 0.08, drag: 0.94, rot: 0, vr: 0, size, color, shape: 'circle', born: performance.now(), life }); }
  },
  /** Floating emoji rain/rise */
  emoji({ emoji = '⚽', count = 20, x, y, rise = true, size = 28, spread = innerWidth } = {}) {
    if (reduced()) count = Math.min(count, 8);
    for (let i = 0; i < count; i++) {
      const px = x ?? Math.random() * spread; const py = y ?? (rise ? innerHeight + 40 : -40);
      add({ x: px, y: py, vx: (Math.random() - 0.5) * 2, vy: rise ? -(Math.random() * 3 + 2) : Math.random() * 3 + 2, g: 0, drag: 1, rot: (Math.random() - 0.5), vr: (Math.random() - 0.5) * 0.05, size: size + Math.random() * 14, emoji: Array.isArray(emoji) ? emoji[i % emoji.length] : emoji, born: performance.now(), life: 3500 + Math.random() * 2500, fadeIn: true });
    }
  },
  /** Rain from the top of the screen (emoji or colors) */
  rain(opts = {}) { this.emoji({ rise: false, ...opts }); },
  clear() { parts = []; },
};
