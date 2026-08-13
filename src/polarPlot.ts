/**
 * Canvas renderer for a polar sky-path plot: azimuth is the angle around the
 * circle (0=N at top, clockwise through E/S/W), altitude is the distance
 * from the center (zenith, 90°) to the horizon ring (0°). This module knows
 * nothing about astronomy-engine or the DOM beyond the canvas it's given, so
 * it stays independently testable/reusable from the data layer.
 */

import { getCanvasCssSize } from './canvasSize.ts';

export interface PlotPoint {
  azimuthDeg: number;
  altitudeDeg: number;
}

export interface BodyMarker extends PlotPoint {
  color: string;
  label: string;
}

export interface PathSeries {
  /** Full-day path, sampled at regular intervals. */
  points: PlotPoint[];
  color: string;
}

export interface PolarPlotOptions {
  paths: PathSeries[];
  /** Current/selected marker positions, drawn on top of the paths. */
  markers?: BodyMarker[];
  /** Zoom scale (>=1, default 1), applied uniformly around the plot's center. */
  zoom?: number;
  /** Pan offset in canvas CSS pixels, applied after zooming. Ignored if `followTarget` is set. */
  panX?: number;
  panY?: number;
  /** When set (and zoom > 1), pan is computed each frame to keep this azimuth/altitude centered. */
  followTarget?: PlotPoint;
}

/** Gap (canvas CSS px) between the plot's outer edge and the canvas edge, for cardinal labels. Exported so callers can reproduce the plot's cx/cy/outerRadius for zoom-around-point math. */
export const POLAR_PLOT_PADDING_PX = 28;

const BELOW_HORIZON_FLOOR_DEG = -30;
const HORIZON_COLOR = '#8a93a6';
const GRID_COLOR = 'rgba(255, 255, 255, 0.14)';
const BELOW_GROUND_FILL = '#3b3f4c';
const SKY_FILL = '#141a2b';
const LABEL_COLOR = '#c7cbd6';

/** Maps an altitude in degrees to a plot radius fraction (0 = zenith center, 1 = the -30° floor). */
function radiusFraction(altitudeDeg: number): number {
  const clamped = Math.max(altitudeDeg, BELOW_HORIZON_FLOOR_DEG);
  return (90 - clamped) / (90 - BELOW_HORIZON_FLOOR_DEG);
}

function toXY(cx: number, cy: number, outerRadius: number, point: PlotPoint): [number, number] {
  const angleRad = (point.azimuthDeg * Math.PI) / 180;
  const r = radiusFraction(point.altitudeDeg) * outerRadius;
  return [cx + r * Math.sin(angleRad), cy - r * Math.cos(angleRad)];
}

/** Splits a day path into contiguous above-horizon runs, interpolating the horizon crossings. */
function aboveHorizonSegments(path: PlotPoint[]): PlotPoint[][] {
  const segments: PlotPoint[][] = [];
  let current: PlotPoint[] = [];

  const crossing = (a: PlotPoint, b: PlotPoint): PlotPoint => {
    const t = a.altitudeDeg / (a.altitudeDeg - b.altitudeDeg);
    return {
      azimuthDeg: a.azimuthDeg + t * (b.azimuthDeg - a.azimuthDeg),
      altitudeDeg: 0,
    };
  };

  for (let i = 0; i < path.length; i++) {
    const point = path[i];
    const prev = path[i - 1];

    if (prev && (prev.altitudeDeg >= 0) !== (point.altitudeDeg >= 0)) {
      const crossPoint = crossing(prev, point);
      if (prev.altitudeDeg >= 0) {
        current.push(crossPoint);
        segments.push(current);
        current = [];
      } else {
        current = [crossPoint];
      }
    }

    if (point.altitudeDeg >= 0) current.push(point);
  }

  if (current.length > 0) segments.push(current);
  return segments;
}

