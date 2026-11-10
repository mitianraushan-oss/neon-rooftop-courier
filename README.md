# Neon Rooftop Courier

A third-person parkour delivery game across a rainy cyberpunk skyline. Run, jump, wall-run,
slide and grapple between rooftops to drop every package before the clock runs out - then
outrun WARDEN-9 at dawn.

Everything is procedural: the city, the courier, the particles, the sky, the neon signs and
the synthwave soundtrack are all generated in the browser. There are no image or audio
files, no build step and no network requests beyond the static files in this repo.

## Run it

Any static file server works (ES modules need `http://`, not `file://`):

```bash
node tools/serve.mjs          # http://127.0.0.1:8080
# or
python3 -m http.server 8080
```

For GitHub Pages: push the repo and enable Pages for the branch root. `index.html` at the
repo root loads everything with relative paths.

## Controls

| | Keyboard + mouse | Touch | Gamepad |
|---|---|---|---|
| Move | `W` `A` `S` `D` / arrows | left virtual stick | left stick |
| Look | mouse (click to capture) | drag right side | right stick |
| Jump / wall-kick | `Space` | JUMP | A |
| Slide | `Shift` (or `C`) | SLIDE | B / RT |
| Grapple | `E` or left click | HOOK | X / LT |
| Pause | `Esc` or `P` | pause button | Start |
| Restart level / mute music | `R` / `M` | | |

## How to play

- Follow the arrow to each green beacon and drop a package. Each drop adds time; the last
  (gold) beacon ends the level.
- **Time is your health.** Falls cost 3 s, drones 4-5 s, the boss more.
- Glowing billboards can be wall-run (jump along them; jump again to kick off). Striped
  ducts must be slid under. Yellow hover buoys can be grappled. Launch pads throw you
  across the big gaps.
- Shards and tricks build a combo multiplier (up to x4). Gold time cells give +5 s.
- A lucky cat is hidden on a side roof in every district.
- Five districts: First Shift, Wall Street, Hook Line, Rush Hour, Warden. Best scores,
  stars, unlocks and settings are stored in `localStorage`.

Settings include an adaptive "Auto" graphics mode (drops resolution, bloom and shadows when
the frame rate dips), volume, look sensitivity, invert-Y and camera shake.

## Project layout

```
index.html          entry point (import map -> vendor/three)
css/style.css       menus, HUD, touch controls, responsive rules
js/main.js          game state machine, scoring, frame loop
js/levels.js        the five level definitions (numbers + seed)
js/route.js         seeded route generator (rooftops, links, pickups, drones)
js/world.js         city meshes, building shader, collision grid
js/env.js           sky, fog, rain, lighting, reflection environment
js/player.js        movement controller + procedural courier model
js/camera.js        third-person camera (collision, shake, FOV)
js/drones.js        patrol + sniper drones        js/boss.js   WARDEN-9
js/fx.js            pooled particles, rings, trail
js/audio.js         WebAudio music sequencer + sound effects
js/hud.js js/ui.js  HUD, minimap, menus, save data
js/input.js         keyboard/mouse, touch, gamepad
js/bot.js           autopilot used by the tests (`?level=3&bot=1` to watch it)
vendor/three        Three.js r180 (MIT) - core + bloom post-processing addons
tools/              static server, Playwright end-to-end test, screenshot helper
```

## Tests

```bash
cd tools && npm install && npx playwright install chromium
node test.mjs              # all levels, desktop + mobile; screenshots in tools/out/
node test.mjs 3 --fast     # one level, desktop only
```

The test opens the menus at desktop, phone-landscape and phone-portrait sizes, then has the
autopilot play every level to the win screen through the same input path a human uses, and
fails on any console error.

Development notes, decisions and known issues are in [notes.md](notes.md).
