/**
 * A "spin the globe and click a spot" location picker: an orthographic
 * (globe-look) projection rendered on a plain 2D canvas via d3-geo, with
 * coastlines and country borders from world-atlas's bundled topojson data
 * (a coarse base layer, plus a lazy-loaded finer one re-simplified from
 * Natural Earth's 50m data for when the user zooms in), worldwide
 * province/state borders from Natural Earth's admin-1 layer (also
 * lazy-loaded, re-simplified from the 10m resolution since the 50m one
 * only covers a handful of large federated countries), and country
 * capitals from Natural Earth's populated-places layer — all public
 * domain, all bundled at build time. No image assets, no network requests,
 * no API keys — this works fully offline. A hover tooltip shows the
 * country/region under the cursor via point-in-polygon lookups against
 * this same bundled data.
 */

import { geoOrthographic, geoPath, geoGraticule10, geoCentroid, geoBounds, geoContains, type GeoProjection } from 'd3-geo';
import { feature } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import type { Feature, GeoJsonProperties, Geometry } from 'geojson';
import landTopology from 'world-atlas/land-110m.json';
import countryTopology from 'world-atlas/countries-110m.json';
import capitalsData from './data/capitals.json';
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

interface CountryProperties {
  name: string;
}

interface Admin1Properties {
  name: string;
  admin: string;
  type: string;
}

interface Capital {
  name: string;
  country: string;
  lat: number;
  lon: number;
}

const OCEAN_TOP = '#4a7fb5';
const OCEAN_BOTTOM = '#1c3a5e';
const LAND_FILL = '#e8dcc0';
const LAND_STROKE = '#a99a72';
const COUNTRY_BORDER_COLOR = 'rgba(90, 70, 40, 0.55)';
const ADMIN1_BORDER_COLOR = 'rgba(60, 45, 110, 0.6)';
const GRATICULE_COLOR = 'rgba(255, 255, 255, 0.18)';
const OUTLINE_COLOR = 'rgba(0, 0, 0, 0.25)';
const MARKER_COLOR = '#f5423a';
const CAPITAL_DOT_COLOR = 'rgba(40, 30, 15, 0.7)';
const LABEL_TEXT_COLOR = '#2a2115';
const LABEL_BG_COLOR = 'rgba(245, 240, 228, 0.82)';

const MIN_ZOOM = 0.8;
const MAX_ZOOM = 18;
const ROTATE_SENSITIVITY_DEG_PER_PX = 0.3;

// Below these zoom levels, the corresponding layer is skipped entirely so the
// globe doesn't turn into visual clutter at whole-Earth scale.
const ZOOM_SHOW_CAPITAL_DOTS = 1.5;
const ZOOM_SHOW_CAPITAL_LABELS = 4;
const ZOOM_SHOW_DETAIL = 2.5;
const ZOOM_SHOW_ADMIN1_LINES = 5;
const ZOOM_SHOW_ADMIN1_LABELS = 6.5;

const land = feature(landTopology as unknown as Topology, landTopology.objects.land as GeometryCollection);
const countries = feature(
  countryTopology as unknown as Topology,
  countryTopology.objects.countries as GeometryCollection<CountryProperties>,
);
const capitals = capitalsData as Capital[];

interface LabelCandidate {
  lon: number;
  lat: number;
  text: string;
}

// Precomputed once (not per frame): capitals already carry lat/lon, so this is just a reshape.
const capitalLabelCandidates: LabelCandidate[] = capitals.map((c) => ({ lon: c.lon, lat: c.lat, text: c.name }));

// Higher-resolution coastlines/country borders and the admin-1 (state/province) layer are
// separate, lazy-loaded chunks: they only add value once the user has zoomed in, so there's no
// reason to pay for them on first paint of the picker. Kept as individual islands/countries
// (rather than one dissolved landmass) specifically so they can be viewport-culled the same way
// as admin1 regions — see `buildCullableFeatures`/`filterVisible` below.
let detail: {
  land: CullableFeature<Record<string, never>>[];
  countries: CullableFeature<CountryProperties>[];
} | null = null;
let detailLoadStarted = false;

