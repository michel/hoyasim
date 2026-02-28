# hoyasim

Interactive 3D panoramic viewer with AR glasses overlay. Supports gyroscope controls on mobile and pointer/touch interaction on desktop.

## Getting Started

```bash
bun install
bun run dev
```

## Scripts

```bash
bun run dev              # Start dev server
bun run build            # Type-check and build for production
bun run preview          # Preview production build
bun run test             # Run tests
bun run test:watch       # Run tests in watch mode
bun run type-check       # Type-check with tsgo
bun run lint             # Check for issues (Biome)
bun run format           # Format all files
bun run check            # Check and auto-fix issues
bun run format-and-check # Format then check and fix
```

## iPhone Development (Gyroscope)

To test gyroscope features on iPhone, you need HTTPS. Use ngrok to create a secure tunnel.

```bash
brew install ngrok        # macOS
bun run dev               # Start dev server (default port 5173)
ngrok http 5173           # In another terminal
```

Open the ngrok HTTPS URL on your iPhone. The gyroscope API requires a secure context to work.
