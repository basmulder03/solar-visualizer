# Solar Visualizer

A small, open-source web app that renders the Sun's and Moon's position in
the sky from any location on Earth, at any time — including sunrise/sunset,
twilight bands, and solar eclipses.

**Live demo:** https://basmulder03.github.io/solar-visualizer/

## Status

This project is being built in phases:

- [x] **Phase 1** — Sky-path overview: polar plot of the Sun's path for a
      given day, sunrise/sunset/solar noon times
- [x] **Phase 2** — Moon path, time slider, play/pause animation
- [x] **Phase 3** — Immersive horizon view with sky tinting
- [x] **Phase 4** — Solar eclipse search and eclipse timeline scrubber

## Stack

- [Vite](https://vite.dev/) + vanilla TypeScript (no framework)
- [astronomy-engine](https://github.com/cosinekitty/astronomy) for all
  Sun/Moon position, rise/set, twilight, and eclipse calculations — this
  project does not hand-roll any astronomical math
- Plain HTML5 Canvas for rendering
- [d3-geo](https://github.com/d3/d3-geo) + [topojson-client](https://github.com/topojson/topojson-client)
  render the location-picker globe from [world-atlas](https://github.com/topojson/world-atlas)'s
  bundled (public-domain, Natural Earth) coastline/country data, plus two
  self-simplified layers derived from Natural Earth's 50m data (finer
  coastlines/country borders, and province/state borders for a handful of
  large federated countries) that lazy-load once the user zooms in — no map
  tiles, no image assets, no network requests, no API keys
- No backend, no API keys — fully static, deployed to GitHub Pages

## Local development

```bash
npm install
npm run dev      # start the dev server
npm run test     # run unit tests for the astronomy data layer
npm run build    # type-check and produce a production build in dist/
```

## Project structure

- `src/astronomy.ts` — wraps astronomy-engine to expose Sun/Moon altitude,
  azimuth, angular radius, rise/set/twilight times, and local solar eclipse
  search. Kept isolated from rendering code so the math can be unit tested
  independently of canvas drawing (`src/astronomy.test.ts`).
- `src/polarPlot.ts` — canvas renderer for the polar sky-path plot.
- `src/horizonView.ts` — canvas renderer for the immersive horizon view
  (compass heading/FOV window, sky tinting by Sun altitude, body discs,
  eclipse close-ups centered on the Sun's altitude).
- `src/timeline.ts` — play/pause/speed/scrub state for the day's time slider,
  shared by both views.
- `src/viewportInteraction.ts` — unifies mouse drag/wheel and touch drag/pinch
  into pan/zoom/tap/double-tap callbacks via the Pointer Events API; shared by
  the polar view, horizon view, and globe picker.
- `src/globePicker.ts` — lazy-loaded location picker: an orthographic
  ("spinning globe") projection on a 2D canvas, click/tap to set the
  latitude/longitude. Country borders, province/state borders, and country
  capitals render in as the user zooms in, backed by `src/data/`.
- `src/data/` — self-built topojson/JSON assets not published as npm
  packages: simplified world coastlines/country borders, province/state
  borders (Natural Earth admin-1, 50m), and country capitals (Natural Earth
  populated places), all derived from public-domain Natural Earth data.
- `src/main.ts` — DOM wiring: inputs, geolocation, view toggle, redraw loop.

## Deployment

Pushes to `main` are built and deployed to GitHub Pages automatically via
`.github/workflows/deploy.yml`. Enable GitHub Pages for this repository
with the source set to "GitHub Actions" for the workflow to publish.

> **Note:** `vite.config.ts` sets `base: '/solar-visualizer/'`, assuming
> the GitHub repository is named `solar-visualizer`. Update this if the
> repo is renamed.

## Credits

Astronomical calculations powered by
[astronomy-engine](https://github.com/cosinekitty/astronomy) by Don Cross.
Globe coastline, country, province/state, and capital data from
[Natural Earth](https://www.naturalearthdata.com/) (public domain), via
[world-atlas](https://github.com/topojson/world-atlas) and, for the layers
world-atlas doesn't publish, re-simplified in this repo from Natural Earth's
own data files.

## License

[MIT](./LICENSE)
