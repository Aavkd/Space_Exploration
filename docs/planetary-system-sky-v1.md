# Planetary System Sky V1

## Goal

When the player descends from a System tier planet into the true-radius Planetary tier, the planet sky should remain a faithful close-up of the parent star system:

- the visible sun is the parent system star;
- sibling planets are visible from orbit/surface as projected sky bodies;
- terrain, atmosphere, the visible sun disc, and ship lighting all use the same sun direction;
- when ascending back to the System tier, the ship emerges near the current parent planet position with the local planet frame mapped back into the system frame.

This is intentionally a projection layer, not the raw System scene graph rendered inside the Planetary tier. The true-radius planet uses metre-scale radii while the System tier uses compact preview radii, so directly exposing the parent scene would break scale and precision.

## Files

- `src/space/universe/SystemContents.js`
  - Adds a compact `parentSystem` snapshot to planet descent candidates.
  - Snapshot includes the parent star, the selected planet ephemeris, and sibling planet ephemerides.

- `src/space/scale/Level.js`
  - Passes `candidate.parentSystem` into `PlanetaryContents` and `QuadPlanetContents`.
  - Breadcrumbs now retain `id` and `kind` for matching the current parent candidate on ascent.

- `src/space/scale/ScaleStack.js`
  - Keeps the immediate parent System level ticking while a Planetary level is active.
  - On ascent, finds the current matching parent planet instead of using only the stale descent position.
  - Lets the leaving planet map local exit direction, velocity, angular velocity, and orientation back into the parent frame.

- `src/space/universe/QuadPlanetContents.js`
  - Adds `ProjectedParentSystemSky`.
  - Renders a sprite sun and sibling planet sprites from the parent-system snapshot.
  - Adds `PlanetaryParentStarLight` for the ship and other PBR/standard materials.
  - Updates terrain and atmosphere `uSunDir` from the same parent-star direction.
  - Projected sprite materials must keep `fog: false`; otherwise true-radius sky distances can make the sun and planet discs disappear into scene fog even while terrain lighting remains correct.

## V1 Validation

Manual validation on 2026-06-26 confirmed:

- The true-radius planet shows a clear lit and dark hemisphere.
- The terminator visually matches the parent-system sun direction.
- The projected parent star is visible from the planet tier after disabling fog on the projected sky sprites.

Still pending:

- Confirm sibling planets are readable from representative surface/orbit camera angles.
- Confirm ascent back to System tier preserves the apparent sun and sibling-body directions closely enough during normal play. -> not realy I tested ascending looking straight at the sun, and when entering system tier, this was not the case anymore
- Tune projected disc sizing and brightness after sibling-body visibility is confirmed.

## Coordinate Model

The parent system snapshot stores compact System-tier orbital data at descent time. While inside the planet:

1. `QuadPlanetContents._time` advances normally.
2. The selected planet and sibling bodies are evaluated from their snapshot orbit phase and orbit speed.
3. The selected planet spin phase is evaluated from `spinPhase + spinSpeed * _time`.
4. Parent-frame directions are transformed into the local rotating planet frame with the inverse selected spin angle.
5. On ascent, local exit vectors are transformed back into the parent frame with the positive selected spin angle.

This makes the sky projection and ascent handoff share one ephemeris model.

## Current V1 Limits

- The projected bodies are simple sprites, not shaded spheres.
- Sibling planet apparent size is artistically clamped for readability.
- Parent star visibility is confirmed; sibling planet visibility still needs a dedicated visual pass.
- No moon projection yet.
- No eclipses, transits, shadows, or ring occlusion.
- Atmosphere is still a rim/haze shader, not volumetric scattering.
- The legacy heroic `PlanetaryContents` path accepts `parentSystem` but does not yet render this projected sky. Landable terrestrial planets use `QuadPlanetContents`, so this is acceptable for V1.

## Next Steps

1. Replace projected planet sprites with tiny shaded impostor spheres or generated disc textures per planet type.
2. Add moons and rings to the snapshot and projection layer.
3. Add horizon-aware atmosphere color: blue/amber daylight, sunset band near the terminator, and low night haze.
4. Add optional star glare/bloom tuning per star luminosity and temperature.
5. Add eclipse/transit checks by comparing angular discs in planet-local sky space.
6. Add debug telemetry for `systemTime`, `sunDir`, selected spin angle, and projected sibling count.
7. Extend the same projection model to gas/legacy `PlanetaryContents` if gas giant orbit sky continuity becomes important.

## Invariants

- Do not render the raw parent System scene inside the true-radius planet tier.
- Do not put terrain-only height or collision changes in this feature path.
- Keep the visible sun, directional light, terrain shader, and atmosphere shader fed from the same direction.
- Preserve ascent/descent continuity through shared ephemeris data rather than decorative random sky placement.