function ensureDetailLoaded(onLoaded: () => void): void {
  if (detail || detailLoadStarted) return;
  detailLoadStarted = true;
  import('./data/world-detail-50m.json').then((mod) => {
    const topology = mod.default as unknown as Topology;
    const landFeatures = feature(topology, topology.objects.land as GeometryCollection);
    const countryFeatures = feature(topology, topology.objects.countries as GeometryCollection<CountryProperties>);
    detail = {
      land: buildCullableFeatures(landFeatures.features),
      countries: buildCullableFeatures(countryFeatures.features),
    };
    onLoaded();
  });
}

// A feature plus enough precomputed info to cheaply decide, per frame, whether it's worth handing
// to d3-geo at all. Built once when a layer loads rather than recomputed on every redraw — with
// e.g. ~4,600 worldwide admin-1 regions, geoCentroid()/geoBounds() are not cheap enough to re-run
// every frame of a drag, and handing d3-geo's clip machinery a full, un-culled collection (most of
// which is off-screen) every frame is itself a multi-hundred-millisecond cost. Very large or
// irregularly-shaped features (continents, Russia, Alaska) get `alwaysInclude: true`: their
// centroid is a poor stand-in for "is any part of this near the viewport" (imagine standing on the
// edge of Portugal — Eurasia's centroid is in central Asia), so culling them by centroid risks
// dropping a landmass that's clearly on screen. They're few enough that always including them is
// cheap insurance.
interface CullableFeature<P extends GeoJsonProperties> {
  feature: Feature<Geometry, P>;
  lon: number;
  lat: number;
  alwaysInclude: boolean;
}

const LARGE_FEATURE_SPAN_DEG = 40;

function buildCullableFeatures<P extends GeoJsonProperties>(features: Feature<Geometry, P>[]): CullableFeature<P>[] {
  return features.map((f) => {
    const [lon, lat] = geoCentroid(f);
    const [[minLon, minLat], [maxLon, maxLat]] = geoBounds(f);
    const alwaysInclude = maxLon - minLon > LARGE_FEATURE_SPAN_DEG || maxLat - minLat > LARGE_FEATURE_SPAN_DEG;
    return { feature: f, lon, lat, alwaysInclude };
  });
}

// Keeps only features plausibly visible in the current viewport: always-include features, plus
// front-facing features whose centroid projects within `marginPx` of the canvas bounds. The margin
// is generous so a compact-but-not-tiny region whose centroid sits just outside the frame isn't
// dropped while a sliver of it is still visible.
function filterVisible<P extends GeoJsonProperties>(
  cullables: CullableFeature<P>[],
  rotation: readonly [number, number, number],
  projection: GeoProjection,
  cssWidth: number,
  cssHeight: number,
  marginPx: number,
): CullableFeature<P>[] {
  const result: CullableFeature<P>[] = [];
  for (const c of cullables) {
    if (c.alwaysInclude) {
      result.push(c);
      continue;
    }
    if (!isFrontFacing(c.lon, c.lat, rotation)) continue;
    const p = projection([c.lon, c.lat]);
    if (!p) continue;
    if (p[0] > -marginPx && p[0] < cssWidth + marginPx && p[1] > -marginPx && p[1] < cssHeight + marginPx) {
      result.push(c);
    }
  }
  return result;
}

let admin1Regions: CullableFeature<Admin1Properties>[] | null = null;
let admin1LoadStarted = false;

function ensureAdmin1Loaded(onLoaded: () => void): void {
  if (admin1Regions || admin1LoadStarted) return;
  admin1LoadStarted = true;
  import('./data/admin1-10m-topo.json').then((mod) => {
    const topology = mod.default as unknown as Topology<{ admin1_10m: GeometryCollection<Admin1Properties> }>;
    const collection = feature(topology, topology.objects.admin1_10m);
    admin1Regions = buildCullableFeatures(collection.features);
    onLoaded();
  });
}

/** Whether a geo point falls on the hemisphere currently facing the viewer, given the globe's rotation. */
function isFrontFacing(lon: number, lat: number, rotation: readonly [number, number, number]): boolean {
  const centerLon = (-rotation[0] * Math.PI) / 180;
  const centerLat = (-rotation[1] * Math.PI) / 180;
  const pointLon = (lon * Math.PI) / 180;
  const pointLat = (lat * Math.PI) / 180;
  const cosDistance =
    Math.sin(pointLat) * Math.sin(centerLat) + Math.cos(pointLat) * Math.cos(centerLat) * Math.cos(pointLon - centerLon);
  return cosDistance > 0;
}

