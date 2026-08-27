# Contributing to Skood

Thanks for wanting to help! Skood is intentionally tiny, and keeping it that
way is a feature.

## Running it locally

```bash
npm install
npm start
```

Open http://localhost:3000. There is no build step and no watch mode — edit a
file in `public/`, refresh the browser, done. If the service worker serves you
a stale file during development, enable "Update on reload" in your browser's
DevTools (Application → Service workers) or hard-refresh.

## Testing sync

Everything interesting in Skood is multiplayer, so test with two browser
windows (one of them private/incognito, so each window gets its own
username):

1. Create a room in window A, copy the room link, open it in window B.
2. Load a video, play/pause/seek in one window, watch the other follow.
3. Add to the queue, skip, toggle loop, chat — every action should appear in
   both windows.

`npm test` runs a syntax check over the server and client scripts.

## Ground rules

- **Keep it vanilla.** No frameworks, no bundlers, no build step, no
  database. The entire point of Skood is that it's a handful of files a
  free-tier VPS can run.
- **Keep it keyless.** The YouTube IFrame API, oEmbed title lookup, and
  thumbnails all work without API keys. Don't introduce features that need
  credentials.
- **Themes:** all colors live as CSS custom properties at the top of
  `public/style.css`. `:root` holds the default `yt2008` values; every other
  theme is one `html[data-theme="NAME"]` token block up top plus (if it
  reshapes anything) a structural override section above the mobile media
  query — see `neon90s` and `midnight` for the two patterns. Rules: theme
  blocks change *look* only, never layout properties the mobile media query
  touches; if you change a base structural rule, mirror it in **every**
  theme's structural section. Adding a theme means: token block, structural
  mirrors, an `<option>` in both `.theme-select`s in `index.html`, entries in
  `THEMES` and `THEME_COLORS` in `script.js`, the head snippet's `VALID` list
  in `index.html`, a service-worker cache-name bump in `sw.js`, and a
  screenshot for the README table. (`manifest.json` intentionally stays on
  the default theme's colors — it's a static file.)
- Small, focused pull requests are easiest to review. For a bigger idea, open
  an issue first so we can talk about it.
