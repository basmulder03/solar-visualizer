import './style.css';
import {
  getMoonPathForDay,
  getMoonPosition,
  getPastAndNextLocalSolarEclipse,
  getSunPathForDay,
  getSunPosition,
  getSunTimes,
  type BodyPosition,
  type Location,
  type PastAndNextSolarEclipses,
  type SolarEclipseEvent,
  type SolarEclipseInfo,
} from './astronomy.ts';
import { drawPolarSkyPlot, type BodyMarker, type PlotPoint } from './polarPlot.ts';
import { drawHorizonView, type HorizonBody } from './horizonView.ts';
import { DayTimeline, MINUTES_PER_DAY } from './timeline.ts';

const SUN_COLOR = '#f5a623';
const MOON_COLOR = '#b9c4d6';
const COMPASS_8 = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const ECLIPSE_CLOSEUP_FOV_DEG = 4;
const ECLIPSE_SEARCH_DEBOUNCE_MS = 400;

const latInput = document.querySelector<HTMLInputElement>('#latitude')!;
const lonInput = document.querySelector<HTMLInputElement>('#longitude')!;
const dateInput = document.querySelector<HTMLInputElement>('#date')!;
const useLocationBtn = document.querySelector<HTMLButtonElement>('#use-location')!;
const statusEl = document.querySelector<HTMLParagraphElement>('#location-status')!;
const sunTimesEl = document.querySelector<HTMLDListElement>('#sun-times')!;
const eclipseContentEl = document.querySelector<HTMLDivElement>('#eclipse-content')!;

const polarCanvas = document.querySelector<HTMLCanvasElement>('#sky-plot')!;
const horizonCanvas = document.querySelector<HTMLCanvasElement>('#horizon-plot')!;
const polarWrap = document.querySelector<HTMLDivElement>('#polar-wrap')!;
const horizonWrap = document.querySelector<HTMLDivElement>('#horizon-wrap')!;
const viewPolarBtn = document.querySelector<HTMLButtonElement>('#view-polar-btn')!;
const viewHorizonBtn = document.querySelector<HTMLButtonElement>('#view-horizon-btn')!;

const headingSlider = document.querySelector<HTMLInputElement>('#heading-slider')!;
const headingLabel = document.querySelector<HTMLOutputElement>('#heading-label')!;
const fovSlider = document.querySelector<HTMLInputElement>('#fov-slider')!;
const fovLabel = document.querySelector<HTMLOutputElement>('#fov-label')!;
const compassQuickButtons = document.querySelectorAll<HTMLButtonElement>('.compass-quick button');

const timeControlsEl = document.querySelector<HTMLDivElement>('#time-controls')!;
const timeSlider = document.querySelector<HTMLInputElement>('#time-slider')!;
const timeLabel = document.querySelector<HTMLOutputElement>('#time-label')!;
const playPauseBtn = document.querySelector<HTMLButtonElement>('#play-pause')!;
const speedSelect = document.querySelector<HTMLSelectElement>('#speed-select')!;
const jumpNowBtn = document.querySelector<HTMLButtonElement>('#jump-now')!;

const eclipseScrubPanel = document.querySelector<HTMLDivElement>('#eclipse-scrub-panel')!;
const eclipseScrubTitle = document.querySelector<HTMLElement>('#eclipse-scrub-title')!;
const eclipseScrubSlider = document.querySelector<HTMLInputElement>('#eclipse-scrub-slider')!;
const eclipseScrubTime = document.querySelector<HTMLOutputElement>('#eclipse-scrub-time')!;
const exitEclipseBtn = document.querySelector<HTMLButtonElement>('#exit-eclipse-btn')!;

// Default location so the plot isn't blank before the user picks one.
const DEFAULT_LOCATION: Location = { latitude: 52.3676, longitude: 4.9041, elevation: 0 };

type ViewMode = 'polar' | 'horizon';
let activeView: ViewMode = 'polar';

// Cached full-day paths; only recomputed when location or date changes, not every animation frame.
let sunPath: PlotPoint[] = [];
let moonPath: PlotPoint[] = [];
// Cached instantaneous positions; recomputed once per time tick, reused when heading/FOV change.
let lastSunPos: BodyPosition | null = null;
let lastMoonPos: BodyPosition | null = null;
let headingSetByUser = false;

let currentEclipses: PastAndNextSolarEclipses | null = null;
let activeEclipse: SolarEclipseInfo | null = null;
let eclipseSearchTimer: number | undefined;

