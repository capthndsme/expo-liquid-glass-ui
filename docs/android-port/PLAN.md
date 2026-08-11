# Android Port — Implementation Plan

**Repo:** `capthndsme/expo-liquid-glass-view` (fork of `rit3zh/expo-liquid-glass-view`)
**Base commit:** `92e4ae7` — "feat rewrite liquid glass with custom Metal renderer"
**Target:** Expo SDK 56 / RN 0.85.3 / New Architecture only
**Status:** **Complete.** All eight phases are done, all seven open decisions taken (§3), and every Phase-1 day-one check closed. Verification runs on two devices — a Galaxy S23 (Adreno 740, API 36, `agsl`) and a Galaxy Note 4 (Mali-T760, API 32, `fallback-blur`) — and a clean consumer install builds on Expo SDK 57 / RN 0.86 with no config plugin (Phase 8 F33).

Two things remain open, both needing hardware or a host this machine does not have: the **API 29–30 `SCRIM` tier** has only ever been exercised by forcing it on newer devices, and the **iOS side-by-side screenshots** for Phase 3's acceptance need a Mac. Neither blocks release; both are listed under Phase 7 and Phase 3 respectively.

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
- `01-android-graphics.md` §9.3 and `03-shader-port.md` §4 disagree on where `saturation` is applied. **Resolved in Phase 3: it stays in the shader**, and the numeric check below proves that ordering reproduces iOS exactly.

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
| `interactive` | ~~Apple's internal press deformation. No public equivalent; a hand-written approximation would not match.~~ **Reversed in Phase 12**: reading AndroidLiquidGlass's catalog showed the behaviour is spring choreography plus a radial specular, not deep magic — so it was ported rather than approximated. | Touch-following glow + press inflation, native springs. See Phase 12. |
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
  **Decision: TextureView-backed playback required; no `PixelCopy` path in v1.** Phase 5 adds a dev-mode warning when a `SurfaceView` is found inside a provider subtree.
  ⚠️ **Correction (Phase 5): the `react-native-video` half of this was wrong twice over.** Its `viewType` is a **numeric** enum (`ViewType.TEXTURE = 0`), not the string `"textureView"` — passing a string throws `java.lang.String cannot be cast to java.lang.Double`. And it does not matter, because in `react-native-video@6.16.1` `ExoPlayerView.updateSurfaceView` is an empty `// TODO: Implement proper surface type switching if needed`, so the prop is a no-op and playback is always `SurfaceView`. (It also rendered nothing at all in this example, with or without a provider — separate problem, not investigated.) **Use `expo-video`, whose `surfaceType: 'surfaceView' | 'textureView'` is real.** The example now depends on it, and it is what the docs should recommend.

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
| R2 | ~~Pre-draw ordering causes a 1-frame offset between glass and backdrop during scroll~~ **Retired.** A backdrop edge lands on the same row inside and outside the glass, at rest and mid-fling | — | Structural: the provider records inside its own real render pass, so glass and backdrop are the same frame by construction | ✅ Phase 3 (F2) |
| R9 | **The provider is a required wrapper on Android that iOS does not need** — forgetting it, or nesting glass inside it, silently yields no effect | Confusing DX; bug reports that look like "it doesn't work" | Explicit `providerId` pairing, a dev-mode warning when a glass view resolves no provider, and a warning when a glass view is found *inside* a provider subtree | Phase 1, Phase 5 |
| R10 | Glass inside an RN `Modal` — a separate window — sees no provider | Broken glass in modals, the exact failure that hit `expo-blur` | Document that a `Modal` needs its own provider; warn at runtime | Phase 1, Phase 8 |
| R3 | ~~Padded-node overdraw~~ **Retired.** HWUI does propagate the device clip into the filter's requested output rect — measured, not assumed: a **90×** padded node costs +2 ms, not +90× | — | The re-scoped remainder — the padded surface's *allocation* — is now closed too: the padding was ~4x larger than the shader can read, and shrinking it cut GPU-tracked memory 42 % with byte-identical output | ✅ Phase 3 (F4), Phase 7 (F28) |
| R4 | Full-screen glass panels | **Confirmed, and the mitigation is weaker than hoped.** On an Adreno 740 at 120 Hz, jank goes 2 % → 18 % → 78 % across 25 / 50 / 75 % coverage | Auto-downgrade to `low` above 25 % coverage — implemented and verified, but worth only ~1 ms and ~9 points of jank. The real mitigation is *less glass*, and the README must say so | ✅ Phase 7 (F27) |
| R5 | Silent driver shader-compile failure — no Java exception, just black or a native crash | Unrecoverable-looking bug on specific hardware | try/catch around shader construction *and* effect creation, plus a non-shader visual fallback; warm the shader at init | Phase 5 |
| R6 | ~~Invalidation loop between the capture pre-draw listener and glass `invalidate()`~~ **Retired.** `dumpsys gfxinfo` reports 0 frames over 8 idle seconds | — | A consumer's `invalidate()` dirties only its own node, so the provider's `dispatchDraw` does not re-run and emits no further notification | ✅ Phase 1 |
| R7 | Video behind glass is invisible | Example app looks broken | D4 | Phase 1 |
| R11 | **Stretch overscroll desyncs glass from its backdrop.** Android 12+ renders overscroll as a pixel-space `RenderEffect` on the scrolling container's `RenderNode`, which warps every descendant — glass and its baked backdrop together — while the provider stays flat | Rows disagree with the world by an amount that decays toward the pulled edge, for as long as the overscroll is held | **Not fixable inside the library.** No child can see a pixel warp, and no public API exposes the stretch amount. Document it, and warn in dev when a glass view has a scrolling ancestor with overscroll enabled | Phase 5 (warning), Phase 8 (docs) |
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

> **API 32 is not yet visually verified.** The armeabi-v7a build installs and launches on the Note 4 — JS reaches `Running "main"`, and there is no crash, no `Cannot set the '<prop>' prop`, and no dropped event — but the device sits behind a secure keyguard that cannot be dismissed over adb, so the `fallback-blur` tier has not been *seen*. Needs someone to unlock the handset. Phase 7's device matrix depends on this.

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

### Day-one checks — final status

| Check | Status |
|---|---|
| R1 — per-frame re-recording cost | ✅ Retired in Phase 1. Recording is display-list capture, not rasterization |
| R2 — 1-frame offset during scroll | ✅ Retired in Phase 3 (F2). Pixel-exact at rest and mid-fling |
| R6 — invalidation loop | ✅ Retired in Phase 1, re-confirmed with the shader attached (Phase 3 F5) |
| D4 — video behind glass | ✅ Closed in Phase 5. `expo-video` with `surfaceType="textureView"` refracts correctly; `surfaceView` is a hole in the backdrop *and* now warns |
| Glass over glass | ✅ Closed in Phase 5. **Neither view sees the other** — a glass view is never inside the provider's recording, so it cannot appear in another's backdrop. This is a **divergence from iOS**, where a Metal glass moving over a native one does refract it. It is the same property that gives Android free self-exclusion, and for stacked glass it arguably looks better (no double-frosting). Document it |
| RN `Modal` | ✅ Closed in Phase 6 (F24). Glass paired with a provider *inside* the modal refracts normally; glass pointing at the activity's provider is refused, draws a visible scrim, and warns once naming the fix. `providerId` is namespaced per window, and a modal can never refract the activity behind it |

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

- [x] Port the AGSL from `03-shader-port.md` §4 into `android/src/main/res/raw/` or a Kotlin constant — it is a **generated** Kotlin string (`glass/GlassShaderSource.kt`), not a resource, because the tap count has to be interpolated per tier
- [x] Uniform upload, one `RuntimeShader` instance cached per quality tier (`glass/GlassShaderCache.kt`, shared process-wide)
- [x] **Construct a new `RenderEffect` object on every uniform change** (**locked decision 14**) — re-assigning the same instance is a no-op.
  **Better than expected:** no uniform depends on the view's position, only on props and size. The recording's translate absorbs scroll, so a pure scroll rebuilds *nothing* — 0 JNI calls per frame, not the 3 Phase 7 budgeted for.
