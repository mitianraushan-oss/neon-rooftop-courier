// Level definitions. Everything else (route, city, pickups, drones) is generated
// from these numbers + the seed, so a level is fully reproducible.
//
// weights: relative chance of each link type between rooftops.
// script:  force a link type at a given rooftop index (used to teach mechanics in order).
// sky:     palette index, see SKIES in world.js.
export const LEVELS = [
  {
    id: 1, name: 'FIRST SHIFT', district: 'Neon Row', seed: 1207,
    platforms: 15, deliveries: 3, time: 40, bonus: 16, baseTop: 70,
    gap: [3, 4.4], rise: [-2, 0.6],
    weights: { jump: 1, pad: 0.15, wallrun: 0, grapple: 0 },
    script: { 1: 'jump', 2: 'jump', 3: 'jump', 7: 'pad' }, barrier: 0.45, barrierFrom: 4,
    drones: 0, snipers: 0, sky: 0, rain: 0.35, tempo: 100, root: 0,
    blurb: 'Learn the rooftops. Jump, slide under ducts, ride a launch pad.',
  },
  {
    id: 2, name: 'WALL STREET', district: 'Hoarding Heights', seed: 2231,
    platforms: 20, deliveries: 3, time: 36, bonus: 28, baseTop: 78,
    gap: [3.4, 5], rise: [-2.5, 0.8],
    weights: { jump: 1, pad: 0.2, wallrun: 0.55, grapple: 0 },
    script: { 1: 'jump', 3: 'wallrun', 6: 'wallrun' }, barrier: 0.35, barrierFrom: 2,
    drones: 4, snipers: 0, sky: 1, rain: 0.7, tempo: 108, root: -2,
    blurb: 'Run the billboards. Patrol drones are watching - break line of sight.',
  },
  {
    id: 3, name: 'HOOK LINE', district: 'Stormfront', seed: 3319,
    platforms: 22, deliveries: 4, time: 28, bonus: 20, baseTop: 84,
    gap: [3.6, 5.4], rise: [-2.5, 1],
    weights: { jump: 1, pad: 0.25, wallrun: 0.4, grapple: 0.5 },
    script: { 1: 'jump', 3: 'grapple', 5: 'jump', 7: 'grapple' }, barrier: 0.35, barrierFrom: 2,
    drones: 4, snipers: 2, sky: 2, rain: 1, tempo: 114, root: 3,
    blurb: 'Grapple the hover buoys through a thunderstorm. Snipers telegraph their shots.',
  },
  {
    id: 4, name: 'RUSH HOUR', district: 'Chrome Canyon', seed: 4409,
    platforms: 26, deliveries: 4, time: 30, bonus: 23, baseTop: 90,
    gap: [4, 6], rise: [-3, 1.1],
    weights: { jump: 1, pad: 0.3, wallrun: 0.55, grapple: 0.5 },
    script: { 1: 'jump' }, barrier: 0.45, barrierFrom: 1,
    drones: 8, snipers: 4, sky: 3, rain: 0.6, tempo: 122, root: -4,
    blurb: 'Everything at once, and the clock is tight. Chain tricks to keep your combo.',
  },
  {
    id: 5, name: 'WARDEN', district: 'Dawn Terminus', seed: 5519,
    platforms: 34, deliveries: 4, time: 42, bonus: 34, baseTop: 96,
    gap: [3.6, 5.6], rise: [-3, 1],
    weights: { jump: 1, pad: 0.3, wallrun: 0.5, grapple: 0.4 },
    script: { 1: 'jump', 2: 'jump' }, barrier: 0.3, barrierFrom: 3,
    drones: 4, snipers: 0, sky: 4, rain: 0.8, tempo: 132, root: 1, boss: true,
    blurb: 'WARDEN-9 has your scent. Never stop moving. Deliver the EMP core to end it.',
  },
];
