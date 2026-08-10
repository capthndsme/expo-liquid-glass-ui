# Android Port — Implementation Plan

**Repo:** `capthndsme/expo-liquid-glass-view` (fork of `rit3zh/expo-liquid-glass-view`)
**Base commit:** `92e4ae7` — "feat rewrite liquid glass with custom Metal renderer"
**Target:** Expo SDK 56 / RN 0.85.3 / New Architecture only
**Status:** In progress — all seven open decisions taken (§3). **Phases 0, 1 and 2 complete and verified on device.** Four Phase-1 day-one checks remain open (D4 video, R2 fling, glass-over-glass, `Modal`). Phase 3 — the shader — is next.

---

## How to use this document

Every task is a checkbox. Tick them as you land them. Each phase has an **Acceptance** block — do not advance until it passes on a real device. Phases 0–2 are strictly sequential; 3 and 4 can overlap; 5–8 are the tail.

Supporting research lives in [`research/`](./research/) and is cited throughout:

| Doc | Contents |
|---|---|
| [`00-ios-parity-spec.md`](./research/00-ios-parity-spec.md) | Exhaustive spec of current iOS behaviour: every prop, default, uniform, pass, and lifecycle rule. The parity target. |
| [`01-android-graphics.md`](./research/01-android-graphics.md) | Android graphics stack research: RenderNode, RenderEffect, AGSL, capture strategies, SurfaceView/TextureView, frame scheduling, prior art. |
| [`02-expo-android-integration.md`](./research/02-expo-android-integration.md) | Expo module mechanics: gradle, autolinking, Kotlin DSL, props/records/enums/events, TS platform branching, publishing. |
| [`03-shader-port.md`](./research/03-shader-port.md) | Metal → AGSL translation: semantic diff, coordinate spaces, full draft shader, uniform budget, 12 named pitfalls. |

**Cross-document resolutions** — where one doc answers another's open question:

- `01-android-graphics.md` §10.7 flags Expo SDK 56's `minSdkVersion` as UNVERIFIED. **It is 24**, verified from `react-native@0.85.3/gradle/libs.versions.toml` in `02-expo-android-integration.md` §2.3. All four degradation tiers are therefore reachable.
- `01-android-graphics.md` §9.3 and `03-shader-port.md` §4 disagree on where `saturation` is applied. See the Phase 3 task list.

---

## 1. What we are building

iOS has three backends: Apple's `UIGlassEffect` (iOS 26+), a custom Metal renderer, and a `UIBlurEffect` fallback when Metal is unavailable.

**Android gets no equivalent of the first one.** There is no Android primitive that lets an in-app view sample the pixels of its siblings — `View.setRenderEffect` applies to a view's *own* content, and `Window.setBackgroundBlurRadius` is cross-*window* only and disabled on many OEM builds. So every drop of Android parity comes from the capture-and-refract route, which on iOS is the *fallback* path. See `00-ios-parity-spec.md` §9.1.

The Android implementation is therefore a port of the **Metal renderer**, not of the native one:

- capture the view hierarchy behind the glass into a `RenderNode`, excluding glass views themselves
- blur it with `RenderEffect.createBlurEffect`
- refract it with an AGSL `RuntimeShader` — a port of `ios/Shaders/LiquidGlass.metal`
- composite tint, frost, saturation, highlight, noise
- drive the whole thing from a shared per-frame scheduler with the same adaptive-stride heuristics as `BackdropCapturer.swift`

### Explicitly NOT in scope

| Feature | Why | Behaviour on Android |
|---|---|---|
| `LiquidGlassContainer` merging (`spacing`) | Today the merge is a pure UIKit compositor side effect — there is *zero* coordination code to port (`00-ios-parity-spec.md` §6). Reproducing it means one surface owning all children's SDFs with a smooth-min union: a rewrite, not a port. | Passthrough `ViewGroup`; `spacing` ignored. Matches today's non-iOS JS behaviour. |
| `interactive` | Apple's internal press deformation. No public equivalent; a hand-written approximation would not match. | No-op. Already ignored by the Metal renderer on iOS too. |
| `cornerStyle: "continuous"` | No continuous-corner primitive on Android. **Mitigating fact:** the iOS *Metal* path is already circular-only — `cornerStyle` only ever reaches `CALayerCornerCurve` for content clipping (`00-ios-parity-spec.md` §9.9). Ignoring it is full parity with the renderer we are porting. | Ignored. |
| A "native" backend | Does not exist on Android. | `renderer="native"` resolves to the shader path, exactly as it does on iOS < 26. |

---

## 2. Locked decisions

These are settled by the research; do not relitigate them mid-implementation.

**Build & integration** — `02-expo-android-integration.md`

1. **No Jetpack Compose.** Plain Kotlin + `Canvas`/`RenderNode`/`RenderEffect`. This is the single biggest divergence from `818jsy/expo-liquid-glass-native`, and it is what removes the config plugin, the Compose compiler-version coupling, the `PopupWindow`, and the second React root.
2. **No config plugin, no `app.plugin.js`, no `@expo/config-plugins` dependency.** Autolinking covers project inclusion, package registration, SDK versions and core deps with zero consumer configuration.
3. **Zero third-party Maven dependencies.** Android platform + AndroidX only. Keeps the published source small and avoids repository configuration entirely.
4. `android/build.gradle` uses `plugins { id 'com.android.library'; id 'expo-module-gradle-plugin' }` — the canonical SDK 56 form, not the legacy `ExpoModulesCorePlugin.gradle` style the reference repo uses.
5. **`minSdk` stays inherited at 24.** Raising it breaks manifest merge for every consumer. Gate at runtime on `Build.VERSION.SDK_INT`.
6. **Do not re-parent React children.** `ExpoView` is a `ViewGroup` and RN's mounting layer applies Yoga frames directly. Draw the glass in `dispatchDraw` *before* `super.dispatchDraw(canvas)`. This makes `containerStyle` work on Android with zero Kotlin code, and keeps children fully interactive.
7. **`cornerRadius`** crosses as `Either<Double, GlassCornerRadii>` — matches iOS 1:1, no iOS churn.
   ⚠️ **Correction (found in Phase 2):** the research's `@OptIn(EitherType::class)` is **wrong for SDK 56** — `EitherType` is now deprecated (*"The Either type is no longer experimental, so this annotation is no longer needed"*) and compiling with it produces warnings. Use `Either` with no opt-in.
