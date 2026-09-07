# Liquid Glass — iOS Behaviour Parity Specification (for the Android port)

Repo: `/home/captainhandsome/projects/expo-liquid-glass-view` @ `92e4ae7`. Package version `0.1.10`.
There is **no `android/` directory**; `expo-module.config.json` declares `"platforms": ["apple"]` only. Podspec floor is iOS/tvOS 15.1 (`ios/ExpoLiquidGlass.podspec:76-79`), README claims 16.4 (`README.md:146`).

Two backends exist today:
- **native** — `UIGlassEffect` inside a `UIVisualEffectView`, iOS 26+ only.
- **metal** — a custom `CAMetalLayer` + `.metal` shader pipeline that rasterises the window into a texture and refracts it.
- **fallback-blur** — a third, undocumented-in-props state: `UIBlurEffect(style: .systemThinMaterial)` used when Metal cannot initialise.

---

## 1. Public TS API inventory

### 1.1 `LiquidGlassView`

Declared in `src/interfaces/liquid-glass-view.interface.ts:21-32`; component in `src/components/LiquidGlassView/LiquidGlassView.tsx`.

| Prop | Exact TS type | Default | Effect |
|---|---|---|---|
| `variant` | `TGlassVariant = "regular" \| "clear"` | `"regular"` (Swift-side, `ExpoLiquidGlassModule.swift:18`) | Native: picks `UIGlassEffect.Style.clear` vs `.regular` (`LiquidGlassView.swift:224`). Metal: selects the entire `MetalDefaults` block (`Enums/GlassVariant.swift:32-67`) used for every unset `metal.*` field. |
| `renderer` | `TGlassRenderer = "auto" \| "native" \| "metal"` | `"auto"` (`ExpoLiquidGlassModule.swift:22`) | Backend preference. See §5. |
| `cornerRadius` | `TGlassCornerRadius = number \| { topLeft?: number; topRight?: number; bottomRight?: number; bottomLeft?: number }` | `0` (uniform) (`Records/GlassCornerRadii.swift:51-54`) | Glass silhouette (Metal SDF), content clip mask, border stroke path, native-tint backdrop-fill path. Unset object keys default to `0`, **not** to the number form. |
| `cornerStyle` | `TGlassCornerStyle = "continuous" \| "circular"` | `"continuous"` (`ExpoLiquidGlassModule.swift:26`) | Maps to `CALayerCornerCurve` (`Enums/GlassVariant.swift:83-85`). **Only affects content/effect-view clipping, and only in the uniform-radius branch** (`LiquidGlassView.swift:399, 414`). The Metal shader silhouette is always circular; so is the non-uniform `UIBezierPath` (`LiquidGlassView.swift:462-480`) and the border path. |
| `tint` | `ColorValue` (RN) | `.clear` → RGBA `(0,0,0,0)` (`ExpoLiquidGlassModule.swift:34`) | Native: `UIGlassEffect.tintColor`, nil'd when alpha == 0 (`LiquidGlassView.swift:226`). Metal: `GlassParams.tintColor`, alpha is the mix weight. Also drives `NonRenderableLayer.backdropFillColor` so a native-tinted view still contributes colour to *other* views' Metal backdrops (`LiquidGlassView.swift:387-396`). |
| `interactive` | `boolean` | `false` (`ExpoLiquidGlassModule.swift:38`) | Native-only. See §7. |
| `metal` | `IGlassMetalOptions` | `GlassMetalOptions()` — all fields `nil` (`ExpoLiquidGlassModule.swift:42`) | Metal-only tuning. See 1.3. |
| `style` | `StyleProp<ViewStyle>` | — | Applied to the native view itself (`LiquidGlassView.tsx:25`). |
| `containerStyle` | `StyleProp<ViewStyle>` | — | Applied to an RN `<View pointerEvents="box-none">` wrapper injected around `children` — **only when `children` is truthy** (`LiquidGlassView.tsx:30-34`). Never crosses the bridge. |
| `children` | `ReactNode` | — | Mounted into `visualEffectView.contentView` (native/fallback) or `contentContainer` (metal) (`LiquidGlassView.swift:319-324`). |
| `onRendererChange` | `(renderer: TGlassActiveRenderer) => void` where `TGlassActiveRenderer = "native" \| "metal" \| "fallback-blur"` | — | Unwrapped from `event.nativeEvent.renderer` in JS (`LiquidGlassView.tsx:17-21`). The native listener is only attached when the JS prop is present (`LiquidGlassView.tsx:27`). |

Notable: `LiquidGlassView.tsx` has **no `Platform.OS` guard**. It renders `NativeLiquidGlassView` unconditionally. `README.md:19` ("On Android and web the components render as plain views") is currently only true for the container.

### 1.2 `LiquidGlassContainer`

`src/interfaces/liquid-glass-container.interface.ts:3-5`, `src/components/LiquidGlassContainer/LiquidGlassContainer.tsx`.

| Prop | Exact TS type | Default | Effect |
|---|---|---|---|
| `spacing` | `number \| undefined` | `undefined` → system default; `UIGlassContainerEffect.spacing` is only assigned when non-nil (`LiquidGlassContainerView.swift:51-55`) | Points at which nested glass merges. |
| `style` | `StyleProp<ViewStyle>` | — | |
| `children` | `ReactNode` | — | |

`Platform.OS !== "ios"` → renders `<View style={style}>{children}</View>` (`LiquidGlassContainer.tsx:14-16`).

### 1.3 The `metal` record — every field with its resolved default

TS: `src/interfaces/glass-metal.interface.ts:1-37`. Swift: `ios/Records/GlassMetalOptions.swift`, `ios/Records/GlassRefractionCurve.swift`. Resolution happens in `LiquidGlassView.applyAppearance()` (`LiquidGlassView.swift:240-274`) via `resolve(_ override: Double?, _ fallback: CGFloat)` (`:276-279`).

**All fields are optional (`Double?`).** Every unset field falls back to `variant.metalDefaults`.

