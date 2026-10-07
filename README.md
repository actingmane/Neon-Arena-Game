# Neon Clash Arena v12

The complete v12 project, organized as one repository for local development and Cloudflare deployment.

## Project layout
- `public/` — browser game files
- `server.js` — local Node/WebSocket server for testing on your PC
- `src/worker.js` — Cloudflare Worker + Durable Object multiplayer server
- `wrangler.jsonc` — Cloudflare configuration
- `package.json` — local and Cloudflare commands
- `START-GAME.bat` — quick local Windows launcher

## Run locally on Windows
1. Open PowerShell in this folder.
2. Run `npm start`.
3. Open `http://localhost:3000`.

Or double-click `START-GAME.bat`.

## Deploy to Cloudflare
This repository is structured so the same repo can be connected to Cloudflare Workers Builds.
- Build command: leave blank
- Deploy command: `npx wrangler deploy`
- Production branch: `main`

Cloudflare serves `public/` and routes `/ws` to the `ArenaHub` Durable Object defined in `src/worker.js`.
