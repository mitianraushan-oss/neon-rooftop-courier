# Neon Rooftop Courier - dev notes

## Decisions
- **No build step.** Plain ES modules + an import map pointing at a vendored Three.js r180
  (`vendor/three`, minified core + only the post-processing addons used). Works from any
  static server and on GitHub Pages; nothing is fetched from a CDN.
- **Levels are data.** `js/levels.js` holds numbers and a seed; `js/route.js` turns that into
  rooftops, links (jump / wallrun / launch pad / grapple), barriers, pickups and drones.
  Gap sizes are derived from the player's movement constants so every route is completable.
- **Collision** is AABB-only with a uniform grid (`Grid` in `js/world.js`). No physics engine.
- **Rendering**: one `InstancedMesh` for every building with a shader patch on
  `MeshStandardMaterial` (procedural windows, roof trims, puddles with rain ripples). Wet
  reflections come from a per-level PMREM environment map baked from the procedural sky.
  Bloom via `UnrealBloomPass`; quality tiers in `js/gfx.js` with an adaptive "Auto" mode.
- **Audio** is 100% WebAudio synthesis (`js/audio.js`): step sequencer with intensity layers
  plus all SFX. No audio or image files are shipped; sign textures are drawn to canvas at runtime.
- **Time is health.** Falls and drone hits cost seconds instead of lives.

## Progress
- [x] M1 - title screen over a live city (sky, rain, bloom, menus, settings, save data)
- [x] M2 - player controller (coyote, buffer, slide, wall-run, grapple, mantle), camera, collision
- [x] M3 - deliveries, HUD, minimap, pickups, checkpoints, 5 levels, autopilot bot + Playwright test
- [x] M4 - patrol + sniper drones, WARDEN-9 boss chase
- [x] M5 - touch + gamepad, adaptive quality, juice pass (hit-stop, shake, rings, trail, speed lines, count-up tallies), README

## Testing
- `node tools/test.mjs` drives headless Chromium: menus on desktop / mobile landscape /
  mobile portrait, then every level is played to completion by `js/bot.js`, which feeds the
  same input struct as a human. `?level=N&bot=1` lets you watch it. `?test=1` hands the
  simulation clock to the test (`__game.simulate(seconds)`).
- Bugs the bot found and that were fixed: wall-run only attached on a hard collision (now
  proximity based, billboards only); billboard walls could sit across the arrival lane (walls
  now always run parallel to the way you arrive); special links chained back to back.

## Balance
- Time budgets are roughly 2x the autopilot's clear time per delivery leg (the bot plays a
  near-perfect line). Level 1 is the most lenient.
- Combo multiplier: +0.5 per 8 chained events, capped at x4, resets after 4.5 s idle or any hit.

## Known issues / not done
- Tested only in headless Chromium (desktop + emulated phone viewports, 60 fps on Apple
  silicon at High). Not hand-tested on a physical phone, Safari, Firefox or a real gamepad.
- The game has not been played by a human hand in this session - feel and difficulty are
  tuned from the bot and from reasoning about the movement constants, so expect to want tweaks.
- Drones and the boss fly through geometry (no collision for enemies).
- Wall-run works on the neon billboards only, not on arbitrary building sides.
- CJK neon signs depend on the device having a Japanese font; otherwise they show boxes.
- No remote was configured in this repo, so commits are local only (see README for Pages).