| TS path | TS type | `regular` default | `clear` default | Units | Notes |
|---|---|---|---|---|---|
| `blurRadius` | `number?` | `0` | `0` | points | `Enums/GlassVariant.swift:36,52`. `> 0.01` enables the two-pass blur (`GlassSurfaceView.swift:166`). |
| `captureQuality` | `number?` | `1` | `1` | multiplier on screen scale | **Not** variant-driven; hard `?? 1` then `max(_, 0.25)` floor (`LiquidGlassView.swift:248`). |
| `opacity` | `number?` | `1` | `1` | 0–1 | Hard `?? 1`, not variant-driven, **unclamped** (`LiquidGlassView.swift:269`). |
| `frost` | `number?` | `0.36` | `0.06` | 0–1 mix weight | `GlassVariant.swift:45,61` |
| `saturation` | `number?` | `1.8` | `1.15` | multiplier | `GlassVariant.swift:46,62`. Unclamped; the demo passes `-5` (`example/screens/LiquidGlassDemo.tsx:40`). |
| `noise` | `number?` | `0.05` | `0.06` | 0–1 amplitude | `GlassVariant.swift:48,64` |
| `light` | `number?` | `0.0` | `0.0` | additive fraction | `GlassVariant.swift:43,59` |
| `refraction.amount` | `number?` | `60` | `30` | points | `GlassVariant.swift:39,55` |
| `refraction.width` | `number?` | `20` | `10` | points | Band depth in from **left/right** edges. `GlassVariant.swift:37,53` |
| `refraction.height` | `number?` | `20` | `10` | points | Band depth in from **top/bottom** edges. `GlassVariant.swift:38,54` |
| `refraction.depth` | `number?` | `1` | `0` | 0–1 blend | Edge-normal (0) ↔ radial (1). `GlassVariant.swift:40,56` |
| `refraction.curve.power` | `number?` | `1` | `1` | exponent | `GlassRefractionCurve.swift:5`; variant profile `SIMD2(1,0)` at `GlassVariant.swift:41,57`. |
| `refraction.curve.bias` | `number?` | `0` | `0` | unitless | Same. **`curve` is all-or-nothing**: `refraction?.curve?.simd ?? defaults.profile` (`LiquidGlassView.swift:256`). Supplying `{ power: 2 }` silently sets `bias` to the Record default `0`, not the variant's. |
| `dispersion.amount` | `number?` | `6` | `10` | points of tangential spread | `GlassVariant.swift:42,58` |
| `dispersion.reach` | `number?` | `20` | `10` | points | **Gotcha**: falls back to `defaults.height` — the *refraction* height default — not a dedicated value, and not to your `refraction.height` override (`LiquidGlassView.swift:259`). |
| `highlight.intensity` | `number?` | `0.25` | `0.35` | 0–1 | `GlassVariant.swift:47,63` |
| `highlight.angle` | `number?` | `135` | `135` | **degrees** in, radians out | Hard `?? 135`, not variant-driven; converted `* .pi / 180` (`LiquidGlassView.swift:262`). Screen-space, y-down. |
| `border.width` | `number?` | `1` | `1` | points | Hard `?? 1` (`LiquidGlassView.swift:77`). `0` hides the border layer (`:430`). |
| `border.opacity` | `number?` | `0.28` | `0.4` | 0–1 | `GlassVariant.swift:49,65` (`LiquidGlassView.swift:273`). |

> **Trap for the porter:** `GlassSurfaceView` declares a second, *different* set of stored-property defaults (`GlassSurfaceView.swift:16-42`: `refractionScale 32×32`, `refractionAmount 60`, `dispersionHeight 20`, `dispersionAmount 12`, `highlightIntensity 0.5`, `highlightAngle .pi*0.75`, `lightIntensity 0.08`, `noiseAmount 0.06`, `frostAmount 0.3`, `saturation 1.7`). These are **dead** — `applyAppearance()` runs in `init` (`LiquidGlassView.swift:129`) and overwrites all of them with the `regular` variant block before any frame is drawn. Do not copy them.

### 1.4 Module-level exports

| Export | Source | Value |
|---|---|---|
| `supportsNativeGlass: boolean` | `src/utils/platform.utils.ts:5-6` | `Platform.OS === "ios" && ExpoLiquidGlassModule?.supportsNativeGlass === true`. Resolved **once at import**, not reactive. |
| `GlassVariant` enum | `src/enum/index.ts:1-4` | `Regular="regular" \| Clear="clear"` |
| `GlassRenderer` enum | `src/enum/index.ts:6-10` | `Auto="auto" \| Native="native" \| Metal="metal"` |
| Constants | `src/constants/glass.constants.ts` | `GLASS_VARIANTS`, `GLASS_RENDERERS`, `GLASS_ACTIVE_RENDERERS`, `GLASS_CORNER_STYLES`, `DEFAULT_GLASS_VARIANT="regular"`, `DEFAULT_GLASS_RENDERER="auto"`, `DEFAULT_GLASS_CORNER_STYLE="continuous"`, `DEFAULT_HIGHLIGHT_ANGLE=135`, `DEFAULT_BORDER_WIDTH=1`, `DEFAULT_GLASS_OPACITY=1`, `MIN_IOS_VERSION_FOR_NATIVE_GLASS=26`. **None of these constants are referenced by any component** — they exist only as type sources (`src/types/glass.types.ts:10-16`). Native holds the real defaults. |
| `NATIVE_MODULE_NAME` | `src/constants/native.constants.ts:1` | `"ExpoLiquidGlass"` |
| `NATIVE_VIEW_NAMES` | `:3-6` | `"LiquidGlassView"`, `"LiquidGlassContainerView"` |

Native views are resolved through a `globalThis["__expoLiquidGlassNativeViews__"]` Map memo (`src/utils/native-view.utils.ts:4-31`) so `requireNativeView` runs once per (module, view) pair.

---

## 2. Prop → native plumbing

Bridge surface is `ios/ExpoLiquidGlassModule.swift:14-50`. There is **no name mangling anywhere**: every Expo `Prop("x")` name, every `@Field` name, and every TS interface key are byte-identical. Records are plain `Record` structs with no `@Field(key:)` overrides.

| TS prop | Expo declaration | Swift type | Lands on native (`UIGlassEffect`) | Lands on Metal | Notes |
|---|---|---|---|---|---|
| `variant` | `Prop("variant")` `:17` | `GlassVariant?` (`String`-backed `Enumerable`, `GlassVariant.swift:4-8`) | `UIGlassEffect(style: .clear/.regular)` `:224` | selects entire `MetalDefaults` block | **both** |
| `renderer` | `Prop("renderer")` `:21` | `GlassBackend?` (`GlassVariant.swift:70-77`) | backend selection | backend selection | **both** |
| `cornerStyle` | `Prop("cornerStyle")` `:25` | `GlassCornerStyle?` (`GlassVariant.swift:79-86`) | `visualEffectView.layer.cornerCurve` `:414` | `contentContainer.layer.cornerCurve` `:399` only — **not a shader uniform** | **both**, but never reaches the shader |
| `cornerRadius` | `Prop("cornerRadius")` `:29` | `Either<Double, GlassCornerRadii>?` → `CornerRadiiValues` (`GlassCornerRadii.swift:50-74`) | layer `cornerRadius` or `CAShapeLayer` mask `:414-425` | `GlassParams.cornerRadii` + content mask + border path | **both**. `Either.get()` tries `Double` first, then the record; nil → uniform 0. |
| `tint` | `Prop("tint")` `:33` | `UIColor?` | `effect.tintColor` (nil if α==0) `:226` | `GlassParams.tintColor` via `UIColor.simdRGBA` (`LiquidGlassView.swift:486-499`) | **both** |
| `interactive` | `Prop("interactive")` `:37` | `Bool?` | `effect.isInteractive` `:225` | **ignored entirely** | native-only |
| `metal` | `Prop("metal")` `:41` | `GlassMetalOptions?` (Record of nested Records) | `border.width/opacity` reach a `CAGradientLayer` only when **not** native `:430` | all other fields → `GlassSurfaceView` stored props → `GlassParams` | metal-only |
| `spacing` (container) | `Prop("spacing")` `:47` | `Double?` | `UIGlassContainerEffect.spacing` | — | native-only |
| `onRendererChange` | `Events("onRendererChange")` `:15` | `EventDispatcher` (`LiquidGlassView.swift:80`) | payload `["renderer": String]` | same | both |
| `containerStyle` | — | — | — | — | **JS-only**, never crosses the bridge (`LiquidGlassView.tsx:31`) |

**Renderer applicability matrix:**

