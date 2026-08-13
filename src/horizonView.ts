/**
 * Canvas renderer for the immersive horizon view: a compass-heading window
 * onto the sky, azimuth offset from the heading on the horizontal axis and
 * altitude on the vertical axis, with a background tinted by the Sun's
 * altitude. Like polarPlot.ts, this knows nothing about astronomy-engine or
 * the DOM beyond the canvas it's given.
 */

import { getCanvasCssSize } from './canvasSize.ts';

export interface HorizonBody {
  azimuthDeg: number;
  altitudeDeg: number;
  /** Apparent angular radius in degrees, for correctly-sized discs. */
  angularRadiusDeg: number;
  color: string;
  label: string;
}

export interface HorizonPathPoint {
  azimuthDeg: number;
  altitudeDeg: number;
}

export interface HorizonPathSeries {
  /** Full-day path, sampled at regular intervals — only the portion within the current FOV is drawn. */
  points: HorizonPathPoint[];
  color: string;
}

export interface HorizonViewOptions {
  /** Compass heading (degrees, 0=N) at the center of the view. */
  headingDeg: number;
  /** Horizontal field of view, in degrees. */
  fovDeg: number;
  /** Drives the sky tint (day/twilight/night). */
  sunAltitudeDeg: number;
  bodies: HorizonBody[];
  /** Faint reference lines tracing each body's path through the sky (e.g. the day's full arc). */
  paths?: HorizonPathSeries[];
  /**
   * Altitude (degrees) to vertically center the frame on, placed at mid-height.
   * Omit for the default horizon-relative framing (horizon line at a fixed
   * height near the bottom); pass e.g. the Sun's altitude for a tight
   * eclipse close-up, since with a narrow FOV the horizon-relative vertical
   * window is too small to contain a body that's high in the sky.
   */
  centerAltitudeDeg?: number;
}

type RGB = [number, number, number];

const SKY_STOPS: { alt: number; zenith: RGB; horizon: RGB }[] = [
  { alt: 20, zenith: [58, 126, 201], horizon: [147, 197, 229] }, // day
  { alt: 4, zenith: [72, 108, 158], horizon: [255, 175, 110] }, // low sun
  { alt: -2, zenith: [44, 58, 92], horizon: [255, 120, 110] }, // sunset/sunrise glow
  { alt: -6, zenith: [26, 32, 58], horizon: [214, 92, 120] }, // civil twilight
  { alt: -12, zenith: [14, 18, 36], horizon: [58, 48, 84] }, // nautical twilight
  { alt: -18, zenith: [5, 7, 15], horizon: [10, 10, 22] }, // astronomical twilight -> night
];

const HORIZON_LINE_COLOR = 'rgba(255, 255, 255, 0.3)';
const GRID_COLOR = 'rgba(255, 255, 255, 0.16)';
const LABEL_COLOR = 'rgba(255, 255, 255, 0.75)';
const GROUND_SCRIM = 'rgba(8, 9, 13, 0.55)';
const MIN_DISC_RADIUS_PX = 6;
const HORIZON_Y_FRACTION = 0.7;
const PATH_ALPHA = 0.35;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpColor(a: RGB, b: RGB, t: number): RGB {
  return [Math.round(lerp(a[0], b[0], t)), Math.round(lerp(a[1], b[1], t)), Math.round(lerp(a[2], b[2], t))];
}

function rgbToCss([r, g, b]: RGB): string {
  return `rgb(${r}, ${g}, ${b})`;
}

function skyColors(sunAltitudeDeg: number): { zenith: string; horizon: string } {
  const stops = SKY_STOPS;
  if (sunAltitudeDeg >= stops[0].alt) {
    return { zenith: rgbToCss(stops[0].zenith), horizon: rgbToCss(stops[0].horizon) };
  }
  const last = stops[stops.length - 1];
  if (sunAltitudeDeg <= last.alt) {
    return { zenith: rgbToCss(last.zenith), horizon: rgbToCss(last.horizon) };
  }
  for (let i = 0; i < stops.length - 1; i++) {
    const upper = stops[i];
    const lower = stops[i + 1];
    if (sunAltitudeDeg <= upper.alt && sunAltitudeDeg >= lower.alt) {
      const t = (upper.alt - sunAltitudeDeg) / (upper.alt - lower.alt);
      return { zenith: rgbToCss(lerpColor(upper.zenith, lower.zenith, t)), horizon: rgbToCss(lerpColor(upper.horizon, lower.horizon, t)) };
    }
  }
  return { zenith: rgbToCss(last.zenith), horizon: rgbToCss(last.horizon) };
}

/** Shortest signed offset (in degrees, [-180, 180]) from `heading` to `azimuth`. */
function azimuthOffset(azimuthDeg: number, headingDeg: number): number {
  return (((azimuthDeg - headingDeg + 540) % 360) + 360) % 360 - 180;
}

const CARDINALS: Record<number, string> = {
  0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW',
};

/** Splits a path into contiguous runs that fall within the current FOV window, so off-screen stretches don't draw connecting lines across the whole sky. */
function segmentsWithinFov(points: HorizonPathPoint[], headingDeg: number, halfFovDeg: number): HorizonPathPoint[][] {
  const segments: HorizonPathPoint[][] = [];
  let current: HorizonPathPoint[] = [];
  for (const point of points) {
    const offset = azimuthOffset(point.azimuthDeg, headingDeg);
    if (offset >= -halfFovDeg && offset <= halfFovDeg) {
      current.push(point);
    } else if (current.length > 0) {
      segments.push(current);
      current = [];
    }
  }
  if (current.length > 0) segments.push(current);
  return segments;
}