function todayInputValue(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function currentMinutesOfDay(): number {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
}

/** Parses a `YYYY-MM-DD` date-input value as a local calendar date (midnight local time). */
function parseInputDate(value: string): Date {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** The selected calendar date, combined with a given minutes-since-midnight offset. */
function dateAtMinutesOfDay(date: Date, minutesOfDay: number): Date {
  const totalSeconds = Math.round(minutesOfDay * 60);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), hours, minutes, seconds);
}

function formatMinutesOfDay(minutesOfDay: number): string {
  const totalMinutes = Math.floor(minutesOfDay);
  const h = String(Math.floor(totalMinutes / 60)).padStart(2, '0');
  const m = String(totalMinutes % 60).padStart(2, '0');
  return `${h}:${m}`;
}

function headingLabelText(deg: number): string {
  const compass = COMPASS_8[Math.round(deg / 45) % 8];
  return `${compass} (${deg}°)`;
}

function currentLocation(): Location | null {
  const latitude = latInput.valueAsNumber;
  const longitude = lonInput.valueAsNumber;
  if (Number.isNaN(latitude) || Number.isNaN(longitude)) return null;
  return { latitude, longitude, elevation: 0 };
}

function selectedDate(): Date {
  return parseInputDate(dateInput.value || todayInputValue());
}