| Group | Props | Native (`UIGlassEffect`) | Fallback-blur | Metal |
|---|---|---|---|---|
| Backend-agnostic | `renderer`, `cornerRadius`, `style`, `containerStyle`, `children`, `onRendererChange` | ✔ | ✔ | ✔ |
| Both, different meaning | `variant`, `tint`, `cornerStyle` | ✔ | `variant`/`tint` **ignored** (fixed `.systemThinMaterial`, `LiquidGlassView.swift:192`); `cornerStyle` still clips | ✔ |
| Native-only | `interactive`, container `spacing` | ✔ | ✗ | ✗ (no-op) |
| Metal-only | all of `metal.*` | ✗ | ✗ (`border` hidden — `!isUsingNativeGlass` gate at `:430`) | ✔ |

**Applied-value flow (Metal):** JS record → `LiquidGlassView.metal` didSet (`:69-74`, no equality check — always schedules) → `setNeedsAppearanceUpdate()` coalesces to one `DispatchQueue.main.async` (`:230-238`) → `applyAppearance()` (`:240-274`) writes ~16 `GlassSurfaceView` stored properties, each with a `didSet { invalidate(old != new) }` that sets `needsRedraw` (`GlassSurfaceView.swift:74-77`) → next frame's `glassDrawRequest` builds a fresh `GlassParams` struct (`:177-200`) uploaded with `setFragmentBytes(..., index: 1)` (`GlassRenderContext.swift:132`) — no persistent uniform buffer.

`metal` didSet also calls `invalidateShape()` if `border.width` changed (`:72`), because border geometry is CPU-side.

Dark-mode reactivity: `traitCollectionDidChange` re-resolves `UIColor.systemBackground` into `resolvedFrostColor` and re-runs `applyAppearance()` **synchronously** (`LiquidGlassView.swift:287-292`, `:281-285`).

---

## 3. Uniform table

### 3.1 `GlassParams` — `ios/Shaders/LiquidGlass.metal:18-45`, mirrored in `ios/Glass/GlassRenderContext.swift:11-32`, populated at `ios/Glass/GlassSurfaceView.swift:177-200`

Metal byte layout (float4=16B align, float2=8B, float=4B). Total **144 bytes**:

| Off | Field | Metal type | Source | Units | Default (regular / clear) |
|---|---|---|---|---|---|
| 0 | `cornerRadii` | `float4` | `CornerRadiiValues.simd(for:)` = `(bottomLeft, bottomRight, topRight, topLeft)`, each clamped to `min(w,h)/2` (`GlassCornerRadii.swift:27-45`); set at `LiquidGlassView.swift:380` | points | `(0,0,0,0)` |
| 16 | `tintColor` | `float4` | `tint.simdRGBA`, straight (non-premultiplied) RGBA | 0–1 | `(0,0,0,0)` |
| 32 | `frostColor` | `float4` | `.rgb` = `UIColor.systemBackground` resolved for the trait collection (light `1,1,1`; dark `0,0,0`); `.a` **overwritten** by `frostAmount` at `GlassSurfaceView.swift:163-164` | 0–1 | rgb theme-dependent, a = `0.36` / `0.06` |
| 48 | `sourceRect` | `float4` | If blurring: `(padding/paddedW, padding/paddedH, w/paddedW, h/paddedH)` — the view's sub-rect inside the padded blur texture. Else: `backdropUVRect(inset: 0)` — the view's rect in the shared backdrop texture. (`GlassSurfaceView.swift:168-175`) | normalised UV (0–1) | computed |
| 64 | `viewSize` | `float2` | `bounds.size` | **points** | layout |
| 72 | `shapeSize` | `float2` | same `viewSize` value (`GlassSurfaceView.swift:182-183`) | points | identical to `viewSize` — currently redundant |
| 80 | `refractionScale` | `float2` | `(refraction.width, refraction.height)` | points | `(20,20)` / `(10,10)` |
| 88 | `refractionAmount` | `float` | `refraction.amount` | points of displacement | `60` / `30` |
| 92 | `depthEffect` | `float` | `refraction.depth` | 0–1 blend weight | `1` / `0` |
| 96 | `profilePower` | `float` | `refraction.curve.power` | exponent | `1` / `1` |
| 100 | `profileBias` | `float` | `refraction.curve.bias` | unitless | `0` / `0` |
| 104 | `dispersionHeight` | `float` | `dispersion.reach` | points | `20` / `10` |
| 108 | `dispersionAmount` | `float` | `dispersion.amount` | points of tangential spread | `6` / `10` |
| 112 | `highlightIntensity` | `float` | `highlight.intensity` | 0–1 | `0.25` / `0.35` |
| 116 | `highlightAngle` | `float` | `highlight.angle * π/180` (`LiquidGlassView.swift:262`) | **radians**, screen-space with **+y down** | `2.35619` (135°) both |
| 120 | `lightIntensity` | `float` | `metal.light` | additive fraction | `0.0` / `0.0` |
| 124 | `glassOpacity` | `float` | `metal.opacity` | 0–1 | `1` / `1` |
| 128 | `saturation` | `float` | `metal.saturation` | multiplier | `1.8` / `1.15` |
| 132 | `noiseAmount` | `float` | `metal.noise` | 0–1 | `0.05` / `0.06` |
| 136 | `_pad0` | `float2` | zero | — | — |

`cornerRadii` swizzle contract, from `radiusAt()` (`LiquidGlass.metal:55-60`) with `centered.y` increasing **downward**: `.x`=bottom-left, `.y`=bottom-right, `.z`=top-right, `.w`=top-left.

### 3.2 `BlurParams` — `LiquidGlass.metal:9-16` / `GlassRenderContext.swift:4-9`. **32 bytes**.

| Off | Field | Source (H pass) | Source (V pass) | Units |
|---|---|---|---|---|
| 0 | `uvRect` | `paddedUVRect` = view rect expanded by `glassBackdropPadding`, in the shared backdrop texture's UV space (`GlassRenderer.swift:102`) | `(0,0,1,1)` — the ping texture is exactly the region (`GlassRenderer.swift:117`) | normalised UV |
| 16 | `texelStep` | `(1/backdrop.width, 0)` | `(0, 1/ping.height)` | 1/texels |
| 24 | `radius` | `blurRadius * captureScale` (`GlassSurfaceView.swift:219`) | same | **capture-space texels** |
| 28 | `_pad0` | 0 | 0 | — |

### 3.3 Derived quantities the Android side must replicate exactly

| Quantity | Formula | Site |
|---|---|---|
| `glassBackdropPadding` | `(max(refractionAmount + dispersionAmount, blurRadius > 0.01 ? max(blurRadius*1.5, 16) : 0) + 2).rounded(.up)` | `GlassSurfaceView.swift:133-137` |
| `glassCaptureScale` (requested) | `max(renderScale * captureQuality, 1)` | `GlassSurfaceView.swift:129-131` |
| `renderScale` | `window.screen.nativeScale` (fallback `UIScreen.main.scale`) | `GlassSurfaceView.swift:111` |
| `drawableSize` | `(bounds.w * renderScale, bounds.h * renderScale)` each `.rounded()` | `GlassSurfaceView.swift:214-217` |
| `blurPixelSize` | `max(round(paddedSize.{w,h} * captureScale), 8)` | `GlassSurfaceView.swift:202-207` |
| backdrop UV rect | `((frameInWindow.minX - capturedOrigin.x)/texSizePts.w, …minY…/h, frame.w/w, frame.h/h)` | `GlassSurfaceView.swift:224-240` |

### 3.4 Shader math contract (must match numerically)

