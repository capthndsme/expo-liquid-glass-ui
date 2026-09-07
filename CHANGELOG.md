# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

## 0.2.0 — 2026-09-07 · one package

`expo-liquid-glass-view` — this fork of rit3zh's, on its `android-port` branch — is folded into
`expo-liquid-glass-ui`, and stops tracking upstream. Consumers install one package and import
everything from it: the view (`LiquidGlassView`, `LiquidGlassProvider`, `LiquidGlassContainer`,
`LiquidGlassStack`, the `metal` types and enums) alongside the controls. The native module keeps
its names (`ExpoLiquidGlass`, `LiquidGlassView` …), so a project must drop any remaining
`expo-liquid-glass-view` dependency or two copies will register the same views. In the tree the
kit stays at the top of `src` and the view lives under `src/core`, with its history. Everything
below this entry is the view's own log.

## Unreleased

### A fuller kit: buttons merge, and eight more controls

* **`LiquidGlassGroup`** — iOS 26's `GlassEffectContainer` for the kit's controls. Buttons, icon
  buttons and chips laid out in a group fuse into their nearest neighbour when pressed: on the
  shader renderers a canvas glass view under the row draws the merged silhouette from
  `metal.shape` + `metal.morph`, the pressed member's pane and its partner's crossfading to it
  for the duration of the press — the pressed rect redrawn from the exact press channels the
  pane is transformed by (`buttonPressTransform`, now a shared worklet), the press light riding
  along, and a tinted member keeping its colour through a flat "ghost" of its tint. On iOS 26 the
  row is a `LiquidGlassContainer` and the system merges. Membership is by context
  (`useGlassGroupMember`), so custom controls can join.
* **`LiquidGlassButton`**: the press light is now the shader's own — the reference's flat 0.08
  wash and 0.15 radial lobe, through the base view's `glow` prop, drawn inside the glass under
  the rim. The flat white overlay that stood in for it read as a Material tap highlight on
  Android; it remains only where `glow` cannot reach (iOS 26's native glass, the no-glass
  degrade), as the reference's declared fallback. Also `size` (`small` 36 / `regular` 48 /
  `large` 56), `shape="circle"`, `icon` (node or `({ color, size }) => node`), `loading`,
  `accessibilityLabel` / `accessibilityState`, and `providerId` accepts an array. The pane is
  now its own layer under the content, so a merge can fade it without touching the label.
* **`LiquidGlassIconButton`** — the circular button with a required `accessibilityLabel`.
* **`LiquidGlassChip`** — the small button with a `selected` state (accent wash, white label).
* **`LiquidGlassToolbar`** — leading and trailing groups of controls that merge, a floating title
  capsule between them.
* **`LiquidGlassStepper`** — a glass capsule with `−` / `+` ends; the held end blooms a canvas
  thumb lit by the press, the value pops on change, and a held end auto-repeats.
* **`LiquidGlassCard`** — a padded pane of the bar's material, optionally pressable (98 %),
  optionally adaptive.
* **`LiquidGlassToast`** — a capsule that springs in from an edge with a message and asks to
  leave after `duration` or a tap; stays mounted through its exit.
* **`LiquidGlassSheet`** — a bottom sheet with top-only corners, a handle, a dim, and a
  drag-to-dismiss with overdrag resistance, a 30 % / 900 dp·s⁻¹ release rule and a spring home.
* Example: the **ui kit** tab is now a scrolling showcase of every control over the stage —
  toolbar, merging button rows, icon buttons, chips, stepper, switch, slider, segmented, card,
  toast and sheet.

### Fixes

* **A dragged slider no longer springs back to old positions.** The slider, switch and tab bar
  guarded their controlled-value effect with "is this the last value I reported?" — but passive
  effects run after paint, so the effect of an earlier render could fire after several newer
  reports had gone out, decide the older value was the app's, and `animateTo` it. On a busy page
  the slider visibly bounced between stale positions mid-drag (measured off a screen recording:
  the fill edge jumping back 80 px and forward again). `useEchoFilter` now remembers every
  un-echoed report and only treats a value it never reported as external; it is exported for
  controls of your own.
* **The pill deflates on arrival.** `useDampedDrag`'s release gate waited for the smoothed
  velocity channel to fall below 0.01 range-fractions/s — the channel that feeds the jelly,
  which rings down on an underdamped spring for a third of a second after the follower has
  landed. A released pill sat inflated ~0.3 s after arriving. The threshold is 0.15, where the
  residual stretch is ~1 %; the deflate now starts on arrival.
