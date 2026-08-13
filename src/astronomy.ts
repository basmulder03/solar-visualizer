import * as Astronomy from 'astronomy-engine';

/** Mean physical radius of the Sun, in kilometers. */
const SUN_RADIUS_KM = 695700;
/** Mean physical radius of the Moon, in kilometers. */
const MOON_RADIUS_KM = 1737.4;

export interface Location {
  latitude: number;
  longitude: number;
  /** Meters above sea level. */
  elevation: number;
}

export interface BodyPosition {
  /** Degrees above (+) or below (-) the horizon. */
  altitude: number;
  /** Degrees clockwise from true north. */
  azimuth: number;
  /** Apparent angular radius of the disc, in degrees, accounting for distance. */
  angularRadius: number;
  distanceAu: number;
}

export interface SunTimes {
  sunrise: Date | null;
  sunset: Date | null;
  solarNoon: Date | null;
  civilDawn: Date | null;
  civilDusk: Date | null;
  nauticalDawn: Date | null;
  nauticalDusk: Date | null;
  astronomicalDawn: Date | null;
  astronomicalDusk: Date | null;
}

export interface PathPoint {
  time: Date;
  altitude: number;
  azimuth: number;
}

function toObserver(location: Location): Astronomy.Observer {
  return new Astronomy.Observer(location.latitude, location.longitude, location.elevation);
}

function angularRadiusDeg(radiusKm: number, distanceAu: number): number {
  const distanceKm = distanceAu * Astronomy.KM_PER_AU;
  return Astronomy.RAD2DEG * Math.asin(radiusKm / distanceKm);
}

function getBodyPosition(body: Astronomy.Body, location: Location, date: Date): BodyPosition {
  const observer = toObserver(location);
  const equator = Astronomy.Equator(body, date, observer, true, true);
  const horizon = Astronomy.Horizon(date, observer, equator.ra, equator.dec, 'normal');
  const radiusKm = body === Astronomy.Body.Sun ? SUN_RADIUS_KM : MOON_RADIUS_KM;
  return {
    altitude: horizon.altitude,
    azimuth: horizon.azimuth,
    angularRadius: angularRadiusDeg(radiusKm, equator.dist),
    distanceAu: equator.dist,
  };
}

export function getSunPosition(location: Location, date: Date): BodyPosition {
  return getBodyPosition(Astronomy.Body.Sun, location, date);
}

export function getMoonPosition(location: Location, date: Date): BodyPosition {
  return getBodyPosition(Astronomy.Body.Moon, location, date);
}

/** Midnight in the local timezone on the same calendar day as `date`. */
function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function searchRiseSet(body: Astronomy.Body, observer: Astronomy.Observer, direction: 1 | -1, dayStart: Date): Date | null {
  const result = Astronomy.SearchRiseSet(body, observer, direction, dayStart, 1);
  return result ? result.date : null;
}

function searchAltitude(observer: Astronomy.Observer, direction: 1 | -1, dayStart: Date, altitude: number): Date | null {
  const result = Astronomy.SearchAltitude(Astronomy.Body.Sun, observer, direction, dayStart, 1, altitude);
  return result ? result.date : null;
}

function searchSolarNoon(observer: Astronomy.Observer, dayStart: Date): Date | null {
  try {
    const event = Astronomy.SearchHourAngle(Astronomy.Body.Sun, observer, 0, dayStart, 1);
    return event.time.date;
  } catch {
    return null;
  }
}

/**
 * Sunrise/sunset/solar-noon and the civil/nautical/astronomical dawn and dusk
 * times (sun altitude -6/-12/-18 degrees) for the local calendar day containing `date`.
 * Any event that doesn't occur that day (e.g. polar day/night) is `null`.
 */
export function getSunTimes(location: Location, date: Date): SunTimes {
  const observer = toObserver(location);
  const dayStart = startOfLocalDay(date);

  return {
    sunrise: searchRiseSet(Astronomy.Body.Sun, observer, 1, dayStart),
    sunset: searchRiseSet(Astronomy.Body.Sun, observer, -1, dayStart),
    solarNoon: searchSolarNoon(observer, dayStart),
    civilDawn: searchAltitude(observer, 1, dayStart, -6),
    civilDusk: searchAltitude(observer, -1, dayStart, -6),
    nauticalDawn: searchAltitude(observer, 1, dayStart, -12),
    nauticalDusk: searchAltitude(observer, -1, dayStart, -12),
    astronomicalDawn: searchAltitude(observer, 1, dayStart, -18),
    astronomicalDusk: searchAltitude(observer, -1, dayStart, -18),
  };
}