- [x] Chain ordering — **`createChainEffect(outer, inner)` applies `inner` first**, so the call is `createChainEffect(glassEffect, blurEffect)` to get blur→glass. Easy to write backwards; it compiles either way and just looks wrong.
- [x] Single `uniform shader content;` — **verified**: the Metal glass pass binds exactly one texture, either the blurred `pong` *or* the sharp backdrop, chosen on the CPU. There is no sharp/blurred lerp anywhere in `LiquidGlass.metal`, so the multi-input workarounds are all unnecessary (`03-shader-port.md` §3.3).
- [x] `createBlurEffect` radius mapping per **locked decision 19**, `TileMode.CLAMP` to match `address::clamp_to_edge`, guarded on `> 0` (**locked decision 15**). Skip the stage entirely when `blurRadiusPx <= 1`, matching iOS's `radius <= 0.01` early-out.
- [x] Node padding. ⚠️ **Corrected: Android adds the two reaches, iOS takes their max.** `03-shader-port.md` §2.5 is right and this task line was quoting the iOS formula. On iOS the blur reads from the whole-window capture and only *writes* the padded rect, so contamination never reaches its interior; here the blur's input **is** the padded node, so `TileMode.CLAMP` fabricates its outer `1.5x` ring from edge pixels. Taking the max would put the refraction band exactly in that fabricated ring. The formula is also tier-aware, since only the shader refracts and only API 31+ blurs — see `GlassAppearance.backdropPaddingPx(tier)`.
- [x] **R3**: `canvas.clipRect` to the view rect + 2 px before `drawRenderNode`. **Verified by A/B measurement instead of a systrace, and R3 is retired** — see the findings below.
- [x] In-shader `crop` clamping on every tap (**locked decision 16**)
- [x] Quality tiers as **separate shader source strings** — the tap count cannot be a uniform. Delete the dead `uniform` declarations *and* their `setFloatUniform` calls per tier, or you hit the dead-uniform trap: a declared-but-optimised-out uniform makes `setFloatUniform` throw `unable to find uniform named …`, and a declared-but-never-set uniform throws at draw time. Both directions throw.
- [x] Compile every tier variant once at module init (`OnCreate` -> `GlassShaderCache.warmUp()`) so a broken variant fails loudly on the dev machine, not on one user's phone
- [x] **Resolve the saturation discrepancy between the two research docs.** `03-shader-port.md` §4 keeps `saturation` as an in-shader uniform, applied after backdrop sampling and before frost/tint — matching the iOS step order exactly (`00-ios-parity-spec.md` §3.4). `01-android-graphics.md` §9.3 instead suggests a `ColorMatrixColorFilter` stage *before* the shader in the chain. Those are not equivalent: iOS clamps the dispersion-averaged colour to 0–1 *before* saturating, and a pre-pass filter saturates the source instead.
  **Recommendation: keep saturation in the shader.** It matches iOS, costs no extra chain stage, and we are already paying for the shader.
- [x] Premultiplied output: return `float4(color * alpha, alpha)`, surface `TRANSLUCENT`
- [x] Noise keyed off view-local pixels (`coord + offset`), **not** `coord` — otherwise the grain field jumps whenever `refractionAmount`/`dispersionAmount`/`blurRadius` changes the padding
- [x] Apache-2.0 attribution for the four items derived from Kyant's `Shaders.kt`, per `03-shader-port.md` §4.4 — `NOTICE` at the repo root, a header comment in the generated shader, the KDoc on `GlassShaderSource`, and a line in the README

### Acceptance

Side-by-side screenshots against iOS at both `variant` values and across `example/screens/LiquidGlassDemo.tsx`'s prop sweep. Differences are explainable and documented — not "close enough".

⚠️ **Partially met, and honestly: no iOS device or macOS host is available in this environment, so no side-by-side screenshot exists.** What replaced it is stronger in one dimension and weaker in another, and both should be recorded:

- **Stronger:** the deep interior was verified *numerically* against the Metal source rather than visually. See finding F3.
- **Weaker:** nothing exercises the refraction band, the dispersion band or the highlight against real iOS output. Those are verified by construction — a line-by-line translation with every divergence enumerated — not by comparison. **Someone with a Mac still owes this phase a screenshot pass.**

### Findings

**F1 — The AGSL renders, at `agsl`, on a Galaxy S23 Ultra (API 36).** Refraction, chromatic dispersion, film grain, the angular highlight, the edge contour, frost, tint and the gradient border all appear. No black rim and no corner blobs, so the in-shader `crop` clamp (**locked decision 16**) is doing its job. Per-corner radii resolve through the SDF correctly: the demo pill's large TL/BR and small TR/BL render exactly as specified, which confirms the `(BL, BR, TR, TL)` packing survives the trip through `writeShaderVec`.

**F2 — The backdrop is pixel-exact, at rest and under fling. R2 is retired.** A stripe boundary in the backdrop lands on row `y=1272` both *inside* the glass and in the raw background beside it — zero offset. Sampled again mid-fling, the boundary still tracks. This is structural: the provider records inside its own render pass, so the glass and its backdrop are the same frame by construction. **Risk R2 (1-frame offset during scroll) never materialised.**

**F3 — The tone chain is numerically correct.** At a glass view's deep interior (`inside >= scale`, no refraction, `band == 0` so the highlight term vanishes) the shader must reduce to `clamp(mix(mix(luma, backdrop, saturation), frost, frostAmount))`. Over a solid `#f64f59` backdrop at `regular` defaults that predicts **(255, 123.8, 135.3)**. Measured, averaged over a 40x40 block to cancel the grain: **(255.0, 124.0, 135.0)**. Within 0.6/255.

That single number validates a lot at once: the Rec.709 luma coefficients, saturation applied *in the shader between sampling and frost* (which settles the `01-android-graphics.md` §9.3 vs `03-shader-port.md` §4 conflict in favour of the latter), the frost colour resolving to `#FFFFFF` in light mode rather than Material's `#121212` (**locked decision 17**), the deep-interior early-out, the `band == 0` highlight null case, premultiplied output, and `content.eval` returning the backdrop unscaled and unfiltered at 1:1.

**F4 — R3 is retired: HWUI really does propagate the device clip into the filter's requested output rect.** Measured by A/B rather than by reading a systrace. Holding everything else fixed and inflating `refraction.amount` so the padded node grows relative to a 96 dp view:

| `refraction.amount` | padding | padded node | vs view area | GPU p50 | GPU p90 |
|---|---|---|---|---|---|
| 60 dp (default) | 240 px | 768 x 768 | 7x | 5 ms | 5 ms |
| 200 dp | 624 px | 1536 x 1536 | 28x | 6 ms | 6 ms |
| 400 dp | 1224 px | 2736 x 2736 | **90x** | 7 ms | 8 ms |

Three such views at 90x, shaded in full, would be ~22 M invocations and ~157 M dependent texture fetches per frame. That is tens of milliseconds on any mobile GPU, not +2 ms. **The shader is not evaluated over the padded node.**

**But the risk did not disappear, it moved.** The residual +2 ms scales with node *area*, which is the allocation and copy of the padded surface — memory bandwidth, not shading. At 400 dp that is a 30 MB surface per view. Even at real defaults the demo's 1296 x 540 panel allocates 2064 x 1308 x 4 = **10.8 MB**. Phase 7 should treat padded-node memory, not shader invocations, as the dominant cost of a large `refraction.amount`.

**F5 — Zero frames at rest, with the shader running.** `dumpsys gfxinfo` reports `Total frames rendered: 0` over 8 idle seconds with four glass views on screen. Phase 4's "zero work per vsync at rest" bar is already met, and R6 stays retired now that there is a real effect chain attached.

**F6 — Scrolling cost.** A six-fling sweep of the demo — four glass views, one of them 1296 x 540 with a 103 px blur and a 384 px padding budget — gives **309 frames, 1 janky (0.32%), 0 missed vsyncs, GPU p90 5 ms**. No tuning yet, on a flagship; the Phase 7 device matrix is where this gets its real test.

**F7 — The `low` tier's dead-uniform trap is real and is handled.** `low` deletes the dispersion loop, the grain and the edge contour, and with them five uniforms (`dispersionHeight`, `dispersionAmount`, `dispersionTapSpacing`, `noiseAmount`, `unitScale` — the last because it exists only to rescale the two point-valued literals inside those blocks). All three tiers render side by side in the demo with no `unable to find uniform named …`, which is only true because every upload is gated on the variant's `liveUniforms` set rather than on a hand-maintained list.

