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
- [ ] M2 - player controller, camera, collision, level 1 playable
- [ ] M3 - deliveries, HUD, pickups, checkpoints, levels 1-4, autopilot test bot
- [ ] M4 - drones, boss chase, level 5
- [ ] M5 - touch + gamepad, adaptive quality, juice pass, README

## Known issues
- Menu buttons other than Settings/How to play do nothing yet (M2).