/**
 * Samples a body's altitude/azimuth at regular intervals across the local
 * calendar day containing `date`, for plotting its path across the sky.
 */
function getBodyPathForDay(body: Astronomy.Body, location: Location, date: Date, stepMinutes = 5): PathPoint[] {
  const dayStart = startOfLocalDay(date);
  const points: PathPoint[] = [];
  const stepMs = stepMinutes * 60 * 1000;
  const dayMs = 24 * 60 * 60 * 1000;

  for (let t = 0; t <= dayMs; t += stepMs) {
    const time = new Date(dayStart.getTime() + t);
    const { altitude, azimuth } = getBodyPosition(body, location, time);
    points.push({ time, altitude, azimuth });
  }

  return points;
}

export function getSunPathForDay(location: Location, date: Date, stepMinutes = 5): PathPoint[] {
  return getBodyPathForDay(Astronomy.Body.Sun, location, date, stepMinutes);
}

export function getMoonPathForDay(location: Location, date: Date, stepMinutes = 5): PathPoint[] {
  return getBodyPathForDay(Astronomy.Body.Moon, location, date, stepMinutes);
}

export type SolarEclipseKind = 'partial' | 'annular' | 'total';

export interface SolarEclipseEvent {
  time: Date;
  /** Sun's altitude at this event, in degrees. Negative means the event is below the horizon (not actually visible). */
  sunAltitude: number;
}

export interface SolarEclipseInfo {
  kind: SolarEclipseKind;
  /** Fraction (0-1] of the Sun's apparent disc area obscured by the Moon at the eclipse's peak. */
  obscuration: number;
  partialBegin: SolarEclipseEvent;
  /** Set only for annular/total eclipses: when the ring/totality phase begins. */
  totalBegin: SolarEclipseEvent | null;
  peak: SolarEclipseEvent;
  /** Set only for annular/total eclipses: when the ring/totality phase ends. */
  totalEnd: SolarEclipseEvent | null;
  partialEnd: SolarEclipseEvent;
}

function toEclipseEvent(event: Astronomy.EclipseEvent): SolarEclipseEvent {
  return { time: event.time.date, sunAltitude: event.altitude };
}

function toSolarEclipseInfo(info: Astronomy.LocalSolarEclipseInfo): SolarEclipseInfo {
  return {
    kind: info.kind as SolarEclipseKind,
    obscuration: info.obscuration,
    partialBegin: toEclipseEvent(info.partial_begin),
    totalBegin: info.total_begin ? toEclipseEvent(info.total_begin) : null,
    peak: toEclipseEvent(info.peak),
    totalEnd: info.total_end ? toEclipseEvent(info.total_end) : null,
    partialEnd: toEclipseEvent(info.partial_end),
  };
}

/** The next solar eclipse visible (at least partially) from `location`, starting the search at `afterDate`. */
export function getNextLocalSolarEclipse(location: Location, afterDate: Date): SolarEclipseInfo {
  const observer = toObserver(location);
  return toSolarEclipseInfo(Astronomy.SearchLocalSolarEclipse(afterDate, observer));
}

export interface PastAndNextSolarEclipses {
  /** The most recent eclipse whose peak was before `referenceDate`, or `null` if none was found within the search window. */
  past: SolarEclipseInfo | null;
  next: SolarEclipseInfo;
}

/**
 * Finds the solar eclipse just before and just after `referenceDate`, as seen from `location`.
 * astronomy-engine only exposes forward search, so the past eclipse is found by searching
 * forward from `yearsBack` years before `referenceDate` and walking the series up to it.
 */
export function getPastAndNextLocalSolarEclipse(
  location: Location,
  referenceDate: Date,
  yearsBack = 6,
): PastAndNextSolarEclipses {
  const observer = toObserver(location);
  const searchStart = new Date(referenceDate);
  searchStart.setFullYear(searchStart.getFullYear() - yearsBack);

  let eclipse = Astronomy.SearchLocalSolarEclipse(searchStart, observer);
  let past: Astronomy.LocalSolarEclipseInfo | null = null;

  const MAX_ITERATIONS = 40;
  for (let i = 0; i < MAX_ITERATIONS && eclipse.peak.time.date.getTime() <= referenceDate.getTime(); i++) {
    past = eclipse;
    eclipse = Astronomy.NextLocalSolarEclipse(eclipse.peak.time, observer);
  }

  return {
    past: past ? toSolarEclipseInfo(past) : null,
    next: toSolarEclipseInfo(eclipse),
  };
}
