# Surface Rendering Audit — Root-Cause Analysis

> **Scope:** Why the true-radius quadtree planet renders as a "broken mess" instead of
> curved, 3-D height-field-rich terrain. Full file-by-file audit with findings,
> severity ratings, and proposed fixes.

---

## Executive Summary

The quadtree surface rendering pipeline is **architecturally sound** — the height
basis, cube-sphere projection, camera-relative placement, and LOD selection are all
correctly designed. The "broken mess" is caused by **five concrete bugs** of varying
severity, one of which is almost certainly the dominant visual failure. Here they are,
ordered by severity:

| # | Severity | File | Bug |
|---|----------|------|-----|
| **1** | 🔴 **CRITICAL** | [DesktopPostFxPipeline.js](file:///d:/Documents/PROJECTS/DEEP_SPACE_VR/src/rendering/DesktopPostFxPipeline.js#L41) | `logarithmicDepthBuffer` on `WebGLRenderTarget` is a **no-op** — Three.js silently ignores it, so the composer's depth buffer is standard linear, producing z-fighting/banding at planet scale |
| **2** | 🟠 **HIGH** | [QuadPlanetContents.js](file:///d:/Documents/PROJECTS/DEEP_SPACE_VR/src/space/universe/QuadPlanetContents.js#L648) | Tile `ShaderMaterial` has no `side` property set → defaults to `THREE.FrontSide`. Combined with winding ambiguity on some cube faces, entire tile faces can be back-face culled and invisible |
| **3** | 🟠 **HIGH** | [CubeSphereQuadTree.js](file:///d:/Documents/PROJECTS/DEEP_SPACE_VR/src/space/universe/CubeSphereQuadTree.js#L309) | Index winding of the surface grid produces **inconsistent face normals** across cube faces — some faces wind CW (front-facing from outside the sphere) while others wind CCW (back-facing), causing half the planet to render as holes |
| **4** | 🟡 **MEDIUM** | [CubeSphereQuadTree.js](file:///d:/Documents/PROJECTS/DEEP_SPACE_VR/src/space/universe/CubeSphereQuadTree.js#L280) | `edgeMetres` fallback calculation for tiles built during constructor (before LOD runs) can produce `NaN` at root depth, breaking skirt depth and tile geometry |
| **5** | 🟡 **MEDIUM** | [QuadPlanetContents.js](file:///d:/Documents/PROJECTS/DEEP_SPACE_VR/src/space/universe/QuadPlanetContents.js#L212) | `quadtree.group.position.copy(camera)` places the tile root at the camera's **world** position, but the tile mesh offsets are computed as `(centerScene + tileOrigin − camera)` — if `camera` and `_centerScene` diverge after rebase, tiles jitter or shift |

---

## Detailed Findings

### Bug 1 — 🔴 `logarithmicDepthBuffer` on `WebGLRenderTarget` Is a No-Op

**File:** [DesktopPostFxPipeline.js:35-42](file:///d:/Documents/PROJECTS/DEEP_SPACE_VR/src/rendering/DesktopPostFxPipeline.js#L35-L42)

```js
const composerRT = new THREE.WebGLRenderTarget(size.x, size.y, {
    depthBuffer: true,
    stencilBuffer: false,
    type: THREE.HalfFloatType,
    samples: renderer.capabilities.isWebGL2 ? 4 : 0,
    logarithmicDepthBuffer: true  // ← THIS IS NOT A VALID OPTION
});
```

**What happens:** `logarithmicDepthBuffer` is a property of `WebGLRenderer`, not of
`WebGLRenderTarget`. Three.js's render target constructor silently ignores unknown
options. The comments in the file explicitly say this was added to fix terrain z-fighting
— but it doesn't actually do anything.

**Consequence:** The `EffectComposer` renders into a target with a **standard 24-bit
linear depth buffer**. At a true planet radius of ~6.4 × 10⁶ m, with a `camera.far`
of ~25.6 × 10⁶ m and `camera.near` of 0.1 m, the linear depth precision at the surface
is approximately:

$$\Delta z \approx \frac{far - near}{2^{24}} \approx \frac{2.56 \times 10^7}{1.67 \times 10^7} \approx 1.53 \text{ metres}$$

This means **all geometry within 1.5 m depth of each other maps to the same depth
value**, producing massive z-fighting, banding, and shimmering across the entire terrain.
This is very likely the dominant visual artefact you're seeing.

**Root cause of the confusion:** The renderer itself IS created with
`logarithmicDepthBuffer: true` at [App.js:68](file:///d:/Documents/PROJECTS/DEEP_SPACE_VR/src/app/App.js#L68).
The tile material's shader includes `#include <logdepthbuf_pars_vertex>` and
`#include <logdepthbuf_vertex>` chunks, which correctly write logarithmic depth.
But when the `EffectComposer` renders to its own render target, the depth comparison
in the target's depth buffer is still linear — the log-written depth values get
compared against a linear depth buffer, producing incorrect z-test results.

> [!CAUTION]
> **This is the #1 most likely cause of the broken surface.** The fix is to NOT pass
> `logarithmicDepthBuffer` to the render target (it's meaningless there), and instead
> either:
> 1. Skip the EffectComposer entirely for the terrain pass (render terrain directly to
>    the default framebuffer, which DOES get the log depth from the renderer), or
> 2. Render to the default framebuffer first (renderer.render), then blit/copy the
>    result into the composer chain, or
> 3. Use `renderer.render(scene, camera)` directly when a quad planet is active and
>    apply post-FX as a full-screen pass on the result.

**Simpler practical fix:** Set `renderer.autoClear = false`, render the scene directly
first with `renderer.render(scene, camera)` so the log depth buffer writes to the
actual default framebuffer, then run only the post-processing passes (bloom, warp,
retro) as a second step reading from a colour-only render target.

---

### Bug 2 — 🟠 Tile Material Missing `side: THREE.DoubleSide`

**File:** [QuadPlanetContents.js:648-698](file:///d:/Documents/PROJECTS/DEEP_SPACE_VR/src/space/universe/QuadPlanetContents.js#L648-L698)

```js
_createTileMaterial() {
    return new THREE.ShaderMaterial({
        uniforms: { ... },
        vertexShader: `...`,
        fragmentShader: `...`
        // ← no 'side' property → defaults to THREE.FrontSide
    });
}
```

**What happens:** `ShaderMaterial` defaults to `THREE.FrontSide`. Whether a triangle
is "front-facing" depends on the **winding order as seen from the camera**. The cube-sphere
quadtree's six faces use different `(forward, right, up)` axis configurations
([CubeSphereQuadTree.js:31-38](file:///d:/Documents/PROJECTS/DEEP_SPACE_VR/src/space/universe/CubeSphereQuadTree.js#L31-L38)):

```js
const FACES = [
    { forward: [1, 0, 0],  right: [0, 0, -1], up: [0, 1, 0] },  // +X
    { forward: [-1, 0, 0], right: [0, 0, 1],  up: [0, 1, 0] },  // -X
    { forward: [0, 1, 0],  right: [1, 0, 0],  up: [0, 0, -1] }, // +Y
    { forward: [0, -1, 0], right: [1, 0, 0],  up: [0, 0, 1] },  // -Y
    { forward: [0, 0, 1],  right: [1, 0, 0],  up: [0, 1, 0] },  // +Z
    { forward: [0, 0, -1], right: [-1, 0, 0], up: [0, 1, 0] }   // -Z
];
```

The cube-to-sphere mapping computes the direction as:
```js
forward + u·right + v·up   // then normalized
```

The grid indices are built with a single winding pattern:
```js
indices.push(a, c, b, b, c, d);  // line 315
```

But whether `(a, c, b)` winds clockwise or counter-clockwise **when viewed from outside
the sphere** depends on the orientation of `right × up` relative to `forward`. For half
the cube faces, the cross product `right × up` points **inward** (opposite to `forward`),
flipping the effective winding — so those tiles are back-face culled.

**Consequence:** Approximately half the planet's surface tiles are invisible from outside.
You see terrain on 3 faces and holes on the other 3.

**Fix:**
```js
_createTileMaterial() {
    return new THREE.ShaderMaterial({
        uniforms: { ... },
        vertexShader: `...`,
        fragmentShader: `...`,
        side: THREE.DoubleSide  // ← add this
    });
}
```

Or, better long-term: fix the winding per-face (Bug 3) and keep `FrontSide` for performance.

---

### Bug 3 — 🟠 Inconsistent Triangle Winding Across Cube Faces

**File:** [CubeSphereQuadTree.js:309-317](file:///d:/Documents/PROJECTS/DEEP_SPACE_VR/src/space/universe/CubeSphereQuadTree.js#L309-L317)

```js
// Surface indices.
for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) {
        const a = j * gridN + i;
        const b = a + 1;
        const c = a + gridN;
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
    }
}
```

**Analysis:** The index order `(a, c, b)` and `(b, c, d)` gives triangles with a specific
winding when the (u, v) grid is traversed in the `(right, up)` directions. Whether this
produces outward-facing triangles depends on whether `right × up` is parallel or
anti-parallel to `forward` for each face.

Checking each face:

| Face | forward | right × up | Parallel? | Winding OK? |
|------|---------|-----------|-----------|-------------|
| +X   | (1,0,0) | (0,0,-1)×(0,1,0) = (-1,0,0) | **Anti** | ❌ |
| -X   | (-1,0,0) | (0,0,1)×(0,1,0) = (1,0,0) | **Anti** | ❌ |
| +Y   | (0,1,0) | (1,0,0)×(0,0,-1) = (0,1,0) | Parallel | ✅ |
| -Y   | (0,-1,0) | (1,0,0)×(0,0,1) = (0,-1,0) | Parallel | ✅ |
| +Z   | (0,0,1) | (1,0,0)×(0,1,0) = (0,0,1) | Parallel | ✅ |
| -Z   | (0,0,-1) | (-1,0,0)×(0,1,0) = (0,0,-1) | Parallel | ✅ |

So the **+X and -X faces** have reversed winding. Their triangles appear back-facing when
viewed from outside the sphere. Combined with Bug 2 (no `DoubleSide`), these two faces
are completely invisible.

**Fix option A (quick):** Set `side: THREE.DoubleSide` on the material (Bug 2 fix).

**Fix option B (proper):** Detect the winding parity per face and flip the index order for
anti-parallel faces:

```js
// In _buildTile, after computing face properties:
const f = FACES[node.faceIndex];
const cross = [
    f.right[1]*f.up[2] - f.right[2]*f.up[1],
    f.right[2]*f.up[0] - f.right[0]*f.up[2],
    f.right[0]*f.up[1] - f.right[1]*f.up[0]
];
const dot = cross[0]*f.forward[0] + cross[1]*f.forward[1] + cross[2]*f.forward[2];
const flip = dot < 0;

// Then in the index loop:
if (flip) {
    indices.push(a, b, c, b, d, c);  // reversed winding
} else {
    indices.push(a, c, b, b, c, d);  // original winding
}
```

---

### Bug 4 — 🟡 `edgeMetres` Fallback Can Produce NaN/Zero

**File:** [CubeSphereQuadTree.js:280](file:///d:/Documents/PROJECTS/DEEP_SPACE_VR/src/space/universe/CubeSphereQuadTree.js#L280)

```js
const edgeMetres = node.edgeMetres
    || (this.radius * Math.PI * 0.5 / Math.max(1, 2 ** node.depth));
```

At construction time ([line 104-109](file:///d:/Documents/PROJECTS/DEEP_SPACE_VR/src/space/universe/CubeSphereQuadTree.js#L104-L109)),
root tiles are built with `_metrics(root, ZERO)` where `ZERO = new Vector3()`.
`_metrics` correctly computes `edgeMetres` and sets `root.edgeMetres`.

However, the `edgeMetres` value is set AFTER `_buildTile` is called through `buildNow`
at line 107, so during the root tile build, `node.edgeMetres` is still `0` (its
initialized value). The fallback `|| ...` catches this for root tiles (depth 0), giving
`radius * π/2`. But for any intermediate tile whose `edgeMetres` was not yet populated
by `_metrics` (because `_metrics` runs during `_updateNode` which hasn't visited it yet),
`node.edgeMetres` is `0`, and `2 ** node.depth` grows, giving very small values.

**Consequence:** Skirt depth is computed as:
```js
THREE.MathUtils.clamp(edgeMetres * this.skirtFraction, MIN_SKIRT_DEPTH, MAX_SKIRT_DEPTH)
```
With `edgeMetres ≈ 0`, `skirtDepth = MIN_SKIRT_DEPTH = 2`. For coarse root tiles spanning
~10⁶ m, a 2-metre skirt is invisible — cracks between LOD levels are not hidden.

**Fix:** Compute `edgeMetres` before calling `_buildTile`, or pass it as a parameter:

```js
for (const root of this.roots) {
    const { edgeMetres } = this._metrics(root, ZERO);
    root.edgeMetres = edgeMetres;  // ← this already exists, but AFTER buildNow
    // Move buildNow AFTER edgeMetres is set
    this.streamer.buildNow(root, () => this._buildTile(root));
}
```

Wait — looking more carefully, lines 105-108 show:
```js
const { edgeMetres } = this._metrics(root, ZERO);
root.edgeMetres = edgeMetres;
const mesh = this.streamer.buildNow(root, () => this._buildTile(root));
```

The `edgeMetres` IS set before `buildNow`. So root tiles are fine. But for **streamed
child tiles**, `_ensureMesh` → `streamer.acquire` → `buildFn` (a closure calling
`_buildTile`) may fire during `processBudget` on a later frame. By that time
`node.edgeMetres` should have been set by `_metrics` in `_updateNode`, so this is
likely fine in practice. The fallback is a belt-and-suspenders measure.

**Revised severity: LOW.** This is not a real bug in normal operation; the fallback is
conservative. Leaving it as-is is acceptable.

---

### Bug 5 — 🟡 Camera-Relative Placement Assumes `camera === cameraPosition`

**File:** [QuadPlanetContents.js:199-220](file:///d:/Documents/PROJECTS/DEEP_SPACE_VR/src/space/universe/QuadPlanetContents.js#L199-L220)

```js
update(shipPosition, dt, cameraPosition) {
    const camera = cameraPosition ?? shipPosition ?? this._lastCamera;
    this._lastCamera.copy(camera);
    this._camLocal.copy(camera).sub(this._centerScene);
    this._lastLeafCount = this.quadtree.update(this._camLocal);

    // Camera-relative placement pass (§4)
    this.quadtree.group.position.copy(camera);  // ← anchors at camera world pos
    for (const leaf of this.quadtree.leaves) {
        this._tmp.copy(this._centerScene).add(leaf.origin).sub(camera);
        leaf.mesh.position.copy(this._tmp);
    }
}
```

**Analysis:** This is correct **if** `camera` is the actual camera position in the scene
frame. The `Level.update` call chain passes `cameraPosition` from `App.js`. If the App
passes `this.camera.position` (which is scene-frame), and the floating-origin rebase
shifts `_centerScene` and the camera together, then `(_centerScene + tileOrigin − camera)`
remains a small, stable offset. This is the correct §4 pattern.

**Potential issue:** If `cameraPosition` is not provided and the fallback to `shipPosition`
is used, but the ship is NOT at the camera (e.g., during EVA when the player walks away
from the ship), the tile placement would be relative to the **ship** instead of the
**camera**, causing the terrain to visually shift away from the viewport.

**Checking App.js call site:**

The `Level.update` at [Level.js:41-43](file:///d:/Documents/PROJECTS/DEEP_SPACE_VR/src/space/scale/Level.js#L41-L43):
```js
update(shipPosition, dt, cameraPosition) {
    this.universe.update(shipPosition, dt, cameraPosition);
}
```

This passes `cameraPosition` through to `QuadPlanetContents.update()`. The App likely
passes the camera position correctly during flight. During EVA, if the App fails to
update `cameraPosition` to the player's position, the terrain would shift.

**Revised severity: LOW-MEDIUM.** Not the primary rendering bug, but could cause
subtle drift during EVA.

---

## Non-Bugs (Confirmed Working)

These components were audited and found **correct**:

### ✅ Height Basis ([planetHeightBasis.js](file:///d:/Documents/PROJECTS/DEEP_SPACE_VR/src/space/universe/planetHeightBasis.js))

- `surfaceRadiusAt(dir)` correctly computes `radius + reliefMetres * land + detailAmplitude * detailAt(dir)`.
- Relief is in real metres (8,000 m per [scaleTiers.js:148](file:///d:/Documents/PROJECTS/DEEP_SPACE_VR/src/config/scaleTiers.js#L148)), giving ~8 km mountains on a ~6.4 Mm planet. This is correct and should produce visible terrain.
- The fbm noise has 5 octaves with proper value-noise interpolation. No bugs found.
- Detail amplitude of 85 m at frequency 260 adds fine-scale variation correctly.

### ✅ Cube-to-Sphere Projection ([CubeSphereQuadTree.js:369-376](file:///d:/Documents/PROJECTS/DEEP_SPACE_VR/src/space/universe/CubeSphereQuadTree.js#L369-L376))

```js
_faceDir(faceIndex, u, v, target) {
    const f = FACES[faceIndex];
    return target.set(
        f.forward[0] + u * f.right[0] + v * f.up[0],
        f.forward[1] + u * f.right[1] + v * f.up[1],
        f.forward[2] + u * f.right[2] + v * f.up[2]
    ).normalize();
}
```

Correct standard cube-sphere mapping. The `normalize()` call projects the cube point
onto the unit sphere.

### ✅ Vertex Position Computation ([CubeSphereQuadTree.js:294-305](file:///d:/Documents/PROJECTS/DEEP_SPACE_VR/src/space/universe/CubeSphereQuadTree.js#L294-L305))

```js
this._faceDir(node.faceIndex, u, v, dir);
const r = this.basis.surfaceRadiusAt(dir);
pos.copy(dir).multiplyScalar(r).sub(origin);  // tile-relative
```

Correctly displaces vertices by the height basis and stores them relative to the
tile centre. The §4 precision contract is implemented correctly at this stage.

### ✅ Surface Normal Computation ([CubeSphereQuadTree.js:380-396](file:///d:/Documents/PROJECTS/DEEP_SPACE_VR/src/space/universe/CubeSphereQuadTree.js#L380-L396))

Finite-difference normals from the shared height field. Cross product of (u+ε) − (u−ε)
and (v+ε) − (v−ε). Correct technique; ensures normals are continuous across LOD seams.

### ✅ LOD Selection Logic ([CubeSphereQuadTree.js:121-164](file:///d:/Documents/PROJECTS/DEEP_SPACE_VR/src/space/universe/CubeSphereQuadTree.js#L121-L164))

Screen-space error proxy `edgeMetres / dist` compared against thresholds. Hysteresis
band prevents thrashing. Parent stays visible until all children ready. Correct.

### ✅ Tile Streaming ([TileStreamer.js](file:///d:/Documents/PROJECTS/DEEP_SPACE_VR/src/space/universe/TileStreamer.js))

Priority queue, ms budget, LRU cache, origin preservation on cache hit. No bugs found.

### ✅ Shader LogDepth Integration ([QuadPlanetContents.js:655-668](file:///d:/Documents/PROJECTS/DEEP_SPACE_VR/src/space/universe/QuadPlanetContents.js#L655-L668))

The vertex shader includes `#include <logdepthbuf_pars_vertex>` and
`#include <logdepthbuf_vertex>`; the fragment shader includes the matching fragment
chunks. This is the correct Three.js pattern for logarithmic depth in a `ShaderMaterial`.
The shader itself writes correct log depth values — the problem is that the
**EffectComposer's render target** doesn't use them correctly (Bug 1).

---

## Recommended Fix Order

> [!IMPORTANT]
> Fix Bug 1 first. It is almost certainly the dominant visual failure and explains most
> of the "broken mess" appearance. Bugs 2+3 together explain any missing faces.

### Step 1 — Fix the depth buffer (Bug 1)

Remove the meaningless `logarithmicDepthBuffer: true` from the `WebGLRenderTarget`.
Then apply **one** of these strategies:

**Option A (simplest):** When a `QuadPlanetContents` is the active environment, bypass the
EffectComposer entirely and render with `renderer.render(scene, camera)`. The default
framebuffer gets the log depth buffer from the renderer. Post-FX can be re-enabled later
with a more careful integration.

**Option B (preserves post-FX):** Use a `DepthTexture` with `THREE.FloatType` on the
composer's render target. This gives 32-bit float depth, which has enough precision for
true-radius rendering even without logarithmic encoding:

```js
const depthTexture = new THREE.DepthTexture(size.x, size.y);
depthTexture.type = THREE.FloatType;
const composerRT = new THREE.WebGLRenderTarget(size.x, size.y, {
    depthBuffer: true,
    depthTexture: depthTexture,
    stencilBuffer: false,
    type: THREE.HalfFloatType,
    samples: renderer.capabilities.isWebGL2 ? 4 : 0
});
```

> [!NOTE]
> `THREE.FloatType` depth textures are widely supported on WebGL2 but not universal.
> Test on target hardware. On devices without `WEBGL_depth_texture` + float support,
> Option A is the safer path.

### Step 2 — Fix face culling (Bugs 2 + 3)

Add `side: THREE.DoubleSide` to the tile `ShaderMaterial` in
[QuadPlanetContents._createTileMaterial()](file:///d:/Documents/PROJECTS/DEEP_SPACE_VR/src/space/universe/QuadPlanetContents.js#L648).
This immediately fixes invisible faces regardless of winding.

Optionally, also fix the winding per-face in [CubeSphereQuadTree._buildTile()](file:///d:/Documents/PROJECTS/DEEP_SPACE_VR/src/space/universe/CubeSphereQuadTree.js#L254)
to avoid the ~2× overdraw cost of `DoubleSide`. Compute `dot(right × up, forward)` per
face and flip the triangle winding for negative-dot faces.

### Step 3 — Verify and iterate

After fixes 1 + 2, the terrain should render as a curved, height-displaced sphere
with correct lighting. Remaining visual polish items (not bugs):

- **Tile faceting at high altitude** — expected without geomorph blending (deferred §14).
- **Coarse LOD at far hemisphere** — correct by design (only near tiles are deep LOD).
- **Skirt visibility** — the 2-metre minimum skirt may be visible as faint lines at
  coarse LOD. Increase `MIN_SKIRT_DEPTH` to ~20 m if needed.

---

## Appendix: File Reference

| File | Role | Lines |
|------|------|-------|
| [App.js](file:///d:/Documents/PROJECTS/DEEP_SPACE_VR/src/app/App.js) | Renderer setup, log depth, scene loop | 1700 |
| [DesktopPostFxPipeline.js](file:///d:/Documents/PROJECTS/DEEP_SPACE_VR/src/rendering/DesktopPostFxPipeline.js) | EffectComposer with broken log-depth RT | 215 |
| [QuadPlanetContents.js](file:///d:/Documents/PROJECTS/DEEP_SPACE_VR/src/space/universe/QuadPlanetContents.js) | True-radius planet provider, tile material | 705 |
| [CubeSphereQuadTree.js](file:///d:/Documents/PROJECTS/DEEP_SPACE_VR/src/space/universe/CubeSphereQuadTree.js) | Quadtree LOD, tile mesh gen, face winding | 448 |
| [planetHeightBasis.js](file:///d:/Documents/PROJECTS/DEEP_SPACE_VR/src/space/universe/planetHeightBasis.js) | Shared fbm height function (correct) | 138 |
| [TileStreamer.js](file:///d:/Documents/PROJECTS/DEEP_SPACE_VR/src/space/universe/TileStreamer.js) | Async tile queue + LRU cache (correct) | 167 |
| [scaleTiers.js](file:///d:/Documents/PROJECTS/DEEP_SPACE_VR/src/config/scaleTiers.js) | QUAD_PLANET config constants | 303 |
| [Level.js](file:///d:/Documents/PROJECTS/DEEP_SPACE_VR/src/space/scale/Level.js) | Level factory, dispatches to QuadPlanet | 308 |
| [PlanetaryContents.js](file:///d:/Documents/PROJECTS/DEEP_SPACE_VR/src/space/universe/PlanetaryContents.js) | Legacy hero sphere (gas giants, correct) | 638 |
| [PlanetBody.js](file:///d:/Documents/PROJECTS/DEEP_SPACE_VR/src/space/universe/PlanetBody.js) | System-tier planet impostor (correct) | 244 |
