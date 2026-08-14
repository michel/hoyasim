# hoyasim

Interactive 3D scene viewer with AR glasses overlay. Experience an immersive Gaussian-splat environment through simulated progressive lenses — on desktop with mouse/touch, or on mobile with real gyroscope head-tracking.

**[Live Demo](https://re-invention.nl/hoyasim/)**

## What It Does

- **Photoreal 3D environment** — explore a captured scene rendered as a streamed Gaussian splat with runtime level-of-detail
- **AR glasses simulation** — dual-lens overlay with realistic optical distortion, progressive multifocal effect, and per-eye swapping between three lens designs (Balansis, MySelf Profile, MySense), each with its own peripheral soft-zone blur
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

| Command              | Description                          |
| -------------------- | ------------------------------------ |
| `bun run dev`        | Start dev server on port 5173        |
| `bun run build`      | Type-check and build for production  |
| `bun run preview`    | Preview the production build locally |
| `bun run test`       | Run tests                            |
| `bun run test:watch` | Run tests in watch mode              |
| `bun run type-check` | Type-check only (no build)           |
| `bun run lint`       | Check for issues with Biome          |
| `bun run format`     | Auto-format all files                |
| `bun run check`      | Check and auto-fix issues            |

## Project Structure

```
src/
├── pages/                  # Home (landing) and Scene (3D viewer) pages
├── components/             # PlayCanvasView, LandscapeGuard, ErrorBoundary, UI primitives
├── hooks/                  # useDeviceOrientation (gyroscope), usePointerControls
├── lib/
│   ├── playcanvasApp.ts    # PlayCanvas bootstrap — scene, gsplat LOD tuning, render loop
│   ├── glasses-pc.ts       # AR glasses rendering — lenses, distortion, frame geometry
│   ├── scripts/            # PlayCanvas scripts (cycleForward, lookCamera)
│   └── utils.ts            # Shared helpers
└── assets/                 # Logo and static assets
```

The 3D environment itself (Gaussian splat + PlayCanvas config) lives under `public/playcanvas/`.

## The Gaussian Splat Environment

The photoreal scene is a [Gaussian splat](https://repo-sam.inria.fr/fungraph/3d-gaussian-splatting/) (~3.9M gaussians) served as a **streamed LOD bundle** at `public/playcanvas/assets/splat-v6/` (the directory name carries a version — see below). Instead of one monolithic file, the splat is split into a spatial octree of small chunks, each available at four detail tiers. At runtime PlayCanvas streams in only the chunks the camera can see and picks an LOD level per chunk from its screen-space size and the per-frame splat budget — so the iPhone never tries to draw all 3.9M gaussians at once.

The bundle is two things on disk:

- `lod-meta.json` — the manifest: the octree bounds tree, LOD count, and the list of chunk meta files. This is the file PlayCanvas loads (registered as asset `287139133` in `config.json`).
- Per-chunk subdirectories (`0_0/`, `1_0/`, `2_3/` …) — the actual gaussian data as WebP tiles. The folder name encodes `<lodLevel>_<chunkIndex>`; the manifest references them by relative path, so **keep this naming intact**.

### Regenerating from a new capture

The whole pipeline is captured in one script — **`bun run build-splat`** (`scripts/build-splat.sh`). Point it at a source `.ply` and it rebuilds the shipped bundle in place:

```bash
bun run build-splat                      # uses the v03 capture from ~/Downloads/Aanlevermap by default
SRC=/path/to/new_capture.ply bun run build-splat
```

It runs [`@playcanvas/splat-transform`](https://github.com/playcanvas/splat-transform) (via `bunx`, no install) in **two passes**:

```bash
# PASS 1 — align the capture onto the scene's frame, then match the bundle's 0-SH format
bunx @playcanvas/splat-transform -w "$SRC" \
  -N \
  -r "$ALIGN_ROTATE" \
  -s "$ALIGN_SCALE" \
  -t "$ALIGN_TRANSLATE" \
  -H 0 \
  "$ALIGNED"

# PASS 2 — build the 4-tier LOD octree (this is what "creates the LOD").
# Since splat-transform 3.3.0 each decimation is its own invocation (must be the
# final action, writing a .ply); the last run assembles the tiers into the octree.
bunx @playcanvas/splat-transform -w "$ALIGNED" --decimate 50%   /tmp/splat_lod1.ply
bunx @playcanvas/splat-transform -w "$ALIGNED" --decimate 25%   /tmp/splat_lod2.ply
bunx @playcanvas/splat-transform -w "$ALIGNED" --decimate 12.5% /tmp/splat_lod3.ply
bunx @playcanvas/splat-transform -w \
  "$ALIGNED" -l 0 \
  /tmp/splat_lod1.ply -l 1 \
  /tmp/splat_lod2.ply -l 2 \
  /tmp/splat_lod3.ply -l 3 \
  --lod-chunk-count 128 \
  "public/playcanvas/assets/splat-v6/lod-meta.json"
```

Expect a few minutes and ~3 GB peak RAM on a multi-million-gaussian splat. The current bundle (from the 3.9M-gaussian `Omgeving - v03` cleaned render, cropped at the T-junction where its street ends — see `CROP_BOX` in the script) is 46 chunks (22 at LOD 0, 13 at LOD 1, 7 at LOD 2, 4 at LOD 3), ~80 MB total, 0 SH bands.

> **⚠️ Frame alignment (PASS 1) — re-derive this for every new capture.** The scene's
> placement of the splat (rotation/scale/loop tiling) is hand-tuned in
> `src/lib/playcanvasApp.ts` against the **existing** bundle's local coordinate
> frame. A fresh render almost never lands in that frame — it's typically a
> different scale, recentred, sometimes reoriented. PASS 1 transforms the capture
> so its solid geometry sits exactly on top of the current bundle (`-s` scale then
> `-t` translate realise `p' = scale·p + translate`; add `-r x,y,z` if a rotation
> is needed). Then `playcanvasApp.ts` needs no changes and the swap is drop-in.
> The `-s/-t` values above were **derived, not guessed** — run
> **`python3 scripts/derive-splat-align.py /path/to/new_capture.ply`**, which
> decodes the current bundle back to a point cloud and best-fits the similarity
> transform, then prints the `ALIGN_SCALE` / `ALIGN_TRANSLATE` (and an `-r` line if
> the rotation exceeds ~1°) to paste into `build-splat.sh`. `-H 0` strips spherical
> harmonics down to DC, matching the shipped 0-SH bundle (`highQualitySH` is off at
> runtime anyway). `-N` drops any NaN/Inf gaussians.
>
> **Ground re-seat — solve `-t` Y separately.** The derive best-fits the _whole_
> cloud, which seats X/Z but not the gravity axis: a new render's floater distribution
> pulls the global Y fit, so the dense **road plane** (what the bike and traffic light
> rest on) lands a few cm off even at overlap 1.000. Two gotchas: (1) the road must be
> seated, not the centroid; (2) splat-transform applies the `-t` **Y** with a sign flip
> (PLY→SOG Y convention — X/Z are unaffected), so `d(road world Y)/d(t_y) = −1` and the
> derive's `t_y` is _not_ the seat value. Solve it directly: run **PASS 1 only** at two
> `t_y` probes, decode and take the densest Y slab of `|x|<0.1, |z|<1` points, and pick
> the `t_y` that lands the road on the old plane (local **−0.00887**, world **−0.0443**).
> For the v03 capture that is **`t_y = +0.0503902`** (derive gave +0.0531902). Then the bike
> and traffic light need no re-seating in `playcanvasApp.ts` and the swap stays drop-in.
>
> **Loop length is coupled to the capture's RIDEABLE street span, not its content
> span.** Measure where the road actually ends on the riding line, crop the bundle
> to exactly that span (`CROP_BOX`), and set `LOOP_PERIOD`/`START_Z` in
> `playcanvasApp.ts` so the lap window covers it exactly — the wrap then lands on
> the identical spot in the next tile copy. The scene currently rides the v03
> capture's cross street (the whole scene is rotated 90° CCW via
> `SCENE_YAW`/`SCENE_PITCH`/`SCENE_SHIFT` in `build-splat.sh`): rideable span 5.04
> local units → `LOOP_PERIOD = 25.2`, `START_Z = 4.2`. Re-check the traffic-light Z
> stays inside the lap window.

**What each flag does — this is how you "create the LOD":**

| Flag             | Meaning                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `-w`             | Overwrite the output directory if it exists.                                                                                                                                                                                                                                                                                                                                                |
| `"$PLY" -l N`    | Add the file as **LOD level N**. Repeat the input once per tier. `-l 0` is full resolution; higher numbers are coarser.                                                                                                                                                                                                                                                                     |
| `--decimate 50%` | Progressive pairwise-merge the _preceding_ input down to N% (or an absolute count) of its gaussians. Best quality-per-splat reduction. Applied per input, so each tier is decimated independently. LOD 0 has no `--decimate` (full quality).                                                                                                                                                |
| `-C 128`         | **LOD chunk size ≈ 128K gaussians per chunk** (`--lod-chunk-count`, in thousands; default 512). Smaller chunks = more files, but each streamed upload is ~4× cheaper, which spreads the per-frame upload spike (e.g. when the camera loops past new geometry) across more frames. **Required** to reproduce the shipped 41-chunk layout — omitting it gives a coarser 12-chunk/512K bundle. |

To trade quality for size, change the `--decimate` percentages or the number of `-l` tiers. To trade file count for smoother streaming, tune `-C`.

#### Optional: clean the capture first

Raw captures often have low-opacity haze and floating "wisp" gaussians that cost GPU sort time for no visual gain. You can prune them before building the LOD bundle (run on the `.ply`, write a cleaned `.ply`, then feed _that_ to the command above):

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

PlayCanvas loads the bundle via asset `287139133` in `public/playcanvas/config.json`, whose `file.url` points at the bundle's `lod-meta.json`. **The bundle directory name carries a version (`splat-v6`, `splat-v6`, …): bump it whenever a rebuild changes geometry** and update the `url` to match. The per-chunk file URLs are identical between rebuilds, so without a fresh directory name browsers and CDNs keep serving stale chunk data — only `lod-meta.json` itself is cache-busted by the size/hash below.

`config.json` also carries `file.size` and `file.hash` for that asset. These act as a **cache-busting hint, not an integrity check** — PlayCanvas does not validate the file against them and will happily load a bundle whose size/hash don't match. Updating them forces browsers / the service worker to refetch a changed bundle, so keep them current (`build-splat` prints both values when it finishes):

```bash
stat -f "%z" public/playcanvas/assets/splat-v6/lod-meta.json   # -> file.size
md5 -q       public/playcanvas/assets/splat-v6/lod-meta.json   # -> file.hash
```

Then edit `file.size` and `file.hash` for `287139133` in `config.json`. If you're seeing a stale splat in the browser, hard-reload / clear the service worker rather than relying on this.

### Runtime LOD tuning

How aggressively the engine streams and coarsens lives in `src/lib/playcanvasApp.ts` (search `app.scene.gsplat`). Current values:

| Setting                             | Desktop   | Touch   | iOS                       |
| ----------------------------------- | --------- | ------- | ------------------------- |
| `splatBudget` (max gaussians/frame) | 4,000,000 | 500,000 | 200,000                   |
| `lodRangeMin` / `lodRangeMax`       | default   | min 2   | pinned to 3 (single tier) |
| `lodBaseDistance`                   | 1         | 0.5     | 0.5                       |
| `lodMultiplier`                     | 1.5       | 2       | 2                         |

Shared (all platforms): `lodUnderfillLimit = 2` (draw a coarser cached tier while the target streams in), `cooldownTicks = 120` (~2s before evicting off-screen chunks), `lodBehindPenalty = 3`, `lodUpdateDistance = 3` (re-evaluate LOD every 3 m of camera motion), `radialSorting = true`, `highQualitySH = false`.

iOS is deliberately pinned to a single LOD: Metal's WebGL texture allocator doesn't promptly reclaim freed chunks, so repeated load/evict cycles compound into FPS drift. Pinning uploads the same 3 chunk files once and never churns them.

## Tech Stack

React 19, PlayCanvas (WebGPU/WebGL2, Gaussian splatting), TypeScript, Vite, Tailwind CSS 4, Biome, Vitest

## Deployment

Pushes to `master` automatically deploy to GitHub Pages via the included GitHub Actions workflow.
