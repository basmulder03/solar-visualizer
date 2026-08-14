/**
 * Draws a small lit/dark Moon disc icon for a given phase angle. The lit region is built from a
 * fixed half-circle (the illuminated limb) plus an ellipse arc (the terminator) whose horizontal
 * radius is `r * cos(age)`: at age=0 (new) the ellipse exactly retraces the half-circle (nothing
 * lit), at age=90 (quarter) it degenerates to a straight line (exactly half lit), and at age=180
 * (full) it retraces the opposite half-circle (fully lit) — the crescent/gibbous shapes in between
 * fall out of that continuously, with waning phases drawn by mirroring the same construction.
 */

const DARK_COLOR = '#1c2130';
const LIT_COLOR = '#e4e8f0';
const OUTLINE_COLOR = 'rgba(255, 255, 255, 0.25)';

export function drawMoonPhaseIcon(canvas: HTMLCanvasElement, ageDeg: number): void {
  const dpr = window.devicePixelRatio || 1;
  const cssSize = Math.max(canvas.clientWidth, 1);
  if (canvas.width !== cssSize * dpr || canvas.height !== cssSize * dpr) {
    canvas.width = cssSize * dpr;
    canvas.height = cssSize * dpr;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssSize, cssSize);

  const r = cssSize / 2 - 1;
  const cx = cssSize / 2;
  const cy = cssSize / 2;

  const age = ((ageDeg % 360) + 360) % 360;
  const waning = age > 180;
  const ageEffDeg = waning ? 360 - age : age; // 0..180, measured against the right-lit construction below

  ctx.save();
  ctx.translate(cx, cy);
  if (waning) ctx.scale(-1, 1);

  // Dark base disc (what a new moon looks like).
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = DARK_COLOR;
  ctx.fill();

  // Lit region: the right half-circle (the limb) plus the terminator ellipse.
  const ageEffRad = (ageEffDeg * Math.PI) / 180;
  const terminatorRx = r * Math.cos(ageEffRad); // +r at new, 0 at quarter, -r at full
  ctx.beginPath();
  ctx.arc(0, 0, r, -Math.PI / 2, Math.PI / 2, false);
  ctx.ellipse(0, 0, Math.abs(terminatorRx), r, 0, Math.PI / 2, -Math.PI / 2, terminatorRx >= 0);
  ctx.closePath();
  ctx.fillStyle = LIT_COLOR;
  ctx.fill();

  ctx.restore();

  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = OUTLINE_COLOR;
  ctx.lineWidth = 1;
  ctx.stroke();
}