* The button's press light defaults to 0.35 of the shader's (`pressLight`) with the dent on —
  see the README's button section for why full strength read as a pressed-state wash.

### iOS below 26 catches up with Android

The Android shader had outgrown the Metal renderer it was translated from: every remodel measured
against real iOS 26 glass (docs/android-port/research/04) had landed on Android alone. The Metal
pass is now the same algorithm line for line, and the two must move together from here.

* **Continuous corners in the Metal SDF** — the same calibrated superellipse family Android
  renders (`ContinuousCorners.swift`, research/05): the SDF, the content mask, the border and the
  backdrop fill all draw one curve. The SDF was circular under Apple's continuous content clip,
  and the border — circular too — sat up to 0.12 r inside the glass at every corner apex, a
  visible double edge on any squircle.
* **The border light** replaces the Metal wash: an additive two-lobe rim with `highlight.width`
  (0.75 pt) and `highlight.falloff`, plus the ~7 pt sheen under the lit edges. The signed
  multiplicative wash — `refraction.height` wide, darkening the quadrant opposite the light by up
  to 25 % — and the separate contour line are gone; they were the inset shadow real glass does
  not have. The stroke is pure white light along the `highlight.angle` axis, no black tails.
* `refraction.swirl` and `dispersion.quadrant` work on iOS; dispersion taps walk the displacement
  axis (blue outermost), as measured.
* **`interactive` on the Metal path**: `GlassPressAnimator.swift`, the port of the Android
  springs — glow under the finger, the dent and lens boost, 3.5 % inflation, tanh follow and
  axis-projected stretch — driven by the view's own touches (an ancestor recogniser taking the
  touch releases like a lift) and a `CADisplayLink` that exists only while a spring is unsettled.
  The transform goes on the surface and content subviews, never on the view React Native owns.
* **`glow` on the Metal path** (`GlassGlowOptions`), so the kit's bar lights under a dragged pill
  on iOS 18 too.
* `GlassParams` is mirrored in Swift and Metal and checked by
  `docs/inspiration-port/tools/check-params-layout.py`, which re-derives both layouts from the
  sources — there is no Mac on the build box, so the iOS work is written blind; see
  `docs/inspiration-port/PLAN.md` for the Mac checklist.

### Inner shadow and magnification (`metal.innerShadow`, `metal.magnification`)

Both shader renderers, from the AndroidLiquidGlass catalog (Apache-2.0, see `NOTICE`):

* `innerShadow: { radius, offsetX, offsetY, opacity }` — Kyant's `InnerShadow` as an SDF band
  rather than a blurred layer: the blurred coverage of the shape minus itself translated by the
  offset, evaluated on the merged field so a morph partner shades as one piece. Default cast is
  straight down by one radius (the top inner edge shades — light from above); default opacity
  0.15. Off at radius 0. Animatable like the rest of `metal`; `lerpMetal` blends it.
* `magnification` — the whole-surface lens research/04 (C16) found missing: sampling contracts
  toward the shape centre by the factor, so the backdrop reads enlarged through the pane the way
  iOS 26's slider thumb enlarges its track. `1` is off; clamped to `[1, 4]`; ≥ 1 only samples
  inward, so the padding budget is untouched.
* The playground gained `innerShadow` and `lens` dials.

### Adaptive glass (`adaptive`, `onBackdropLuminance`)

* The shader renderers read the mean luminance of the backdrop under the view — Android renders
  the provider content, transformed exactly as the glass records it, into an 8×8 probe through a
  private `HardwareRenderer` and reads it back off the RenderThread (`GlassLuminanceProbe`);
  iOS reads the capture buffer the CPU already holds — at most four times a second and only when
  the backdrop or the geometry moved. `PixelCopy` was rejected because it captures the glass and
  its own content, a feedback loop for a label that flips on the reading.
* The frost's polarity follows the backdrop instead of the colour scheme: dark content under a
  dark frost, light under a light one, hysteresis at 0.45 / 0.55, a 350 ms crossfade.
  `onBackdropLuminance` reports `{ luminance, dark }` when the value moved ≥ 0.02 or the polarity
  flipped. iOS 26's native glass adapts on its own and ignores the prop.
* Kit: `useAdaptiveGlass` (scheme + UI-thread crossfade progress), `useGlassUITheme(scheme?)`,
  and an `adaptive` prop on `LiquidGlassTabBar` and `LiquidGlassButton` that switches the whole
  dress with the backdrop — surface wash crossfading through `useAnimatedProps` (as a processed
  ARGB number; `interpolateColor` already returns one inside a worklet, and processing it again
  rotated the channels — the pill went cyan for one build), labels crossfading, icons swapping.