8. **`tint`** is declared `Int?` in Kotlin and sent as `processColor(tint)` from JS. The `Color` converter rejects `rgba()`/`PlatformColor` and silently mis-parses `#RRGGBBAA` as `#AARRGGBB`.
9. **`Name()` is mandatory inside each `View {}` block.** Without it the component registers as `ViewManagerAdapter_ExpoLiquidGlass` and JS cannot find it. Swift gets away with omitting it; Android does not.
10. **`OnViewDidUpdateProps`** is the coalescing hook — the analogue of iOS's `setNeedsAppearanceUpdate()`. Prop setter order is JS-map order, *not* DSL order; never write a setter that depends on another prop already being set.
11. **No old-architecture branches.** SDK 56 is New Architecture only; `newArchEnabled: false` is ignored. No `isBridgeless` checks, no `UIManagerModule`.

**Rendering** — `01-android-graphics.md`, `03-shader-port.md`

12. **API floors:** `RenderNode` = **29**; `RenderEffect` + `createBlurEffect` + `createChainEffect` = **31**; `RuntimeShader` / `createRuntimeShaderEffect` (AGSL) = **33**. Full glass needs 33.

**Topology** — `01-android-graphics.md` §9. This was the open architectural question; the research settles it.

12a. **Provider + sibling glass views, paired by an explicit `providerId` registry.** A `LiquidGlassProvider` records `super.dispatchDraw()` into a `RenderNode` inside its own real render pass — no extra draw, no extra invalidate — and glass views are **siblings drawn after it**, reading that node. This is the Dimezis 3.x `BlurTarget` model.
12b. **Self-exclusion is structural, not filtered.** A glass view is never inside the recorded subtree, so it cannot appear in its own backdrop. **No static `isCapturingBackdrop` flag, no marker canvas, no recursion guard** — and therefore no cyclic-render-tree failure class. This is a genuinely better mechanism than the iOS one we were going to port.
12c. **Do not auto-discover the provider by walking up the view hierarchy.** That is exactly what `expo-blur` did before SDK 55, and it is precisely what broke inside RN `Modal` ([expo/expo#44165](https://github.com/expo/expo/issues/44165)). A `Modal` is a separate window; glass inside one needs its own provider.
12d. **The effect chain goes on a second, padded `RenderNode` owned by each glass view** — never on the provider's node, and never via `View.setRenderEffect`, which cannot be cropped and clips to bounds.
12e. **Recording a display list is not rasterization.** Unchanged children re-reference their existing RenderNodes, so re-recording is near-free — and `contentNode` is a *live reference*, not a snapshot, so content changes require no `invalidate()` on the glass views at all. This is why most of the iOS `BackdropCapturer` machinery is not needed (see Phase 4).
13. **`float`/`vec*` throughout the shader — zero `half`.** Confirmed fp16 overflow failures on Samsung/Mali hardware (haze [#520](https://github.com/chrisbanes/haze/issues/520), [#530](https://github.com/chrisbanes/haze/pull/530)). Emulators execute mediump at fp32, so `half` bugs **pass in CI and fail on device**. Only `main`'s return type is `half4`, because AGSL requires it.
14. **Construct a NEW `RenderEffect` object whenever uniforms change.** HWUI short-circuits on pointer identity (`RenderProperties.cpp`: `if (mImageFilter.get() == imageFilter) return false;`) and Skia snapshots the uniform builder by value at effect-creation time. Re-assigning the same effect object is a guaranteed no-op.
15. **Guard `blurRadius > 0` before `createBlurEffect`** — `createBlurEffect(0f, 0f, …)` throws `IllegalArgumentException: nativePtr is null` ([b/241546169](https://issuetracker.google.com/issues/241546169), open).
16. **Clamp taps in-shader against a `crop` uniform *in addition to* padding the node.** Skia's decal-vs-clamp edge behaviour is device- and version-dependent; relying on either is a correctness bug.
17. **Frost colour is hardcoded white/black**, not resolved from `?attr/colorSurface`. iOS uses `UIColor.systemBackground` = `#FFFFFF`/`#000000`; Material's dark default is `#121212` and would visibly diverge at `frost: 0.36`.
18. **`fwidth` does not exist in AGSL** (it is `$es3`-tagged and rejected in strict-ES2 mode). Replace with the constant `aa = 1.0` — exact, because the SDF has unit gradient and we work in pixels.
19. **Blur is `RenderEffect.createBlurEffect`, not a ported shader.** Match the iOS 8-tap Gaussian (`σ = 0.5 × blurRadiusPx`) with `R = √3 × (0.5 × blurRadiusPx − 0.5) ≈ 0.866 × (blurRadiusPx − 1)`, because HWUI converts radius→sigma internally as `0.57735 × R + 0.5`. Skia's blur is *strictly better* than iOS's above σ ≈ 10 px — the iOS kernel's tap spacing grows linearly with radius, so at large radii it ghosts into 17 faint copies of a high-contrast edge. Expect Android to look slightly softer there, and treat that as an upgrade.
    **`metal.blurRadius` defaults to `0` for both variants**, so the default path is a *single* effect stage with no blur at all — blur is opt-in. iOS uses 3 passes when blurring (H, V, glass); Android uses 2. We are strictly cheaper.
20. **Dispersion taps: 16 → 8 by default.** Lossless at `regular` defaults (6 dp ⇒ 7 taps); clips `clear` from 11 to 9. Tap count is a `const int` baked into the source string — it **cannot** be a uniform, because AGSL loops must have compile-time-constant bounds.

---

## 3. Open decisions — need a call before the phase that consumes them

> **All seven are now decided** (2026-08-10). Each recommendation was taken as written. Kept in full because the reasoning is the rationale for the code.

- [x] **D1 — What does `onRendererChange` report on Android?** *(needed by Phase 2)*
  `TGlassActiveRenderer` is currently `"native" | "metal" | "fallback-blur"`. Options: (a) add `"agsl"` and report that; (b) report `"metal"` on Android, treating it as "the custom shader renderer" regardless of API; (c) rename the concept.
  **Recommendation: (a).** Additive to the union, honest, and lets consumers distinguish. Keep `"fallback-blur"` for the API 31–32 blur-only tier and `"none"`… — see D2. The *input* `renderer` prop union stays `"auto" | "native" | "metal"` unchanged, where `"metal"` means "force the shader path" on both platforms.
  **Decision: (a).** `GLASS_ACTIVE_RENDERERS` becomes `["native", "metal", "agsl", "fallback-blur", "scrim", "none"]`. Android reports `"agsl"` (33+), `"fallback-blur"` (31–32), `"scrim"` (29–30) and `"none"` (<29). iOS is untouched — it never emits the three new values. The input `renderer` union is unchanged.

- [x] **D2 — How far down the API ladder do we go?** *(needed by Phase 0 and 5)*
  `RenderNode` is API 29, so a **live** backdrop is available two levels below full glass. The research proposes four tiers (`01-android-graphics.md` §9.5.10):

  | API | Tier | What you get |
  |---|---|---|
  | 33+ | full | blur + refraction + dispersion + highlight + tint + frost |
  | 31–32 | blur | blur + saturation + tint + frost, outline-clipped. No refraction. Reports `"fallback-blur"`. |
  | 29–30 | scrim-live | live backdrop drawn + a translucent scrim. No blur, no shader. |
  | < 29 | scrim | static tinted view. `supportsNativeGlass === false`, JS degrades to a plain view. |

  **Recommendation:** ship all four. The 29–30 tier is nearly free once the provider exists — it is the same `RenderNode` path with no effect attached — and it covers a real slice of devices. `supportsNativeGlass` on Android then returns `SDK_INT >= 29`.
  **Decision: ship all four.** `MIN_ANDROID_SDK_FOR_NATIVE_GLASS = 29`. The tier is resolved once in `GlassTier.resolve()` and reported through `onRendererChange` per D1.

- [x] **D7 — Provider ergonomics, and does iOS get one too?** *(needed by Phase 0 — this is new public API)* 🔴
  Android **requires** a `<LiquidGlassProvider>` wrapping the content that should show through the glass, with glass views as siblings outside it. iOS needs nothing — it captures the whole window. Options:
  (a) Android-only component; iOS exports a no-op passthrough of the same name so app code is written once.
  (b) Require it on both platforms, making iOS's a real no-op wrapper — one mental model, at the cost of churn for existing iOS users.
  (c) Auto-install a provider at the RN root from native, with an opt-in component for `Modal`/multi-window cases.
  **Recommendation: (a).** Export `LiquidGlassProvider` from the package; on iOS it renders `<View>` and nothing else. Existing iOS code keeps working untouched; Android code adds one wrapper. Reject (c) — auto-discovery by hierarchy walk is the documented cause of expo-blur's `Modal` breakage (**locked decision 12c**).
  **Decision: (a).** `LiquidGlassProvider` is exported from the package root. On iOS, web, and Android < 29 it renders a plain `<View>` and nothing else. `providerId` defaults to `"default"` on both the provider and the glass view, so the single-provider case needs no explicit id.

- [x] **D3 — What does `supportsNativeGlass` mean on Android?** *(needed by Phase 0)*
  The name says "the Apple material". The usage says "is there a hardware-accelerated glass path". The TS type is a plain boolean with no room for a third state, and the JS component uses it to decide whether to render the native view at all.
  **Recommendation:** treat it as a capability flag (per D2), and separately document that Android never has the *Apple* material. Consider adding `supportsGlass` as a clearer alias and soft-deprecating `supportsNativeGlass` in a later minor.
  **Decision: capability flag.** Android returns `SDK_INT >= 29`. `supportsGlass` is exported as an alias now; `supportsNativeGlass` keeps working and is soft-deprecated in the README rather than in code (no `@deprecated` tag until a later minor, to avoid noisy editor warnings for existing users).

- [x] **D4 — Is video-behind-glass a requirement?** *(needed by Phase 1 — it changes the capture architecture)*
  `SurfaceView` content is **uncapturable** by every canvas/RenderNode path; it composites out of process. `TextureView` **is** capturable by a hardware `RecordingCanvas` (`TextureView.draw()` calls `recordingCanvas.drawTextureLayer(layer)`) — but not by a software canvas. Only `PixelCopy` sees `SurfaceView`, at the cost of async ≥1-frame latency and a full readback, which breaks the frame-timing contract the adaptive-stride system depends on.
  The example app is built on `example/video/*.mp4`.
  **Recommendation:** require TextureView-backed playback, document it, and do **not** build a `PixelCopy` path in v1.
  **Decision: TextureView-backed playback required; no `PixelCopy` path in v1.** `react-native-video` (already an example dependency) exposes `viewType="textureView"`. Phase 5 adds a dev-mode warning when a `SurfaceView` is found inside a provider subtree.

- [x] **D5 — Commit `example/android/` or gitignore it?** *(needed by Phase 0)*
  `example/ios/` is currently tracked (18 files). `example/android/` is not ignored.
  **Recommendation:** commit it, for parity and so CI/reviewers get a buildable example without a prebuild step.
  **Decision: commit it**, matching `example/ios/`. `example/.gitignore` already excludes the generated build output.

- [x] **D6 — Do we bump `expo-module-scripts`?** *(needed by Phase 0)*
  Currently `^4.1.9`; latest is SDK-aligned at `~56.0.3`. Bumping aligns `expo-module build/lint/test` with SDK 56 but touches the iOS build tooling too.
  **Recommendation:** bump, in its own commit, before any Android work, so a regression is unambiguous.
  **Decision: bump to `~56.0.3`, in its own commit, before any Android work.**

---

## 4. Anti-patterns — do not reproduce

Drawn from `818jsy/expo-liquid-glass-native`, which wraps Kyant's `backdrop` for Expo. Its *existence* proves AGSL glass works under RN; its *design* is what we are avoiding.

- ❌ **Do not put React children in a `PopupWindow` / second React root.** It makes them non-interactive (`isTouchable = false` on the popup, `opacity: 0` + `pointerEvents="none"` on the in-tree copy) and severs them from the app's React context. It is why that library had to ship a *native* Compose bottom-tab-bar.
- ❌ **Do not use `PixelCopy` per frame.** GPU readback with a pipeline sync, ≥1 frame latency, per glass view — and it captures the calling window's own content, which is the feedback loop the PopupWindow exists to work around.
- ❌ **Do not hand-roll a `drawViewGroupChildren` traversal.** It ignores transforms (so anything animated by Reanimated samples wrong), clipping, alpha, and hardware layers.
- ❌ **Do not rewrite the consumer's `settings.gradle`/`app/build.gradle` from a config plugin.** Wiped by `expo prebuild --clean`, and hard-coding a Kotlin/Compose-compiler version guarantees a break on the next SDK bump.
- ❌ **Do not depend on `io.github.kyant0:backdrop`.** It is Compose-bound by construction: `Backdrop` is a `DrawScope` interface, `drawBackdrop` is a `Modifier`, `LayerBackdrop` wraps a Compose `GraphicsLayer`. There is no non-Compose entry point.

**What we do take from Kyant:** the AGSL in `backdrop/src/commonMain/kotlin/com/kyant/backdrop/internal/Shaders.kt` — rounded-rect SDF, gradient, `circleMap`, dispersion, angular highlight. Apache-2.0. See Phase 3 for the attribution task.

---

## 5. Risk register

| # | Risk | Impact | Mitigation | Settled by |
|---|---|---|---|---|
| R1 | ~~Per-frame re-recording is too expensive~~ **Largely retired.** Recording is display-list capture, not rasterization; unchanged children re-reference existing RenderNodes | Low | Confirm empirically anyway | Phase 1 |
| R2 | Pre-draw ordering causes a 1-frame offset between glass and backdrop during scroll | Glass visibly slides against its backdrop | Lower than feared — the provider records inside its own real render pass, so glass and backdrop are in the same frame by construction. Verify under fling. | Phase 1 |
| R9 | **The provider is a required wrapper on Android that iOS does not need** — forgetting it, or nesting glass inside it, silently yields no effect | Confusing DX; bug reports that look like "it doesn't work" | Explicit `providerId` pairing, a dev-mode warning when a glass view resolves no provider, and a warning when a glass view is found *inside* a provider subtree | Phase 1, Phase 5 |
| R10 | Glass inside an RN `Modal` — a separate window — sees no provider | Broken glass in modals, the exact failure that hit `expo-blur` | Document that a `Modal` needs its own provider; warn at runtime | Phase 1, Phase 8 |
| R3 | Padded-node overdraw — the effect is evaluated over a node inflated by up to ~204 px | ~4.9× the view area shaded | `canvas.clipRect` to the view rect + 2 px before `drawRenderNode`; HWUI propagates the device clip into the filter's requested output rect | Phase 3 |
| R4 | Full-screen glass panels | ~18 M dependent texture fetches/frame → guaranteed drops on a Mali-G57 | Auto-downgrade to the `low` tier above ~25 % screen coverage | Phase 7 |
| R5 | Silent driver shader-compile failure — no Java exception, just black or a native crash | Unrecoverable-looking bug on specific hardware | try/catch around shader construction *and* effect creation, plus a non-shader visual fallback; warm the shader at init | Phase 5 |
| R6 | ~~Invalidation loop between the capture pre-draw listener and glass `invalidate()`~~ **Retired.** `dumpsys gfxinfo` reports 0 frames over 8 idle seconds | — | A consumer's `invalidate()` dirties only its own node, so the provider's `dispatchDraw` does not re-run and emits no further notification | ✅ Phase 1 |
| R7 | Video behind glass is invisible | Example app looks broken | D4 | Phase 1 |
| R8 | Example app does not build on Android — `LiquidGlassDemo.tsx` pulls in `@expo/ui/swift-ui` | Can't test anything | Platform-gate or add `.android.tsx` variants | Phase 0 |

---

## Phase 0 — Repo prep & scaffolding

**Goal:** an Android build that runs, autolinks, and renders a *plain* (non-glass) view — plus fixes to the two pre-existing platform bugs. No graphics work.

### Pre-existing bugs to fix here

- [ ] **Web is broken today.** `src/views/NativeLiquidGlassView.ts:7` calls `requireNativeViewOnce` at module scope, and `requireNativeViewManager` *throws* in the web build. `import { LiquidGlassView }` crashes at import on web. The README's "on Android and web the components render as plain views" is false.
- [ ] **Android is broken today.** `src/components/LiquidGlassView/LiquidGlassView.tsx` has no platform guard at all (unlike `LiquidGlassContainer.tsx:14`), so it renders an unregistered view manager and fails at render.

### Tasks

- [ ] Decide **D5**, **D6**; apply the `expo-module-scripts` bump in its own commit if taken
- [ ] `expo-module.config.json` → `"platforms": ["apple", "android"]`, add `"android": { "modules": ["expo.modules.liquidglass.ExpoLiquidGlassModule"] }`, add `"name": "expo-liquid-glass-view"`. Do **not** add `"web"`. This is safely additive — Apple resolution only looks for `apple|ios|macos|tvos`, and a `platforms` entry with no `android/build.gradle` yet is silently skipped.
- [ ] `android/build.gradle` per `02-expo-android-integration.md` §2.6 — `com.android.library` + `expo-module-gradle-plugin`, `namespace "expo.modules.liquidglass"`, no dependencies block
- [ ] `android/src/main/AndroidManifest.xml` — `<manifest>\n</manifest>`
- [ ] `android/.gitignore` — copy verbatim from `expo/expo@sdk-56:packages/expo-module-template/android/.gitignore`. Load-bearing lines: `.gradle/`, `build/`, `**/build/`, `local.properties`, `.cxx/`, `*.iml`. Do **not** add `**/build/` to the root `.npmignore` — it would match this package's compiled JS output.
- [ ] `ExpoLiquidGlassModule.kt` — `Name("ExpoLiquidGlass")`, `Constant("supportsNativeGlass")`, and **three** `View(...)` blocks (view, container, provider) each with an explicit `Name()`. Views can be empty `ExpoView` subclasses at this stage.
- [ ] Register `LiquidGlassProviderView` and add `NATIVE_VIEW_NAMES.LiquidGlassProviderView` in `src/constants/native.constants.ts` (D7)
- [ ] TS platform branching — base `.ts` + `.web.ts` overrides only (**not** `.android.ts`/`.ios.ts`; a single native base file is enough and keeps the constants shared):
  - `src/views/NativeLiquidGlassView.web.ts`, `src/views/NativeLiquidGlassContainerView.web.ts` — export a plain RN `View` shim
  - `src/utils/platform.utils.ts` — stop hard-gating on `Platform.OS === "ios"`; accept `"android"` too, keep the `Constant` check as the real gate
  - `src/components/LiquidGlassView/LiquidGlassView.tsx` — add the `!supportsNativeGlass → plain View` guard that `LiquidGlassContainer` already has, preserving the `containerStyle` wrapper
- [ ] `src/constants/glass.constants.ts` — add `MIN_ANDROID_SDK_FOR_NATIVE_GLASS` alongside `MIN_IOS_VERSION_FOR_NATIVE_GLASS`
- [ ] Example app: `npx expo prebuild --platform android`. Autolinking already works via `"autolinking": { "nativeModulesDir": ".." }` — no symlink or `npm link` needed.
- [ ] Fix **R8**: platform-gate `MatchedText` / `GlassButton` (they import `@expo/ui/swift-ui`, whose `Host` calls `requireNativeView('ExpoUI', …)` at module scope) or add `.android.tsx` variants
- [ ] Add an `AndroidDemo` screen stub

### Acceptance

- `cd example && npx expo-modules-autolinking resolve --platform android --json | jq '.modules[].packageName'` lists `expo-liquid-glass-view`
- `./gradlew projects | grep liquid` shows `Project ':expo-liquid-glass-view'`
- `npx expo run:android` installs and launches; the demo screen renders plain views with **no redbox and no `Unable to get the view config` warning**
- `npx expo run:ios` is byte-for-byte unaffected
- Importing the package on web no longer throws

---

## Phase 1 — Provider + backdrop, and the day-one test harness

**Goal:** a live, correctly-positioned backdrop under a glass view. The architecture is **settled** by `01-android-graphics.md` §9 (locked decisions 12a–12e), so this phase builds it rather than exploring it — but it front-loads the empirical checks that everything downstream depends on.

### Topology

```
<LiquidGlassProvider providerId="main">      ← ExpoView; owns contentNode: RenderNode
    …all app content that should show through the glass…
</LiquidGlassProvider>
<LiquidGlassView providerId="main" />        ← SIBLING, drawn after; owns its own padded glassNode
```

The provider records `super.dispatchDraw()` into `contentNode` and then draws that node — so the recording *is* the real render pass, not an extra one. Glass views are outside the recorded subtree, which is what makes self-exclusion structural rather than filtered.

Full annotated implementations of both classes are in `01-android-graphics.md` §9.2 and §9.3. Follow them closely.

### Tasks

- [ ] `LiquidGlassProviderView : ExpoView, BackdropSource` — records `super.dispatchDraw` into `contentNode`, bumps `contentGeneration`, notifies consumers
- [ ] Process-level `providerId` registry (the `expo-blur` `<BlurTargetView>` + `appContext.findView` pattern)
- [ ] `LiquidGlassProvider` TS component + D7's iOS no-op
- [ ] `LiquidGlassView` draws the provider's node into its own padded node and blits — with a hardcoded `createBlurEffect`, no shader and no props yet
- [ ] Handle the provider-hasn't-drawn-yet case: `if (!provider.contentNode.hasDisplayList()) { invalidate(); return }`
- [ ] `onDescendantInvalidated` → bump `contentGeneration` (scrolling children invalidate a descendant *without* re-running `dispatchDraw`)
- [ ] Note that `dispatchDraw` is step 4 of `View.draw()`, so the provider's own background/`onDraw`/foreground are **not** captured. Decide whether to draw the provider's background into the recording canvas first (Dimezis' `setFrameClearDrawable` equivalent).

### Day-one empirical checks

These are cheap now and expensive later. `01-android-graphics.md` §10 lists them as the open questions the research could not settle from documentation.

- [x] **Coordinate space** — the single highest-value check. Run the throwaway ramp shader from `03-shader-port.md` §6-P12 on a standalone `RenderNode` and confirm what `main`'s `coord` is relative to, and how `setPosition`/`translationX` affect it.
- [x] **Out-of-bounds sampling** — confirm that `content.eval()` outside the node returns transparent black, and that the padding hides it.
- [x] **R6** — no invalidation loop. Instrument with a frame counter.
- [ ] **D4** — put a `TextureView`-backed and a `SurfaceView`-backed video behind the glass and record what each looks like. Expected: TextureView works on a hardware canvas, SurfaceView is a hole on every path.
- [ ] **R2** — is there a visible lag during a fling? Test inside a `FlatList`.
- [ ] Verify glass-over-glass does not feed back (it structurally cannot, but confirm the registry wiring does not accidentally nest one provider inside another)
- [ ] Confirm behaviour inside an RN `Modal` — a separate window, so it needs its own provider (**locked decision 12c**)

### Acceptance

A glass view showing a **real, correctly-positioned, live blur** of scrolling content behind it, at a stable 60 fps on a mid-range device, with no feedback and no invalidation loop. All seven day-one checks answered and recorded below.

### Findings

**Test devices.** `SM-S918U1` (Galaxy S23 Ultra, Android 16 / **API 36**, Adreno, arm64-v8a) → `FULL`/`agsl`. `SM-N910C` (Galaxy Note 4 on an Android 12 ROM, **API 32**, armeabi-v7a) → `BLUR`/`fallback-blur`. Between them they cover the top two tiers on real silicon.

**✅ The architecture works, first try.** Provider records `super.dispatchDraw` into a `RenderNode`; sibling glass views draw it into their own padded node and blit. A glass panel and a pill both show a live, correctly-positioned blur of the content behind them, including the blurred inter-stripe gaps at the panel's top and bottom edges — i.e. the alignment is right to the pixel, not just approximately. Scrolling the list updates the backdrop. `onRendererChange` fires once with `"agsl"`. Children draw on top and stay interactive.

**✅ R6 — no invalidation loop, and Phase 4's acceptance is already met.** `dumpsys gfxinfo` after `reset` reports **`Total frames rendered: 0` over 8 idle seconds** with the glass on screen. Notifying consumers from `dispatchDraw` does *not* feed back, because a consumer's `invalidate()` dirties only its own `RenderNode` — the provider's `dispatchDraw` is not re-run, so no notification is emitted in response. R6 is retired.

**🔴 Coordinate space — `coord` is NODE-LOCAL.** Settles `01-android-graphics.md` §10 open question 1, which was UNVERIFIED.
The probe painted white wherever `c.x < 3 || c.y < 3`. **No white line appeared on the glass's top or left edge**, so `c == (0,0)` is not the view's top-left — it is the padded node's top-left, which sits at view `(-pad, -pad)` and is clipped away. `content.eval(c)` at the same node-local coordinate returns the recorded content in exact alignment (confirmed by the backdrop's stripe numeral landing where it should).
**Consequence:** the `03-shader-port.md` §4 draft is correct as written — `uNodeSize = (pw, ph)`, `uGlassRect = (pad, pad, width, height)`, and view-local pixels are `c - pad`. Pass `size`/`offset` explicitly anyway, per the research.

**🔴 Out-of-bounds sampling returns TRANSPARENT BLACK (decal), not clamped.** Compositing `content.eval(c + (600, 0))` over magenta made it unmistakable: the magenta begins at displayed x≈510, and the predicted boundary — `c.x + 600 > paddedWidth` ⟹ `c.x > 756` ⟹ view x > 708 px ⟹ screen x > 798 px ⟹ displayed 517 — matches. This independently re-confirms the node-local origin *and* the exact node extent.
**Consequence:** **locked decision 16 is mandatory, not defensive.** Padding alone does not save a tap that reaches past the node; every tap must be clamped in-shader against the `crop` uniform.

**Divergence found in the demo, not the library.** `containerStyle` is the wrapper around children, so a child with `flex: 1` collapses to zero height unless the flex lives on `containerStyle` itself. Same on iOS. Worth a README note.

**Still open:** D4 (video), R2 (fling lag), glass-over-glass, `Modal`.

---

## Phase 2 — Prop plumbing

**Goal:** the entire TS API crosses the bridge correctly and is observable. Still no shader.

### Tasks

- [x] Enums as `Enumerable`: `GlassVariant{regular, clear}`, `GlassBackend{auto, native, metal}`, `GlassCornerStyle{continuous, circular}` — 1:1 with `ios/Enums/GlassVariant.swift`
- [x] Records mirroring `ios/Records/GlassMetalOptions.swift`, nested to full depth (`GlassMetalOptions → GlassRefractionOptions → GlassRefractionCurve`). All fields `var` with `@Field`; nested Records recurse fine. Omitted keys leave the Kotlin initializer untouched, matching Swift.
- [x] Per-variant defaults table ported from `ios/Enums/GlassVariant.swift:32-67` — see the full table in `00-ios-parity-spec.md` §1.3
- [x] ⚠️ **Do not port the `GlassSurfaceView.swift:16-42` stored-property defaults.** They are dead code — `applyAppearance()` runs in `init` and overwrites all of them with the `regular` block before any frame is drawn. They differ from the real defaults and copying them would silently change the look.
- [x] Reproduce the two iOS default-resolution quirks exactly, or fix them deliberately on both platforms:
  - `dispersion.reach` falls back to the *refraction* height default, not a dedicated value and not to your `refraction.height` override (`LiquidGlassView.swift:259`)
  - `refraction.curve` is all-or-nothing: supplying `{ power: 2 }` silently sets `bias` to the Record default `0`, not the variant's
- [x] `cornerRadius` via `Either<Double, GlassCornerRadii>`; per-corner values clamped to `min(w,h)/2`. Mind the swizzle contract: `.x`=bottom-left, `.y`=bottom-right, `.z`=top-right, `.w`=top-left, with y increasing downward.
- [x] `tint` as `Int?` + `processColor(tint)` in JS (**locked decision 8**)
- [x] `onRendererChange` via `EventDispatcher` — the **Kotlin property name is the event name** and must match `Events("onRendererChange")` exactly, or it is silently dropped with a `⚠️ Event … wasn't exported` warning. Payload `mapOf("renderer" to name)`. Fire once on first window attach, then only on genuine change (`00-ios-parity-spec.md` §5).
- [x] Implement **D1**'s outcome in `GLASS_ACTIVE_RENDERERS` and `TGlassActiveRenderer`
- [x] `OnViewDidUpdateProps` → one dirty-flag commit. **Never read `view.width`/`view.height` in a prop setter or in `OnViewDidUpdateProps`** — recompute size-dependent state in `onSizeChanged`/`onLayout`.
- [x] `OnViewDestroys` → release `RenderNode`s, bitmaps, `Choreographer` callbacks
- [x] `LiquidGlassContainerView` as a passthrough `ViewGroup`; accept and ignore `spacing`
- [x] `providerId` prop on both `LiquidGlassView` and `LiquidGlassProviderView`, with a sensible default so the common single-provider case needs no explicit id
- [ ] Watch for the CSS-prop collision: every `View {}` block auto-registers RN's `borderRadius` etc. via `UseCSSProps()`, so a JS `style={{ borderRadius }}` clips independently of our `cornerRadius` prop

### Acceptance

Every prop from `00-ios-parity-spec.md` §1 logs its resolved native value. `onRendererChange` fires with the right value at the right time. No `❌ Cannot set the '<prop>' prop` in logcat for any value the example app sends, including `saturation: -5` (the demo passes it, and iOS leaves it unclamped).

---

## Phase 3 — The shader

**Goal:** visual parity with the iOS Metal renderer.

`03-shader-port.md` contains the complete draft AGSL, the coordinate-space derivation, and twelve named pitfalls. Read it start to finish before writing a line.

### Tasks

- [ ] Port the AGSL from `03-shader-port.md` §4 into `android/src/main/res/raw/` or a Kotlin constant
- [ ] Uniform upload, one `RuntimeShader` instance cached per quality tier
- [ ] **Construct a new `RenderEffect` object on every uniform change** (**locked decision 14**) — re-assigning the same instance is a no-op
- [ ] Chain ordering — **`createChainEffect(outer, inner)` applies `inner` first**, so the call is `createChainEffect(glassEffect, blurEffect)` to get blur→glass. Easy to write backwards; it compiles either way and just looks wrong.
- [ ] Single `uniform shader content;` — **verified**: the Metal glass pass binds exactly one texture, either the blurred `pong` *or* the sharp backdrop, chosen on the CPU. There is no sharp/blurred lerp anywhere in `LiquidGlass.metal`, so the multi-input workarounds are all unnecessary (`03-shader-port.md` §3.3).
- [ ] `createBlurEffect` radius mapping per **locked decision 19**, `TileMode.CLAMP` to match `address::clamp_to_edge`, guarded on `> 0` (**locked decision 15**). Skip the stage entirely when `blurRadiusPx <= 1`, matching iOS's `radius <= 0.01` early-out.
- [ ] Node padding: `glassBackdropPadding = ceil(max(refractionAmount + dispersionAmount, blurRadius > 0.01 ? max(blurRadius*1.5, 16) : 0) + 2)` (`GlassSurfaceView.swift:133-137`)
- [ ] **R3**: `canvas.clipRect` to the view rect + 2 px before `drawRenderNode`; verify in a systrace that the filtered area actually shrinks
- [ ] In-shader `crop` clamping on every tap (**locked decision 16**)
- [ ] Quality tiers as **separate shader source strings** — the tap count cannot be a uniform. Delete the dead `uniform` declarations *and* their `setFloatUniform` calls per tier, or you hit the dead-uniform trap: a declared-but-optimised-out uniform makes `setFloatUniform` throw `unable to find uniform named …`, and a declared-but-never-set uniform throws at draw time. Both directions throw.
- [ ] Compile every tier variant once at module init so a broken variant fails loudly on the dev machine, not on one user's phone
- [ ] **Resolve the saturation discrepancy between the two research docs.** `03-shader-port.md` §4 keeps `saturation` as an in-shader uniform, applied after backdrop sampling and before frost/tint — matching the iOS step order exactly (`00-ios-parity-spec.md` §3.4). `01-android-graphics.md` §9.3 instead suggests a `ColorMatrixColorFilter` stage *before* the shader in the chain. Those are not equivalent: iOS clamps the dispersion-averaged colour to 0–1 *before* saturating, and a pre-pass filter saturates the source instead.
  **Recommendation: keep saturation in the shader.** It matches iOS, costs no extra chain stage, and we are already paying for the shader.
- [ ] Premultiplied output: return `float4(color * alpha, alpha)`, surface `TRANSLUCENT`
- [ ] Noise keyed off view-local pixels (`coord + offset`), **not** `coord` — otherwise the grain field jumps whenever `refractionAmount`/`dispersionAmount`/`blurRadius` changes the padding
- [ ] Apache-2.0 attribution for the four items derived from Kyant's `Shaders.kt`, per `03-shader-port.md` §4.4 — add a `NOTICE` or a header comment, and a line in the README

### Acceptance

Side-by-side screenshots against iOS at both `variant` values and across `example/screens/LiquidGlassDemo.tsx`'s prop sweep. Differences are explainable and documented — not "close enough".

---

## Phase 4 — Frame scheduling

**Goal:** correct, self-gating scheduling. Much smaller than it looks from the iOS side.

> **Most of `BackdropCapturer.swift` does not need porting.** Its adaptive-stride controller, double-buffered slot ring, 64 px allocation buckets, ¼-step scale pinning, 220 pt movement margin and FNV-1a pixel digest all exist to amortize **CPU rasterization into GPU-visible memory**. The Android path records a *display list* — unchanged children just re-reference their existing RenderNodes — and `contentNode` is a live reference rather than a snapshot. There is no per-frame cost to amortize, so porting that machinery would add complexity and buy nothing (`01-android-graphics.md` §9.4, §7).
>
> This also means the iOS "dragged glass refracts a slightly stale backdrop" behaviour **does not reproduce, and should not be recreated**. Android's will simply be correct. Note the divergence in the docs.

### Tasks

- [ ] Drive from `ViewTreeObserver.OnPreDrawListener` on the **provider**. This is self-gating: no draw pass ⇒ no callback ⇒ no work.
- [ ] **Do not use `Choreographer.postFrameCallback`** — it fires every vsync regardless of whether anything changed, and burns power at idle.
- [ ] Gate redraw on the `contentGeneration` counter plus a geometry check (`getLocationOnScreen` + scale/rotation), mirroring the iOS `needsRedraw || moved || backdropDidChange` decision (`00-ios-parity-spec.md` §4 Phase C)
- [ ] Verify the pre-draw listener is removed on detach
- [ ] Address **R2** with whatever Phase 1 found

### Acceptance

Scroll a `FlatList` of glass rows and drag a glass view on a mid-range device: no dropped frames, no visible lag between glass and backdrop. At rest, confirm with a frame counter that **zero** work happens per vsync.

---

## Phase 5 — Degradation & robustness

- [ ] Implement the four-tier ladder from **D2**: 33+ full · 31–32 blur+saturation+tint, outline-clipped · 29–30 live backdrop + scrim · < 29 static scrim with `supportsNativeGlass === false` so JS degrades to a plain view
- [ ] **R9/R10**: dev-mode warnings when a glass view resolves no provider, and when a glass view is found *inside* a provider subtree
- [ ] Detect `SurfaceView` descendants of a provider and warn — they will be a hole in the backdrop on every capture path
- [ ] **R5**: try/catch around both `RuntimeShader` construction and `RenderEffect` creation; fall back to the blur-only tier, then to a plain tinted view. Remember that stage-4 driver compilation happens lazily on the RenderThread at first draw and throws **no** Java exception — a visual fallback is mandatory, not defensive.
- [ ] Warm the shader at init on a background thread (draw the node once into a 1×1 offscreen) — HWUI's `ShaderCache` is invalidated by OS/driver updates, so cold first-draw compiles are real
- [ ] `onConfigurationChanged(UI_MODE_NIGHT_*)` → re-resolve frost, where iOS uses `traitCollectionDidChange`
- [ ] Correct teardown on detach: release nodes, unregister `Choreographer`/pre-draw callbacks

---

## Phase 6 — Example app

- [ ] Android demo screen exercising every prop
- [ ] Video-behind-glass demo reflecting **D4**
- [ ] `FlatList` and `ScrollView` demos (the existing ones rely on `renderer="native"` silently resolving to the shader path — verify that holds on Android)
- [ ] A screen that forces each degradation tier for manual QA

---

## Phase 7 — Performance

- [ ] Device matrix: at minimum one Adreno and one Mali, plus one API 31–32 device and one < 31
- [ ] **R4**: auto-downgrade above ~25 % screen coverage
- [ ] Systrace a scrolling `FlatList` of glass rows; confirm the Phase-3 clip is effective
- [ ] Consider packing the 13 loose scalar uniforms into 4 `float4`s (21 → 12 JNI calls) — **only if profiling shows JNI in the trace**
- [ ] Only re-upload changed uniforms: on a pure scroll, that is 3 calls (`size`, `offset`, `crop`) instead of 21

---

## Phase 8 — Docs & release

- [ ] README: Android section, API-level table, the degradation matrix, the video/`SurfaceView` caveat, and a plain statement that Android has no Apple-material equivalent
- [ ] Per-prop platform-support column in the props table
- [ ] Apache-2.0 attribution for the Kyant-derived AGSL
- [ ] CHANGELOG
- [ ] `npm pack --dry-run` — the tarball must contain `android/build.gradle`, `android/src/main/**`, `build/**`, `ios/**` and **nothing** under `android/build/` or `android/.gradle/`
- [ ] Verify a clean consumer install: fresh app, `npx expo install`, prebuild, run — with no config plugin and no manual gradle edits

---

## Appendix A — Files to be added

```
android/
  build.gradle
  .gitignore
  src/main/
    AndroidManifest.xml
    java/expo/modules/liquidglass/
      ExpoLiquidGlassModule.kt
      LiquidGlassView.kt
      LiquidGlassProviderView.kt          ← new; records the backdrop
      LiquidGlassContainerView.kt
      records/         GlassMetalOptions.kt, GlassRefraction*.kt, GlassCornerRadii.kt, …
      enums/           GlassVariant.kt, GlassBackend.kt, GlassCornerStyle.kt
      glass/           BackdropSource.kt, ProviderRegistry.kt, GlassShaders.kt, GlassTier.kt
src/components/LiquidGlassProvider/        ← new; iOS renders a no-op passthrough (D7)
docs/android-port/
  PLAN.md            ← this file
  research/          00-ios-parity-spec.md, 01-android-graphics.md,
                     02-expo-android-integration.md, 03-shader-port.md
```

## Appendix B — Files to be modified

| File | Change |
|---|---|
| `expo-module.config.json` | add `android` platform + module FQCN, add `name` |
| `package.json` | `expo-module-scripts` bump (D6) |
| `src/utils/platform.utils.ts` | stop hard-gating on `Platform.OS === "ios"` |
| `src/views/NativeLiquidGlass*.ts` | add `.web.ts` overrides |
| `src/components/LiquidGlassView/LiquidGlassView.tsx` | add the `supportsNativeGlass` guard |
| `src/constants/glass.constants.ts` | `MIN_ANDROID_SDK_FOR_NATIVE_GLASS`, `GLASS_ACTIVE_RENDERERS` (D1) |
| `src/types/glass.types.ts` | `TGlassActiveRenderer` (D1) |
| `README.md` | Android section, platform matrix, attribution |
| `example/**` | Android screens, platform-gate the SwiftUI imports |
