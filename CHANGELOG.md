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
* `onRendererChange` gained `"agsl"`, `"scrim"` and `"none"`.

**Behaviour**

* Automatic degradation by API level: `agsl` (33+) → `fallback-blur` (31–32) → `scrim` (29–30) →
  unsupported. A tier is also dropped when the shader fails to compile *or* silently renders nothing,
  which an off-screen render probe detects at startup rather than leaving to a user.
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
* Glass does not refract other glass — a deliberate divergence from iOS.
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
