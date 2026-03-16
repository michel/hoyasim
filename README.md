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

## Tech Stack

React 19, Three.js, TypeScript, Vite, Tailwind CSS 4, Biome, Vitest

## Deployment

Pushes to `master` automatically deploy to GitHub Pages via the included GitHub Actions workflow.
