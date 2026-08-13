import { describe, expect, it } from 'vitest';
import {
  getMoonPosition,
  getNextLocalSolarEclipse,
  getPastAndNextLocalSolarEclipse,
  getSunPathForDay,
  getSunPosition,
  getSunTimes,
  type Location,
} from './astronomy.ts';

const AMSTERDAM: Location = { latitude: 52.3676, longitude: 4.9041, elevation: 0 };
const SVALBARD: Location = { latitude: 78.2232, longitude: 15.6267, elevation: 0 };
// Path of totality for the well-documented 2024-04-08 total solar eclipse.
const DALLAS: Location = { latitude: 32.7767, longitude: -96.797, elevation: 0 };

describe('getSunPosition', () => {
  it('returns altitude/azimuth/angular radius in physically sane ranges', () => {
    const pos = getSunPosition(AMSTERDAM, new Date('2026-06-21T12:00:00Z'));
    expect(pos.altitude).toBeGreaterThan(-90);
    expect(pos.altitude).toBeLessThanOrEqual(90);
    expect(pos.azimuth).toBeGreaterThanOrEqual(0);
    expect(pos.azimuth).toBeLessThan(360);
    // The Sun's apparent radius is ~0.26-0.27 degrees from Earth.
    expect(pos.angularRadius).toBeGreaterThan(0.25);
    expect(pos.angularRadius).toBeLessThan(0.28);
  });

  it('places the sun high in the sky around local solar noon in summer', () => {
    // Amsterdam is UTC+2 in June (CEST), so ~12:00 local is ~10:00 UTC.
    const pos = getSunPosition(AMSTERDAM, new Date('2026-06-21T10:00:00Z'));
    expect(pos.altitude).toBeGreaterThan(55);
  });
});

describe('getMoonPosition', () => {
  it('returns an angular radius within the Moon\'s known apparent-size range', () => {
    const pos = getMoonPosition(AMSTERDAM, new Date('2026-06-21T12:00:00Z'));
    expect(pos.angularRadius).toBeGreaterThan(0.24);
    expect(pos.angularRadius).toBeLessThan(0.36);
  });
});

describe('getSunTimes', () => {
  it('orders sunrise before solar noon before sunset at a mid-latitude location', () => {
    const times = getSunTimes(AMSTERDAM, new Date('2026-06-21T00:00:00'));
    expect(times.sunrise).not.toBeNull();
    expect(times.solarNoon).not.toBeNull();
    expect(times.sunset).not.toBeNull();
    expect(times.sunrise!.getTime()).toBeLessThan(times.solarNoon!.getTime());
    expect(times.solarNoon!.getTime()).toBeLessThan(times.sunset!.getTime());
  });

  it('orders twilight bands symmetrically around sunrise/sunset', () => {
    const times = getSunTimes(AMSTERDAM, new Date('2026-03-20T00:00:00'));
    expect(times.astronomicalDawn!.getTime()).toBeLessThan(times.nauticalDawn!.getTime());
    expect(times.nauticalDawn!.getTime()).toBeLessThan(times.civilDawn!.getTime());
    expect(times.civilDawn!.getTime()).toBeLessThan(times.sunrise!.getTime());
    expect(times.sunset!.getTime()).toBeLessThan(times.civilDusk!.getTime());
    expect(times.civilDusk!.getTime()).toBeLessThan(times.nauticalDusk!.getTime());
    expect(times.nauticalDusk!.getTime()).toBeLessThan(times.astronomicalDusk!.getTime());
  });

  it('returns no sunrise/sunset during polar night', () => {
    const times = getSunTimes(SVALBARD, new Date('2026-01-05T00:00:00'));
    expect(times.sunrise).toBeNull();
    expect(times.sunset).toBeNull();
  });

  it('returns no sunrise/sunset during the midnight sun', () => {
    const times = getSunTimes(SVALBARD, new Date('2026-06-21T00:00:00'));
    expect(times.sunrise).toBeNull();
    expect(times.sunset).toBeNull();
  });
});

describe('getNextLocalSolarEclipse', () => {
  it('finds the 2024-04-08 total eclipse over Dallas', () => {
    const eclipse = getNextLocalSolarEclipse(DALLAS, new Date('2024-01-01T00:00:00Z'));

    expect(eclipse.kind).toBe('total');
    expect(eclipse.obscuration).toBeCloseTo(1, 5);
    expect(eclipse.peak.time.toISOString().slice(0, 10)).toBe('2024-04-08');

    // Contact order: partial begin < total begin < peak < total end < partial end.
    expect(eclipse.partialBegin.time.getTime()).toBeLessThan(eclipse.totalBegin!.time.getTime());
    expect(eclipse.totalBegin!.time.getTime()).toBeLessThan(eclipse.peak.time.getTime());
    expect(eclipse.peak.time.getTime()).toBeLessThan(eclipse.totalEnd!.time.getTime());
    expect(eclipse.totalEnd!.time.getTime()).toBeLessThan(eclipse.partialEnd.time.getTime());

    // The Sun was well above the horizon in Dallas during totality.
    expect(eclipse.peak.sunAltitude).toBeGreaterThan(50);
  });

  it('reports no total/annular phase for a purely partial eclipse', () => {
    // Amsterdam saw only a partial phase of the 2025-03-29 eclipse.
    const eclipse = getNextLocalSolarEclipse(AMSTERDAM, new Date('2025-01-01T00:00:00Z'));
    expect(eclipse.kind).toBe('partial');
    expect(eclipse.totalBegin).toBeNull();
    expect(eclipse.totalEnd).toBeNull();
    expect(eclipse.obscuration).toBeGreaterThan(0);
    expect(eclipse.obscuration).toBeLessThan(1);
  });
});

describe('getPastAndNextLocalSolarEclipse', () => {
  it('finds the Dallas total eclipse as "past" when searching from just after it', () => {
    const { past, next } = getPastAndNextLocalSolarEclipse(DALLAS, new Date('2024-06-01T00:00:00Z'));

    expect(past).not.toBeNull();
    expect(past!.kind).toBe('total');
    expect(past!.peak.time.toISOString().slice(0, 10)).toBe('2024-04-08');

    expect(next.peak.time.getTime()).toBeGreaterThan(new Date('2024-06-01T00:00:00Z').getTime());
  });

  it('returns null past eclipse when the search window does not reach back before the reference date', () => {
    // yearsBack=0 starts the search exactly at referenceDate, so nothing before it can be found.
    const { past } = getPastAndNextLocalSolarEclipse(DALLAS, new Date('2024-01-01T00:00:00Z'), 0);
    expect(past).toBeNull();
  });
});

describe('getSunPathForDay', () => {
  it('samples a full day and peaks in altitude near solar noon', () => {
    const date = new Date('2026-06-21T00:00:00');
    const path = getSunPathForDay(AMSTERDAM, date, 15);
    const times = getSunTimes(AMSTERDAM, date);

    expect(path.length).toBeGreaterThan(1);

    const peak = path.reduce((max, p) => (p.altitude > max.altitude ? p : max));
    const peakOffsetMs = Math.abs(peak.time.getTime() - times.solarNoon!.getTime());
    expect(peakOffsetMs).toBeLessThan(15 * 60 * 1000);
  });
});