export function drawPolarSkyPlot(canvas: HTMLCanvasElement, options: PolarPlotOptions): void {
  const dpr = window.devicePixelRatio || 1;
  const cssSize = Math.max(getCanvasCssSize(canvas).width, 1);
  if (canvas.width !== cssSize * dpr || canvas.height !== cssSize * dpr) {
    canvas.width = cssSize * dpr;
    canvas.height = cssSize * dpr;
  }

  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssSize, cssSize);

  const padding = POLAR_PLOT_PADDING_PX;
  const cx = cssSize / 2;
  const cy = cssSize / 2;
  const outerRadius = Math.max(cssSize / 2 - padding, 1);
  const horizonRadius = radiusFraction(0) * outerRadius;

  const zoom = Math.max(options.zoom ?? 1, 1);
  let panX = options.panX ?? 0;
  let panY = options.panY ?? 0;
  if (options.followTarget && zoom > 1) {
    const [fx, fy] = toXY(cx, cy, outerRadius, options.followTarget);
    panX = -(fx - cx) * zoom;
    panY = -(fy - cy) * zoom;
  }
  // Pan in screen pixels, then zoom uniformly around the plot's center — every draw call below
  // is unchanged and just rides along on this transform.
  ctx.save();
  ctx.translate(panX, panY);
  ctx.translate(cx, cy);
  ctx.scale(zoom, zoom);
  ctx.translate(-cx, -cy);

  // Below-horizon ring background.
  ctx.beginPath();
  ctx.arc(cx, cy, outerRadius, 0, Math.PI * 2);
  ctx.fillStyle = BELOW_GROUND_FILL;
  ctx.fill();

  // Sky disc (above horizon).
  ctx.beginPath();
  ctx.arc(cx, cy, horizonRadius, 0, Math.PI * 2);
  ctx.fillStyle = SKY_FILL;
  ctx.fill();

  // Altitude grid rings at 0 (horizon), 30, 60 degrees.
  for (const alt of [60, 30, 0]) {
    const r = radiusFraction(alt) * outerRadius;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = alt === 0 ? HORIZON_COLOR : GRID_COLOR;
    ctx.lineWidth = alt === 0 ? 1.5 : 1;
    ctx.stroke();
  }

  // Azimuth spokes every 30 degrees, with cardinal directions emphasized.
  const cardinals: Record<number, string> = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };
  ctx.font = '12px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let az = 0; az < 360; az += 30) {
    const angleRad = (az * Math.PI) / 180;
    const x2 = cx + outerRadius * Math.sin(angleRad);
    const y2 = cy - outerRadius * Math.cos(angleRad);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(x2, y2);
    ctx.strokeStyle = GRID_COLOR;
    ctx.lineWidth = 1;
    ctx.stroke();

    const labelR = outerRadius + 14;
    const lx = cx + labelR * Math.sin(angleRad);
    const ly = cy - labelR * Math.cos(angleRad);
    ctx.fillStyle = cardinals[az] ? LABEL_COLOR : 'rgba(199, 203, 214, 0.5)';
    ctx.font = cardinals[az] ? 'bold 13px system-ui, sans-serif' : '11px system-ui, sans-serif';
    ctx.fillText(cardinals[az] ?? String(az), lx, ly);
  }

  // Body paths, each drawn only where above the horizon.
  for (const series of options.paths) {
    for (const segment of aboveHorizonSegments(series.points)) {
      if (segment.length < 2) continue;
      ctx.beginPath();
      segment.forEach((point, i) => {
        const [x, y] = toXY(cx, cy, outerRadius, point);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.strokeStyle = series.color;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  // Body markers (e.g. the Sun's current position).
  for (const marker of options.markers ?? []) {
    const [x, y] = toXY(cx, cy, outerRadius, marker);
    const belowHorizon = marker.altitudeDeg < 0;

    ctx.beginPath();
    ctx.arc(x, y, 7, 0, Math.PI * 2);
    ctx.fillStyle = marker.color;
    ctx.globalAlpha = belowHorizon ? 0.45 : 1;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    ctx.globalAlpha = 1;

    ctx.fillStyle = LABEL_COLOR;
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillText(marker.label, x, y - 14);
  }

  ctx.restore();
}