`glassGeometry()` — `LiquidGlass.metal:141-163`:
- `halfSize = shapeSize * 0.5`; `centered = uv*viewSize - viewSize*0.5` (points, y-down).
- `sd = sdRoundedRect(centered, halfSize, cornerRadii)` — standard IQ rounded-box SDF with per-quadrant radius; negative inside.
- **Normal uses a different radius set**: `gradRadius = min(cornerRadii * 1.5, min(halfSize.x, halfSize.y))` (`:147-148`) — inflating the corner radius by 1.5× so the normal field sweeps more smoothly than the silhouette.
- `direction = normalize(normal + depthEffect * normalize(centered))`, fallback to `normal`.
- `scale = max(dot(normal*normal, clamp(refractionScale, 1e-3, halfSize)), 1e-3)` — anisotropic band depth: `refraction.width` governs left/right edges, `.height` top/bottom, smoothly interpolated at corners by the squared normal.
- `t = clamp(-min(sd,0)/scale, 0, 1)` — 0 at the rim, 1 at band depth.

`refractedPixels()` — `:165-169`: `profile = circleMap(pow(1-t, max(power,1e-3)))` where `circleMap(x)=1-sqrt(1-x²)`; `amount = (profile + bias*(1-t)) * refractionAmount`; result `pixels - amount*direction` (`direction` points outward, so this samples inward).

`glassFragment()` — `:180-256`, in strict order:
1. `aa = max(fwidth(sd), 1e-4)`; `shapeAlpha = 1 - smoothstep(-aa, aa, sd)`; **early return `float4(0)` if `shapeAlpha <= 0.001`**.
2. `inside = -min(sd,0)`. If `inside >= scale` → sample backdrop **unrefracted** (flat interior).
3. Else `dispersionT = clamp(inside / max(dispersionHeight,1e-3), 0, 1)`; `spread = circleMap(1 - dispersionT) * dispersionAmount`.
   - `spread < 2.0` → one refracted tap.
   - Else 16-iteration loop along `tangent = (direction.y, -direction.x)`, `u = i / min(spread, 16)`, `break` when `u > 1`; offset `tangent * (u-0.5) * spread`. Channel masks: **R** `step(0.5,u)`, **G** `step(0.25,u)*step(u,0.75)`, **B** `step(u,0.5)`. Per-channel weighted average.
4. `clamp(color,0,1)`; luma = Rec.709 `(0.2126, 0.7152, 0.0722)`; `mix(luma, color, saturation)`.
5. `mix(color, frostColor.rgb, frostColor.a)`.
6. `mix(color, tintColor.rgb, tintColor.a)`.
7. If `noiseAmount > 0`: `color += (hashNoise(position.xy * 1e-3) - 0.5) * noiseAmount`, where `hashNoise(c) = fract(sin(dot(c,(12.9898,78.233))) * 43758.5453)`. **`position.xy` is in drawable pixels and the `1e-3` factor makes this very low-frequency — a soft mottle, not per-pixel grain.**
8. `glow = sin(atan2(normalized.y, normalized.x) - highlightAngle)` with `normalized = centered/max(halfSize,1e-4)`; `band = 1 - smoothstep(0,1,t)`; `color *= 1 + glow*highlightIntensity*band + lightIntensity`.
9. `contour = 1 - smoothstep(0, 1.5, abs(sd))` (a ~3-point rim line); `color += contour * highlightIntensity * 0.35 * max(glow, 0)`.
10. `clamp`; `alpha = shapeAlpha * glassOpacity`; **return `float4(color * alpha, alpha)` — premultiplied**.

`blurFragment()` — `:98-126`: `radius <= 0.01` → passthrough sample. Otherwise `sigma = max(radius*0.5, 1e-4)`, `stride = max(radius*1.5/8, 1.0)` texels, 8 symmetric tap pairs + centre (**17 samples/pass**), weight `exp(offset² · -1/(2σ²))` (written as `exp2(… · 1.4426950)`). Sampler is `linear/linear/clamp_to_edge` (`:91-93`).

---

## 4. Render pipeline (per frame)

Only the **Metal** path has a pipeline. Native views never subscribe (`installNativeGlass` removes `surface` from the hierarchy → `didMoveToWindow(window: nil)` → unsubscribe, `GlassSurfaceView.swift:79-89`), so a screen of only native glass costs zero.

### Phase A — `CADisplayLink.tick` (`GlassFrameScheduler.swift:100-114`), main thread, at the top of the frame

1. `frameDuration = max(link.targetTimestamp - link.timestamp, 1/120)`.
2. `isUnderLoad = lastFrameTimestamp > 0 && (timestamp - lastFrameTimestamp) > frameDuration * 1.5`.
3. If `frameIsPending` (the runloop observer never fired last frame) → `gather()` now.
4. `prune()` dead weak refs; bail if none.
5. `backdropDidChange = captureBackdrop()`.
6. `frameIsPending = true`.

`captureBackdrop()` (`:116-140`): unions every participant's `glassRegionInWindow` **each already inset by that participant's own `glassBackdropPadding`**, takes `max` of all `glassCaptureScale`, and hands the union + scale to `BackdropCapturer.capture(...)`. A participant is skipped if `bounds ≤ 1×1`, `isHidden`, or `alpha ≤ 0.01` (`GlassSurfaceView.swift:120-125`).

### Phase B — `CFRunLoopObserver(.beforeWaiting)` (`GlassFrameScheduler.swift:69-81, 142-146`)

Registered on `CFRunLoopGetMain()` in `.commonModes` alongside the display link (which is in `.common`). Firing at `beforeWaiting` means gathering happens **after UIKit has laid out and committed the frame**, so `convert(bounds, to: window)` reflects final geometry. This two-phase split (capture at vsync → encode after layout) is the load-bearing ordering trick.

`gather()` (`:148-170`):
- Bail if `capturer.texture == nil`.
- `changed = backdropDidChange || lastSubmissionDropped` (a dropped submission forces the next frame to redraw).
- Ask each participant for a `GlassDrawRequest`, collect into one `batch`.
- `lastSubmissionDropped = !GlassRenderer.shared.submit(batch)`.

### Phase C — per-view redraw decision (`GlassSurfaceView.glassDrawRequest`, `:139-222`)

Redraw iff `needsRedraw || moved || backdropDidChange`, where:
- `needsRedraw` is set by any uniform change (`invalidate(_:)`, `:74-77`), `layoutSubviews` (`:107`), `updateContentsScale` (`:115`), and `subscribe()` (`:95`).
- `moved` = `backdropUVRect(inset: -padding) != lastUVRect` — i.e. the view's position **relative to the captured backdrop origin** changed, in UV terms.

Guard rails: needs a window and `bounds > 1×1`; `lastUVRect` is reset to nil on unmount and on failure. When it declines, `needsRedraw` stays as-is and no drawable is acquired.

### Phase D — GPU encode (`GlassRenderer.swift`)

