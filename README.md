# hoyasim

Interactive 3D panoramic viewer with AR glasses overlay. Experience immersive scenes through simulated progressive lenses — on desktop with mouse/touch, or on mobile with real gyroscope head-tracking.

**[Live Demo](https://micheldegraaf.github.io/hoyasim/)**

## What It Does

- **360° panoramic scenes** — look around a biking scene with procedural scenery or an office environment
- **AR glasses simulation** — dual-lens overlay with realistic optical distortion, progressive lens effects, and lens swapping
- **Gyroscope support** — tilt your phone to look around naturally (iOS & Android)
- **Desktop controls** — click and drag or use touch to pan the camera
- **PWA** — install on your home screen for a fullscreen, app-like experience

## Prerequisites

- [Bun](https://bun.sh) (v1.3+) — this project uses Bun instead of npm/yarn

Install Bun if you don't have it:

```bash
curl -fsSL https://bun.sh/install | bash
```

## Getting Started

```bash
# Clone the repo
git clone https://github.com/micheldegraaf/hoyasim.git
cd hoyasim

# Install dependencies
bun install

# Start the dev server
bun run dev
```

Open http://localhost:5173 in your browser. Click **Get Started** to enter the biking scene.

## Testing on iPhone (Gyroscope)

The gyroscope API requires HTTPS. Use [ngrok](https://ngrok.com) to create a secure tunnel to your local dev server:

```bash
# Terminal 1
bun run dev

# Terminal 2
brew install ngrok    # one-time setup
ngrok http 5173
```

Open the ngrok HTTPS URL on your iPhone. Tap the gyroscope button in the scene to enable head-tracking (iOS will prompt for permission).

## Available Scripts

| Command | Description |
|---------|-------------|
| `bun run dev` | Start dev server on port 5173 |
| `bun run build` | Type-check and build for production |
| `bun run preview` | Preview the production build locally |
| `bun run test` | Run tests |
| `bun run test:watch` | Run tests in watch mode |
| `bun run type-check` | Type-check only (no build) |
| `bun run lint` | Check for issues with Biome |
| `bun run format` | Auto-format all files |
| `bun run check` | Check and auto-fix issues |

## Project Structure

```
src/
├── pages/             # Home (landing) and Scene (3D viewer) pages
├── components/        # ThreeView, GlassesControls, LandscapeGuard, UI primitives
├── hooks/             # React hooks for Three.js scene, controls, rendering, assets
├── config/scenes.ts   # Scene definitions (panorama image, 3D models, effects)
├── lib/
│   ├── glasses.ts     # AR glasses rendering — lenses, distortion, frame geometry
│   ├── blocks.ts      # Procedural scenery (houses, trees, windmills, etc.)
│   ├── loaders.ts     # GLTF and texture loaders
│   └── debug.ts       # Debug overlay (toggle with Ctrl+D)
└── test/              # Test setup
```

## Regenerating the Splat LOD Bundle

The Gaussian splat is served as a streamed LOD bundle (`public/playcanvas/assets/splat/`). Each visible chunk picks an LOD level at runtime based on screen-space size and the per-frame splat budget — on desktop the engine can pick any tier; on mobile the floor is LOD 1 (50% density) with a 750K splat budget.

The bundle is generated from the source `.ply` with [`@playcanvas/splat-transform`](https://github.com/playcanvas/splat-transform). Re-run it whenever you have a newer capture:

```bash
PLY="/path/to/new_splat.ply"
OUT="public/playcanvas/assets/splat"

rm -rf "$OUT"
mkdir -p "$OUT"

bunx @playcanvas/splat-transform -w \
  "$PLY" -l 0 \
  "$PLY" --decimate 50%  -l 1 \
  "$PLY" --decimate 25%  -l 2 \
  "$PLY" --decimate 12.5% -l 3 \
  "$OUT/lod-meta.json"
```

This produces `lod-meta.json` plus per-chunk subdirectories (`0_0/`, `1_0/`, etc.) — keep the existing chunk-folder naming, it's referenced from inside the manifest. Decimation runs on each input independently, so this takes ~3–5 minutes on a 2.8M-gaussian splat.

After regenerating, update the manifest's size and hash in `public/playcanvas/config.json` under asset `287139133` so PlayCanvas's cache-buster picks up the new bundle:

```bash
echo "size:" && stat -f "%z" public/playcanvas/assets/splat/lod-meta.json
echo "hash:" && md5 -q  public/playcanvas/assets/splat/lod-meta.json
```

Then edit the `file: { size, hash }` fields for `287139133` in `config.json` to match. The `url` (`assets/splat/lod-meta.json`) stays the same.

If you need different LOD counts or sizes, tune the `-l N` levels and `--decimate` percentages above — runtime LOD selection (`splatBudget`, `lodRangeMin`, `lodBaseDistance`, `lodMultiplier`) lives in `src/lib/playcanvasApp.ts`.

## Tech Stack

React 19, Three.js, TypeScript, Vite, Tailwind CSS 4, Biome, Vitest

## Deployment

Pushes to `master` automatically deploy to GitHub Pages via the included GitHub Actions workflow.
