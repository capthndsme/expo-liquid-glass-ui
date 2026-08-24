# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

## Unreleased

### iOS below 26 renders glass again

`LiquidGlassView` now mounts its native view on every supported iOS version. The JS mount gate
read the `supportsNativeGlass` constant, which on iOS answers "is `UIGlassEffect` here?" (26+) —
so on iOS 15.1–25 every glass view silently degraded to a plain transparent `View` and the
entire Metal renderer shipped as unreachable code. QA's "invisible tab bar, floating icons" on
iOS 18.7.5 was this.

* New constant `supportsGlass` — "will `LiquidGlassView` render glass at all?" (iOS: always;
  Android: API 29+, same as before). The JS `supportsGlass` export now reads it, with a fallback
  to the old constant when the native predates it, and the mount gate uses it.
* `supportsNativeGlass` keeps its exact old meaning on both platforms — layout code that switches
  tab-bar strategies on it is unaffected.

### Liquid morphing (`metal.shape` + `metal.morph`)

The shader renderers — Android's `agsl` tier and iOS's Metal renderer — can now fold a second
rounded rect into a view's shape with a polynomial smooth-min. Refraction, chromatic dispersion
and the border light all read the *merged* field and its blended gradient, so the two silhouettes
neck together and fuse like iOS 26's `UIGlassContainerEffect` merge, rather than overlapping.

* `metal.morph` — `{ x, y, width, height, cornerRadius, smoothing }`, view-local dp. `smoothing`
  is the distance at which the shapes begin to merge; 0 (or an absent rect) disables it and the
  pipeline is bit-identical to before. Drivable per-frame via Reanimated `useAnimatedProps`,
  like the rest of `metal`.
* `metal.shape` — `{ x, y, width, height }`: insets the primary shape from the view, turning the
  view into a *canvas* larger than its glass. Both platforms clip their draw at the view bounds,
  so this is what gives a morph partner room to approach and separate. `cornerRadius` resolves
  against this rect; the drawn `border` and child clipping still track the view.
* The example app gains a **morph** tab: a bar-in-canvas with a draggable puck that necks in and
  out of it, with selectable smoothing.

Implemented from this project's own shader lineage (the existing rounded-rect SDFs and gradients)
plus the public smooth-min formula; see `docs/liquidglasskit-study.md` for what was deliberately
*not* taken from elsewhere.

### Android support

The library now runs on Android 10+ (API 29). Android has no equivalent of Apple's `UIGlassEffect` —
no primitive lets an in-app view sample its siblings' pixels — so this is a port of the **Metal
renderer**, the path iOS uses below 26, written in AGSL.

**Added**

* `LiquidGlassProvider` — marks the content that should show through the glass. Android needs the
  backdrop captured explicitly; glass views are its **siblings**, never its children, which is what
  keeps a view out of its own backdrop. Renders as a plain `View` on iOS and web, so it is safe to
  wrap unconditionally.
* `providerId` on both components, for pairing when there is more than one provider. Namespaced per
  window, so a `Modal` can reuse `"default"`.
* `metal.android.quality` — `"low" | "medium" | "high"`. Selects one of three separately compiled
  shaders; the dispersion loop needs a compile-time-constant bound to unroll, so the tiers cannot be
  one shader driven by a uniform. `"medium"` is the iOS-parity default.
* `metal.android.maxTier` — a ceiling on the rendering ladder, using the same strings
  `onRendererChange` reports. It can only lower a device, never raise one.
* `setGlassDebugLogging(enabled)` — provider-recording and glass-draw rates under the
  `ExpoLiquidGlass` logcat tag. No-ops off Android.
* A **playground** tab in the example app (both platforms): every `metal` dial on a slider over a
  stage built to be read through glass — stripes for refraction, dark and light patches for the
  rim — with a draggable panel and a paste-ready JSON readout of the current configuration.
* `onRendererChange` gained `"agsl"`, `"scrim"` and `"none"`.
* `metal.highlight.width` — depth of the crisp border-light line, in dp. Default `0.75`
  (measured off a real iOS 26 icon). iOS drops the key.
* `metal.highlight.falloff` — angular falloff exponent of the rim's two lobes (Kyant's `falloff`).
  Default `1`. iOS drops the key.
