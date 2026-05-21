# hoyasim

Interactive 3D scene viewer with AR glasses overlay. Experience an immersive Gaussian-splat environment through simulated progressive lenses — on desktop with mouse/touch, or on mobile with real gyroscope head-tracking.

**[Live Demo](https://micheldegraaf.github.io/hoyasim/)**

## What It Does

- **Photoreal 3D environment** — explore a captured scene rendered as a streamed Gaussian splat with runtime level-of-detail
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

Open http://localhost:5173 in your browser. Click **Get Started** to enter the scene.

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
├── pages/                  # Home (landing) and Scene (3D viewer) pages
├── components/             # PlayCanvasView, LandscapeGuard, ErrorBoundary, UI primitives
├── hooks/                  # useDeviceOrientation (gyroscope), usePointerControls
├── lib/
│   ├── playcanvasApp.ts    # PlayCanvas bootstrap — scene, gsplat LOD tuning, render loop
│   ├── glasses-pc.ts       # AR glasses rendering — lenses, distortion, frame geometry
│   ├── scripts/            # PlayCanvas scripts (cycleForward, lookCamera, sun)
│   └── utils.ts            # Shared helpers
└── assets/                 # Logo and static assets
```

The 3D environment itself (Gaussian splat + PlayCanvas config) lives under `public/playcanvas/`.

## The Gaussian Splat Environment

The photoreal scene is a [Gaussian splat](https://repo-sam.inria.fr/fungraph/3d-gaussian-splatting/) (~2.8M gaussians) served as a **streamed LOD bundle** at `public/playcanvas/assets/splat/`. Instead of one monolithic file, the splat is split into a spatial octree of small chunks, each available at four detail tiers. At runtime PlayCanvas streams in only the chunks the camera can see and picks an LOD level per chunk from its screen-space size and the per-frame splat budget — so the iPhone never tries to draw all 2.8M gaussians at once.

The bundle is two things on disk:

- `lod-meta.json` — the manifest: the octree bounds tree, LOD count, and the list of chunk meta files. This is the file PlayCanvas loads (registered as asset `287139133` in `config.json`).
- Per-chunk subdirectories (`0_0/`, `1_0/`, `2_3/` …) — the actual gaussian data as WebP tiles. The folder name encodes `<lodLevel>_<chunkIndex>`; the manifest references them by relative path, so **keep this naming intact**.

### Regenerating from a new capture

You need the source `.ply` capture and [`@playcanvas/splat-transform`](https://github.com/playcanvas/splat-transform) (run via `bunx`, no install needed). The current bundle was built from a ~2.8M-gaussian, 0-SH-band compressed PLY (~150 MB).

```bash
PLY="/path/to/new_splat.ply"
OUT="public/playcanvas/assets/splat"

rm -rf "$OUT"
mkdir -p "$OUT"

bunx @playcanvas/splat-transform -w \
  "$PLY" -l 0 \
  "$PLY" --decimate 50%   -l 1 \
  "$PLY" --decimate 25%   -l 2 \
  "$PLY" --decimate 12.5% -l 3 \
  -C 128 \
  "$OUT/lod-meta.json"
```

Expect ~3–4 minutes and ~3 GB peak RAM on a 2.8M-gaussian splat. The current bundle is 41 chunks (21 at LOD 0, 11 at LOD 1, 6 at LOD 2, 3 at LOD 3), ~67 MB total.

**What each flag does — this is how you "create the LOD":**

| Flag | Meaning |
|------|---------|
| `-w` | Overwrite the output directory if it exists. |
| `"$PLY" -l N` | Add the file as **LOD level N**. Repeat the input once per tier. `-l 0` is full resolution; higher numbers are coarser. |
| `--decimate 50%` | Progressive pairwise-merge the *preceding* input down to N% (or an absolute count) of its gaussians. Best quality-per-splat reduction. Applied per input, so each tier is decimated independently. LOD 0 has no `--decimate` (full quality). |
| `-C 128` | **LOD chunk size ≈ 128K gaussians per chunk** (`--lod-chunk-count`, in thousands; default 512). Smaller chunks = more files, but each streamed upload is ~4× cheaper, which spreads the per-frame upload spike (e.g. when the camera loops past new geometry) across more frames. **Required** to reproduce the shipped 41-chunk layout — omitting it gives a coarser 12-chunk/512K bundle. |

To trade quality for size, change the `--decimate` percentages or the number of `-l` tiers. To trade file count for smoother streaming, tune `-C`.

#### Optional: clean the capture first

Raw captures often have low-opacity haze and floating "wisp" gaussians that cost GPU sort time for no visual gain. You can prune them before building the LOD bundle (run on the `.ply`, write a cleaned `.ply`, then feed *that* to the command above):

```bash
bunx @playcanvas/splat-transform "$PLY" \
  -V opacity,gt,0.05 \
  -G \
  "$PLY".clean.ply
```

- `-V opacity,gt,0.05` — keep only gaussians with linear opacity > 0.05 (use `opacity_raw` for pre-sigmoid PLY values). Above ~0.1 starts eating soft edges.
- `-G` — drop "floaters" that don't contribute to any solid voxel.

This was used in earlier single-file experiments; the shipped LOD bundle currently feeds the raw PLY directly, so treat cleaning as opt-in.

### After regenerating: the `config.json` entry

PlayCanvas loads the bundle via asset `287139133` in `public/playcanvas/config.json`, whose `file.url` is `assets/splat/lod-meta.json`. The `url` never changes.

`config.json` also carries `file.size` and `file.hash` for that asset. These act as a **cache-busting hint, not an integrity check** — PlayCanvas does not validate the file against them and will load a bundle whose size/hash don't match (the shipped repo currently does exactly this). Updating them is only useful to force browsers / the service worker to refetch a changed bundle. If you want that, set them to the new values:

```bash
stat -f "%z" public/playcanvas/assets/splat/lod-meta.json   # -> file.size
md5 -q       public/playcanvas/assets/splat/lod-meta.json   # -> file.hash
```

Then edit `file.size` and `file.hash` for `287139133` in `config.json`. If you're seeing a stale splat in the browser, hard-reload / clear the service worker rather than relying on this.

### Runtime LOD tuning

How aggressively the engine streams and coarsens lives in `src/lib/playcanvasApp.ts` (search `app.scene.gsplat`). Current values:

| Setting | Desktop | Touch | iOS |
|---------|---------|-------|-----|
| `splatBudget` (max gaussians/frame) | 4,000,000 | 500,000 | 200,000 |
| `lodRangeMin` / `lodRangeMax` | default | min 2 | pinned to 3 (single tier) |
| `lodBaseDistance` | 1 | 0.5 | 0.5 |
| `lodMultiplier` | 1.5 | 2 | 2 |

Shared (all platforms): `lodUnderfillLimit = 2` (draw a coarser cached tier while the target streams in), `cooldownTicks = 120` (~2s before evicting off-screen chunks), `lodBehindPenalty = 3`, `lodUpdateDistance = 3` (re-evaluate LOD every 3 m of camera motion), `radialSorting = true`, `highQualitySH = false`.

iOS is deliberately pinned to a single LOD: Metal's WebGL texture allocator doesn't promptly reclaim freed chunks, so repeated load/evict cycles compound into FPS drift. Pinning uploads the same 3 chunk files once and never churns them.

## Tech Stack

React 19, PlayCanvas (WebGPU/WebGL2, Gaussian splatting), TypeScript, Vite, Tailwind CSS 4, Biome, Vitest

## Deployment

Pushes to `master` automatically deploy to GitHub Pages via the included GitHub Actions workflow.
