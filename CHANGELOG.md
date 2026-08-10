# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

## Unreleased

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
* `metal.highlight.width` — depth of the specular rim bloom, in dp. Default `3.5`. iOS drops the key.
* `LiquidGlassStack` — declarative stacked glass (glass refracting other glass: a slider under a
  glass sheet, tabs over glass rows). Layers go bottom to top; each boundary expands to a nested
  provider with an auto id that reaches descendant glass views **through context**, so reusable
  glass components need no `providerId` prop. Keep the layer list static and toggle content inside
  a layer; every level re-records everything below it, so two or three layers is the sane budget.
  Renders plain views on iOS and web. Also exports `useGlassStackProviderId()`.

**Behaviour**

* The highlight is remodeled against real iOS 26 glass rather than translated from the Metal
  fallback — the shader's one deliberate visual divergence. Metal's highlight is a multiplicative
  wash as wide as `refraction.height` (20 pt at `regular`): it vanishes over dark backdrops and
  darkens the whole quadrant opposite the light by up to the same ±25 %. Android instead draws a
  thin **additive** rim that lights *both* light-axis lobes (`abs(dot(normal, light))` — the
  falloff model of Kyant's highlight shader), fading over `highlight.width`, with the old signed
  shading kept underneath at a quarter of its former weight. `highlight.intensity` now reads as rim
  strength rather than wash gain; `0` still disables everything.

* Automatic degradation by API level: `agsl` (33+) → `fallback-blur` (31–32) → `scrim` (29–30) →
  unsupported. A tier is also dropped when the shader fails to compile *or* silently renders nothing,
  which an off-screen render probe detects at startup rather than leaving to a user.
* A provider nobody reads skips recording and draws like a plain `ViewGroup` — a provider wrapped
  unconditionally around a glassless screen, or an empty stack layer, now costs nothing. Glass
  views also attach to their provider eagerly at mount, so the first frame is recorded, not a
  scrim.
* Above 25 % screen coverage an unset `quality` drops to `"low"` automatically.
* Dev builds warn, once each and with the fix named, for: glass inside its own provider, glass inside
  a different provider, an unmatched `providerId`, a provider in another window, a `SurfaceView`
  inside a provider, and a glass view inside a scroller with stretch overscroll enabled.
* `renderer` is accepted and ignored on Android; `cornerStyle`, `interactive` and
  `metal.captureQuality` likewise, each for a documented reason.

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