export function createGlobePicker(canvas: HTMLCanvasElement, options: GlobePickerOptions): GlobePicker {
  const projection: GeoProjection = geoOrthographic();
  let zoom = 1;
  let markerLat = options.initialLatitude;
  let markerLon = options.initialLongitude;
  let rotation: [number, number, number] = [-options.initialLongitude, -options.initialLatitude, 0];

  function drawLabel(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, fontPx: number): void {
    ctx.font = `${fontPx}px sans-serif`;
    const padX = 3;
    const width = ctx.measureText(text).width;
    ctx.fillStyle = LABEL_BG_COLOR;
    ctx.fillRect(x - width / 2 - padX, y - fontPx, width + padX * 2, fontPx * 1.3);
    ctx.fillStyle = LABEL_TEXT_COLOR;
    ctx.textAlign = 'center';
    ctx.fillText(text, x, y - fontPx * 0.25);
  }

  // Renders at most one label per `minSpacingPx` screen-pixel neighborhood: with worldwide
  // admin-1 coverage, a view of e.g. Europe or the Middle East has hundreds of front-facing
  // regions, and drawing (let alone measuring) a label for every one of them both tanks frame
  // time and produces an illegible pile of overlapping text. Off-screen candidates (front-facing
  // but outside the current zoomed viewport) are skipped before any text metrics are touched.
  function drawDeclutteredLabels(
    ctx: CanvasRenderingContext2D,
    candidates: LabelCandidate[],
    fontPx: number,
    minSpacingPx: number,
    cssWidth: number,
    cssHeight: number,
    offsetY = 0,
  ): void {
    const placed: { x: number; y: number }[] = [];
    for (const { lon, lat, text } of candidates) {
      if (!isFrontFacing(lon, lat, rotation)) continue;
      const projected = projection([lon, lat]);
      if (!projected) continue;
      const [x, y] = projected;
      if (x < -20 || x > cssWidth + 20 || y < -20 || y > cssHeight + 20) continue;
      if (placed.some((p) => Math.hypot(p.x - x, p.y - y) < minSpacingPx)) continue;
      placed.push({ x, y });
      drawLabel(ctx, x, y + offsetY, text, fontPx);
    }
  }

  function draw(): void {
    if (zoom >= ZOOM_SHOW_DETAIL) ensureDetailLoaded(draw);
    if (zoom >= ZOOM_SHOW_ADMIN1_LINES) ensureAdmin1Loaded(draw);

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

    // Viewport-relative culling margin, shared by the land/country detail layer and admin-1: see
    // the `CullableFeature`/`filterVisible` doc comment above for why this matters.
    const cullMarginPx = Math.max(cssWidth, cssHeight) * 0.08;
    const activeLand = detail
      ? {
          type: 'FeatureCollection' as const,
          features: filterVisible(detail.land, rotation, projection, cssWidth, cssHeight, cullMarginPx).map(
            (c) => c.feature,
          ),
        }
      : land;
    const activeCountries = detail
      ? {
          type: 'FeatureCollection' as const,
          features: filterVisible(detail.countries, rotation, projection, cssWidth, cssHeight, cullMarginPx).map(
            (c) => c.feature,
          ),
        }
      : countries;

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
    path(activeLand);
    ctx.fillStyle = LAND_FILL;
    ctx.fill();
    ctx.strokeStyle = LAND_STROKE;
    ctx.lineWidth = 0.75;
    ctx.stroke();

    // Country borders (drawn on top of the land fill so internal borders show, not just coastline).
    ctx.beginPath();
    path(activeCountries);
    ctx.strokeStyle = COUNTRY_BORDER_COLOR;
    ctx.lineWidth = 0.6;
    ctx.stroke();

    // Province/state borders, once loaded and zoomed in enough to be useful. Drawn bolder and
    // in a distinct hue from country borders since disambiguating regions matters most for
    // picking a precise location.
    if (admin1Regions && zoom >= ZOOM_SHOW_ADMIN1_LINES) {
      // Same viewport pre-filter as the land/country detail layer above: handing d3-geo's clip
      // machinery the full worldwide ~4,600-region/77k-point collection every frame (the
      // front-facing hemisphere alone can still be most of it — e.g. Europe/Africa/Asia together
      // hold a large share of the world's admin-1 subdivisions) is what actually costs hundreds of
      // milliseconds here, not the final stroke — the geometry work happens in `path()`, not in
      // `ctx.stroke()`.
      const visible = filterVisible(admin1Regions, rotation, projection, cssWidth, cssHeight, cullMarginPx);
      ctx.beginPath();
      path({ type: 'FeatureCollection', features: visible.map((r) => r.feature) });
      ctx.strokeStyle = ADMIN1_BORDER_COLOR;
      ctx.lineWidth = 0.9;
      ctx.stroke();

      if (zoom >= ZOOM_SHOW_ADMIN1_LABELS) {
        drawDeclutteredLabels(
          ctx,
          visible.map((r) => ({ lon: r.lon, lat: r.lat, text: r.feature.properties.name })),
          10,
          36,
          cssWidth,
          cssHeight,
        );
      }
    }

    // Outline.
    ctx.beginPath();
    path({ type: 'Sphere' });
    ctx.strokeStyle = OUTLINE_COLOR;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Country capitals.
    if (zoom >= ZOOM_SHOW_CAPITAL_DOTS) {
      for (const capital of capitals) {
        if (!isFrontFacing(capital.lon, capital.lat, rotation)) continue;
        const projected = projection([capital.lon, capital.lat]);
        if (!projected) continue;
        const [cx, cy] = projected;
        if (cx < -10 || cx > cssWidth + 10 || cy < -10 || cy > cssHeight + 10) continue;
        ctx.beginPath();
        ctx.arc(cx, cy, 2, 0, Math.PI * 2);
        ctx.fillStyle = CAPITAL_DOT_COLOR;
        ctx.fill();
      }
      if (zoom >= ZOOM_SHOW_CAPITAL_LABELS) {
        drawDeclutteredLabels(ctx, capitalLabelCandidates, 10, 30, cssWidth, cssHeight, -4);
      }
    }

    // Marker, only when the selected point is on the visible (near) hemisphere.
    if (isFrontFacing(markerLon, markerLat, rotation)) {
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
  }

  function recenterOnMarker(): void {
    rotation = [-markerLon, -markerLat, 0];
  }

  // Hover overlay: shows the country (and, once zoomed in, province/state) under the cursor.
  // Point-in-polygon lookups against the country/admin1 layers are cheap individually but add up
  // across hundreds of features, so mousemove events are coalesced to at most one lookup per frame.
  const hoverLabel = document.createElement('div');
  hoverLabel.className = 'globe-hover-label';
  canvas.parentElement?.appendChild(hoverLabel);

  function hideHover(): void {
    hoverLabel.classList.remove('visible');
  }

  function updateHover(clientX: number, clientY: number): void {
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const point = projection.invert?.([x, y]);
    if (!point || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) {
      hideHover();
      return;
    }
    const activeCountryFeatures = detail ? detail.countries.map((c) => c.feature) : countries.features;
    let countryName: string | null = null;
    for (const country of activeCountryFeatures) {
      if (geoContains(country, point)) {
        countryName = country.properties.name;
        break;
      }
    }
    if (!countryName) {
      hideHover();
      return;
    }
    let label = countryName;
    if (admin1Regions && zoom >= ZOOM_SHOW_ADMIN1_LINES) {
      for (const region of admin1Regions) {
        if (!isFrontFacing(region.lon, region.lat, rotation)) continue;
        if (geoContains(region.feature, point)) {
          label = `${region.feature.properties.name}, ${countryName}`;
          break;
        }
      }
    }
    hoverLabel.textContent = label;
    hoverLabel.style.left = `${canvas.offsetLeft + x}px`;
    hoverLabel.style.top = `${canvas.offsetTop + y}px`;
    hoverLabel.classList.add('visible');
  }

  let hoverRafId: number | null = null;
  let pendingHoverPoint: { x: number; y: number } | null = null;

  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    pendingHoverPoint = { x: e.clientX, y: e.clientY };
    if (hoverRafId !== null) return;
    hoverRafId = requestAnimationFrame(() => {
      hoverRafId = null;
      if (pendingHoverPoint) updateHover(pendingHoverPoint.x, pendingHoverPoint.y);
    });
  });
  canvas.addEventListener('pointerleave', hideHover);

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
