# Starter Kit Racing

Port of the Kenney "Starter Kit Racing" Godot 4.6 project (in `_godot/`) to plain JavaScript and three.js with crashcat physics. Includes multiplayer (Socket.io), a track editor, and solo/multiplayer race modes.

## Structure

- `_godot/` — Original Godot project (reference implementation)
- `js/` — JavaScript port
  - `main.js` — Entry point, scene setup, game loop, solo & multiplayer UI
  - `Physics.js` — crashcat wall colliders and sphere body (ported from Godot collision shapes)
  - `Track.js` — GridMap track layout, piece placement, encode/decode map codec
  - `Vehicle.js` — Vehicle physics and controls (sphere-drive model)
  - `Camera.js` — Camera system
  - `Controls.js` — Input handling
  - `Particles.js` — Smoke trail effects
  - `Audio.js` — Sound
  - `Race.js` — Finish-line crossing detection and lap/time tracking
  - `Multiplayer.js` — Socket.io client: room management, ghost interpolation, position broadcast
  - `editor.js` — Browser-based track editor (auto-tile, finish placement, encode/share)
- `server.js` — Node.js Socket.io server: room lifecycle, race start relay, finish relay
- `index.html` — Game page (solo + multiplayer UI overlays, HUD, finish screen)
- `editor.html` — Track editor page
- `models/` — GLB models shared between both versions
- `audio/` — Audio assets
- `benchmark/` — Physics library benchmark (Rapier vs crashcat vs bounce)
- `sprites/` — Sprite assets

## Key conventions

- GridMap cell size: 9.99 units, scale: 0.75 (`CELL_RAW` and `GRID_SCALE` in `Track.js`)
- Effective world cell size: `CELL_SIZE = CELL_RAW * GRID_SCALE = 7.4925`
- Track pieces positioned at `(gx+0.5) * CELL_RAW` in group-local space; group has `scale=0.75` → world position = `(gx+0.5) * CELL_SIZE`
- Track group has `position.y = -0.5` offset (Y only)
- Godot vehicle models use `root_scale = 0.5`
- Wall colliders: friction 0.0, restitution 0.1
- Corner colliders: arc center at `(-CELL_HALF, +CELL_HALF)` in local space, outer wall radius `2*CELL_HALF - 0.25`
- Orientation mapping from Godot GridMap indices: `{ 0: 0°, 10: 180°, 16: 90°, 22: 270° }`
- Map codec (`encodeCells`/`decodeCells`): Godot orient → 2-bit index via `GODOT_TO_ORIENT`/`ORIENT_TO_GODOT`

## Race system (`Race.js`)

- Finish line at center of the `track-finish` cell; axis determined by tile orient (N-S → Z axis, E-W → X axis)
- Crossing detection: vehicle must cross `_finishValue` on `_axis`, be within `CELL_SIZE * 0.6` on orthogonal axis, and have traveled `MIN_TRAVEL = CELL_SIZE * 0.5` from the finish since the last crossing
- `currentLap` starts at 1 on `startRace()`; increments on each valid crossing; race ends when `currentLap >= totalLaps` at crossing time

## Multiplayer (`Multiplayer.js` + `server.js`)

- Host creates room with map param; non-hosts auto-redirect to the correct map URL before joining
- Race start is server-authoritative: host emits `race:start`, server broadcasts `{ laps }` to all room members
- Position broadcast at ~30 Hz; ghost vehicles interpolated client-side
- Finish times relayed via `race:finish` → `player:finished` (includes `totalTime` and `bestLapTime`)

## Editor (`editor.js`)

- Auto-tile: finish cells only become `track-finish` type when resolved as a straight (not corners)
- Export as base64url-encoded cells via `encodeCells`; shared via URL `?map=<encoded>`

## Porting reference

Godot collision shapes are defined in `_godot/models/Library/mesh-library.tscn` as `ConcavePolygonShape3D` vertex data. The JS port approximates these with crashcat cuboid colliders.