- `submit()` (`:48-58`): non-blocking `DispatchSemaphore(value: 2).wait(timeout: .now())`. Failure → returns `false` (frame dropped, flagged for retry). Success → dispatch async onto a serial `.userInteractive` queue `expo.liquidglass.render`.
- `encode(_ requests:)` (`:60-76`): **one `MTLCommandBuffer` labelled `"GlassFrame"` for the entire batch**; committed once, and only if at least one view presented.
- Per request (`:78-157`):
  1. If `appliedDrawableSize != drawableSize` → set `layer.drawableSize` inside a `CATransaction` with actions disabled, and **release the blur ping/pong textures**.
  2. **Blur pass H** (only if `needsBlur`): `blurPipeline`, source = shared backdrop texture, `uvRect = paddedUVRect`, `texelStep = (1/backdrop.width, 0)` → `ping` (offscreen, load `.clear`, store `.store`, clear colour transparent).
  3. **Blur pass V**: source = `ping`, `uvRect = (0,0,1,1)`, `texelStep = (0, 1/ping.height)` → `pong`. `source = pong`.
  4. If not blurring: `releaseBlurTextures()` and `source = backdrop`.
  5. `layer.nextDrawable()` (called **on the render queue**, not main; may block). Nil → skip this view.
  6. **Glass pass**: `glassPipeline`, source = `pong` or the shared backdrop, into `drawable.texture`, `loadAction .clear`, clear `(0,0,0,0)`.
  7. `commandBuffer.present(drawable)`.

So: **2 or 3 passes per view per frame** (blur H, blur V, composite; or just composite). Intermediate textures are per-view `ping`/`pong` (`GlassSurfaceCore`, `GlassRenderContext.swift:4-22`), `bgra8Unorm`, `.private`, `[.renderTarget, .shaderRead]`, reallocated only when `blurPixelSize` changes (`GlassRenderer.swift:159-170`).

Every pass is the same full-screen quad: a 4-vertex triangle strip `(-1,-1,0,1) (1,-1,1,1) (-1,1,0,0) (1,1,1,0)` — **`xy` = NDC, `zw` = UV, with UV `v` flipped so `v=0` is the top** (`GlassRenderContext.swift:53-58`, vertex shader `:47-53`). Params go via `setFragmentBytes(index: 1)`, texture via `setFragmentTexture(index: 0)`.

`CAMetalLayer` config (`GlassSurfaceView.swift:55-65`): `bgra8Unorm`, `isOpaque = false`, `framebufferOnly = true`, `presentsWithTransaction = false`, `maximumDrawableCount = 3`, `contentsScale = nativeScale`.

### Phase E — backdrop capture (`BackdropCapturer.swift`)

`capture(window:region:scale:frameDuration:isUnderLoad:)` (`:148-202`):
1. If the requested scale changed → drop all slots.
2. `clipped = region ∩ window.bounds`; bail if empty.
3. `moved = clipped != lastRegion`; if moved, stamp `lastMovementTime`.
4. `mustRefreshGeometry = !capturedRegion.contains(clipped)`.
5. `isMoving = now - lastMovementTime < 0.4s`.
6. `stride = staleCaptures >= 4 ? 4 : strideFrames`; `dueByCadence = !isMoving && frameCounter % stride == 0`.
7. **Bail unless `mustRefreshGeometry || dueByCadence`.** Note the consequence: **while moving, cadence capture is switched off entirely** — instead the captured region is inflated by a `220pt` margin (`Tuning.movementMargin`, `:44`) and re-rasterised only when the glass leaves that margin. Dragging a glass view pans within a stale, over-sized capture. This is the single biggest perceptual behaviour to replicate.
8. `rasterise(window:region:target)`; measure elapsed; EMA `captureCost` with smoothing `0.2`.
9. `updateStride(frameDuration:)`.

`updateStride` (`:204-229`): budget = `frameDuration * 0.30` (`dutyCycle`); `needed = ceil(captureCost/budget)` clamped to `1…3` (`maxStride`); requires **45 consecutive frames** of agreement (`strideHysteresisFrames`) before committing.

`rasterise` (`:251-349`):
- **Scale pinning**: `ceiling = sqrt(4_500_000 / regionArea)`; `textureScale = max(floor(min(requestedScale, ceiling)*4)/4, 1.0)` — quantised to ¼ steps, capped at 4.5 Mpx. Scale change → drop slots.
- **Origin snapping**: `origin = floor(region.min * scale)/scale` — texel-aligned so UV maths stays stable; `size = region.max - origin`.
- `prepareSlots(for:)` (`:485-539`): pixel dims rounded up to a **64-px bucket**; reuse if the request fits and doesn't waste ≥2× in either axis; a shrink only takes effect after **1.0 s** of continuous smaller demand (`shrinkDelay`). Allocates **2 slots** (double buffering), `bytesPerRow` aligned to `device.minimumLinearTextureAlignment(for: .bgra8Unorm)`.
- **Zero-copy on device** (`makeSlot`, `:560-592`): `MTLBuffer(storageModeShared)` → `buffer.makeTexture(descriptor:offset:bytesPerRow:)` → `CGContext(data: buffer.contents(), …, premultipliedFirst | byteOrder32Little)`. Core Graphics draws *directly into GPU-visible memory*; `uploadSource == nil` so **no `texture.replace` step**. On the **simulator** (`#if !targetEnvironment(simulator)` excludes the fast path) it falls back to malloc'd memory + `texture.replace(region:…)`.
- CTM: `translate(0, pixelHeight)` → `scale(scale, -scale)` → `translate(-origin)`. This flips CG's bottom-left origin so texel `v=0` is the **top** of the region, matching the vertex shader's flipped UVs.
- `clip(to: regionRect)` then `clear(regionRect)`.
- Draw via the active strategy (§8).
- Empty-detection (`:327-341`) and FNV-1a digest over every 97th pixel (`:231-249`) to drive `staleCaptures` → idle stride 4.
- Publishes `texture`, `capturedOrigin`, `textureSizePoints = slot.pixelSize / scale`.

`textureSizePoints` uses the **allocated (bucketed) slot size**, not the requested region size — so the UV rect divides by the padded allocation. Getting this wrong shifts the whole backdrop.

### Phase F — lifecycle

`add()` starts the display link + runloop observer on first participant (`:62-82`). `remove()` → `stopIfIdle()` invalidates the link, removes the observer, clears the batch, and calls `BackdropCapturer.shared.releaseResources()` (`:84-98`) which frees the slots and resets all adaptive state — but **not** the capture `strategy`, which is sticky for the process lifetime.

---

## 5. Renderer selection & lifecycle

### Resolution (`LiquidGlassView.swift:133-172`)

```
shouldUseNativeGlass:
  backend == .metal            -> false
  backend == .native || .auto  -> (iOS >= 26) && isGlassEffectAvailable
```

`isGlassEffectAvailable` is a lazy static (`:143-151`): `NSClassFromString("UIGlassEffect") as? NSObject.Type` and `responds(to: NSSelectorFromString("effectWithStyle:"))`.

**`renderer="native"` is a preference, not a force.** On iOS < 26 it silently resolves to Metal — `shouldUseNativeGlass` returns `false` for `.native` on old OSes and `refreshBackend` installs the Metal surface. `example/screens/ScrollDemo.tsx:71` and `FlatListDemo.tsx:174` both rely on this.

`refreshBackend()` (`:153-172`):

```
wantsNative = shouldUseNativeGlass
useNative   = wantsNative || !surface.isOperational   // isOperational == (GlassRenderContext.shared != nil)
isUsingNativeGlass = useNative

useNative && !wantsNative -> installFallbackBlur()   // UIBlurEffect(.systemThinMaterial)
useNative                 -> installNativeGlass()    // UIGlassEffect
else                      -> installMetalGlass()     // CAMetalLayer surface
```
then `updateBackdropExclusion()`, `restoreChildren()`, `reportRenderer()`, `invalidateShape()`.

