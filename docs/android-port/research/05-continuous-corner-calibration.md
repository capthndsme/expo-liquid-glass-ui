# 05 — Continuous-corner (squircle) calibration

**Question.** `cornerStyle: "continuous"` has been accepted-and-ignored since Phase 2, with the
documented mitigation that the iOS *Metal* renderer is itself circular-only (00-ios-parity-spec §9.9).
Implementing it means choosing a curve family that (a) matches Apple's continuous corner to
sub-pixel, (b) has an SDF the AGSL shader can evaluate — the SDF is load-bearing for refraction,
not just the mask — and (c) keeps the Kotlin `Path` (clip + border) and the shader SDF on the
*same* curve, or every corner grows a double edge at the 0.75 dp rim / 1 px border scale.

**Ground truth.** The PaintCode reverse-engineering of iOS' continuous rounded rect
(paintcodeapp.com/news/code-for-ios-7-rounded-rectangles, Matej Dunik / PixelCut 2013, license
"you may use it in your projects as you wish"), as republished in
gist.github.com/dagronf/cb9ea487b10151e69e2555e819b1ef3d (MIT). Three cubics + two hairline lines
per corner; the curve departs the straight edge at **1.52866483 × r** from the rect corner. The
corner-to-corner FP jitter in the constants is export noise; the symmetric mean is used.
`CALayerCornerCurve.continuous` is this same curve family.

**Candidate family.** A superellipse quadrant in an E × E corner cell,
`((E−x)/E)^n + ((E−y)/E)^n = 1` in corner-local coordinates. Chosen over closer-but-costlier
candidates for one structural property: **the circular corner is the (E = r, n = 2) member**, so
one formula serves both `cornerStyle` values, the Kotlin path and the AGSL SDF agree exactly by
construction, and capsule degradation is a continuous blend back to n = 2 rather than a branch.

