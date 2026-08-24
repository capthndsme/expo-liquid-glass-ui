# LiquidGlassKit (DnV1eX) — technique study, 2026-08-24

Studied from a local clone of https://github.com/DnV1eX/LiquidGlassKit (411 stars,
HEAD `2eb41c5`). Written so we can improve our own pre-iOS-26 pipeline **without
copying anything from it**.

## ⚠️ License status: NONE — do not copy code

- No LICENSE file anywhere in the repo.
- GitHub API reports `"license": null`.
- README ends with a bare `Copyright © 2025 DnV1eX`.

No license means **all rights reserved** by default. Unlike AndroidLiquidGlass
(Apache-2.0, credited in our NOTICE), nothing from this repo may be copied,
ported line-by-line, or closely translated into `expo-liquid-glass-view` /
`-ui` / `-native`. That includes the Metal shaders and the Swift capture
pipeline.

What we *can* do:

- Read it and learn **techniques** — the underlying math and architecture ideas
  are standard computer graphics, published independently long before this repo
  (SDF combinators: Inigo Quilez's articles; Snell/Fresnel refraction: any
  graphics text; IOSurface-backed CVPixelBuffer→Metal texture: Apple sample
  code and docs).
- Implement those techniques **from our own shader lineage** (`ios/Shaders/
  LiquidGlass.metal` and its AGSL translation), citing public references,
  never this repo's expression.
- If closer reuse is ever wanted: open an issue asking DnV1eX to add a license.
  Until then the answer is no.

Rule of thumb for the implementer: it is fine to know *that* their morph is
"smooth-min over an array of rounded-rect SDFs". It is not fine to have their
file open in a split pane while writing ours.

## Architecture inventory (idea level)

### 1. The morphing system — simpler than it looks

- The fragment shader takes a uniform array of up to 16 rects
  (`float4(x, y, w, h)` in points) plus one `shapeMergeSmoothness` scalar.
- Per fragment it evaluates every rect's rounded-rect SDF and folds them with
  the **textbook polynomial smooth union** (iq's `opSmoothUnion`,
  https://iquilezles.org/articles/distfunctions/ — public, pre-2010): shapes
  closer than the smoothness distance visually fuse like liquid.
- Everything downstream (refraction offset, edge highlight, anti-aliasing) is
  computed from the **merged** field and its finite-difference gradient — that
  single decision is why two nearby shapes look like one connected blob of
  glass: the refraction bends around the union silhouette, not per-shape.
- SDF distances are normalized by `resolution.y` before merging so the
  smoothness constant is resolution-independent.
- Corners are superellipse-based (exponent 2 = round, 4 = squircle), evaluated
  only in the corner region of the rect; edges use the standard rounded-box
  formula.
- Status in their repo: **only the shader supports it.** The slider/switch/
  lens components never populate the rect array (grep `frames` — no consumers),
  and their README TODO #1 is "utilize the existing multiform morphing shader
  in container effect view". So "the amazing morphing" is a capability, not a
  shipped feature, even upstream.

Their container API mirrors Apple's `UIGlassContainerEffect`: a `spacing`
value meaning "distance at which elements begin to merge" — a good API shape
for us to mirror **against Apple's public API semantics**, not theirs.

### 2. Refraction / dispersion model

- Depth ramp from the SDF: `depth = -distance`, thickness-limited; incident
  angle `asin(pow(1 - depth/thickness, 2))`, Snell transmit, offset =
  `-tan(t - i)` along the 2D gradient. Interior beyond thickness refracts
  nothing (flat center, bending rim) — same family as what we already ship.
- Chromatic dispersion = three samples with per-channel refractive indices
  (±0.02 around green). We already do dispersion (quadrant dispersion,
  `487eb26`); nothing new to take here.
- Fresnel rim and a directional glare are boosted in **LCH color space** so
  brightening doesn't desaturate. Idea worth remembering if our highlight
  looks washed out, standard colorimetry (CIE LAB/LCH).

### 3. Capture pipeline — the part relevant to our iOS-18 bug class

Two paths behind one `captureBackground()`:

- **Pre-26.2: private API.** A helper view whose layer class is
  `NSClassFromString("CABackdropLayer")` (+ `windowServerAware`, `groupName`
  KVC keys) inserted *below* the glass view, then `drawHierarchy(in:,
  afterScreenUpdates: false)` reads window-server-composited content.
  **We must not adopt this** — private API, App Store rejection risk, and
  it's exactly what broke for them on 26.2.
- **26.2+ fallback: root-view capture.** Walk to the root view,
  `rootLayer.render(in:)` into a CG context cropped to the glass frame.
  Flagged "High CPU usage" in their own comments.

Techniques here genuinely worth adopting independently (all public-API):

- **Presentation-layer tracking**: both paths use `layer.presentation() ??
  layer` for the glass view's own frame *and* the root layer, so the captured
  backdrop follows in-flight UIView animations instead of jumping to the model
  layer's final frame. Directly relevant to a tab pill that *slides*: capturing
  the model frame while animating means the pill refracts the wrong strip of
  backdrop for the whole animation.
- **Hide-self during capture** (`isHidden = true; defer { isHidden = false }`
  around `render(in:)`): keeps the glass view out of its own backdrop. If our
  capturer ever includes the bar/pill subtree, this is the standard cure —
  relevant to the "tapped icon disappears" family of bugs.
- **Zero-copy CG→Metal bridge**: draw into an IOSurface-backed `CVPixelBuffer`
  wrapped as an `MTLTexture` via `CVMetalTextureCache` — no `CGImage`
  round-trip per frame. Public API, Apple-documented pattern.
- Optional downscale (`backgroundTextureScaleCoefficient` 0.2–0.8) before an
  MPS gaussian blur — capture cost control.

### 4. Component patterns (skimmed)

- One shared `MTLDevice`/pipeline in a singleton renderer; per-view command
  queue + uniforms buffer.
- Effect-view mirrors `UIVisualEffectView` shape (contentView + effect), and a
  factory returns the native `UIGlassEffect` view on iOS 26+, custom below —
  same split we already have.
- Presets = parameter bundles (regular / lens / thumb) with per-style capture
  scale+blur. Their `regular` preset encodes the same polarity rule we use:
  dark scheme → near-black tint, light scheme → near-white tint.

## What this means for our plan

1. **Morphing is buildable from what we already own.** Our shader already has
   rounded-rect SDF + gradient + dispersion. The increment is: (a) accept N
   shapes instead of 1, (b) fold with polynomial smooth-min (public formula),
   (c) drive refraction/highlight from the merged gradient. Same increment
   translates to AGSL for Android (loop over a uniform float4 array — AGSL
   supports fixed-size uniform arrays).
2. **Capture hardening**: keep our public-API capturer, add presentation-layer
   tracking and hide-self-during-capture; consider IOSurface bridging if CPU
   cost shows up. Do NOT adopt CABackdropLayer.
3. **API shape**: mirror Apple's `UIGlassContainerEffect.spacing` semantics for
   the container/merge API so iOS 26 native and fallback paths share one prop.
