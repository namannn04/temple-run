# Temple Run — Escape the Ruins

A realistic, smooth 3D endless runner inspired by *Temple Run*, built from scratch with
[Three.js](https://threejs.org) and [Vite](https://vitejs.dev). You've stolen the idol, so run
along ancient walkways high above the jungle, take the corners, jump the chasms and slide under the
arches while a pack of demon monkeys chases you.

## Features

- **Endless procedural temple**: walkway segments with 90° corners, chasms, fallen logs, low
  stone arches, broken pillars and fire vents. Difficulty and speed ramp up the longer you run.
- **Realistic look**: PBR materials with procedurally generated albedo, normal and roughness maps
  (weathered, pitted, lichen-covered slabs polished in the middle by centuries of feet), a physically
  based sky with drifting clouds, image-based lighting, golden-hour sun shadows, screen-space god
  rays and lens flare, flickering torch light on the stone, exponential fog, animated mist, ACES tone
  mapping, emissive-only bloom, SMAA and a film-style colour grade.
- **Living world**: an endless jungle canopy below the walkway with swaying leaves, ferns and grass
  pushing through the ruins, ridged mountains on the horizon, torch-lit columns, hanging vines,
  ruined gateways and distant stepped temples.
- **Animated hero**: a skinned character with run/idle blending and procedural jump and slide
  poses layered on top of the animation.
- **Demon chasers**: a pack of horned, fanged demon monkeys with real shell-rendered fur and glowing
  eyes. They gallop along your exact trail, roar, close in when you stumble and pounce if you
  stumble twice.
- **Coins, power-ups and scoring**: coin trails and arcs, a coin magnet, a shield, distance-based
  score multipliers and a best score saved on your device.
- **Synthesized audio**: a tribal drum score whose tempo follows your speed, jungle wind, demon
  growls and every sound effect, all generated with the Web Audio API. No audio files needed.
- **Plays anywhere**: keyboard on desktop, swipe and tap on mobile, three graphics presets.

## Controls

| Action | Keyboard | Touch |
| --- | --- | --- |
| Turn at a corner / switch lane | `←` `→` or `A` `D` | Swipe left / right |
| Jump | `↑`, `W` or `Space` | Swipe up or tap |
| Slide (in the air: slam down) | `↓` or `S` | Swipe down |
| Pause | `P` or `Esc` | ❚❚ button |
| Mute | `M` | 🔊 button |

## Getting started

```bash
npm install
npm run dev      # start the dev server on http://localhost:5173
npm run build    # production build into dist/
npm run preview  # serve the production build
```

## Project structure

```
src/
├── main.js               Boot
├── Game.js               State machine, frame loop, collisions, scoring, power-ups
├── core/
│   ├── Engine.js         Renderer, camera, post-processing chain, quality presets
│   ├── GodRaysPass.js    Quarter-res crepuscular rays + lens flare
│   └── GradeShader.js    Colour grade, vignette, grain, danger tint
├── world/
│   ├── Textures.js       Procedural PBR texture generation (tileable noise)
│   ├── Environment.js    Sky, sun, IBL, fog, mountains, mist, dust motes
│   ├── TrackAssets.js    Shared geometries/materials (columns, trees, flames…)
│   ├── Track.js          Segment generation, gameplay layout and scenery
│   ├── Forest.js         World-anchored wrapping jungle canopy
│   └── TorchLights.js    Flickering light pool that follows the nearest torches
├── entities/
│   ├── Player.js         Runner kinematics, turning, jump/slide, animation
│   └── Demons.js         Demon pack models, gallop animation and trail following
├── systems/
│   ├── CameraRig.js      Chase/menu camera, shake and FOV kick
│   ├── Input.js          Keyboard + swipe input
│   ├── Audio.js          Web Audio music and SFX synthesis
│   └── Particles.js      Pooled dust and spark particles
└── ui/UI.js              HUD, menus and toasts
```

## Credits

- Character model: `Soldier.glb` from the [three.js examples](https://github.com/mrdoob/three.js/tree/dev/examples/models/gltf)
  (animated with Mixamo).
- Everything else (textures, scenery, creatures, music and sound) is generated in code.

## License

MIT