**Method.** `tools/squircle-calibration.mjs` (node, no deps). Dense-sample the PaintCode corner,
golden-search n (E pinned to Apple's extent; a joint (E, n) fit for comparison), measure symmetric
max/mean deviation; then march inward along true normals and compare the shader's exact formula —
first-order-corrected n-norm, `sd ≈ (g − E)/|∇g|` — against true Euclidean distance, plus the
gradient's angular error. px figures quoted at r = 110 px (40 dp at density 2.75).

## Results

| fit | E | n | max dev | mean dev |
|---|---|---|---|---|
| E pinned to Apple | 1.52866483 | **3.3418** | 7.30e-3 r (0.80 px) | 4.62e-3 r (0.51 px) |
| joint | 1.5215 | 3.3233 | 7.19e-3 r (0.79 px) | — |

The joint fit buys 0.013 px — the ~0.7%-of-r residual is intrinsic to a single-superellipse
family. **E stays pinned at Apple's 1.52866483**: the departure point is the visually distinctive
part of the curve, and it is exact. Apex (diagonal) sits at 0.2863 r vs Apple's 0.2915 r —
0.6 px tighter at r = 110 px, and that is where most of the residual lives.

SDF accuracy through the refraction band (fit 1):

| depth (px) | max \|sd err\| (px) | max rel err | max grad angle err |
|---|---|---|---|
| 1 | 0.0002 | 0.02% | 0.11° |
| 2 | 0.0010 | 0.05% | 0.22° |
| 5 | 0.0063 | 0.13% | 0.58° |
| 10 | 0.026 | 0.26% | 1.21° |
| 20 | 0.111 | 0.56% | 2.62° |
| 40 | 0.517 | 1.29% | 6.22° |
| 55 | 1.103 | 2.01% | 9.92° |

**Why the deep-band errors are acceptable:** the refraction displacement
`amount = (circleMap(pow(1−t, power)) + bias·(1−t)) · refractionAmount` decays to ~0 as depth → 
`refractionScale` — exactly where the SDF and gradient errors grow. Where displacement is large
(0–10 px), the formula is accurate to 0.03 px and 1.2°. The shader's own *deliberate* geometry
distortion — normals from radii inflated 1.5× (Metal :148 heritage) — is far coarser than any of
this. Edge and interior regions use the existing straight-edge algebra and are exact.

## Baked constants and rules

```
CONTINUOUS_EXTENT = 1.52866483   // corner-cell size per unit radius; Apple's, exact
CONTINUOUS_N      = 3.3418       // superellipse exponent at full extent
```

- **Per-corner extents.** desired `E_i = 1.52866483·r_i`; on each edge, if the two desired extents
  overflow the side, both scale by `side/sum` (a corner takes the min of its two edges' scales);
  then a hard cap at `min(halfW, halfH)` for quadrant integrity. Because `clampedTo` already
  guarantees `r_a + r_b ≤ side`, the scale never pushes `E_i` below `r_i` — `E/r ∈ [1, 1.5287]`
  always, so the blend below never extrapolates.
- **Degradation blend.** `n = 2 + (3.3418 − 2) · (E/r − 1)/(1.52866483 − 1)`. At full room, Apple's
  curve; at `E = r` (capsule limit), exactly the circular corner. Apex drift through the blend is
  monotonic and ≤ 0.7% of r.
- **Circular style** is `E = r, n = 2` through the same code path in the shader (which reduces to
  the existing Euclidean SDF, no pow), while the Kotlin side keeps `addRoundRect` for exact arcs.
- **The Kotlin continuous path is sampled from the same superellipse** (polyline, 24+ segments per
  corner) rather than from the PaintCode beziers — Path↔SDF agreement is exact by construction,
  and the 0.8 px residual vs Apple is shared by both renderers instead of appearing between them.

**Verdict.** Sub-pixel against real iOS at every radius that occurs in UI (deviation scales with
r: 0.29 px at r = 40 px), exact internal agreement, exact capsules, and the circular fast path
untouched. Costs the corner-cell pixels ~5 `pow()` in SDF + 2 in grad, only when continuous.

## On-device verification (2026-08-14, Nothing Phone (2), Adreno 730, API 36)

Screenshot A/B of the playground card (210 dp, r = 44 dp, density 2.625), continuous vs circular,
gated on a same-state diff of 0 (PLAN F52's stability rule):

- Differences confined to corners: **100.0%** corner zones, 0.0% mid-edges, 0.0% centre — the
  straight-edge and interior algebra is untouched, as the E-cancellation predicts.
- Top-edge diff reach from each corner: **177 px / 176 px** measured, `E = 1.52866·r = 177 px`
  predicted. The Apple extent is live to within a pixel.
- Pill at r = h/2: **0 differing pixels** between styles — the capsule degradation lands on the
  circular member exactly.
- TL corner at 3×: single silhouette edge, no border/rim double line, smooth flank-to-diagonal
  transition.
- All three tiers compile on Adreno 730 (API 36) and the API 37 emulator. (First attempt failed
  everywhere: `packed` is an SkSL reserved word — caught by the warm-up log, renamed to
  `corners`.) Mali re-verification rides the X7 Pro APK round.

**Post-ship correction (same day, PLAN F53).** The first build stroked an "inverse squircle"
hairline inside every continuous corner: `ContinuousCorners.corner()` parametrized the corner
curve about the **corner point** (`C + aE·cos^p + bE·sin^p`) instead of the inner cell point —
the true curve mirrored through its chord, with identical endpoints, which is why the silhouette
A/B still passed. Pixel forensics identified it as `nnorm(p − corner) = 0.99·E` at RMS 0.11 px,
stroke-width amplitude, fading with the border gradient. The SDF was never wrong. The corrected
parametrization `C + aE(1 − sin^p) + bE(1 − cos^p)` re-derives the 0.286 r apex and satisfies
the boundary equation to 2e-4. Also measured en route: the top-edge A/B "reach" saturates at
~137 px, where the squircle's 0.37 px edge-inset drops below the detector threshold — the E
extent is confirmed by curve *fits*, not by the reach statistic.
