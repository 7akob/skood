<div align="center">

# Skood

**Watch YouTube together in perfectly synced rooms — wearing its best 2008 outfit.**

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node >= 18](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](package.json)
[![CI](https://github.com/7akob/skood-2-g/actions/workflows/ci.yml/badge.svg)](https://github.com/7akob/skood-2-g/actions/workflows/ci.yml)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

<img src="docs/screenshots/room-yt2008.png" alt="A Skood room in the Classic 2008 theme: synced player, shared queue, favorites and chat" width="760">

### ▶ Try it now at [skood.jkb.app](https://skood.jkb.app)

*No account, no install — create a room and share the link.*
*(Community instance on a small box; if it's ever busy, self-hosting is two commands.)*

</div>

## Why Skood

Skood exists because watching a video together shouldn't require an account, a subscription nag, or a page fighting your ad blocker. Every watch-together site we tried was some mix of paywalled features, layered ads and trackers, and mysterious "this content is unavailable" walls — so we built the opposite and have used it for movie nights over Discord for about a year, first as a single shared session, now with rooms so any group can use it at once. It also does great projected on a wall at parties.

The opposite, concretely:

- **No ads and no trackers of its own** — nothing breaks if you run an ad blocker, because there's nothing to block. Whatever YouTube does inside its own player is untouched.
- **No accounts** — pick a name, you're in.
- **No database** — rooms live in the server's memory and evaporate when the last person leaves. There is nothing to breach, sell, or subpoena.
- **No lock-in** — MIT-licensed, ~250-line server, self-hostable in two commands. It stays free.

*Skood is from Swedish **skåda** — to watch.*

## Features

- **Synced playback** — play, pause, and seek follow everyone in the room. The server keeps the authoritative position, so late joiners land exactly where the room is, not at 0:00.
- **Shareable rooms** — six-character room codes and `?room=CODE` deep links with one-click copy.
- **Shared queue** — thumbnails, titles, and *added by* attribution; play-now, skip, clear, and auto-advance when a video ends.
- **Loop toggle** — shared room state, replays the current video for everyone.
- **Favorites with play counts** — star videos for yourself (stored in your browser, not the room) and see how many times you've watched them.
- **Presence & chat** — live list of who's in the room, join/leave/rename notices, and an ephemeral room chat.
- **PWA + media keys** — installable, and your lock-screen/keyboard media controls drive the shared room state.
- **Three themes** — see below. Your pick is remembered per browser.

## Themes

| Classic 2008 *(default)* | Neon 90s | Midnight |
| :---: | :---: | :---: |
| ![The Classic 2008 theme](docs/screenshots/room-yt2008.png) | ![The Neon 90s theme](docs/screenshots/room-neon90s.png) | ![The Midnight theme](docs/screenshots/room-midnight.png) |

Switch anytime with the theme selector in the lobby or the room. Themes are CSS custom properties on top of the same markup — adding your own is [a small, well-marked diff](CONTRIBUTING.md), and [the theme gallery issue](https://github.com/7akob/skood-2-g/issues/2) even has a ready-designed light theme waiting for a first contributor.

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

## Privacy

The claim "no tracking" is verifiable — the code is one sitting long. The full inventory:

- **What the server holds:** the live room object only — room code, current video ID and position, the queue, and the names people typed. In memory, never written to disk, deleted the moment the last person leaves.
- **What your browser stores:** your username, favorites, and theme choice, in `localStorage`. Clear site data and they're gone.
- **What's counted:** the lobby shows how many rooms are open right now. That's the server reporting the size of its own in-memory list — an aggregate number with no names, no history, and no storage behind it.
- **What doesn't exist:** cookies, analytics, fingerprinting, logs of what anyone watched.

## FAQ

**Will YouTube block this?**
Unlikely — Skood is a plain, by-the-book embed. It uses the official YouTube IFrame Player API, and every viewer streams directly from YouTube in their own player: views count, region rules apply, and YouTube's own embed behavior is untouched. Nothing is proxied, downloaded, or stripped, so there's nothing to crack down on.

**Why do some videos refuse to play ("not allowed on other sites")?**
The uploader or their label disabled embedding for that video. It affects every embed on the web equally — Skood just tells you in chat instead of showing a silently dead player.

**Everyone drifted apart for a moment — why?**
If YouTube serves one viewer an ad inside the embed, that person's clock differs until it ends. A pause/play from anyone, or refocusing the tab, resyncs the room.

**Is it really free?**
Yes — free to use at [skood.jkb.app](https://skood.jkb.app), free to self-host, MIT-licensed. If you want to say thanks, see [Support](#support).

## Feedback & contributing

- 🐛 Something broke? [File a bug](https://github.com/7akob/skood-2-g/issues/new?template=bug_report.yml) — takes two minutes.
- 💡 Missing a feature? [Suggest it](https://github.com/7akob/skood-2-g/issues/new?template=feature_request.yml).
- 🎨 Want to add a theme? [The theme gallery](https://github.com/7akob/skood-2-g/issues/2) walks you through it (a designed-but-unbuilt light theme is up for grabs).
- 🧑‍💻 Want to hack on it? Start with [CONTRIBUTING.md](CONTRIBUTING.md) and the [`help wanted`](https://github.com/7akob/skood-2-g/issues?q=is%3Aissue+is%3Aopen+label%3A%22help+wanted%22) / [`good first issue`](https://github.com/7akob/skood-2-g/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22) labels.

The one rule: it stays vanilla — no frameworks, no build step, no database, no API keys.

## License

[MIT](LICENSE) © [Jakob (7akob)](https://github.com/7akob)

## Support

Skood is free and always will be. If it made your movie night better:

- ⭐ star the repo — it genuinely helps people find it
- ☕ [buy me a coffee](https://buymeacoffee.com/7akob)
- 👋 check out my other projects at [github.com/7akob](https://github.com/7akob)