function formatTime(date: Date | null): string {
  if (!date) return '—';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function renderSunTimes(location: Location, date: Date): void {
  const times = getSunTimes(location, date);
  sunTimesEl.innerHTML = `
    <dt>Sunrise</dt><dd>${formatTime(times.sunrise)}</dd>
    <dt>Solar noon</dt><dd>${formatTime(times.solarNoon)}</dd>
    <dt>Sunset</dt><dd>${formatTime(times.sunset)}</dd>
    <dt>Civil dawn</dt><dd>${formatTime(times.civilDawn)}</dd>
    <dt>Civil dusk</dt><dd>${formatTime(times.civilDusk)}</dd>
    <dt>Nautical dawn</dt><dd>${formatTime(times.nauticalDawn)}</dd>
    <dt>Nautical dusk</dt><dd>${formatTime(times.nauticalDusk)}</dd>
    <dt>Astronomical dawn</dt><dd>${formatTime(times.astronomicalDawn)}</dd>
    <dt>Astronomical dusk</dt><dd>${formatTime(times.astronomicalDusk)}</dd>
  `;
}

/** Recomputes the cached full-day paths and sun-times text. Call on location/date change. */
function recomputeDay(): void {
  const location = currentLocation();
  if (!location) return;
  const date = selectedDate();

  sunPath = getSunPathForDay(location, date).map((p) => ({ azimuthDeg: p.azimuth, altitudeDeg: p.altitude }));
  moonPath = getMoonPathForDay(location, date).map((p) => ({ azimuthDeg: p.azimuth, altitudeDeg: p.altitude }));
  renderSunTimes(location, date);
  renderFrame(timeline.minutesOfDay);
}

/** Redraws whichever canvases are relevant using the last-computed body positions. Cheap: no astronomy calls. */
function redrawCanvases(): void {
  if (!lastSunPos || !lastMoonPos) return;

  const markers: BodyMarker[] = [
    { azimuthDeg: lastSunPos.azimuth, altitudeDeg: lastSunPos.altitude, color: SUN_COLOR, label: 'Sun' },
    { azimuthDeg: lastMoonPos.azimuth, altitudeDeg: lastMoonPos.altitude, color: MOON_COLOR, label: 'Moon' },
  ];

  if (activeView === 'polar') {
    drawPolarSkyPlot(polarCanvas, {
      paths: [
        { points: sunPath, color: SUN_COLOR },
        { points: moonPath, color: MOON_COLOR },
      ],
      markers,
    });
  } else {
    const bodies: HorizonBody[] = [
      { azimuthDeg: lastSunPos.azimuth, altitudeDeg: lastSunPos.altitude, angularRadiusDeg: lastSunPos.angularRadius, color: SUN_COLOR, label: 'Sun' },
      { azimuthDeg: lastMoonPos.azimuth, altitudeDeg: lastMoonPos.altitude, angularRadiusDeg: lastMoonPos.angularRadius, color: MOON_COLOR, label: 'Moon' },
    ];
    drawHorizonView(horizonCanvas, {
      headingDeg: Number(headingSlider.value),
      fovDeg: Number(fovSlider.value),
      sunAltitudeDeg: lastSunPos.altitude,
      bodies,
      centerAltitudeDeg: activeEclipse ? lastSunPos.altitude : undefined,
    });
  }
}

/** Per-frame update: recomputes the two body positions at the given time, then redraws. */
function renderFrame(minutesOfDay: number): void {
  const location = currentLocation();
  if (!location) return;
  const instant = dateAtMinutesOfDay(selectedDate(), minutesOfDay);

  lastSunPos = getSunPosition(location, instant);
  lastMoonPos = getMoonPosition(location, instant);

  if (!headingSetByUser) {
    headingSlider.value = String(Math.round(lastSunPos.azimuth));
    headingLabel.textContent = headingLabelText(Number(headingSlider.value));
  }

  redrawCanvases();

  timeSlider.value = String(minutesOfDay);
  timeLabel.textContent = formatMinutesOfDay(minutesOfDay);
}

function setView(view: ViewMode): void {
  if (view === 'polar' && activeEclipse) exitEclipseMode();
  activeView = view;
  polarWrap.hidden = view !== 'polar';
  horizonWrap.hidden = view !== 'horizon';
  viewPolarBtn.setAttribute('aria-selected', String(view === 'polar'));
  viewHorizonBtn.setAttribute('aria-selected', String(view === 'horizon'));
  redrawCanvases();
}

const timeline = new DayTimeline({
  initialMinutes: currentMinutesOfDay(),
  speedMinutesPerSecond: Number(speedSelect.value),
  onTick: renderFrame,
  onPlayingChange: (playing) => {
    playPauseBtn.textContent = playing ? '⏸ Pause' : '▶ Play';
    playPauseBtn.setAttribute('aria-pressed', String(playing));
  },
});

// --- Eclipses -----------------------------------------------------------

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function formatEclipseTime(date: Date): string {
  return date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function eclipseContactRow(label: string, event: SolarEclipseEvent | null): string {
  if (!event) return '';
  const belowClass = event.sunAltitude < 0 ? ' class="below-horizon"' : '';
  return `<dt>${label}</dt><dd${belowClass}>${formatEclipseTime(event.time)}</dd>`;
}

function eclipseCardHtml(eclipse: SolarEclipseInfo, title: string, which: 'past' | 'next'): string {
  const ringOrTotality = eclipse.kind === 'total' ? 'Totality' : 'Ring';
  return `
    <div class="eclipse-card">
      <h3>${title}<span class="eclipse-kind">${capitalize(eclipse.kind)}</span></h3>
      <p class="eclipse-magnitude">Magnitude ${(eclipse.obscuration * 100).toFixed(1)}%</p>
      <dl class="eclipse-contacts">
        ${eclipseContactRow('First contact', eclipse.partialBegin)}
        ${eclipse.totalBegin ? eclipseContactRow(`${ringOrTotality} begins`, eclipse.totalBegin) : ''}
        ${eclipseContactRow('Maximum', eclipse.peak)}
        ${eclipse.totalEnd ? eclipseContactRow(`${ringOrTotality} ends`, eclipse.totalEnd) : ''}
        ${eclipseContactRow('Last contact', eclipse.partialEnd)}
      </dl>
      <button type="button" class="eclipse-view-btn" data-which="${which}">🔭 View in horizon</button>
    </div>
  `;
}

function renderEclipsePanel(result: PastAndNextSolarEclipses): void {
  currentEclipses = result;
  const parts: string[] = [eclipseCardHtml(result.next, 'Next eclipse', 'next')];
  if (result.past) parts.push(eclipseCardHtml(result.past, 'Previous eclipse', 'past'));
  eclipseContentEl.innerHTML = parts.join('');
}

/** Searches for the past/next solar eclipse visible from the current location, anchored to the real "now". */
function recomputeEclipses(): void {
  const location = currentLocation();
  if (!location) return;
  eclipseContentEl.innerHTML = '<p class="status">Searching…</p>';
  try {
    const result = getPastAndNextLocalSolarEclipse(location, new Date());
    renderEclipsePanel(result);
  } catch {
    eclipseContentEl.innerHTML = '<p class="status">Could not find eclipse data for this location.</p>';
  }
}

function scheduleRecomputeEclipses(): void {
  window.clearTimeout(eclipseSearchTimer);
  eclipseSearchTimer = window.setTimeout(recomputeEclipses, ECLIPSE_SEARCH_DEBOUNCE_MS);
}

/** Renders the Sun/Moon at a point (0-1) along the active eclipse's first-contact-to-last-contact span. */
function renderEclipseFrame(fraction: number): void {
  if (!activeEclipse) return;
  const location = currentLocation();
  if (!location) return;

  const start = activeEclipse.partialBegin.time.getTime();
  const end = activeEclipse.partialEnd.time.getTime();
  const time = new Date(start + (end - start) * fraction);

  lastSunPos = getSunPosition(location, time);
  lastMoonPos = getMoonPosition(location, time);

  if (!headingSetByUser) {
    headingSlider.value = String(Math.round(lastSunPos.azimuth));
    headingLabel.textContent = headingLabelText(Number(headingSlider.value));
  }

  redrawCanvases();
  eclipseScrubTime.textContent = time.toLocaleString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function enterEclipseMode(which: 'past' | 'next'): void {
  const eclipse = which === 'next' ? currentEclipses?.next : currentEclipses?.past;
  if (!eclipse) return;

  timeline.pause();
  activeEclipse = eclipse;
  headingSetByUser = false;
  fovSlider.value = String(ECLIPSE_CLOSEUP_FOV_DEG);
  fovLabel.textContent = `${ECLIPSE_CLOSEUP_FOV_DEG}°`;

  eclipseScrubTitle.textContent = `${capitalize(eclipse.kind)} eclipse — ${formatEclipseTime(eclipse.peak.time)}`;
  eclipseScrubSlider.value = '0';

  timeControlsEl.hidden = true;
  eclipseScrubPanel.hidden = false;
  setView('horizon');
  renderEclipseFrame(0);
}

function exitEclipseMode(): void {
  activeEclipse = null;
  headingSetByUser = false;
  timeControlsEl.hidden = false;
  eclipseScrubPanel.hidden = true;
  fovSlider.value = '90';
  fovLabel.textContent = '90°';
  renderFrame(timeline.minutesOfDay);
}

eclipseContentEl.addEventListener('click', (e) => {
  const button = (e.target as HTMLElement).closest<HTMLButtonElement>('.eclipse-view-btn');
  if (!button) return;
  enterEclipseMode(button.dataset.which === 'past' ? 'past' : 'next');
});

eclipseScrubSlider.addEventListener('input', () => {
  renderEclipseFrame(Number(eclipseScrubSlider.value) / 1000);
});

exitEclipseBtn.addEventListener('click', exitEclipseMode);

// --- Wiring ---------------------------------------------------------------

function useMyLocation(): void {
  if (!('geolocation' in navigator)) {
    statusEl.textContent = 'Geolocation is not available in this browser.';
    return;
  }
  statusEl.textContent = 'Locating…';
  navigator.geolocation.getCurrentPosition(
    (position) => {
      latInput.value = position.coords.latitude.toFixed(4);
      lonInput.value = position.coords.longitude.toFixed(4);
      statusEl.textContent = `Location set (±${Math.round(position.coords.accuracy)}m accuracy).`;
      recomputeDay();
      recomputeEclipses();
    },
    (error) => {
      statusEl.textContent = `Could not get location: ${error.message}`;
    },
    { enableHighAccuracy: false, timeout: 10000 },
  );
}

latInput.value = String(DEFAULT_LOCATION.latitude);
lonInput.value = String(DEFAULT_LOCATION.longitude);
dateInput.value = todayInputValue();
timeSlider.max = String(MINUTES_PER_DAY - 1);

useLocationBtn.addEventListener('click', useMyLocation);
dateInput.addEventListener('input', recomputeDay);
[latInput, lonInput].forEach((el) =>
  el.addEventListener('input', () => {
    recomputeDay();
    scheduleRecomputeEclipses();
  }),
);
window.addEventListener('resize', redrawCanvases);

timeSlider.addEventListener('input', () => {
  timeline.pause();
  timeline.setMinutes(Number(timeSlider.value));
});

playPauseBtn.addEventListener('click', () => timeline.toggle());

speedSelect.addEventListener('change', () => timeline.setSpeed(Number(speedSelect.value)));

jumpNowBtn.addEventListener('click', () => {
  timeline.pause();
  dateInput.value = todayInputValue();
  timeline.setMinutes(currentMinutesOfDay());
  recomputeDay();
});

viewPolarBtn.addEventListener('click', () => setView('polar'));
viewHorizonBtn.addEventListener('click', () => setView('horizon'));

headingSlider.addEventListener('input', () => {
  headingSetByUser = true;
  headingLabel.textContent = headingLabelText(Number(headingSlider.value));
  redrawCanvases();
});

fovSlider.addEventListener('input', () => {
  fovLabel.textContent = `${fovSlider.value}°`;
  redrawCanvases();
});

compassQuickButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    headingSetByUser = true;
    headingSlider.value = btn.dataset.heading!;
    headingLabel.textContent = headingLabelText(Number(headingSlider.value));
    redrawCanvases();
  });
});

recomputeDay();
recomputeEclipses();