export function drawHorizonView(canvas: HTMLCanvasElement, options: HorizonViewOptions): void {
  const dpr = window.devicePixelRatio || 1;
  const cssSize = getCanvasCssSize(canvas);
  const cssWidth = cssSize.width;
  const cssHeight = cssSize.height;
  if (canvas.width !== cssWidth * dpr || canvas.height !== cssHeight * dpr) {
    canvas.width = cssWidth * dpr;
    canvas.height = cssHeight * dpr;
  }

  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const pxPerDeg = cssWidth / options.fovDeg;
  const halfFov = options.fovDeg / 2;
  // Normally the frame is anchored to the horizon line near the bottom; when centering on a
  // given altitude (e.g. a high-altitude eclipse close-up) it's anchored at mid-height instead.
  const anchorAltitudeDeg = options.centerAltitudeDeg ?? 0;
  const anchorY = options.centerAltitudeDeg === undefined ? cssHeight * HORIZON_Y_FRACTION : cssHeight * 0.5;
  const altitudeToY = (altDeg: number) => anchorY - (altDeg - anchorAltitudeDeg) * pxPerDeg;
  const horizonY = altitudeToY(0);
  const { zenith, horizon } = skyColors(options.sunAltitudeDeg);

  // Sky gradient, extended flat past the horizon line so the ground scrim can tint it.
  const grad = ctx.createLinearGradient(0, 0, 0, cssHeight);
  const horizonStop = Math.min(Math.max(horizonY / cssHeight, 0), 1);
  grad.addColorStop(0, zenith);
  grad.addColorStop(horizonStop, horizon);
  grad.addColorStop(1, horizon);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, cssWidth, cssHeight);

  // Ground.
  ctx.fillStyle = GROUND_SCRIM;
  ctx.fillRect(0, horizonY, cssWidth, cssHeight - horizonY);

  // Altitude reference lines.
  ctx.font = '11px system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  for (const alt of [60, 30, 0]) {
    const y = altitudeToY(alt);
    if (y < -10 || y > cssHeight + 10) continue;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(cssWidth, y);
    ctx.strokeStyle = alt === 0 ? HORIZON_LINE_COLOR : GRID_COLOR;
    ctx.lineWidth = alt === 0 ? 1.5 : 1;
    ctx.stroke();
    if (alt !== 0) {
      ctx.fillStyle = LABEL_COLOR;
      ctx.textAlign = 'left';
      ctx.fillText(`${alt}°`, 6, y);
    }
  }

  // Faint path lines tracing each body's route through the sky, clipped to the current FOV.
  ctx.lineWidth = 1;
  for (const series of options.paths ?? []) {
    for (const segment of segmentsWithinFov(series.points, options.headingDeg, halfFov)) {
      if (segment.length < 2) continue;
      ctx.beginPath();
      segment.forEach((point, i) => {
        const x = cssWidth / 2 + azimuthOffset(point.azimuthDeg, options.headingDeg) * pxPerDeg;
        const y = altitudeToY(point.altitudeDeg);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.strokeStyle = series.color;
      ctx.globalAlpha = PATH_ALPHA;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  // Compass ticks every 15 degrees, cardinal/intercardinal directions emphasized.
  ctx.textAlign = 'center';
  const startAz = Math.ceil((options.headingDeg - halfFov) / 15) * 15;
  for (let az = startAz; az <= options.headingDeg + halfFov; az += 15) {
    const norm = ((az % 360) + 360) % 360;
    const offset = azimuthOffset(norm, options.headingDeg);
    const x = cssWidth / 2 + offset * pxPerDeg;
    if (x < -20 || x > cssWidth + 20) continue;

    const isCardinal = norm % 45 === 0;
    ctx.beginPath();
    ctx.moveTo(x, horizonY);
    ctx.lineTo(x, horizonY - (isCardinal ? 14 : 8));
    ctx.strokeStyle = isCardinal ? LABEL_COLOR : GRID_COLOR;
    ctx.lineWidth = 1;
    ctx.stroke();

    if (isCardinal) {
      ctx.fillStyle = LABEL_COLOR;
      ctx.font = 'bold 13px system-ui, sans-serif';
      ctx.fillText(CARDINALS[norm] ?? '', x, horizonY - 24);
    } else if (norm % 30 === 0) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.font = '10px system-ui, sans-serif';
      ctx.fillText(String(norm), x, horizonY - 18);
    }
  }

  // Bodies: disc if within the FOV, edge chevron pointing toward it otherwise.
  for (const body of options.bodies) {
    const offset = azimuthOffset(body.azimuthDeg, options.headingDeg);
    const y = altitudeToY(body.altitudeDeg);

    if (offset >= -halfFov && offset <= halfFov) {
      const x = cssWidth / 2 + offset * pxPerDeg;
      const radius = Math.max(body.angularRadiusDeg * pxPerDeg, MIN_DISC_RADIUS_PX);

      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fillStyle = body.color;
      ctx.fill();
      if (radius > MIN_DISC_RADIUS_PX + 1) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      ctx.fillStyle = LABEL_COLOR;
      ctx.font = '11px system-ui, sans-serif';
      ctx.fillText(body.label, x, y - radius - 10);
    } else {
      const clampedY = Math.min(Math.max(y, 14), cssHeight - 14);
      const atLeft = offset < 0;
      const x = atLeft ? 14 : cssWidth - 14;
      ctx.beginPath();
      ctx.moveTo(x, clampedY - 8);
      ctx.lineTo(atLeft ? x - 8 : x + 8, clampedY);
      ctx.lineTo(x, clampedY + 8);
      ctx.closePath();
      ctx.fillStyle = body.color;
      ctx.fill();
    }
  }
}
