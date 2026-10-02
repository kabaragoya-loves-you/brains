# Brains! by Kabaragoya

A visualizer for the [Neurosity Crown](https://neurosity.co). Sign in with your Neurosity account, stream live EEG metrics, and switch between timeline plots and GPU visualization modes. Demo mode works without a headset.

Licensed under the [MIT License](./LICENSE).

## Features

- Email/password login (no OAuth developer key required for your own Crown)
- Live raw EEG, power-by-band, PSD, focus/calm, signal quality, and accelerometer
- Timeline charts plus Head, Fireflies, Rings, Attractors, Storm, Aurora, Crystal, and Weather modes
- Optional audio sonification and a synthetic Demo feeder
- Desert world mode with a time-of-day scrubber
- Desktop stay-signed-in via OS credential encryption; web stay-signed-in via browser `localStorage`

## Requirements

- Node.js 20+
- Windows 10/11 for the desktop build
- A Neurosity account and Crown (or use Demo mode)

## Desktop (Electron)

```bash
npm install
npm start
```

### Windows x64 executable

```bash
npm run dist:win
```

`npm run build:web` also rebuilds the Windows exe on a local Windows machine (skipped automatically on Cloudflare Pages / CI).

Output lands in `dist/desktop/`:

- `Brains! Setup *.exe` — NSIS installer
- `Brains! *.exe` — portable executable

## Web (Cloudflare)

Build a static single-page app:

```bash
npm run build:web
```

Artifacts are written to `dist/web/`. Use `npm run build:web:only` if you want the site without packaging the exe.

### Cloudflare Workers Builds settings

This repo deploys as a **Worker with static assets** (`wrangler.toml` `[assets]`), not via `wrangler pages deploy`. The auto-created Builds token has Workers permissions, not Pages.

| Setting | Value |
| --- | --- |
| Build command | `npm run build:web` |
| Deploy command | `npx wrangler deploy` |
| Root directory | leave empty (repo root — **not** `dist/web`) |
| API token | Create/select from **Settings → Builds → API token** (not Profile rename) |

Do **not** add a custom `CLOUDFLARE_API_TOKEN` build secret unless you know you need it — it overrides the Builds token and often causes auth `10000` on deploy.

Assets directory is `./dist/web` in `wrangler.toml`. Cloudflare sets `CF_PAGES`/`CI` so Windows exe packaging is skipped in CI.
## Scripts

| Script | Purpose |
| --- | --- |
| `npm start` | Build Electron main + renderer and launch the app |
| `npm run build` | Compile Electron main and renderer |
| `npm run build:web` | Build the web app and (locally on Windows) the x64 exe |
| `npm run build:web:only` | Build only the Cloudflare Pages static site |
| `npm run dist:win` | Build web + Electron and package the Windows installer/portable exe |

## Notes

- Put the Crown on your head, out of sleep mode, and not charging for live EEG.
- Sand textures are Poly Haven `sand_01` (CC0); see `assets/textures/sand/ATTRIBUTION.txt`.
- App icon: `assets/kabaragoya.png`.
