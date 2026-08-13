/**
 * A "spin the globe and click a spot" location picker: an orthographic
 * (globe-look) projection rendered on a plain 2D canvas via d3-geo, with
 * coastlines from world-atlas's bundled topojson data (public domain,
 * Natural Earth). No image assets, no network requests, no API keys —
 * everything is bundled at build time and this works fully offline.
 */

import { geoOrthographic, geoPath, geoGraticule10, type GeoProjection } from 'd3-geo';
import { feature } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import landTopology from 'world-atlas/land-110m.json';
import { attachViewportInteraction } from './viewportInteraction.ts';
import { getCanvasCssSize } from './canvasSize.ts';

export interface GlobePicker {
  /** Moves the marker to a location; recenters the globe on it if `recenter` is true. */
  setLocation(latitude: number, longitude: number, opts?: { recenter?: boolean }): void;
  redraw(): void;
}

export interface GlobePickerOptions {
  onPick: (latitude: number, longitude: number) => void;
  initialLatitude: number;
  initialLongitude: number;
}

const OCEAN_TOP = '#4a7fb5';
const OCEAN_BOTTOM = '#1c3a5e';
const LAND_FILL = '#e8dcc0';
const LAND_STROKE = '#a99a72';
const GRATICULE_COLOR = 'rgba(255, 255, 255, 0.18)';
const OUTLINE_COLOR = 'rgba(0, 0, 0, 0.25)';
const MARKER_COLOR = '#f5423a';

const MIN_ZOOM = 0.8;
const MAX_ZOOM = 4;
const ROTATE_SENSITIVITY_DEG_PER_PX = 0.3;

const land = feature(landTopology as unknown as Topology, landTopology.objects.land as GeometryCollection);

export function createGlobePicker(canvas: HTMLCanvasElement, options: GlobePickerOptions): GlobePicker {
  const projection: GeoProjection = geoOrthographic();
  let zoom = 1;
  let markerLat = options.initialLatitude;
  let markerLon = options.initialLongitude;
  let rotation: [number, number, number] = [-options.initialLongitude, -options.initialLatitude, 0];

  function draw(): void {
    const dpr = window.devicePixelRatio || 1;
    const { width: cssWidth, height: cssHeight } = getCanvasCssSize(canvas);
    if (canvas.width !== cssWidth * dpr || canvas.height !== cssHeight * dpr) {
      canvas.width = cssWidth * dpr;
      canvas.height = cssHeight * dpr;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssWidth, cssHeight);

    const baseScale = (Math.min(cssWidth, cssHeight) / 2) * 0.94;
    projection.translate([cssWidth / 2, cssHeight / 2]).scale(baseScale * zoom).rotate(rotation);
    const path = geoPath(projection, ctx);

    // Sphere fill, with a soft gradient so the flat projection still reads as a lit sphere.
    ctx.beginPath();
    path({ type: 'Sphere' });
    const grad = ctx.createLinearGradient(0, 0, 0, cssHeight);
    grad.addColorStop(0, OCEAN_TOP);
    grad.addColorStop(1, OCEAN_BOTTOM);
    ctx.fillStyle = grad;
    ctx.fill();

    // Graticule.
    ctx.beginPath();
    path(geoGraticule10());
    ctx.strokeStyle = GRATICULE_COLOR;
    ctx.lineWidth = 1;
    ctx.stroke();

    // Land.
    ctx.beginPath();
    path(land);
    ctx.fillStyle = LAND_FILL;
    ctx.fill();
    ctx.strokeStyle = LAND_STROKE;
    ctx.lineWidth = 0.75;
    ctx.stroke();

    // Outline.
    ctx.beginPath();
    path({ type: 'Sphere' });
    ctx.strokeStyle = OUTLINE_COLOR;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Marker, only when the selected point is on the visible (near) hemisphere.
    const projected = projection([markerLon, markerLat]);
    if (projected) {
      const [mx, my] = projected;
      ctx.beginPath();
      ctx.arc(mx, my, 6, 0, Math.PI * 2);
      ctx.fillStyle = MARKER_COLOR;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
    }
  }

  function recenterOnMarker(): void {
    rotation = [-markerLon, -markerLat, 0];
  }

  attachViewportInteraction(canvas, {
    onPan: (dx, dy) => {
      const sensitivity = ROTATE_SENSITIVITY_DEG_PER_PX / zoom;
      rotation = [rotation[0] + dx * sensitivity, Math.max(-90, Math.min(90, rotation[1] - dy * sensitivity)), 0];
      draw();
    },
    onZoom: (factor) => {
      zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom * factor));
      draw();
    },
    onTap: (x, y) => {
      const point = projection.invert?.([x, y]);
      if (!point) return;
      const [lon, lat] = point;
      markerLat = lat;
      markerLon = lon;
      draw();
      options.onPick(lat, lon);
    },
    onReset: () => {
      zoom = 1;
      recenterOnMarker();
      draw();
    },
  });

  window.addEventListener('resize', draw);
  draw();

  return {
    setLocation(latitude, longitude, opts) {
      markerLat = latitude;
      markerLon = longitude;
      if (opts?.recenter) recenterOnMarker();
      draw();
    },
    redraw: draw,
  };
}