* The example gained a **goodies** tab: a draggable adaptive card with its reading on screen, a
  draggable magnifier, and an adaptive tab bar over scrolling light/dark bands.

### Kit

* The resting tab pill no longer refracts. The accent strip it reads through kept the bar's
  24 dp lens at rest (a departure taken to match the pill's brightness to the bar's — a
  three-layer-stack artefact, since fixed), so the backdrop's edges bent inside a pill whose own
  recipe was innocent. The strip's lens is the reference's `24 dp × progress` again: blur at
  rest, the lens with the grab. On iOS the resting pill carries the bar's blur and vibrancy
  itself, because the window capture excludes glass views, and the soft cutout now holds the
  bar's wash as well as the lift.
* The accent copy seen through the pill is minified at rest — 56/64 of the visible row, the
  strip's own ratio — and grows back to the neighbours' size as the pill lifts, never past it
  (the reference's 1.2× swell inside a pill inflating to 78/56 read as a huge glyph). A
  full-size glyph on a shrunken bar read wrong at rest, an oversized one read wrong lifted.
* The grabbed tab pill and the held thumbs carry the reference's inner shadow (8 dp × p and
  4 dp × p) and its drop shadow — a `boxShadow` sibling under the glass, opacity-animated on the
  pill, resting on the thumbs, drawn outside the capsule. The thumbs' `shadow*` quartet was
  iOS-only; `boxShadow` draws on both platforms.
* `LiquidGlassSlider`: a rubber band past either stop (10 dp through tanh) and `onEdgeReached`,
  which fires once per arrival at an end — wire `expo-haptics` there; the kit takes no haptics
  dependency.
* `useGravityHighlight` — a smoothed accelerometer-to-`highlight.angle` filter (the catalog's
  `UISensor`), fed by the app so `expo-sensors` stays optional.

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

### Progressive blur (`metal.progressiveBlur`)

The scroll-edge melt: a blur whose radius ramps across the view, iOS 26's "content dissolves
into blur" treatment. `{ startRadius, endRadius, direction, start, end }` — dp, a Hermite-eased
ramp along `direction` (named for where the blur increases toward), confined to the
`start`..`end` fraction window.

* Android `agsl` (API 33+): a blur pyramid — one hwui blur per doubling of radius from ~4.5 px up
  to the ramp's maximum, cross-faded per pixel by the ramp so each pixel mixes the two levels that
  bracket its radius. Smooth at every radius (Skia's blur downsamples internally) and the sharp
  end is the untouched original. Radii in the iOS `sigma = 0.5 * r` convention so the two
  platforms match by number. Replaces the uniform `blurRadius` stage when present; equal radii
  collapse to the plain uniform stage. A first cut as a separable variable-radius Gaussian in AGSL
  point-sampled the backdrop at strides up to 14 px and streaked every blurred row; gone.
  `metal.android.quality` sets the level count — `low` 2, `medium` 3, `high` up to 6 — because each
  level is a full-node blur, weight and blend: ~10 ms per level for two full-width scrims covering
  440 dp of a 1080×2400 screen on an Adreno 610 (Redmi Note 13 4G), against a 23 ms floor for the
  glass pass alone over the same nodes, and against 105 ms for the AGSL comb it replaces. A view
  covering more than a quarter of the screen auto-resolves to `low`, as before.
* iOS Metal renderer: the existing blur passes gain a per-pixel radius ramp.
* Degradation ladder: Android API 31–32 approximates with a uniform blur at the mean radius;
  `scrim` ignores it; if the variable shader fails to compile on a device, the stage falls back
  to a uniform blur rather than disappearing.
* The example app gains a **blur** tab: text melting into ramped blur at both screen edges.
* Also fixed here: the shader warm-up probe was missing four uniforms (`touchLens` and the three
  morph/shape ones), so it reported INCONCLUSIVE everywhere and the silent-driver-failure
  detection was itself failing silently.
* Blur stages — this one and the plain `blurRadius` one — now read an edge-extended copy of the
  recorded content: a one-tap pass fills the node's padding with the content's clamped edge
  pixels before any blur runs, so hwui's blur no longer smears the transparent outside inward and
  the glass samples right up to the content edge. Before, the glass stayed a full blur reach
  inside the content and every pixel within that reach of a provider edge was a copy of the row
  or column at the inset: a visible band along the screen edge of any blurred bar, and a dark line
  across both margins of a full-width scrim.

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
