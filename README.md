<div align="center">

# Skood

**Watch YouTube together in perfectly synced rooms — wearing its best 2008 outfit.**

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node >= 18](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](package.json)
[![CI](https://github.com/7akob/skood-2-g/actions/workflows/ci.yml/badge.svg)](https://github.com/7akob/skood-2-g/actions/workflows/ci.yml)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

<img src="docs/screenshots/room-yt2008.png" alt="A Skood room in the Classic 2008 theme: synced player, shared queue, favorites and chat" width="760">

*Skood (from Swedish **skåda** — to watch) is a deliberately tiny watch-together app:*
*no build step, no database, no API keys, no accounts. Clone it, start it, share a room link.*

</div>

## Features

- **Synced playback** — play, pause, and seek follow everyone in the room. The server keeps the authoritative position, so late joiners land exactly where the room is, not at 0:00.
- **Shareable rooms** — six-character room codes and `?room=CODE` deep links with one-click copy. No sign-up, pick a name and you're in.
- **Shared queue** — thumbnails, titles, and *added by* attribution; play-now, skip, clear, and auto-advance when a video ends.
- **Loop toggle** — shared room state, replays the current video for everyone.
- **Favorites with play counts** — star videos for yourself (stored in your browser, not the room) and see how many times you've watched them.
- **Presence & chat** — live list of who's in the room, join/leave/rename notices, and an ephemeral room chat.
- **PWA + media keys** — installable, and your lock-screen/keyboard media controls drive the shared room state.
- **Two themes** — see below. Your pick is remembered per browser.

## Themes

| Classic 2008 *(default)* | Neon 90s |
| :---: | :---: |
| ![The Classic 2008 theme](docs/screenshots/room-yt2008.png) | ![The Neon 90s theme](docs/screenshots/room-neon90s.png) |

Switch anytime with the theme selector in the lobby or the room. Both themes are pure CSS custom properties on top of the same markup — adding a third theme is [a small, well-marked diff](CONTRIBUTING.md).

## Quick start

```bash
git clone https://github.com/7akob/skood-2-g.git
cd skood-2-g
npm install
npm start
```

Open <http://localhost:3000>, create a room, and share the link. That's the whole setup — the YouTube IFrame player, title lookup, and thumbnails are all keyless public endpoints.

### Docker

```bash
docker compose up -d --build
```

The bundled `docker-compose.yml` binds to `127.0.0.1:3000` on purpose: it expects to sit behind a reverse proxy on your server. Change the port mapping if you want it exposed directly.

## Deploying

Two things matter when you put Skood behind a reverse proxy:

1. **WebSockets must be forwarded.** Skood uses the WebSocket transport only (no HTTP long-polling fallback), so a proxy that doesn't forward upgrade headers breaks it completely.
2. Rooms live in memory — a restart clears them, and there's nothing to back up. Run a single instance.

**Caddy** (handles WebSockets automatically):

```text
skood.example.com {
    reverse_proxy localhost:3000
}
```

**nginx:**

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
}
```

## How it works

The whole app is five files. An Express + Socket.IO server (`server.js`, ~260 lines) keeps a per-room state object — `{ videoId, time, isPlaying, loop }` plus the queue and presence — entirely in memory. Every play/pause/seek updates it and is broadcast to the room; when someone joins or reconnects, the server extrapolates the current position from the last update timestamp so they sync to where the room *actually is*. When the last person leaves, the room evaporates.

The client (`public/`) is vanilla HTML/CSS/JS driving the official YouTube IFrame player. No framework, no bundler, no transpiler — what's in the repo is what ships. Favorites and your username stay in `localStorage`; nothing about you is stored server-side.

Design goals, in order: cheap to run on a free tier, trivial to self-host, easy to read in one sitting.

## Contributing

Bug reports, small PRs, and new themes are very welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). The one rule: it stays vanilla (no frameworks, no build step, no database, no API keys).

## License

[MIT](LICENSE) © [Jakob (7akob)](https://github.com/7akob)

## Support

Skood is free and always will be. If it made your movie night better:

- ⭐ star the repo — it genuinely helps people find it
- ☕ *Buy Me a Coffee — coming soon*
- 👋 check out my other projects at [github.com/7akob](https://github.com/7akob)