* `metal.refraction.swirl` — how far the edge refraction leans toward `highlight.angle`'s light
  axis. Default `0`: per-edge pixel solves of real iOS 26 screenshots found no lean (the twist
  the eye reads is `depth`'s radial term sweeping the corners, which ships). Kept as a
  stylisation knob, clamped to `[-1, 1]`. iOS drops the key.
* The playground gained a **wallpaper backdrop** (the Backdrop Catalog demo wallpaper, toggleable
  back to the gradient stage) plus `swirl` and `falloff` sliders.
* `LiquidGlassStack` — declarative stacked glass (glass refracting other glass: a slider under a
  glass sheet, tabs over glass rows). Layers go bottom to top; each boundary expands to a nested
  provider with an auto id that reaches descendant glass views **through context**, so reusable
  glass components need no `providerId` prop. Keep the layer list static and toggle content inside
  a layer; every level re-records everything below it, so two or three layers is the sane budget.
  Renders plain views on iOS and web. Also exports `useGlassStackProviderId()`.
* `interactive` now works on Android — the native port of iOS 26's
  `UIGlassEffect.isInteractive`. A spring-driven specular blooms under the finger and chases it,
  the refraction dents into a travelling bulge and deepens while pressed, and the view inflates
  ~3.5 %, translates a fraction toward the drag and stretches along it, rubber-band style — the
  jelly. All
  springs run natively off the animation stage (no JS per frame) and children stay fully
  interactive. A bare-glass press held past ~150 ms takes the gesture from ancestor scrollers so
  dragging glass does not scroll it away; quick flicks still scroll, and a `PanResponder` grant
  still cancels cleanly. On the blur and scrim tiers the press paints an additive wash instead,
  so the feedback never disappears with the tier. Interaction model derived from
  AndroidLiquidGlass (Apache-2.0, see `NOTICE`).

**Behaviour**

* The highlight is remodeled against real iOS 26 glass rather than translated from the Metal
  fallback. Metal's highlight is a signed multiplicative wash as wide as `refraction.height`
  (20 pt at `regular`): it vanishes over dark backdrops and darkens the whole quadrant opposite
  the light by up to ±25 % — an inset shadow real glass does not have. Android now draws **only**
  the glass border light: a thin additive rim lighting *both* light-axis lobes
  (`pow(abs(dot(normal, light)), falloff)` — the falloff model of Kyant's highlight shader),
  fading over `highlight.width` (1.5 dp). The signed wash and the separate edge-contour line are
  deleted outright — eye-tested against an iOS 26 button, the interior of real glass is flat and
  its edge is a hairline, not a 3-layer stack. A second measurement round against real iOS 26
  screenshots (docs/android-port/research/04) then tuned the pieces: the crisp line is 0.75 dp
  with a faint ~7 dp sheen under the lit edges, and the
  default light axis is vertical (`highlight.angle` 180, was 135 — real bars are perfectly
  top/bottom symmetric with dead side rims). `highlight.intensity` reads as rim strength; `0`
  still disables everything, and the highlight no longer distinguishes `angle` from
  `angle + 180` — only the `refraction.swirl` lean flips there. A dark flank contour shipped for
  one round between measurement passes and was deleted again: per-channel solves showed the dark
  edge line on real icons is the refraction *fold* imaging dark content — the lens produces it
  for free, and inked lines double-darken it.
* Chromatic dispersion taps walk **along the displacement axis** (R deepest, B shallowest, blue
  the outermost fringe) — measured off real iOS 26; the Metal source (and the first port) walked
  the tangent, which puts the fringe on the wrong axis.
* The border stroke is pure white light. It kept the iOS `CAGradientLayer` geometry (four stops,
  fading at the axis ends) but the black end stops are now transparent — real iOS 26 glass has no
  dark edge component — and the gradient axis follows `highlight.angle` instead of being pinned
  corner-to-corner.

* Automatic degradation by API level: `agsl` (33+) → `fallback-blur` (31–32) → `scrim` (29–30) →
  unsupported. A tier is also dropped when the shader fails to compile *or* silently renders nothing,
  which an off-screen render probe detects at startup rather than leaving to a user.
* A provider nobody reads skips recording and draws like a plain `ViewGroup` — a provider wrapped
  unconditionally around a glassless screen, or an empty stack layer, now costs nothing. Glass
  views also attach to their provider eagerly at mount, so the first frame is recorded, not a
  scrim.
* The startup render probe works again. `highlightWidth` was never primed, so since the highlight
  remodel the probe threw into its own catch and reported "inconclusive" on every device —
  disabling the silent-driver-failure detection it exists for. It now completes, and primes the
  press-glow branch on so drivers compile the whole program.
* Above 25 % screen coverage an unset `quality` drops to `"low"` automatically.
* Dev builds warn, once each and with the fix named, for: glass inside its own provider, glass inside
  a different provider, an unmatched `providerId`, a provider in another window, a `SurfaceView`
  inside a provider, and a glass view inside a scroller with stretch overscroll enabled.
* `renderer` is accepted and ignored on Android; `cornerStyle` and `metal.captureQuality`
  likewise, each for a documented reason.

**Known limits**

* Video behind glass requires `TextureView` (`expo-video`'s `surfaceType="textureView"`).
  `SurfaceView` composites out of process and is a hole in the backdrop.
* Set `overScrollMode="never"` on any scroller containing glass. Android 12+ stretch overscroll is a
  pixel-space `RenderEffect` that no child can see or compensate for.
* Glass does not refract other glass *by default* — sibling panels do not see each other. Stacking
  is opt-in via `LiquidGlassStack` (or hand-nested providers): see the README's "Stacked glass"
  section and the example app's `stack` tab. The dev-mode nesting diagnostic logs the stacked
  topology once at INFO; only glass inside the provider it *reads* — a genuine feedback loop —
  still warns.
* A `Modal` needs its own provider and cannot refract the activity behind it.

**Packaging**

* The published tarball no longer ships `bun.lock` or the internal `docs/` tree, and excludes
  `android/build/`, `android/.gradle/` and `android/.cxx/`. 636 kB → 391 kB.
* `NOTICE` added: parts of the AGSL shader derive from
  [AndroidLiquidGlass](https://github.com/Kyant0/AndroidLiquidGlass) (Apache-2.0, © 2025 Kyant).

### [0.1.7](https://github.com/rit3zh/expo-liquid-glass-view/compare/v0.1.6...v0.1.7) (2025-09-19)


### Features

* **glass:** add ExpoLiquidGlassContainer with layout direction support ([decc813](https://github.com/rit3zh/expo-liquid-glass-view/commit/decc8130854ad783da6f61488541dfba54309f67))
* **glass:** add ExpoLiquidGlassContainer with layout direction support ([2c33ac5](https://github.com/rit3zh/expo-liquid-glass-view/commit/2c33ac5a8df5350e8e959ede2f4f1437686f1879))

### [0.1.6](https://github.com/rit3zh/expo-liquid-glass-view/compare/v0.1.5...v0.1.6) (2025-08-04)