**F8 — New public API: `metal.android.quality`** (`'low' | 'medium' | 'high'`, default `'medium'`), per `03-shader-port.md` §5.4. Android-only; iOS's Record has no matching field so the key is silently dropped there. It exists now rather than in Phase 7 because without it the `low` and `high` shader variants compile but are never *drawn*, and F7 is exactly the failure that would hide until Phase 7 turned them on.

**Two divergences from iOS worth carrying forward to the docs:**

1. The border is a real `LinearGradient` now, black -> white -> white -> black bottom-left to top-right at stops 0/0.25/0.75/1, reproducing `CAGradientLayer` (`LiquidGlassView.swift:108-123`) rather than the flat stroke Phase 2 shipped.
2. `metal.captureQuality` remains accepted and ignored. iOS scales a rasterized capture; Android records a display list, so there are no pixels to scale.

---

## Phase 4 — Frame scheduling

**Goal:** correct, self-gating scheduling. Much smaller than it looks from the iOS side.

> **Most of `BackdropCapturer.swift` does not need porting.** Its adaptive-stride controller, double-buffered slot ring, 64 px allocation buckets, ¼-step scale pinning, 220 pt movement margin and FNV-1a pixel digest all exist to amortize **CPU rasterization into GPU-visible memory**. The Android path records a *display list* — unchanged children just re-reference their existing RenderNodes — and `contentNode` is a live reference rather than a snapshot. There is no per-frame cost to amortize, so porting that machinery would add complexity and buy nothing (`01-android-graphics.md` §9.4, §7).
>
> This also means the iOS "dragged glass refracts a slightly stale backdrop" behaviour **does not reproduce, and should not be recreated**. Android's will simply be correct. Note the divergence in the docs.

### Tasks

- [x] Drive from `ViewTreeObserver.OnPreDrawListener` — ⚠️ **on each glass view, not on the provider.** The provider needs no scheduling at all (F9), and the thing that has to be noticed is a *consumer* moving, which only the consumer can measure. Self-gating either way: the listener is dispatched from `ViewRootImpl.performTraversals`, so no traversal means no callback.
- [x] **Do not use `Choreographer.postFrameCallback`** — it fires every vsync regardless of whether anything changed, and burns power at idle
- [x] Gate redraw on the `contentGeneration` counter plus a geometry check, mirroring the iOS `needsRedraw || moved || backdropDidChange` decision (`00-ios-parity-spec.md` §4 Phase C). The geometry check is a **full matrix**, not `getLocationOnScreen` — see F10
- [x] Verify the pre-draw listener is removed on detach
- [x] Address **R2** — retired in Phase 3 (F2)

### Acceptance

Scroll a `FlatList` of glass rows and drag a glass view on a mid-range device: no dropped frames, no visible lag between glass and backdrop. At rest, confirm with a frame counter that **zero** work happens per vsync.

**Met on an S23 Ultra; the mid-range half of the sentence is Phase 7's device matrix.** `example/screens/AndroidListDemo.tsx` is the acceptance case: a motionless provider behind a `FlatList` of 24 glass rows. Scrolled, the backdrop bands pass straight through the glass with no step at any row's edge, at rest and mid-fling. **322 frames, 2 janky (0.62%), 0 missed vsyncs, GPU p90 8 ms** with ~9 glass rows in flight, and **0 frames rendered over the following 8 idle seconds** — including after ten mount/unmount cycles, which is the real test that the listener is being removed.

### Findings

**F9 — The provider needs no scheduling, and most of Phase 4's premise was already satisfied.** During a fling of the `AndroidDemo` provider's `ScrollView`, the instrumented counters report **0.0 provider recordings/s** while the backdrop updates perfectly. The provider's recording holds a *live reference* to the `ScrollView`'s `RenderNode`; scrolling re-records that node, and HWUI re-rasterizes the whole chain — provider node -> each glass view's padded node -> screen — with no Java code running at all. `contentGeneration` and `onBackdropChanged` remain correct but are close to vestigial.

**F10 — The real gap was the opposite one, and it was a live bug: the glass moving while the backdrop stays still.**

When an **ancestor** moves a glass view — a `FlatList` scrolling its rows, a Reanimated transform on a wrapper, `Animated` with `useNativeDriver` — the glass view itself is not dirty, so `dispatchDraw` never re-runs. The padded node keeps the offset it recorded, and the glass carries its old backdrop along like a decal.

Confirmed on device before the fix by animating a wrapper's `translateY` over the striped backdrop: the glass drifted down through three stripes while still showing the cyan/black/purple it had been over at rest. The distinction matters and is easy to get wrong — animating the *glass view's own* transform does not reproduce it, because that path re-runs `dispatchDraw` at the full refresh rate (measured 120/s). Only ancestor motion is invisible to it.

**The fix is a `ViewTreeObserver.OnPreDrawListener` per glass view** that recomputes provider-local -> view-local and invalidates when it differs from the transform the backdrop was recorded with.

**A full `Matrix`, not a `(dx, dy)`.** `getLocationOnScreen` would cover scroll and drag, but an ancestor that scales or rotates would still be wrong, and comparing a matrix costs the same. The composition is the public-API equivalent of the `@hide` `View.transformMatrixToGlobal`: recurse to the parent, undo the parent's scroll, apply the view's offset then its own transform. Both walks stop at the topmost `View` rather than the window — whatever `ViewRootImpl` contributes above that is common to both, since `ProviderRegistry` only ever pairs views in the same window, and it cancels in `localToWindow⁻¹ · providerToWindow`.

It reduces to the old code exactly in the translation-only case, which is what made it safe to swap in.

**F11 — The listener does not create work, and it does not loop.** The invalidate happens only on a genuine transform change; the resulting redraw records the new transform, so the next pre-draw sees no change. Measured: 0 frames at rest with five glass views watching, and 0 again after ten mount/unmount cycles.

**F12 — `setGlassDebugLogging(enabled)` is now exported from the package.** It was already a native `Function`, but nothing on the JS side could reach it, which made every measurement in this phase require a temporary patch. No-ops on iOS and web.

**F13 — The example app's demo switcher was written but never rendered.** `App.tsx` had the styles and a `useState` whose setter was unused. Wired up, and scoped per platform — Android gets `android` and `androidList`, the other three screens are SwiftUI- or `renderer="native"`-bound.

---

## Phase 5 — Degradation & robustness

- [x] Implement the four-tier ladder from **D2**: 33+ full · 31–32 blur+saturation+tint, outline-clipped · 29–30 live backdrop + scrim · < 29 static scrim with `supportsNativeGlass === false` so JS degrades to a plain view. Saturation on the blur tier is a `ColorMatrixColorFilter` chained after `createBlurEffect` — see F14
- [x] **R9/R10**: dev-mode warnings when a glass view resolves no provider, and when a glass view is found *inside* a provider subtree
- [x] **R11**: dev-mode warning when a glass view has a scrolling ancestor whose `getOverScrollMode()` is not `OVER_SCROLL_NEVER`
- [x] Detect `SurfaceView` descendants of a provider and warn — ⚠️ **driven from the provider's recording pass, not from attach.** See F16
- [x] **R5**: try/catch around both `RuntimeShader` construction and `RenderEffect` creation; fall back to the blur-only tier. The "no Java exception" case is handled by an actual render probe — F15
- [x] Warm the shader at init on a background thread — the probe does both jobs
- [x] `onConfigurationChanged(UI_MODE_NIGHT_*)` → re-resolve frost
- [x] Correct teardown on detach: release nodes, unregister pre-draw callbacks

### Findings

**F14 — The blur tier gains saturation, and it is the one place the two paths genuinely differ.**
`ColorMatrix.setSaturation` uses (0.213, 0.715, 0.072) against the shader's Rec.709 (0.2126, 0.7152, 0.0722) — below one 8-bit step. The real difference is *what* it saturates: the filter acts on the blurred backdrop, the shader acts on the refracted, dispersion-averaged colour. With no refraction on that tier there is nothing to diverge from.

**F15 — R5's "silent driver failure" is now actually detected, not just documented.**

