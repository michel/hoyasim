# hoyasim

```bash
npm install
npm run dev
```

## Linting & Formatting

This project uses [Biome](https://biomejs.dev/) for linting and formatting.

```bash
npm run lint              # Check for issues
npm run format            # Format all files
npm run check             # Check and auto-fix issues
npm run format-and-check  # Format then check and fix
```

## iPhone Development (Gyroscope)

To test gyroscope features on iPhone, you need HTTPS. Use ngrok to create a secure tunnel.

Install ngrok:

```bash
brew install ngrok        # macOS
```

Start the tunnel:

```bash
npm run dev              # Start dev server (default port 5173)
ngrok http 5173          # In another terminal
```

Open the ngrok HTTPS URL on your iPhone. The gyroscope API requires a secure context to work.