`GlassRenderContext.shared` is `nil` if any of: no default `MTLDevice`, no command queue, no shader library (`ExpoLiquidGlassShaders.bundle/default.metallib`, or the pod's own default library — `GlassRenderContext.swift:92-102`), no quad buffer, or either pipeline state failing to compile (`:47-90`). That is the **only** route to `"fallback-blur"`.

Triggers of `refreshBackend()`: `init` (`:130`), `backend` didSet (`:28-33`), and `variant` didSet (`:20-26` — because the native effect object must be rebuilt for a new style).

### `onRendererChange` (`:294-305`)

```
guard window != nil                                   // never fires before attach
name = isUsingNativeGlass ? (shouldUseNativeGlass ? "native" : "fallback-blur") : "metal"
guard !didReportRenderer || name != lastReportedRenderer
onRendererChange(["renderer": name])
```
Fires **once on first window attach**, then only on genuine change. Callers: `refreshBackend()` and `didMoveToWindow()` (`:316`). Values are exactly `"native" | "metal" | "fallback-blur"` — matching `GLASS_ACTIVE_RENDERERS` (`src/constants/glass.constants.ts:3`). Not re-fired on remount to a new window if the name is unchanged.

### `supportsNativeGlass` mismatch

`ExpoLiquidGlassModule.swift:9-12` returns `true` for **any** iOS ≥ 26, with no `UIGlassEffect` class check — unlike the view's `isGlassEffectAvailable`. So JS `supportsNativeGlass` can be `true` while the view falls back. The Android port should decide whether `supportsNativeGlass` means "the platform can do the Apple material" (→ always `false`) or "the platform has a hardware-accelerated path" — the TS type is a plain boolean and offers no room for a third state.

### View-hierarchy lifecycle notes

- `setGlassLayerView` always `insertSubview(view, at: 0)` and early-returns if unchanged (`:211-216`).
- `visualEffectView` is created lazily and **cached across native↔fallback switches** (`existingOrNewEffectView`, `:196-203`); `installMetalGlass` destroys it (`:206-207`).
- `restoreChildren()` re-parents `mountedChildren` into the new `contentHost` on every backend switch (`:326-332`).
- Two `UIVisualEffectView` re-application workarounds: on the first post-attach `layoutSubviews`, `effect` is set to a bare `UIVisualEffect()` and then re-assigned (`:353-358`, guarded by `hasAppliedEffectAfterLayout`, reset on window detach at `:311`); the same reset happens on `interactive` change (`:63`). Without these, `UIGlassEffect` renders wrong on a zero-frame or re-used effect view.

---

## 6. Container semantics

`ios/Views/LiquidGlassContainerView.swift` (99 lines). It is a **thin wrapper over `UIGlassContainerEffect`, with no Metal counterpart at all.**

| Aspect | Behaviour |
|---|---|
| Availability | `#available(iOS 26.0, *) && NSClassFromString("UIGlassContainerEffect") != nil`, cached in a static (`:39-44`). Failing that, `effectView` stays `nil` and the container is an inert passthrough `UIView`. |
| Structure | One `UIVisualEffectView(effect: nil)` added as the sole subview at init (`:29-33`), sized to `bounds` on every layout (`:82-83`). |
| Child hosting | `contentHost = effectView?.contentView ?? self` (`:10-12`); `mountChildComponentView` does a plain `insertSubview(at: index)` — **no index clamping**, unlike `LiquidGlassView` (`:59` vs `LiquidGlassView.swift:337`). |
| Merging | Entirely Apple-internal. Child `LiquidGlassView`s that resolve to the **native** backend become sibling `UIVisualEffectView`s inside the container's `contentView`; UIKit blends their glass shapes as they approach. **There is no coordination code between the container and its children** — no protocol, no notification, no shared state. The merge is a pure compositor side effect of nesting `UIGlassEffect` views inside a `UIGlassContainerEffect` view. |
| `spacing` | `effect.spacing = CGFloat(spacing)` only when non-nil (`:52-54`), i.e. `undefined` leaves the system default. Points; the distance at which children begin to merge. Change triggers a full `applyEffect()` rebuild (`:14-19`). |
| Hit testing | `hitTest` returns `nil` when the hit is the container, the effect view, or its content view (`:92-98`) — so the container never intercepts touches, only its real children do. |
| Layout workaround | Same "first layout with a window → reset to bare `UIVisualEffect()`, then re-apply" dance as `LiquidGlassView` (`:85-89`). |
| Metal children | A child forced to `renderer="metal"` inside a container gets **no merging whatsoever**. It is just a `CAMetalLayer` sibling that renders its own independent glass. |
| Non-iOS | JS returns `<View style={style}>{children}</View>` (`LiquidGlassContainer.tsx:14-16`). |

**Consequence for Android:** the container currently has *zero* cross-view logic to port. Any Android merging would be new architecture: the container itself would need to own a single render surface and evaluate all children's SDFs together (a smooth-min / metaball union) — structurally incompatible with today's one-`CAMetalLayer`-per-view design. The zero-cost path is to ship the container as a passthrough `ViewGroup` honouring `style`/`children` and ignoring `spacing`, matching the existing non-iOS behaviour.

---

## 7. `interactive` behaviour

| Renderer | Behaviour |
|---|---|
| **native** | `effect.isInteractive = isInteractive` on the `UIGlassEffect` (`LiquidGlassView.swift:225`). This is the system's built-in press/hover response — Apple's internal deformation, specular tracking and scale on touch. No custom gesture recognisers, no touch handling, no animation code in this repo. |
| **fallback-blur** | No effect. `applyNativeTint()` early-returns because it requires `isUsingNativeGlass && shouldUseNativeGlass` (`:219-223`), and `installFallbackBlur` sets a plain `UIBlurEffect` (`:192`). |
| **metal** | **Completely ignored.** `isInteractive` is not read anywhere in `GlassSurfaceView`, `GlassParams`, or the shader. |

The setter's side effect (`:58-67`): when `shouldUseNativeGlass`, it first assigns a bare `UIVisualEffect()` to force UIKit to tear down the old effect, then calls `applyNativeTint()` to rebuild a fresh `UIGlassEffect` with the new `isInteractive` and the current `variant`/`tint`. It is guarded by `isInteractive != oldValue`.

`interactive` does **not** change hit testing, `isUserInteractionEnabled` (both `contentContainer` and `visualEffectView` are unconditionally `true`, `:105` and `:200`), or any layout. README documents it as "iOS 26+ only; ignored by the Metal renderer" (`README.md:66`). **On Android the honest parity answer is a no-op**, or a hand-written press animation that will not match Apple's.

---

## 8. Backdrop exclusion & the two capture strategies

### 8.1 The exclusion mechanism

`ios/Glass/NonRenderableView.swift` (49 lines) — two pieces:

```swift
final class NonRenderableLayer: CALayer {
    static var isCapturingBackdrop = false          // global flag, set only during rasterise
    var isExcludedFromBackdrop = true               // per-instance, defaults to excluded
    var backdropFillColor: CGColor?
    var backdropFillPath: CGPath?

    override func render(in ctx: CGContext) {
        guard !(Self.isCapturingBackdrop && isExcludedFromBackdrop) else { return }   // :13
        if Self.isCapturingBackdrop, let backdropFillColor, let backdropFillPath {    // :15-21
            ctx.saveGState(); ctx.setFillColor(backdropFillColor)
            ctx.addPath(backdropFillPath); ctx.fillPath(); ctx.restoreGState()
        }
        super.render(in: ctx)
    }
}
```

Wiring:
- `LiquidGlassView.layerClass = NonRenderableLayer.self` (`LiquidGlassView.swift:6`) — the whole view, including its children and border layer, disappears from a capture when excluded, because the early `return` skips `super.render` and therefore the entire sublayer subtree.
- `contentContainer` is a `NonRenderableView` (`:12`), also carrying a `NonRenderableLayer`.
- `updateBackdropExclusion()` (`:174-178`): `excluded = !isUsingNativeGlass`. **Metal views exclude themselves; native and fallback-blur views do not.** A Metal glass therefore correctly refracts a native glass beneath it, while never refracting its own output (which would smear/feed back).
- `updateBackdropFill()` (`:387-396`): only when `isUsingNativeGlass && tint.alpha > 0`, sets `backdropFillColor`/`backdropFillPath` to the tint and the clamped rounded-rect path. Since `UIVisualEffectView` renders as *nothing* through `CALayer.render(in:)` (the blur lives in the render server), this fill is a stand-in so a Metal view moving over a tinted native view still picks up the colour. Cleared to `nil` otherwise.
- `NonRenderableView.hitTest` returns `nil` when the hit is the container itself (`:45-48`), so an empty content container never swallows touches.

`isCapturingBackdrop` is a plain static toggled around exactly one call: `BackdropCapturer.swift:306-308`.

### 8.2 Strategy 1 — `.layerRender` (default, `BackdropCapturer.swift:98`)

```
NonRenderableLayer.isCapturingBackdrop = true
window.layer.render(in: context)      // one synchronous CALayer traversal of the whole window
NonRenderableLayer.isCapturingBackdrop = false
drawHostedContent(window:region:context:)
```

`drawHostedContent` (`:433-483`) is the SwiftUI patch: `CALayer.render(in:)` returns blank for content composited by the render server, so the tree is walked for views whose class name contains `"HostingView"` (cached per class in `hostingClasses`, `:473-483`) and each is redrawn with `drawHierarchy(in:afterScreenUpdates: false)` **on top of** the window pass. Views already excluded via `NonRenderableLayer` are skipped during collection (`:456-459`), as are hidden/`alpha ≤ 0.01` views and any not intersecting the region. This is what makes `@expo/ui`'s `<Host>` visible in the backdrop (`README.md:133`).

### 8.3 Strategy 2 — `.compositedDraw`

Switch condition (`:327-341`): after each `.layerRender` capture, `isEmpty(slot,…)` (`:351-367`) samples an 8×8 grid of the captured pixels; if all equal the first pixel **and** that pixel is fully transparent or pure black, it counts as empty. **3 consecutive empty captures** (`emptyCapturesBeforeSwitch`) flip `strategy` to `.compositedDraw` permanently (an `NSLog` explains it as an iOS 26+ regression where `CALayer.render(in:)` yields nothing). Any non-empty capture resets the counter. `releaseResources()` does **not** reset `strategy` — the switch is sticky for the process.

`drawComposited` (`:369-431`): a manual recursive compositor.
1. `collectExcludedViews(in: window)` (`:383-391`) — depth-first, collecting every subview whose layer is a `NonRenderableLayer` with `isExcludedFromBackdrop == true`; **does not descend into an excluded subtree**.
2. `drawSubviews(of:window:region:context:)` (`:397-431`) per subview:
   - Skip hidden or `alpha ≤ 0.01`; skip anything in `excludedViews`.
   - `frame = subview.convert(bounds, to: window)`; `leadsToGlass = excludedViews.contains { $0.isDescendant(of: subview) }` (`:393-395`).
   - Cull: `clipsToBounds && !frame.intersects(region) && !leadsToGlass` → skip.
   - Apply `setAlpha(subview.alpha)` when < 1.
   - If **not** on a path to a glass view → `subview.drawHierarchy(in: frame, afterScreenUpdates: false)` and stop descending (a fast whole-subtree blit).
   - If it **does** contain a glass view → clip if `clipsToBounds`, fill its `backgroundColor` manually, then recurse. This is the only way to draw an ancestor of a glass view without also drawing the glass.

### 8.4 Summary table

| | `.layerRender` | `.compositedDraw` |
|---|---|---|
| Selection | default | after 3 consecutive blank captures; sticky |
| Traversal | one `window.layer.render(in:)` + a second `drawHierarchy` pass for `*HostingView*` | full manual recursion with `drawHierarchy` per non-glass subtree |
| Exclusion | `NonRenderableLayer.render(in:)` early-return, driven by a global static | `excludedViews` set + `leadsToExcludedView` recursion decision |
| Native-tint fill | via `backdropFillColor`/`Path` in `render(in:)` | **not applied** — no equivalent hook in this path |
| Cost | ~1 traversal | much higher; per-view `drawHierarchy` calls |

---

## 9. What will be hard or impossible to reproduce on Android

Ordered by risk. Each tied to specific code.

**1. There is no Android primitive for "sample what is behind this view".**
`UIGlassEffect` / `UIVisualEffectView` gets backdrop sampling from the compositor for free — that is the entire reason the native path in `LiquidGlassView.swift:180-186` is ~7 lines. Android has `View.setRenderEffect` (API 31+), which applies to a view's **own** content, and `SurfaceControl.Transaction.setBackgroundBlurRadius` / `Window.setBackgroundBlurRadius` (API 31+), which apply to whole **windows** and are gated on `WindowManager.isCrossWindowBlurEnabled()` (off on many OEM builds and in battery saver). None of these gives an in-app view access to the pixels of its siblings. Consequence: **Android has no "native" backend at all.** `onRendererChange` will only ever emit `"metal"`-equivalent or `"fallback-blur"`, and everything in §2's "native-only" row (`interactive`, container `spacing`) is dead. Every drop of parity has to come from the capture-and-refract route, which on iOS is the *fallback*.

**2. Zero-copy CPU rasterisation into GPU memory (`BackdropCapturer.swift:560-592`).**
The iOS design has Core Graphics draw *directly into an `MTLBuffer`* aliased as a texture, so there is literally no upload step (`uploadSource == nil` → `replace(region:)` skipped, `:318-325`), and it double-buffers two such slots so the CPU never writes memory the GPU is reading (`:271-275`). Android's analogue is `HardwareBuffer` (API 26+) + `HardwareRenderer`/`HardwareBufferRenderer` (API 29/34+) + `Bitmap.wrapHardwareBuffer` + an `EGLImageKHR` / `AHardwareBuffer` Vulkan import. That is significantly more machinery, has real API-level floors, and OEM driver variance. The naive `Canvas`→`Bitmap`→`glTexSubImage2D` route adds a full-frame CPU→GPU copy every capture, which will blow the `dutyCycle: 0.30` budget (`:26`) the whole adaptive-stride system is calibrated against, pushing `strideFrames` straight to its `maxStride: 3` cap.

**3. `SurfaceView` vs `TextureView` — `CAMetalLayer` has no clean Android twin.**
`GlassSurfaceView` is an ordinary `UIView` whose `layerClass` is `CAMetalLayer` (`GlassSurfaceView.swift:7`), inserted at index 0 of a normal view (`LiquidGlassView.swift:214`) with content and a `CAGradientLayer` border stacked above it. On Android:
- `SurfaceView` is a separate compositor layer with hard z-order constraints (`setZOrderOnTop` puts it above *everything* including the content you want on top of the glass; `setZOrderMediaOverlay` is coarse). It cannot be freely interleaved as sibling #0 with content above it — which is exactly what `example/screens/FlatListDemo.tsx:112-142` needs (glass row with children on top, inside a scrolling list).
- `TextureView` interleaves correctly but costs an extra copy and typically an extra frame of latency, and it is drawn by the parent's draw pass — meaning it will appear in a `View.draw()`-based capture and needs its own exclusion hook.
There is no option that is simultaneously cheap, correctly z-ordered, and self-excluding. This is the single biggest architectural fork in the port.

**4. `CALayer.render(in:)` over the whole window has no exact Android equivalent, and both substitutes are lossy.**
- `decorView.draw(canvas)` into a software `Canvas`: synchronous and reasonably fast, but it **misses `SurfaceView`/`TextureView`/video/`WebView`/`MapView` content** (composited out of process) and forces hardware-layer'd views down a software path, changing shadows, elevation, `RenderEffect`s and some text rendering. This is the direct analogue of the SwiftUI-blank problem that `drawHostedContent` (`:433-448`) patches — but Android has **no `drawHierarchy(in:afterScreenUpdates:)`**, so the patch is not portable. There is nothing to call.
- `PixelCopy.request(Window, …)` captures everything correctly including surfaces, but is **asynchronous with ≥1 frame of latency** and far more expensive. It cannot be dropped into `tick()` where `rasterise` is called synchronously and its duration is measured to feed `updateStride` (`BackdropCapturer.swift:188-199`).
Practically: the `.layerRender` vs `.compositedDraw` two-strategy design maps to `draw()` vs `PixelCopy`, but the switch heuristic (`isEmpty`, `:351-367`) would need replacing, and the async path breaks the frame-timing contract.

**5. The `beforeWaiting` runloop-observer ordering (`GlassFrameScheduler.swift:69-81`).**
The design depends on: capture at vsync (`tick`), then encode *after* UIKit layout has committed, so `convert(bounds, to: window)` in `backdropUVRect` (`:224-240`) reads final geometry — otherwise the UV rect lags the view by a frame and the glass visibly slides against its backdrop. Android's `Choreographer.postFrameCallback` gives the vsync half; the "after layout, before the frame sleeps" half has no public callback. `ViewTreeObserver.OnPreDrawListener` fires before draw but its ordering relative to a background GL thread's encode is not guaranteed, and `Choreographer.CALLBACK_COMMIT` is `@hide`. Expect a persistent one-frame offset between glass and backdrop during scroll/drag unless this is solved deliberately.

**6. `UIGlassContainerEffect` merging is unportable as designed.**
§6: today the merge is *entirely* a compositor side effect of nesting effect views — there is no coordination code to port (`LiquidGlassContainerView.swift` has no reference to `LiquidGlassView`). Reproducing it means inverting the architecture so the container owns one surface and smooth-mins all children's SDFs. That is a rewrite, not a port. Recommendation: ship the container as a passthrough `ViewGroup` (matching `LiquidGlassContainer.tsx:14-16`) and document `spacing` as iOS-only.

**7. Derivative functions in the shader.**
`shapeAlpha` depends on `fwidth(g.sd)` (`LiquidGlass.metal:189`). GLSL ES 3.0 has `fwidth`; **AGSL / `RuntimeShader` (API 33+) does not expose derivatives**, so a `RuntimeShader`-based implementation must replace it with an analytic value. Fortunately `sd` is in points and the drawable is `viewSize * renderScale` px, so `fwidth(sd) ≈ 1/renderScale` points away from corners — a workable substitute, but it will differ subtly at corners where the SDF gradient is not unit-length in screen space. Similarly, the dispersion loop's data-dependent `break` (`:216`) is fine on ES 3.0 but not on ES 2.0.

**8. Frost colour is `UIColor.systemBackground` resolved against the trait collection (`LiquidGlassView.swift:281-285`).**
Light = `#FFFFFF`, dark = `#000000` (pure black). Android's nearest is `?android:attr/colorBackground` / `?attr/colorSurface`, whose Material dark default is `#121212`, not black. For visual parity with `frost: 0.36` the Android side should **hardcode white/black** rather than resolve a theme attribute, and hook `onConfigurationChanged(UI_MODE_NIGHT_*)` where iOS uses `traitCollectionDidChange` (`:287-292`).

**9. `cornerStyle: "continuous"` (Apple squircle).**
Android has no continuous corner curve. Mitigating factor discovered while reading: the Metal path is **already** circular-only — the SDF uses circular corners (`LiquidGlass.metal:62-69`), the non-uniform path uses `addArc` (`LiquidGlassView.swift:462-480`), and the border path is always circular. `cornerStyle` only ever reaches `CALayerCornerCurve` for **content clipping in the uniform branch** (`:399, 414`). So Android achieves full parity with the *Metal* renderer by ignoring `cornerStyle` entirely; it only diverges from the iOS 26 *native* renderer, which Android cannot match anyway.

**10. Premultiplied output + surface blending.**
The fragment returns `float4(color * alpha, alpha)` (`LiquidGlass.metal:255`) into a `CAMetalLayer` with `isOpaque = false`, where premultiplied is the Core Animation convention. On Android the surface must be `PixelFormat.TRANSLUCENT` with `glBlendFunc(GL_ONE, GL_ONE_MINUS_SRC_ALPHA)`, and `SurfaceView.setZOrderMediaOverlay`/holder format has to be set consistently or you get either double-darkening or a black box. Easy to get wrong, easy to verify.

**11. `renderScale` semantics.**
`window.screen.nativeScale` (`GlassSurfaceView.swift:111`) is the *physical* scale, which on some devices differs from `UIScreen.scale` (downsampled Plus-class devices). Android's `DisplayMetrics.density` is the point→px factor and is the right analogue, but on devices with a render-resolution setting `density` and the actual buffer scale can diverge. Not a blocker, but the `4_500_000` pixel ceiling (`BackdropCapturer.swift:22`) and `¼`-step scale quantisation (`:255`) are tuned to iOS pixel counts and will want re-tuning.

**12. The "moving" capture behaviour is subtle and easy to miss.**
`BackdropCapturer.swift:176-186`: while a glass view is moving (within `0.4 s` of the last region change), cadence capture is **disabled** and the region is inflated by `220 pt`, re-rasterising only when the view escapes that margin. The visible result on iOS is that a dragged glass view refracts a *slightly stale* backdrop, which reads as natural. An Android implementation that naively re-captures every frame during a drag will be much slower **and look different**. Replicate the heuristic, not just the shader.

**13. Not a portability issue but must be fixed for the port to work at all:** `src/components/LiquidGlassView/LiquidGlassView.tsx` has no `Platform.OS` guard (unlike the container at `LiquidGlassContainer.tsx:14`), and `src/views/NativeLiquidGlassView.ts:7` calls `requireNativeViewOnce` at module scope. `expo-module.config.json` lists `"platforms": ["apple"]` only. All three need changing, plus a decision on what `supportsNativeGlass` (`src/utils/platform.utils.ts:5-6`, currently hard-gated on `Platform.OS === "ios"`) should return on Android.