Stage-4 compilation happens on the RenderThread and throws nothing; the symptom is an invisible or black glass view on one chipset. The only way to catch it is to render and look. `GlassShaderCache.warmUp` compiles every tier synchronously (so a bad string interpolation still fails on the developer's machine), then on a background thread renders each one over opaque white into a 64×64 `ImageReader` via `HardwareRenderer` and reads the centre pixel.

Only a **fully transparent** centre pixel demotes a tier. At the centre the SDF is far inside the shape, so `shapeAlpha` and `glassOpacity` are both 1 — alpha 0 there is unreachable by any correct evaluation. Anything that stops the probe running is *inconclusive* and never demotes: wrongly demoting a working device would cost every one of its users the refraction.

**Verified end-to-end by forcing it.** Priming `glassOpacity` to 0 made all three tiers probe transparent; logcat reported each demotion, and the demo fell to a blurred, frosted, tinted, corner-clipped surface reporting `fallback-blur` to JS. Reverted after.

**F16 — A one-shot subtree scan at attach is close to useless, and the first version of the `SurfaceView` check was one.**

A `SurfaceView` almost never exists when the provider attaches — it arrives when the video mounts, which for anything data-driven is later. Caught in testing: switching the video demo to `surfaceView` produced the hole in the backdrop with no warning at all. Moved to the provider's own recording pass and latched off once it has nothing left to say. The provider only re-records on a structural change, which is exactly when a new `SurfaceView` can appear, so the scan is both cheap and correctly timed.

**F17 — `AppContext.reactContext` is null at `OnCreate`.** Dev-mode was being resolved from it, which silently left it false and disabled every check — they were written, compiled, shipped, and did nothing. Now resolved lazily from a **View's** context, which is always real by the time any check runs. A reminder that a diagnostic nobody has watched fire is not a diagnostic.

**F18 — All four warnings verified on device** by temporarily introducing each mistake: glass inside its own provider, glass inside a *different* provider, a glass view pointing at an unmounted `providerId`, and a glass row inside a list with stretch overscroll. Each fires once, names the fix, and stays quiet otherwise.

**F19 — The no-provider fallback is a visible frosted scrim, not an invisible view.** A `LiquidGlassView` that resolves nothing still draws frost, tint, corner clipping and the border, so a layout keeps reading correctly while logcat says exactly what is wrong.

---

---

## Phase 6 — Example app

**Goal:** every prop, every tier and every known-hard topology visible on a device, so a regression is something you can *see* rather than something you have to reason about.

### Tasks

- [x] Android demo screen exercising every prop — `AndroidPropsDemo.tsx`. One tile per prop over a shared pinned backdrop, grouped into five sections. Each tile varies exactly one thing from the `regular` defaults, so anything visible is attributable. Tiles that are *meant* to be no-ops (`captureQuality`, `cornerStyle`; `interactive` graduated to a real behaviour in Phase 12) say so in their label — a silently-inert tile would otherwise read as a bug
- [x] Video-behind-glass demo reflecting **D4** — `AndroidVideoDemo.tsx` (landed in Phase 5)
- [x] `FlatList` and `ScrollView` demos — see **F20**. Both are now cross-platform and are in the Android tab list
- [x] A screen that forces each degradation tier for manual QA — `AndroidTierDemo.tsx`, on top of a new `metal.android.maxTier` (**F21**)
- [x] RN `Modal` — `AndroidModalDemo.tsx`. The last day-one check (**F24**)
- [x] Switcher reworked into a horizontal `ScrollView`; eight demos no longer fit a fixed row

### Acceptance

Every prop lands with no `❌ Cannot set the '<prop>' prop` and no `⚠️ Event … wasn't exported`. **Met**, verified on two devices: a Galaxy S23 (Adreno 740, API 36, `agsl`) and a Galaxy Note 4 (Mali-T760, API 32, `fallback-blur`) — the first time the API-32 device has rendered at all, previously blocked on a secure keyguard.

Notable confirmations from the props sweep, all on the `agsl` device:

- `quality "low"` shows **no chromatic fringe** at a hard light/dark boundary while `"medium"` and `"high"` clearly do — the `LOW` tier really is dropping the dispersion loop, and its five-uniform-smaller live set does not throw
- `cornerRadius` per-corner produces the expected leaf shape, confirming the `(BL, BR, TR, TL)` swizzle end to end
- `highlight.intensity 0` is completely flat; `angle 315` inverts the bevel — the same isolation that answered the "what is the ~10 px gradient?" question
- `border { width 6, opacity 1 }` shows the diagonal black→white→black gradient plainly; `opacity 0` removes it
- Frost resolves against the system background on both devices in opposite directions — near-white on the S23 (light mode), near-black on the Note 4 (dark mode)

### Findings

**F20 — `renderer="native"` was never the portability problem; the provider is.**

The task was written expecting `renderer="native"` to be the thing that quietly breaks on Android. It is not: `native` and `metal` tiles render pixel-identically, because Android has no Apple material to ask for and `GlassBackend` is accepted and unread. What actually stopped `ScrollDemo` and `FlatListDemo` from working on Android was the missing `LiquidGlassProvider` — without one they resolved nothing and rendered as frosted scrims.

Both became cross-platform by adding **one wrapper and nothing else**, which is the migration story worth documenting. `FlatListDemo` is the instructive case: the provider wraps the background `Image` **alone**, not the `FlatList`, because the glass rows live inside the list and wrapping it would put every row inside the backdrop it samples. Provider placement is about what should show *through*, not about what is on screen.

**F21 — `metal.android.maxTier`, a ceiling rather than an override.**

Forcing a tier needed a mechanism, and the honest one is a cap that composes with the device's own: `GlassTier.weakest(device, ceiling)`. Its values are the same four strings `onRendererChange` reports (`agsl`, `fallback-blur`, `scrim`, `none`), so a caller compares what it asked for against what it got with no second vocabulary — which required backtick-quoting `` `fallback-blur` `` as a Kotlin enum entry, since Expo's `EnumTypeConverter` matches the JS string against `Enum.name` verbatim.

That converter has a trap worth recording: it switches from name-matching to **parameter-matching** the moment the enum declares a single non-static field. `GlassTierCeiling.tier` is therefore a getter — `javap` confirms no instance fields survive — and adding a constructor parameter later would silently break every value.

Verified on both devices: API 36 reports all four distinctly, API 32 reports `agsl → fallback-blur` with the screen's own "capped by this device's API level" note. The mechanism is also the manual counterpart of Phase 7's **R4**.

**F22 — the SCRIM tier's blur gate was on the API level, not on the tier, and building the QA screen is what exposed it.**

`drawBlurredBackdrop` ran `applyFallbackEffect` whenever `SDK_INT >= S`, so a view lowered to SCRIM on a modern device still got a blur that a genuine API 29–30 device cannot produce. The forced tier would have been a *different* thing from the tier it claimed to reproduce, which is the one bug a QA screen must not have. Now gated on `tier == BLUR`, with a `clearFallbackEffect` for a view that drops from BLUR to SCRIM at runtime.

**F23 — SCRIM and NONE are indistinguishable at rest, and that is correct.**

At SCRIM the recorded backdrop is drawn opaquely and then frosted: `0.64 × backdrop` at the default frost. At NONE nothing is drawn and the frost lands on the real content already beneath: also `0.64 × backdrop`. The pixels agree because SCRIM's only job is to redraw what is already there. They diverge the moment the glass moves relative to its provider — which is exactly when a live backdrop starts earning its cost. The QA screen states this rather than pretending the two tiles differ.

**F24 — RN `Modal` closed, both directions.**

Glass paired with a provider **inside** the modal refracts normally and reports `agsl`. Glass pointing at the activity's `"default"` provider is refused, renders as a visible frosted scrim (F19), and logs exactly once:

> `A <LiquidGlassProvider providerId="default"> exists, but in a different window. A React Native <Modal> is its own window — put a <LiquidGlassProvider> inside it.`

The `providerId` namespace is per-window rather than global, so a modal may reuse `"default"` freely. And a modal can never refract the activity behind it — not a library limit but a structural one: a provider records a view tree and the activity is not in the modal's tree.

Worth noting the orphaned view still reports `agsl`. The tier is a statement about **device capability**, not about whether a backdrop was resolved — deliberate, and matching iOS, where the renderer name likewise says nothing about whether the capture succeeded.

**F25 — every Record was being converted by reflection.** `RecordTypeConverter` logs `Introspectable data is missing` and falls back to reflection unless the class carries `@OptimizedRecord`, and `metal` is a four-deep nest, so one prop commit converts up to eight Records that way. All eight are now annotated.

The annotation does not take effect *in this example build*, and not because of anything in this library: the `io.github.lukmccall.pika` KSP processor that emits the metadata is not applied to **any** module here — `:expo-modules-core`, `:expo-video` and `:expo-liquid-glass-view` all lack a `kspDebugKotlin` task and pika is absent from the Gradle cache entirely. So the warning persists locally while the annotation is correct and forward-compatible. Re-measure in Phase 7 rather than assume it is fixed.

**F26 — a mid-session environment note.** Gradle's `installDebug` hangs indefinitely against a remote adb server (`ADB_SERVER_SOCKET=tcp:host:5037`): ddmlib honours `ANDROID_ADB_SERVER_ADDRESS`/`PORT` but not `ADB_SERVER_SOCKET`, so its `DeviceMonitor` loops on "Cannot reach ADB server" while the `adb` CLI works fine. Use `assembleDebug` plus a manual `adb install`.

---

## Phase 7 — Performance

### Tasks

- [~] Device matrix — **partially met.** Adreno 740 (Galaxy S23, API 36, `agsl`) and Mali-T760 (Galaxy Note 4, API 32, `fallback-blur`) both covered, which also closes the API 31–32 row. **No API 29–30 device is available**, so the `SCRIM` tier has been exercised only by forcing it via `maxTier` on newer hardware — which is now faithful (Phase 6 **F22**) but is not the same as running on the real thing
- [x] **R4**: auto-downgrade above ~25 % screen coverage — measured rather than guessed, see **F27**
- [x] **Padded-node memory** — solved rather than capped, see **F28**. A measured **42 % cut in GPU-tracked memory** with byte-identical output
- [x] Systrace a scrolling `FlatList` of glass rows — see **F29**
- [x] ~~Consider packing the 13 loose scalar uniforms into 4 `float4`s~~ **Not doing it.** The condition was "only if profiling shows JNI in the trace", and it does not: a pure scroll rebuilds no `RenderEffect` at all, so the uniform uploads are not on the scrolling path to begin with. The `dumpsys gfxinfo` split on the flinging list is 19 ms total against 14 ms GPU — the gap is layout and record, not JNI
- [x] ~~Only re-upload changed uniforms: on a pure scroll, that is 3 calls~~ **Already 0.** No uniform depends on the view's position — the recording's translate absorbs scroll — so a pure scroll rebuilds no `RenderEffect` at all (Phase 3)

### Findings

**F27 — R4's threshold, measured. The cliff and the right threshold are not in the same place.**

A temporary probe rig — one glass view of controllable size, translated every frame by the native driver so the GPU is never idle, over a static provider — sampled with `dumpsys gfxinfo` over ~480 frames per step on the S23 (120 Hz, 8.33 ms budget), two passes:

| coverage | jank pass A | jank pass B | p50 |
|---------:|------------:|------------:|----:|
|       5% |        0.6% |        0.2% |  5ms |
|      10% |        2.1% |        1.2% |  6ms |
|      25% |        0.2% |        2.1% |  6ms |
|      50% |        3.3% |       17.9% |  7ms |
|      75% |       40.4% |       77.8% |  9ms |
|     100% |       49.9% |       79.6% | 10ms |

The *cliff* is between 50 % and 75 %. The **threshold is still 25 %**, but for a different reason than the plan assumed: pass B — the warmer, later run — is already at 18 % jank at 50 % while 25 % holds in both passes. A cold measurement at 50 % looks fine and is not.

How much the downgrade buys, interleaved low/medium/high at 100 % coverage across three rounds to cancel thermal drift:

| quality | jank (3 rounds)      | p50  | p90  |
|---------|----------------------|-----:|-----:|
| `LOW`   | 71.3 / 71.9 / 74.8 % |  9ms | 10ms |
| `MEDIUM`| 79.3 / 81.1 / 84.9 % | 10ms | 11ms |
| `HIGH`  | 83.5 / 82.3 / 86.0 % | 11ms | 12ms |

Monotonic and reproducible, but **each step is worth about 1 ms** and all three are far past budget. So R4 is a cheap marginal win, not a rescue: at high coverage the cost is fill rate over a full-screen shader pass and a full-screen padded node, not the dispersion tap count. **Nothing at this layer makes full-screen glass hold 120 Hz — only less glass does**, and the README should say so.

An earlier *non-interleaved* batch appeared to show 21 % at `LOW` against 29 % at `MEDIUM`, which would have made the downgrade look far more valuable than it is. That gap was thermal state. Interleaving is not optional for this measurement.

Design: an explicit `metal.android.quality` is honoured exactly and never overridden — a caller who asks for `high` on a full-screen view owns that. Only an **absent** value is resolved from coverage. Verified by grain signature rather than by frame timing, which is far more decisive: `LOW` drops the film grain, so high-frequency energy in a flat interior patch is 0.000 at `LOW`, ~4.2 at `MEDIUM`, ~2.4 at `HIGH` (lower than MEDIUM because 16 dispersion taps average the noise down). `AUTO` at 100 % coverage measures **0.000 across three independent patches** — identical to `LOW` — and reads as `MEDIUM` below the threshold.

**F28 — the padded backdrop was ~4x larger than the shader can actually read, and shrinking it is pixel-exact.**

The old padding was `refractionAmount + dispersionAmount + blurReach`, taken on the assumption that a refracted tap can travel `refractionAmount` outward. **It cannot travel outward at all.** The shader computes `base = pixels - amount * direction` with `direction` the *outward* SDF gradient, so a positive `amount` moves the sample **inward**; the only inputs that flip it are a negative `refraction.amount` or a negative `curve.bias`, neither of which any variant default produces. Dispersion taps walk along the *tangent* — parallel to the edge — by at most half the spread, and only round a corner.

So the true reach is `max(0, -min(0, bias) · amount) + 0.5 · dispersionAmount + blurReach`. At every variant default the refraction term is **zero** and the padding is the blur's alone. At `regular` defaults, density 3:

| case | pad | padded node | saving |
|---|---:|---|---:|
| demo panel, `blurRadius: 40` | 384 → 195 px | 10.30 → 5.98 MiB | 42 % |
| demo panel, no blur (default) | 204 → 15 px | 6.16 → 2.88 MiB | 53 % |
| list row 72 dp, no blur | 204 → 15 px | 4.11 → 1.27 MiB | 69 % |

Two independent confirmations, because a padding cut that changes a single pixel is a bug:

1. **Pixel-exact.** The tiers and props screens re-rendered **byte-identical** across the change — 0 of 1,530,000 and 0 of 11,664,000 subpixels differ. The old padding was rendering nothing.
2. **Measured memory.** `dumpsys meminfo` on the 24-row glass list, identical fling procedure before and after: `GL mtrack` **124,680 KB → 72,044 KB, −42 %**; Graphics total 196,104 → 143,468 KB. (`EGL mtrack` is unchanged at 71,424 KB — those are window surfaces, not ours.)

The negative-`bias` case, the one input that does push samples outward, has its own props tile (`curve { power 1, bias −0.8 }`) and renders cleanly under the new padding — no black rim, no smear, no corner blobs. This is the case that would fail first if the derivation were wrong.

R3's re-scoped successor is therefore **retired**, not merely mitigated. No cap on `P` was needed and the in-shader `crop` clamp is never reached in normal use.

**F29 — the scrolling glass list holds up.** 24 glass rows, ~12 visible, sustained flinging on the S23: **2.76 % janky frames, 1 missed vsync** over 434 frames, p50 19 ms total against 14 ms GPU. The Phase-3 clip is doing its job — the shader is evaluated over the view, not over the padded node — and the remaining 5 ms of non-GPU time is layout and display-list recording, not uniform upload, which is what retires the uniform-packing item above.

**F30 — an unexplained sub-perceptual variance, recorded rather than claimed.** Midway through this phase the `agsl` tile on the tiers screen shifted by a mean of 1.85/255 (max 15) over 8 % of its pixels, concentrated in the refraction band and absent from the interior. It is **not** attributable to either Phase-7 change: the padding change was proven byte-identical, and building with R4's threshold set unreachable produced output byte-identical to R4-on while still differing from the earlier capture. It is stable within a session and across launches, reinstalls and builds. Most likely a GPU driver shader-cache or pipeline-compilation difference. Flagged because it bounds how strong a "pixel-exact" claim can be on real hardware — it is not a bug anyone can see, but it is not nothing.

**F31 — environment: `adb reverse` goes to the adb *server's* host, not yours.** With `ADB_SERVER_SOCKET=tcp:<host>:5037`, `adb reverse tcp:8081 tcp:8085` tunnels the device to port 8085 on **that** machine. If Metro runs on the machine driving `adb`, the device must reach it by LAN IP instead — set `debug_http_host` to `<lan-ip>:<port>`. Related to F26: the same split is why Gradle's `installDebug` cannot see the devices at all. Avoid `pm clear` on the example app; it wipes that setting and the app then falls back to loading a bundle from assets that a debug build does not contain.

---

## Phase 8 — Docs & release

### Tasks

- [x] README: `## Android` section — the provider requirement and *why* it exists, the API-level table, the degradation matrix, the `metal.android` options, a measured performance table with the "don't cover the screen in glass" guidance, and a "things that do not work, and why" list covering `SurfaceView`, stretch overscroll, `Modal` and glass-over-glass. Opens with the plain statement that Android has **no** Apple-material equivalent and that this is a port of the *fallback* path
- [x] `## How the Android path works`, as a counterpart to the existing Metal section — display-list capture, structural self-exclusion, the chained blur→shader effect, and the "nothing is on a timer" scheduling
- [x] Per-prop platform-support column, on both the props table and the `metal` table. Every accepted-and-ignored prop now says so *and* says why
- [x] Documented the two API warts that would otherwise read as bugs: `refraction.height` also governs the angular highlight's falloff, and `dispersion.reach` falls back to the refraction *default* rather than to your `refraction.height`
- [x] Apache-2.0 attribution for the Kyant-derived AGSL — `NOTICE`, scoped to four enumerated items, linked from the README and shipped in the tarball
- [x] CHANGELOG — an `Unreleased` section covering the added API, the behaviour, the known limits and the packaging change
- [x] `npm pack --dry-run` — see **F32**
- [x] Verify a clean consumer install — see **F33**

### Findings

**F32 — the tarball was shipping 245 kB of things nobody needs, and the Android sources were fine.**

The worry going in was that `android/**` might not ship. It does, and `android/build/` was already
excluded. What was actually wrong: `bun.lock` (370 kB) and the whole `docs/android-port/` tree
(352 kB of internal planning and research) were being published — more bytes than the code they
describe. Now excluded, along with `android/.gradle/` and `android/.cxx/` for good measure.

**636 kB → 391 kB**, 184 → 178 files. Verified present: `android/build.gradle`,
`android/src/main/**`, `build/**`, `ios/**`, `expo-module.config.json`, `NOTICE`. Verified absent:
`android/build/`, `android/.gradle/`, `bun.lock`, `docs/`, `example/`.

**F33 — a clean consumer install works, including on a newer SDK than this was built against.**

Fresh `create-expo-app` (blank-typescript), `npm install <tarball>`, `npx expo prebuild --platform
android`, then `./gradlew :expo-liquid-glass-view:assembleDebug`. **BUILD SUCCESSFUL**, with no
config plugin, no `settings.gradle` edit and no Podfile-equivalent anywhere — `expoAutolinking.useExpoModules()`
resolves it from `expo-module.config.json` alone, and `expo-modules-autolinking resolve -p android`
lists `expo-liquid-glass-view` among the 11 modules it finds.

Worth noting the app was **Expo SDK 57 / RN 0.86.2**, a major version ahead of the SDK 56 / RN 0.85.3
this was developed against, and the Kotlin compiled unchanged. A consumer `App.tsx` exercising the
whole public surface — `LiquidGlassProvider`, per-corner `cornerRadius`, `tint`, `metal.android.quality`,
`metal.android.maxTier`, `onRendererChange`, `setGlassDebugLogging`, `supportsGlass` — typechecks
against the published `build/` output with no errors.

## Phase 9 — Highlight remodel

Triggered by the shine reading as a 20 dp wash rather than the thin rim actual iOS 26 glass draws.
The root cause is in the **Metal reference**, not in the translation — four defects, confirmed by
re-deriving the term and comparing against Kyant's stroke-layer highlight:

1. the band borrows `refractionScale` for its width, so at `regular` it is 20 dp deep and covers a
   44 dp control entirely;
2. it **multiplies** (`color *= 1 + glow·I·band`), so it vanishes over dark backdrops;
3. `sin(polar − angle)` lights one lobe and *darkens* the opposite quadrant by the same ±25 %,
   where real glass lights **both** light-axis lobes;
4. the *position* angle, not the surface normal, drives the falloff, so a long edge fades where
   real glass holds steady.

This fork is Android-focused and the Metal side cannot be verified here (no Mac), so the remodel is
Android-only and in-shader — the port's one deliberate **visual** divergence, marked as such in the
generated source header, the `GlassShaderSource` KDoc, the README and the CHANGELOG.

What changed, all in the HIGHLIGHT / CONTOUR fragments plus one uniform:

- `glow` — Metal's signed sweep — survives at **0.25×** weight as the faint broad shading real
  glass does have, still over the full `refractionScale` band. It is now the only term that
  distinguishes `angle` from `angle + 180`.
- The specular is new: `rim = abs(dot(normal, lobeDir))`, the falloff model of Kyant's
  `DefaultHighlightShaderString` with the falloff exponent fixed at its default 1 (so the `pow` is
  never paid). It is **added**, not multiplied, and fades over its own `highlightWidth` uniform —
  `metal.highlight.width`, default 3.5 dp (5 dp initially; see F35), an Android-only Record field
  iOS silently drops.
  `lobeDir` is `highlightDir` rotated +90°, which is what keeps `angle: 135` meaning "bright
  top-left" (and now also "bright bottom-right").
- The contour keeps its 1.5 dp width, trades the single-lobe `max(glow, 0)` for the two-lobe
  `rim`, and rises 0.35 → 0.6 now that it is the crisp line over the bloom.

No padding change: the rim samples nothing — it only adds light — so `backdropPaddingPx` and every
reach computation are untouched.

### Findings

**F34 — verified on the S23 (API 36, `agsl`), 60 glass draws/s, no uniform-set exceptions on any
quality.** The four demo tiles behave exactly as designed: `highlight.intensity 0` is completely
flat (the off-switch survives); `intensity 1` is a strong but *local* rim, where the old model
multiplied the surface by 2× on one side and 0× on the other; `angle 315` renders a rim identical
to `135` with only the faint shading flipped (the rim is 180°-periodic by construction);
`width 20` blooms visibly deeper than the default 5. The rim reads over dark backdrops — the
`frost 0` tile on black and the `clear` pill over the navy list both show it, which is the additive
term doing the one thing the multiplicative one could not. `quality "low"` keeps the soft bloom and
drops only the crisp contour line, matching which fragments each tier compiles.

**F35 — the eye-test against iOS read the default ring as 1.5× too thick, so the default width is
5 / 1.5.** The profile (`1 − smoothstep`) holds a plateau at the edge and its tail carries most of
the perceived thickness, so narrowing the width is the correct single knob — the crisp 1.5 dp
contour is already the right size and stays. 5 dp → **3.5 dp**. Overridable either way via
`metal.highlight.width`.

## Phase 10 — The stacking spike, and R4 put in context

Glass-over-glass (a slider under a bottom sheet, tabs over a glass list) was the port's loudest
divergence: a consumer's backdrop is exactly the provider's `contentNode`, so lower glass simply
does not exist in upper glass's world. The spike question: does **nested providers** — the
topology the dev warning calls "rarely what you want" — deliver stacking without touching the
library? The `stack` example screen is the test rig: base provider → stage; outer provider wraps
base + a draggable glass pill + a glass puck; a `clear` sheet outside reads outer (stacked) or
base (flat) on a live toggle.

### Findings

**F36 — nested-provider stacking works, on both test devices, with zero library changes.** The
sheet reading the outer provider shows the pill's finished glass — frost, rim, ring-refraction,
even its child `Text` — re-refracted and visibly displaced by the sheet's own lens at its rim.
The flat toggle is the control: the pill's image stops dead at the sheet's top edge. Dragging the
pill under the sheet updates its through-the-sheet image live, which is
`onDescendantInvalidated → contentGeneration` propagating through two provider levels with no
extra plumbing. Verified on the S23 (API 36, light mode) and the Poco F1 (API 36 custom ROM,
Adreno 630, dark mode — where the pill's frost correctly mixes toward black). The "inside a
different provider" warning fires once, as designed; it should learn to describe this pattern as
intentional rather than suspect.

**F37 — absolutely-positioned children at index ≥ 1 directly under the native provider view get
broken frames.** Measured twice: the child lands at `x = parent width, width = 0` (height full or
zero), even for `StyleSheet.absoluteFill` — while its own subtree lays out **correctly** within
those broken bounds (a child at `top: "56%"` resolved 56% of the real height). Child 0 is always
correct, and normal-flow children at any index are correct (the sheet's three flow children lay
out fine). Every prior screen happened to use the one-child shape, so this never surfaced. The
workaround, carried in the demo with a comment: give the provider exactly one normal-flow child
and position everything inside that. Root cause not yet chased into expo-modules/Yoga.

**F38 — the list demo's numbers, and why they do not contradict R4.** Six hard flings, `dumpsys
gfxinfo`: **S23** — 295 frames, **5.4 % janky**, p50 5 ms, p90 18 ms; **Poco F1** (60 Hz,
Adreno 630) — 152 frames, **7.9 % janky**, p50 21 ms, p90 23 ms (≈45–50 fps effective during the
fling, usable but visibly not locked). R4's 50–80 % jank measured ONE glass view at 75–100 %
coverage animating **every frame for 480 frames sustained** — a full-screen shader pass with no
idle. The list's aggregate glass coverage is high, but it is many small views whose shader
evaluations are clip-bounded to their own rects, redraw only while the scroll is actually moving,
and idle between flings; and R4's auto-LOW threshold never fires for them because it is per-view
(each row ≪ 25 %). Both results are true: **aggregate coverage from small glass is cheap; one
huge always-animating glass surface is the cliff.** The R4 doc wording should say "per-view
coverage", which is what the code implements.

---

## Phase 11 — LiquidGlassStack: stacking productized

The spike's manual sandwich became a component. `LiquidGlassStack` takes `Layer` slots bottom to
top and expands them into the F36 topology — N layers, N−1 nested providers with per-instance
auto ids (`stack:<useId()>:<k>`) — and delivers each layer's id to descendant glass through a new
`GlassStackProviderContext`, consumed by `LiquidGlassView` as `providerId ?? context`. That
context seam is the point: a reusable glass Slider or Sheet needs no `providerId` prop to
participate in stacking. The `stack` tab now dogfoods the component (the stacked/flat A-B is
which layer the sheet's content mounts in), verified on both devices with the auto-id INFO line
and zero warnings.

### Findings

**F39 — F37 is a shadow-tree defect, so the stack's wrappers must stay flattenable.** Fabric
flattens plain layout-only Views (`ViewShadowNode.cpp` forms a host view only for
`collapsable={false}`, touch handlers, transforms, background, etc. — and `pointerEvents`
materializes only for `box-only`/`none`, not `box-none`). The working demo's `stackInner`
(`{flex:1}`, prop-less) **is flattened on device** — the provider's real native children are the
absolutely-positioned pill wrap and puck at index ≥ 1, the exact shape F37 describes — and it
works. So F37 lives in shadow-node layout, not the native hierarchy, and the one-flow-child
shield only needs to exist in the element tree, which any JSX wrapper satisfies. The stack
therefore uses prop-minimal wrappers and **no `collapsable={false}`** — adding it would diverge
from the device-verified native topology and materialize N dead views.

**F40 — a provider nobody reads now skips recording; the fix that makes it safe is in
`addConsumer`.** With consumer-less providers a real topology (any empty stack layer slot; a
provider wrapped around a glassless screen), `dispatchDraw` short-circuits to
`super.dispatchDraw` — no display-list pass, no `onProviderRecorded()`, so the debug rate honestly
reads zero. The subtle half: consumers attach lazily during their own first draw, which is *after*
the provider already drew that frame, and the consumer's `content == null` retry path only ever
invalidates the consumer — against a skipping provider it would exhaust all 8 retries into a
permanent scrim. `addConsumer` therefore invalidates the provider on a genuine add, and glass
views now also resolve eagerly at attach (quietly — `warnOnMiss=false` through
`ProviderRegistry.find`, since a same-commit mount can legitimately miss; the draw path keeps the
warnings) so the sanctioned provider-first topology records its very first frame. Verified on the
S23: flat mode leaves the outer provider consumer-less and correct, every flat→stacked toggle
recovers the re-refracted pill within a frame, and rates settle to zero at rest — no invalidation
loop from the new `invalidate()`.

**F41 — transform-only drags cost almost nothing, which retires a Phase 10 assumption.** During
the pill drag the recordings *and* glass-draw counters stay near zero, yet the sheet's picture of
the pill tracks live. The whole chain is RenderThread property propagation: the pill's translation
is a `RenderNode` property update, the outer provider's display list *references* that node, and
the sheet's `RenderEffect` re-evaluates against the provider node at render time — no UI-thread
redraw anywhere. Structural changes (mount/unmount, size, scroll content) still tick the counters;
each stacked toggle shows as a burst of ~1 recording. The stacking overlap budget in the README is
therefore a bound on *structurally busy* layers, not on animated glass gliding over a stack.

---

## Phase 12 — `interactive`, reversed from not-in-scope

The §"NOT in scope" table called `interactive` unportable ("a hand-written approximation would
not match"). Reading AndroidLiquidGlass's catalog — `InteractiveHighlight`, `DampedDragAnimation`,
`LiquidBottomTabs` — falsified that: the behaviour is spring choreography (press progress,
position-follow, scale, all plain springs) plus a five-line radial specular, additive. So it was
ported at full fidelity, native springs, zero JS per frame; the flag that was accepted-and-ignored
now does on Android what `UIGlassEffect.isInteractive` does on iOS 26. This is groundwork for the
component toolkit (`expo-liquid-glass-everywhere`): per-component physics (slider tracking, toggle
snap) stay toolkit-level; the flag owns the whole press choreography — glow, dent, lens boost,
inflation, follow and jelly.

### Findings

**F42 — the glow is two uniforms and a fragment, but a uniform is five edits.** `touchPos`
(view-local px — `MotionEvent.getX/getY` feed it raw, because the shader's `pixels = fragCoord +
offset` is exactly that space, the same stability trick GRAIN uses so the glow cannot jump when
padding changes mid-press) and `touchGlow` (0–1), live in every tier. The fragment is Kyant's
falloff — flat 0.08 wash + 0.15 radial lobe, radius 1.5×min-dimension, full inside half — with
the reversed-edge `smoothstep(hi, lo, x)` rewritten forward: reversed edges are spec-undefined,
and Mali is where undefined stops meaning "works anyway". The five mandatory sites for any new
uniform: constants block, AGSL preamble, `liveUniforms` set, `buildShaderEffect` upload
(always — declared-but-unset throws at *draw*), and `primeUniforms`. Missing the last one is F44.

**F43 — observe in `dispatchTouchEvent`, claim in `onTouchEvent`.** The observer sees the whole
stream whenever anything in the subtree is the target and never changes the verdict; the claim
(`return isInteractive` after `super`) only fires when no child wanted the DOWN, which is what
keeps MOVE/UP arriving for presses on bare glass. RN is structurally indifferent: its responder
pipeline is fed from `ReactRootView.onInterceptTouchEvent` on every event regardless of native
claims, and RN child views claim their own DOWNs natively anyway. Ancestor steals (scroller
intercept, `PanResponder` grants via `JSResponderHandler`) arrive as ACTION_CANCEL → treated as
UP. Device-verified: a swipe starting on an interactive tile scrolls the list and cancels the
glow; the playground's pan-wrapped panel glows-then-cancels on drag, which is the cancel path
working, not a bug. Press scale multiplies onto the app's own transform (recovered as
`scaleX / lastPressScale`) and the backdrop stays welded under it — the F41 matrix walk again.

**F44 — the startup probe had been dead since Phase 9.** `primeUniforms` never set
`highlightWidth`, which entered every tier's live set in the highlight remodel. Declared-but-unset
throws at draw, inside the probe's broad catch → `INCONCLUSIVE`, silently — the detector for
silently-failing drivers was itself silently failing, on every device, for two phases. One line
fixes it; the probe now also primes `touchGlow = 1` so drivers compile the glow branch, per the
probe's own "compile the whole program" doctrine. The meta-lesson is recorded in the
`GlassShaderVariant` KDoc's spirit: every parallel hardcoded list is a place a change can rot
unseen — worth a grep for "parallel list" smells whenever a uniform is added.

**F45 — the eye-test round: dent, deepened lens, follow, jelly, hold-to-own.** The first cut
(glow + inflation) read as lighting, not morphing. Four additions, all riding the existing two
uniforms: a magnifying dent in `sampleBackdrop` (the one funnel every backdrop read passes
through — interior, rim band, dispersion taps all warp coherently while SDF geometry stays put);
`touchBoost = 1 + 0.35·touchGlow` multiplying `refractionAmount` and the dispersion spread, which
is Kyant's press-animated `lens()`; a magnetic follow (the view translates `0.12×` the
spring-smoothed finger displacement, clamped, and springs home because release retargets the
position springs at the press origin); and the velocity jelly (stretch along the motion axis from
the position springs' own velocities, mild thin across it — the springs' settle criteria include
velocity, so it can never stick). Scroll arbitration got a policy: a bare-glass press still held
after 150 ms calls `requestDisallowInterceptTouchEvent` — deliberate drags own the glass, flicks
breach the scroller's slop first and still scroll, and JS responder grants are faster than both.
The blur-tile "no blur" report was the demo forgetting that the fallback tier blurs only what
`metal.blurRadius` asks for — honest degradation, not a bug.

**F46 — the jelly is a function of displacement, not velocity.** The F45 jelly wobbled on slow
curved drags (the report: drag right, then slowly up — "weird bouncing"). Two porting errors,
both misreadings of `DampedDragAnimation`. First, ζ 0.5 / k 300 was taken as the drag-tracking
spec, but it is Kyant's *release* spec — the finger-follow value spring is `spring(1f, 1000f)`,
critically damped and stiff, and `InteractiveHighlight` snaps the hotspot outright during the
drag; underdamped X and Y position springs rang independently at every direction change. Second,
the stretch read the position springs' own |velocity| — a rectified oscillation the moment
anything rings — where `LiquidButton`'s `layerBlock` derives the whole jelly from the
*displacement*: `maxOffset · tanh(slope · offset / maxOffset)` for the follow (rubber-band
saturation at the view's min dimension, replacing the hard clamp) and an axis-projected
`|cos θ · dx| / maxDimension` for the stretch, which turns continuously with the drag direction,
never compresses, and is aspect-corrected so a wide view does not stretch further along its long
side. Hotspot, follow and stretch now all derive from the one spring-smoothed displacement — the
position spring is critically damped while tracking and retunes to ζ 0.5 / k 300 only for the way
home, so the release decays everything coherently on a single spring. A held displacement settles
and stops posting frames; the pinned rubber band costs nothing. Deleted with the velocity model:
`VELOCITY_NORM`, `STRETCH_ALONG`, `STRETCH_ACROSS`, `FOLLOW_CLAMP_PX`.

**F47 — the fleet matrix: three Adreno generations, one story.** Release-build `dumpsys gfxinfo`
runs across Adreno 512 (Redmi Note 7, API 34), Adreno 610 (Redmi Note 13 4G, API 35) and Adreno
740 (S23 Ultra, API 36), all on `agsl` — the table lives in the README's Performance section.
What the numbers taught beyond the table: (1) deadline-jank% without p50 latency lies — on the
continuous-animation test the 512 surrenders to 45 fps and reads "33% janky" while the 610 holds
60 fps, near-misses half its deadlines and reads "65%", yet is perceptually the smoother of the
two; (2) the list-fling column (88 → 44 → 0.75%) halves per GPU generation with no algorithmic
cliff — pure fill rate, which is why the consumer remedy is `maxTier: "fallback-blur"` rather
than any shader knob; (3) the two patterns that pass everywhere (pinned bars, `interactive`
presses) are the ones real UIs ship, so the library's sweet spot is universal; (4) GPUWatch on
the 740 put the bandwidth thesis on screen — 8.8% GPU idling with a small animating tile, 63% at
102 fps flinging the glass list at 1440p; (5) three GPUs, three Android majors, zero artifacts,
zero warnings, zero probe degradations. Mali remains the open column — the probe's actual target
audience — pending a Mali-G720 device (Poco X7 Pro). Method for that run: install the release
APK, then per scenario `dumpsys gfxinfo <pkg> reset`, exercise (12 s animation / 4 flings /
press-drag-release), dump, read "Janky frames" and the 50th percentile together.

**F48 — the edge was three lies stacked; real glass is a hairline and a lean.** The user's
side-by-side against a real iOS 26 button (and Kyant's playground over the wallpaper) named what
"off" meant: the heavy dark band rising from the bottom edge and the white wash on top do not
exist in real glass — the interior is flat and the edge is purely the glass border *light*.
Three deletions and one addition, all eye-verified on the Poco F1 against the Backdrop Catalog
reference:

1. The signed multiplicative glow wash (Metal's `sin(pos − angle)` sweep, kept at 0.25× since
   Phase 9) is deleted outright — it *was* the inset shadow. The highlight is now 180°-periodic
   by construction; the swirl lean added below becomes the one thing that still flips at
   `angle + 180`.
2. The separate contour line is folded into the rim. Its 1.5 dp width became the rim's own:
   `highlight.width` default 3.5 → **1.5 dp** (5 → 3.5 → 1.5 across the port; the band, not the
   falloff exponent, is what keeps the line crisp — Kyant's eye-matched stroke is ~0.5 dp core +
   mask blur at 0.38 alpha, additive). `low` no longer differs by a contour it no longer has.
3. The border's black gradient stops are transparent white now — same four-stop geometry, no dark
   component anywhere (Kyant's `Plain`/`Default` styles have none either) — and the gradient axis
   follows `highlight.angle`, so the stroke fades exactly where the shader's lobes die.
4. `refraction.swirl` (default 0.25, new uniform + Record field + slider): the displacement
   direction gains `swirl · lobeDir` before normalization, so the edge refraction leans toward
   the highlight's light axis — the screen-space twist the user isolated on the real button
   ("the angle controls the direction of swirl; more amount twists further"). 0 restores
   Metal/Kyant exactly (research: Kyant has **no** light-steered term; its perceived swirl is the
   1.5× gradRadius inflation + the depthEffect radial sum, both of which we already had — and its
   `coord + d·grad` refraction is *inward* like ours, because `Lens.kt:49` negates the amount
   before upload; an LLM reading the shader string alone called it outward and was wrong).
   `highlight.falloff` (Kyant's `falloff`, default 1) came along as the rim's angular shaping
   knob. Both primed in the probe (the F44 lesson, applied at authorship time this once).

Device-verified on the wallpaper backdrop (now the playground's default stage, toggleable):
swirl ±1 flips the twist direction of the boundary crossing the rim band; angle 315 vs 135 moves
nothing but the lean; no dark banding anywhere at any slider position; the edge reads as one thin
light line over both the mint and the cerulean regions.

**F49 — measurement beats eye-test: the screenshot round corrects F48's numbers.** The user
supplied real iOS 26 screenshots (a home-screen icon over banded wallpaper; dark-mode Apple Music
bars); a Fable subagent ran per-edge luminance solves and gemini-3.1-pro read the same pixels —
full ledger in `research/04-ios26-edge-evidence.md`. Sustained: the wash deletion (twice over —
the bars' interior is flat 31–32 across 100+px; their "top-lit bottom-dark" look is a content
illusion), inward sampling, falloff 1, equal lobes for bars. Corrected: the swirl lean is
falsified per-edge (no constant axis fits; default 0.25 → **0**, knob kept — the perceived twist
is `depth`'s radial fisheye, which ships); the lobe axis is vertical, not diagonal
(`highlight.angle` default 135 → **180**, all four copies: Kotlin, Swift `?? 180`, TS constant,
playground); the hairline is 0.75 dp, not 1.5 (F35's ratchet continues: 5 → 3.5 → 1.5 → 0.75),
now flanked by a measured ~7 dp sheen at 0.18× under the lit edges; and F48's line-deletion
overshot — a 1.5 pt **multiplicative** dark contour returns on the non-lit flanks (measured luma
9–17 against 35–92 neighbours; multiplicative is why Apple's dark bars show none). `unitScale`
returns to every tier for the two new point-valued bands. Method note for the next round: one
analyst eyeballing (gemini called a clockwise circulation; the solves refuted it) is a witness,
not a verdict — the ledger's consensus-or-measurement bar exists because both this round's
single-witness claims failed it.

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
      glass/           BackdropSource.kt, ProviderRegistry.kt, GlassTier.kt,
                       GlassAppearance.kt, CornerRadii.kt, GlassDebug.kt,
                       GlassShaderSource.kt, GlassShaderCache.kt
NOTICE                                     ← Apache-2.0 attribution for the Kyant-derived AGSL
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
