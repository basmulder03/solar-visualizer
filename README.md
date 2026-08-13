# Solar Visualizer

A small, open-source web app that renders the Sun's and Moon's position in
the sky from any location on Earth, at any time — including sunrise/sunset,
twilight bands, and solar eclipses.

**Live demo:** _TODO: add the GitHub Pages URL once deployed_

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

## License

[MIT](./LICENSE)
