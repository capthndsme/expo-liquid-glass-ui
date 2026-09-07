# Shader Porting Analysis — `LiquidGlass.metal` → AGSL

Target: `android.graphics.RuntimeShader` (API 33+) driven by `android.graphics.RenderEffect` (API 31+, `createRuntimeShaderEffect` API 33+).

Source of truth: `/home/captainhandsome/projects/expo-liquid-glass-view/ios/Shaders/LiquidGlass.metal` (256 lines), read in full together with `ios/Glass/GlassRenderer.swift`, `ios/Glass/GlassSurfaceView.swift`, `ios/Glass/GlassRenderContext.swift`, `ios/Views/LiquidGlassView.swift`, `ios/Glass/BackdropCapturer.swift`, `ios/Records/GlassMetalOptions.swift`, `ios/Records/GlassRefractionCurve.swift`, `ios/Records/GlassCornerRadii.swift`, `ios/Enums/GlassVariant.swift`.

Reference read for idiom (not copied verbatim): `/home/captainhandsome/projects/AndroidLiquidGlass/backdrop/src/commonMain/kotlin/com/kyant/backdrop/internal/Shaders.kt`, `.../effects/Lens.kt`, `.../effects/Blur.kt` — Apache-2.0, © 2025 Kyant. Attribution requirements are enumerated in §4.4.

---

## 0. Ground truth established by reading the code

Facts that the rest of the document depends on. Every one is verified against the source, not assumed.

| # | Fact | Evidence |
|---|---|---|
| G1 | **The glass pass binds exactly ONE texture.** `glassFragment` declares a single `texture2d<float> source [[texture(0)]]`. There is no second sampler anywhere in the file. | `LiquidGlass.metal:180-182` |
| G2 | **That one texture is *either* the blurred pong *or* the sharp backdrop — never both.** `var source = request.backdrop` → if `needsBlur`, H-blur into `ping`, V-blur into `pong`, `source = pong` → glass pass encoded with `source:`. | `GlassRenderer.swift:94`, `:97-131`, `:145-153` |
| G3 | **Blur is OFF by default for both variants.** `MetalDefaults.blur = 0` for `.regular` and `.clear`; `needsBlur = blurRadius > 0.01`. So the default Android chain is a *single* runtime-shader stage. | `GlassVariant.swift:37`, `:52`; `LiquidGlassView.swift:247`; `GlassSurfaceView.swift:166` |
| G4 | **`viewSize == shapeSize` always.** Both fields of `GlassParams` are assigned the same `viewSize` value. They collapse into one AGSL `size` uniform. | `GlassSurfaceView.swift:157`, `:182-183` |
| G5 | **`pixels` is in POINTS, not device pixels.** `pixels = in.uv * params.viewSize` where `viewSize = bounds.size` (points). `in.position.xy` (used only by the noise term) is in *drawable* device pixels. | `LiquidGlass.metal:184`, `:239`; `GlassSurfaceView.swift:157` |
| G6 | **`sourceRect` has two different meanings** depending on `needsBlur`: with blur it is the view's sub-rect inside the *padded blur* texture; without blur it is the view's rect in the *whole window capture* UV space. | `GlassSurfaceView.swift:168-175` |
| G7 | **Padding formula** = `ceil(max(refractionAmount + dispersionAmount, blur > 0.01 ? max(blur * 1.5, 16) : 0) + 2)`, in points. | `GlassSurfaceView.swift:133-137` |
| G8 | **Corner-radii packing is `(BL, BR, TR, TL)`** and `radiusAt` is called with the *centered* coordinate (y-down). | `GlassCornerRadii.swift:39-44`; `LiquidGlass.metal:55-60`, `:63` |
| G9 | **Backdrop is premultiplied.** `CGImageAlphaInfo.premultipliedFirst`; the shader reads `.rgb` of premultiplied data, and the output is premultiplied (`float4(color * alpha, alpha)`). This matches AGSL/Skia exactly. | `BackdropCapturer.swift:557`; `LiquidGlass.metal:177`, `:255` |
| G10 | **`GlassParams` is 36 floats / 144 bytes** including `_pad0`. | `LiquidGlass.metal:18-45`; `GlassRenderContext.swift:11-32` |
| G11 | Blur weight `exp2(x * 1.4426950)` **is** `exp(x)` — `1.4426950 = log2(e)`. So the kernel is a true Gaussian `exp(-o^2 / 2 sigma^2)` with **sigma = radius * 0.5**. | `LiquidGlass.metal:107-108`, `:117` |
| G12 | `dispersionHeight` defaults to `defaults.height` — i.e. the **refraction** height (20 regular / 10 clear), not a dispersion-specific default. Preserve this quirk for parity. | `LiquidGlassView.swift:259`; `GlassVariant.swift:38`, `:53` |

**Consequence of G1 + G2: §3's "sample both sharp and blurred" problem does not exist.** A single `uniform shader content;` is sufficient and correct. This removes the hardest structural obstacle to the port.

---

## 1. Semantic diff: Metal vs AGSL

Status legend: **OK** = direct equivalent · **RW** = needs rewrite · **X** = impossible, must be replaced by a different mechanism.

| Metal feature | Where (file:line) | AGSL status | Port |
|---|---|---|---|
| `constexpr sampler(mag_filter::linear, min_filter::linear, address::clamp_to_edge)` | `LiquidGlass.metal:91-93` | **X** | No sampler objects exist in AGSL. `content.eval()` filtering is chosen by Skia (linear for a `RenderEffect` chain input; **nearest** for a `BitmapShader` unless you call `BitmapShader.setFilterMode(FILTER_MODE_LINEAR)`, API 31+). Address mode is **not** clamp — see §2.7. Must be emulated with an explicit `clamp(coord, sampleBounds.xy, sampleBounds.zw)`. |
| `texture2d<float>.sample(sampler, uv)` | `:104`, `:112`, `:120-121`, `:177` | **RW** | `content.eval(float2 deviceCoord)`. Returns `half4`, **premultiplied**. The argument is device pixels, not normalized UV. |
| Normalized UVs + `uvRect`/`sourceRect` remap | `:101`, `:174-177` | **RW** | Deleted entirely. Replaced by an `offset`/`size` pair (Kyant idiom, `Lens.kt:45-46`) plus a `sampleBounds` clamp rect. Full derivation in §2. |
| Vertex stage `liquid_glass_vertex`, `VertexOut`, `[[stage_in]]`, full-screen quad buffer | `:4-7`, `:47-53`; `GlassRenderContext.swift:53-58`, `:130` | **X** | AGSL has no vertex stage and no interpolators. `main(float2 coord)` *is* the rasteriser output. `in.uv` is reconstructed from `coord` in node space; `in.position.xy` becomes `coord` too (they differ only by the point↔pixel factor, see G5 and §6-P7). |
| `constant GlassParams &params [[buffer(1)]]` (struct-typed uniform buffer) | `:182`; `GlassRenderContext.swift:132` | **RW** | No uniform blocks, no uniform structs, no `std140` layout. Each field becomes an individual top-level `uniform`. 21 declarations instead of one `setFragmentBytes`. Cost: 21 JNI `setFloatUniform` calls per frame (mitigation in §5.1). |
| User `struct GlassGeometry` returned from a helper function | `:128-139`, `:141-163` | **OK, but avoid** | SkSL supports user structs, but Android 13.0 Skia builds are the shakiest on struct-typed function returns inside runtime effects. The draft inlines the geometry into `main` (it is constructed exactly once, `:187`) — zero behavioural change, one less compatibility risk. |
| Non-const global variables | n/a (Metal uses `constant int kBlurTaps` / `kDispersionTaps`) | **RW** | SkSL **forbids mutable globals** in runtime effects. `constant int` → `const int` (fine). Anything else must be a local or a uniform. |
| `float4`, `float3`, `float2`, `float` | throughout | **OK** | Identical spellings. `vec4`/`vec2` aliases also parse, but prefer `floatN` (Android docs style). |
| `half4` | not used in Metal (`float4` everywhere) | **Constrained** | Required only as the return type of `main` (`half4 main(float2)`), and it is the return type of `content.eval()`. **Everywhere else `half` is banned** in this port — see the parallel-track constraint recorded in §6-P5. Widen `eval()` results to `float` immediately; construct the `half4` return explicitly at the very last statement. |
| `mix`, `step`, `smoothstep`, `sign`, `normalize`, `fract`, `clamp`, `min`, `max`, `abs`, `length`, `dot`, `sqrt`, `pow`, `sin`, `cos` | `:76-80`, `:84`, `:88`, `:190`, `:234-236`, `:244-250` | **OK** | All present in AGSL with GLSL ES 1.00 semantics. The `mix(vecN, vecN, float)` and `max(vecN, float)` overloads both exist. |
| `exp2` | `:117` | **OK** | Present. In the AGSL blur draft it is written as plain `exp()` because `exp2(x * log2(e)) === exp(x)` (G11) and `exp` is equally cheap. |
| `atan2(y, x)` | `:244` | **RW (rename)** | AGSL spells it `atan(y, x)` (two-arg overload). **Better:** the whole `sin(atan2(y, x) - phi)` collapses to `n.y * cos(phi) - n.x * sin(phi)` with `n = normalize(v)` — algebraically exact including the `v == 0` degenerate case, and it removes the single most expensive transcendental in the shader. The draft does this. |
| `fwidth(g.sd)` | `:189` | **X — hard blocker** | **AGSL has no derivative functions** (`dFdx` / `dFdy` / `fwidth`). Runtime effects may be evaluated outside the fragment pipeline, so Skia rejects them. Replacement: because `sd` is an exact Euclidean SDF, `|grad(sd)| = 1`, so `fwidth(sd) ≈ 1` *in the units of the coordinate space*. Working in device pixels gives `aa = 1.0`, which reproduces iOS exactly: iOS `fwidth(sd_points) = 1 / contentsScale` points = 1 device pixel, so the feather is `2 * aa` = 2 device pixels in both. **No visual difference.** |
| `for (int i = 0; i < kBlurTaps; ++i)` with a `constant int` bound | `:115`, `:214` | **OK with constraints** | AGSL follows GLSL ES 1.00 Appendix A: the loop must be **statically unrollable** — `int` counter, constant initialiser, comparison against a **compile-time constant**, and a simple `++` / `+= const` step. `const int kDispersionTaps = 8;` satisfies this. A *uniform* bound does **not** — so the tap count must be baked into the shader **string** (Kotlin string interpolation, exactly the `$RoundedRectSDF` idiom at `Shaders.kt:61`, `:98`), with one cached `RuntimeShader` per tap count. |
| `break` inside the loop (`if (u > 1.0) break;`) | `:216` | **RW** | Formally legal in ES2, but Skia's unroll analyser is version-sensitive about it and a `break` also defeats the unroll. Rewrite as `if (u <= 1.0) { ...taps... }` — a real dynamic branch that GPUs *do* skip when the whole wave agrees, with identical results (the accumulator and weight are untouched when the condition fails). |
| Early `return` inside `main` | `:192`, `:104` | **OK** | Supported; Kyant relies on it (`Shaders.kt:73-75`). `return float4(0.0)` → `return half4(0.0)`. |
| Two fragment entry points in one file (`blurFragment` + `glassFragment`), selected by pipeline state | `:98`, `:180`; `GlassRenderContext.swift:65-77` | **RW** | One `RuntimeShader` == one source string == one `main`. Two separate shader strings, or drop the blur one entirely (§3). |
| Multiple texture inputs / a second sampled texture | not used (G1) | **OK-ish, unnecessary** | AGSL *does* allow several `uniform shader` children. With `RenderEffect.createRuntimeShaderEffect(shader, "content")` only the named one is bound to the chain output; any other must be pre-bound with `RuntimeShader.setInputShader(name, someShader)` where `someShader` is a real `Shader` (`BitmapShader`, `LinearGradient`, another `RuntimeShader`). **Caveat:** the manually-bound child's coordinate space is its own local space, *not* the filter's node space, so you must set a `Shader` local matrix to align it — a classic source of half-pixel / offset bugs on API 33-34. **Not needed here (G1).** |
| `discard` | not used | — | Not available in AGSL either. Not needed. |
| Bit operations, `while` / `do`, recursion, dynamic array indexing, matrices | not used | **X** | The ES2 profile forbids all of them. Nothing in this shader needs them. |
| Premultiplied output `float4(color * alpha, alpha)` | `:255` | **OK** | Skia expects premultiplied output from `main`. Direct match, no change. |
| Colour space (`bgra8Unorm`, i.e. maths in gamma/sRGB space) | `GlassRenderContext.swift:70` | **OK, with a trap** | AGSL runs in the destination working space, which is non-linear sRGB for a normal window — the same as Metal here. **Do not use `layout(color) uniform half4`** for tint/frost: that triggers Skia's colour conversion into the working space and will diverge on wide-gamut / HDR windows. Use plain `uniform float4` + `setFloatUniform`, with components extracted exactly as `UIColor.getRed(...)` does (`LiquidGlassView.swift:488-498`). |
| `inline` qualifier | `:55`, `:62`, `:71`, `:83`, `:87`, `:141`, `:165`, `:171` | **RW (drop)** | Not a keyword in AGSL. Plain functions; SkSL inlines aggressively anyway. Functions must be **defined before use** (no forward declarations). |

---

## 2. Coordinate-space mapping

This is where the port breaks if it is done loosely. Follow this section literally.

### 2.1 The three iOS spaces

1. **`in.uv` ∈ [0,1]²** — quad-interpolated, **top-left origin, y-down**. Verify from the quad at `GlassRenderContext.swift:53-58`: vertex `(-1,-1,0,1)` maps clip-bottom to `uv.y = 1`, and `(-1,1,0,0)` maps clip-top to `uv.y = 0`.
2. **`pixels = in.uv * viewSize`** (`LiquidGlass.metal:184`) — **view-local POINTS**, top-left origin. `centered = pixels - viewSize * 0.5` (`:185`).
3. **Backdrop texture UV** — `uv = pixels / viewSize; texUV = sourceRect.xy + uv * sourceRect.zw` (`:174-175`), then `clamp(texUV, 0, 1)` (`:177`).

Android's `main(float2 coord)` gives you **one** space: device pixels, origin at the top-left of the RenderNode the effect is attached to. `content.eval(c)` samples the chain input **in that same space**, 1:1, with no scaling.

### 2.2 The chosen Android layout

Draw the captured backdrop into a **padded RenderNode**:

```
padded node size   = (W + 2P, H + 2P)          px
padded node origin = (viewX - P, viewY - P)    in window space
```

where `W`, `H` are the glass view's size **in device pixels** and `P` is the padding in device pixels (formula in §2.5).

Then:

```
nodeCoord  = main()'s `coord`               ∈ [0, W+2P] × [0, H+2P]
viewPixels = coord + offset                 with offset = (-P, -P)   →  ∈ [-P, W+P] × [-P, H+P]
centered   = viewPixels - size * 0.5        with size   = (W, H)
```

This is exactly Kyant's `centeredCoord = (coord + offset) - halfSize` with `offset = (-padding, -padding)` (`Shaders.kt:69`; `Lens.kt:45-46`). Borrowed idiom — attribute (§4.4).

**Everything downstream then works in device pixels.** All length-valued uniforms must therefore be pushed in device pixels (`dp * density`), not dp:

| Metal field | iOS unit | Android unit |
|---|---|---|
| `cornerRadii` | points | **px** (`radiusDp * density`, clamped to `min(W,H)/2` — mirror `GlassCornerRadii.swift:27-35`) |
| `viewSize` / `shapeSize` → `size` | points | **px** |
| `refractionScale` | points | **px** |
| `refractionAmount` | points | **px** |
| `dispersionHeight` | points | **px** |
| `dispersionAmount` | points | **px** |
| `highlightAngle` | radians | radians (unchanged) |
| everything else | unitless | unitless |

### 2.3 Per-call-site conversion table

| Metal expression | file:line | AGSL replacement |
|---|---|---|
| `float2 base = params.uvRect.xy + in.uv * params.uvRect.zw;` (blur) | `:101` | Deleted. The blur stage's input *is* the padded node, so `base = coord`. |
| `source.sample(linearSampler, base)` (blur centre tap) | `:104`, `:112` | `content.eval(coord)` |
| `float2 delta = params.texelStep * offset;` then `sample(base ± delta)` | `:118-121` | `texelStep` becomes a **pixel** step, `(1,0)` for H and `(0,1)` for V (not `1/texWidth`). `content.eval(coord ± texelStep * offset)` |
| `float2 pixels = in.uv * params.viewSize;` | `:184` | `float2 pixels = coord + offset;` |
| `float2 centered = pixels - params.viewSize * 0.5;` | `:185` | `float2 centered = pixels - size * 0.5;` |
| `sampleBackdrop(source, pixels, params)` (deep-interior path) | `:199` | `content.eval(clamp(pixels - offset, sampleBounds.xy, sampleBounds.zw))` |
| `sampleBackdrop(source, refractedPixels(...), params)` | `:205`, `:207`, `:218` | Same helper; the argument is the refracted **view-pixel** coordinate. |
| `float2 uv = pixels / params.viewSize;`<br>`float2 texUV = sourceRect.xy + uv * sourceRect.zw;`<br>`sample(..., clamp(texUV, 0, 1))` | `:174-177` | **Collapses to one line:**<br>`content.eval(clamp(viewPixels - offset, sampleBounds.xy, sampleBounds.zw))`<br>The entire `sourceRect` indirection disappears because on Android the node *is* the region. |
| `hashNoise(in.position.xy * 1e-3)` | `:239` | `hashNoise(pixels * 1e-3)` — see §6-P7 for why `pixels` and not `coord`. |
| `fwidth(g.sd)` | `:189` | `1.0` (constant, §1) |

### 2.4 New uniforms the Kotlin side must supply

| Uniform | Type | Value |
|---|---|---|
| `size` | `float2` | `(viewWidthPx, viewHeightPx)` — replaces both `viewSize` and `shapeSize` (G4) |
| `offset` | `float2` | `(-P, -P)` in px |
| `sampleBounds` | `float4` | `(0.5, 0.5, W + 2P - 0.5, H + 2P - 0.5)` — node-space clamp rect, **half-pixel inset** |
| `unitScale` | `float` | `resources.displayMetrics.density` — px per iOS point. Needed **only** where the Metal source hard-codes a point-valued constant (§2.6). |
| `dispersionTapSpacing` | `float` | px between dispersion taps; `= unitScale` for pixel-exact iOS parity, `= 1.0` for the "high" tier. **Invariant: must be ≤ `unitScale`** (see §6-P8). |

`sourceRect`, `uvRect`, `texelStep`, `viewSize` (as distinct from `shapeSize`), and `_pad0` are all **deleted**.

### 2.5 Padding

iOS uses `max(refraction + dispersion, blurExtent)` (`GlassSurfaceView.swift:133-137`). **On Android you must use `+`, not `max`.**

Reason: on iOS the blur pass reads from the *full window capture* texture (which itself extends up to 220 pt beyond the region — `BackdropCapturer.swift:44`) and only *writes* the padded rect, so blur contamination never reaches the padded rect's interior. On Android the blur's input is the padded node itself, so `TileMode.CLAMP` smears the outer `~1.5 * blurRadius` ring of that node; if the glass shader's refracted reads land in that ring you get a visible smear.

```
P_px = ceil( refractionAmountPx + dispersionAmountPx
           + (blurRadiusPx > 0.01 ? max(1.5 * blurRadiusPx, 16 * density) : 0)
           + 2 * density )
```

Worst case at defaults (`.regular`, density 3): `60*3 + 6*3 + 0 + 6 = 204 px`.

### 2.6 The two hard-coded *point*-valued constants

These are the only places where working in px instead of points changes the picture, because iOS's `pixels` is in points (G5):

| Metal | file:line | iOS effective size @3× | AGSL |
|---|---|---|---|
| `smoothstep(0.0, 1.5, abs(g.sd))` (contour highlight) | `:249` | 4.5 device px | `smoothstep(0.0, 1.5 * unitScale, abs(sd))` |
| `if (spread < 2.0)` (dispersion cutoff) | `:204` | 6 device px | `if (spread < 2.0 * unitScale)` |
| `maxI = min(spread, 16.0)` → one tap per **point** | `:212`, `:215` | 3 device px per tap | `maxI = min(spread / dispersionTapSpacing, float(kTaps))` |

Ignoring these gives an Android contour highlight ~3× thinner than iOS's and a dispersion cutoff that fires ~3× later — both immediately visible side by side.

### 2.7 Edge / clamp behaviour and its visual consequence

| | iOS | Android |
|---|---|---|
| Out-of-range sample | `address::clamp_to_edge` on the **whole window-capture texture** (`:91-93`), plus a belt-and-braces `clamp(texUV, 0, 1)` (`:177`) | `content.eval()` outside the input's bounds returns **transparent black (decal)**, *not* the edge pixel |
| Effective clamp boundary | outer edge of the window capture, which includes a 220 pt movement margin | outer edge of the padded node |

**Consequence if you omit the clamp:** at the view's edges and corners, refraction displaces samples up to `refractionAmount + dispersionAmount / 2` px outward. Any of those that leave the padded node return `(0,0,0,0)`. After the premultiplied `.rgb` read that is *black*, so you get a **black rim and black corner blobs** hugging the SDF boundary — the single most common AGSL glass bug, and precisely why Kyant's library carries an explicit `padding` budget through the whole effect chain (`Lens.kt:25-27`, `Blur.kt:16-20`).

**Consequence with the clamp:** identical to iOS *inside* the view, because the clamp only ever fires when `P` was under-budgeted. If `P` is too small you get a smear of the padded edge rather than black — a much more forgiving failure mode.

**Half-pixel inset:** `sampleBounds` is inset by 0.5 px so that Skia's bilinear filter, which reads a 2×2 texel neighbourhood, never blends the outermost real texel with the transparent black outside it. Without the inset you get a 1-px dark hairline at the padded boundary that the clamp is *supposed* to hide.

**View-boundary clipping:** the SDF feather spans `sd ∈ [-1, +1]` px, so the outer half of the antialiasing band lies *outside* the view rect. If you clip the padded node's draw to the view rect exactly, that half is chopped and the edge hardens by ~1 px. Clip to the view rect **inflated by 2 px**.

---

## 3. Pass restructure

### 3.1 What iOS actually does

```
[window capture texture]   (BackdropCapturer, premultiplied BGRA8, whole-window)
        │
        ├─ if needsBlur (blurRadius > 0.01):
        │     blurFragment  H: uvRect = paddedUVRect, texelStep = (1/backdrop.width, 0) → ping
        │     blurFragment  V: uvRect = (0,0,1,1),    texelStep = (0, 1/ping.height)    → pong
        │     source = pong                                    GlassRenderer.swift:101-131
        │
        └─ glassFragment(source, GlassParams) → CAMetalLayer drawable
                                                               GlassRenderer.swift:145-153
```

`ping` / `pong` are `paddedSize * captureScale` px (`GlassSurfaceView.swift:202-207`). The glass pass's `sourceRect` then picks the view sub-rect out of that padded texture (`GlassSurfaceView.swift:168-175`).

### 3.2 Options for "sample both sharp and blurred backdrop"

Recorded for completeness, because the question was asked — but see the verdict in §3.3.

| Option | Mechanism | Verdict |
|---|---|---|
| **A. Second `uniform shader`** | `uniform shader sharp;` plus `RuntimeShader.setInputShader("sharp", bitmapShader)`. `content` stays bound to the chain output. | Works, but the manually bound child lives in **its own** coordinate space and needs a `Shader` local matrix to align with the node space. Also requires materialising the sharp backdrop as a `Bitmap`/`BitmapShader` (a readback, or a second `GraphicsLayer.toImageBitmap()`), which costs a full copy per frame. |
| **B. Pack both into one input** | Blur into spare channels, or render a 2× tall atlas (sharp on top, blurred below) into one node and offset the eval. | Halves the effective texture resolution or doubles the node area, and needs a custom compose step. Ugly. |
| **C. Blend-mode pre-pass** | `RenderEffect.createBlendModeEffect` to combine sharp + blurred *before* the glass shader, with a fixed mix factor. | Only works if the mix factor is constant per pixel. Ours would not be. |
| **D. Two RuntimeShader stages** | Stage 1 computes a per-pixel blur factor and writes it; stage 2 reads it. | Loses the sharp signal after stage 1. Dead end. |
| **E. Don't** | Prove it is unnecessary. | ✅ |

### 3.3 Verdict — verified against the code

**The Metal glass pass never samples both. It has exactly one texture input (G1), which is *either* the blurred `pong` *or* the sharp backdrop, decided on the CPU by `needsBlur` (G2).** `sampleBackdrop` (`LiquidGlass.metal:171-178`) is the only sampling function in the glass pass and it takes one `texture2d<float>`. There is no lerp between sharp and blurred anywhere in the file.

Therefore the AGSL port needs **one `uniform shader content;`** and a **linear `RenderEffect` chain**. Options A–D are all discarded.

### 3.4 Recommended Android pass structure

```kotlin
// P, and all *Px values, in device pixels (§2.5)
val glass = obtainRuntimeShader(tapCount)            // cached per tap count — Lens.kt:35-43 idiom
glass.applyGlassParams(...)                          // §4.2

val glassEffect = RenderEffect.createRuntimeShaderEffect(glass, "content")   // API 33

val chain = if (blurRadiusPx > 0.01f) {
    // createChainEffect(outer, inner): inner runs first
    RenderEffect.createChainEffect(
        glassEffect,
        RenderEffect.createBlurEffect(
            blurEffectRadiusPx, blurEffectRadiusPx,      // §3.5
            Shader.TileMode.CLAMP                        // matches address::clamp_to_edge
        )
    )
} else {
    glassEffect                                          // the DEFAULT path — G3
}

paddedBackdropNode.setRenderEffect(chain)
```

Stage count: **1** by default (G3), **2** when `blurRadius > 0`. iOS uses 3 when blurring (H, V, glass), so Android is strictly cheaper — HWUI's blur is one fused, downsampling-aware filter.

Backdrop capture (out of scope for this document but load-bearing): record the sibling/ancestor content into a `RenderNode` of size `(W + 2P, H + 2P)` positioned at `(viewX - P, viewY - P)`, then `canvas.drawRenderNode(paddedNode)` from the glass view's `onDraw` on a hardware canvas. In Compose the equivalent is `rememberGraphicsLayer()` + `drawWithContent { layer.record { ... } }`, which is the machinery Kyant's `BackdropEffectScope` wraps.

### 3.5 Replace `blurFragment` with `createBlurEffect` — and the exact radius

**Recommendation: delete `blurFragment`. Use `RenderEffect.createBlurEffect`.**

The sigma relationship, precisely:

* **iOS**: `sigma = max(radius * 0.5, 0.0001)` where `radius = blurRadiusTexels = blurRadius_pt * captureScale` (`LiquidGlass.metal:107`; `GlassSurfaceView.swift:219`). In device-pixel terms, **σ_iOS = 0.5 * blurRadiusPx**.
* **Android**: `RenderEffect.createBlurEffect(radiusX, ...)` does **not** take sigma. HWUI converts with `Blur::convertRadiusToSigma(r) = r > 0 ? 0.57735 * r + 0.5 : 0` before handing it to `SkImageFilters::Blur`.

Solving `0.57735 * R + 0.5 = 0.5 * blurRadiusPx`:

```
R_android = sqrt(3) * (0.5 * blurRadiusPx - 0.5)
          ≈ 0.8660 * (blurRadiusPx - 1)
```

Guard: if `blurRadiusPx <= 1` then `R <= 0` — skip the blur stage entirely, matching iOS's `radius <= 0.01` early-out at `:103`.

Worked examples (density 3):

| `metal.blurRadius` (dp) | blurRadiusPx | target σ (px) | `createBlurEffect` radius (px) |
|---|---|---|---|
| 4 | 12 | 6.0 | 9.53 |
| 8 | 24 | 12.0 | 19.92 |
| 20 | 60 | 30.0 | 51.10 |
| 40 | 120 | 60.0 | 103.06 |

**Quantified visual difference vs the iOS 8-tap Gaussian:**

The iOS kernel is 17 point samples per pass with `stride = max(radius * 1.5 / 8, 1.0)` (`:110`) and support `±7.5 * stride`. For `radius >= 5.33` that support is `±1.40625 * radius = ±2.81σ`, capturing ~99.5 % of the Gaussian mass — the *truncation* is negligible. The problem is **spacing**: taps sit `0.1875 * radius = 0.375σ` apart for small radii, but `stride` grows linearly with radius, so at `radius = 60` the taps are **11.25 px apart across a σ = 30 kernel**, with no bilinear tap pairing. That is a sparse, aliased Gaussian. On a high-contrast backdrop edge it produces visible **ghosting — 17 faint copies of the edge** rather than a smooth ramp.

Skia's blur is a true separable Gaussian, and for large σ it downsamples first, filters, then upsamples. Result:

* **σ ≲ 4 px** (`blurRadius ≲ 3 dp @3×`): iOS strides at 1 texel, so both are correctly sampled Gaussians of matching σ — **visually indistinguishable**.
* **σ ≳ 10 px**: Skia is **strictly better** — no ghosting. The port is an upgrade, not a regression. Expect a slightly *softer* look than iOS at large radii; if bug-for-bug parity is ever demanded, keep the AGSL blur in §4.3.
* **Very large σ** (≳ 250 px): HWUI approximates via downsampling; error grows, but so does iOS's.

This only affects users who explicitly opt in — `blur` defaults to `0` for both variants (G3).

---

## 4. Full draft AGSL source

`kDispersionTaps` is a **string-interpolated Kotlin constant**, not a uniform (§1, ES2 unroll rule). Cache one `RuntimeShader` per value.

**Precision policy for this file (see §6-P5): there is no `half` type declaration anywhere.** The only two `half` touchpoints are imposed by the language — the return type of `main` and the return type of `content.eval()` — and both are widened/narrowed explicitly at the boundary.

### 4.1 `LiquidGlass.agsl` — the glass shader

```glsl
// ============================================================================
//  LiquidGlass.agsl
//  AGSL port of ios/Shaders/LiquidGlass.metal:180-256 (glassFragment)
//  Requires API 33 (android.graphics.RuntimeShader).
//
//  Coordinate space: DEVICE PIXELS, origin = top-left of the padded backdrop
//  RenderNode.  All length-valued uniforms are px.  See §2 of the port doc.
//
//  PRECISION POLICY: no `half` declarations anywhere.  `content.eval()` returns
//  half4 by language definition and is widened to float immediately; `main`
//  must return half4 and does so only in its final statement.  Rationale in
//  §6-P5 (fp16 overflow confirmed on Samsung/Mali; emulators run mediump at
//  fp32, so this class of bug passes CI and fails on device).
//
//  The rounded-rect SDF decomposition and the `size`/`offset` uniform idiom
//  follow AndroidLiquidGlass (Apache-2.0, Copyright 2025 Kyant),
//  backdrop/src/commonMain/kotlin/com/kyant/backdrop/internal/Shaders.kt:22-48
//  and effects/Lens.kt:45-46.  All refraction / dispersion / shading maths is a
//  direct translation of the Metal original and carries no Kyant provenance.
// ============================================================================

uniform shader content;          // chain input: blurred (or sharp) backdrop.
                                 // Metal: texture2d<float> source [[texture(0)]]   (:181)

// ---- geometry --------------------------------------------------------------
uniform float2 size;             // view size, px.  Metal: viewSize == shapeSize (:24,:25 — G4)
uniform float2 offset;           // (-P, -P), px.   Kyant idiom, Lens.kt:46
uniform float4 sampleBounds;     // node-space clamp rect (minX, minY, maxX, maxY), px.
                                 // Replaces `address::clamp_to_edge` + clamp(texUV,0,1) (:93,:177)
uniform float4 cornerRadii;      // px, packed (BL, BR, TR, TL).  GlassCornerRadii.swift:39-44
uniform float  unitScale;        // device px per iOS point (= displayMetrics.density).
                                 // ONLY used where the Metal source hard-codes a point value.

// ---- refraction ------------------------------------------------------------
uniform float2 refractionScale;  // px.   Metal: refractionScale         (:27)
uniform float  refractionAmount; // px.   Metal: refractionAmount        (:29)
uniform float  depthEffect;      //       Metal: depthEffect             (:31)
uniform float  profilePower;     //       Metal: profilePower            (:33)
uniform float  profileBias;      //       Metal: profileBias             (:34)

// ---- chromatic dispersion --------------------------------------------------
uniform float  dispersionHeight;      // px.  Metal: dispersionHeight    (:36)
uniform float  dispersionAmount;      // px.  Metal: dispersionAmount    (:37)
uniform float  dispersionTapSpacing;  // px between taps.  = unitScale for iOS parity,
                                      // 1.0 for the "high" tier.  MUST be <= unitScale.

// ---- shading ---------------------------------------------------------------
uniform float4 tintColor;        // straight (non-premultiplied) sRGB RGBA.
                                 // Metal: tintColor                     (:20)
uniform float4 frostColor;       // rgb = frost colour, a = frostAmount. Metal: frostColor (:21)
                                 // GlassSurfaceView.swift:163-164
uniform float  highlightIntensity;    // Metal: highlightIntensity       (:38)
uniform float  highlightAngle;        // radians.  Metal: highlightAngle (:39)
uniform float  lightIntensity;        // Metal: lightIntensity           (:40)
uniform float  glassOpacity;          // Metal: glassOpacity             (:41)
uniform float  saturation;            // Metal: saturation               (:42)
uniform float  noiseAmount;           // Metal: noiseAmount              (:43)

// kDispersionTaps: Metal `constant int kDispersionTaps = 16` (:96).
// MUST be a compile-time constant (ES2 unroll rule, §1) and MUST be >= 3 so the
// `spread >= 2 * unitScale` guard still yields >= 3 taps and every channel
// weight ends up > 0 (see §6-P8).
const int   kDispersionTaps = 8;     // <-- Kotlin string-interpolates this per tier
const float kNormEps = 1e-6;

// ---------------------------------------------------------------------------
// NaN-free normalize.  Metal guards each normalize with a length test
// (:79, :150, :152, :154).  A ternary is NOT safe here: if the compiler lowers
// `cond ? normalize(v) : fb` to an arithmetic select, normalize(0) = NaN is
// still multiplied by 0, and NaN * 0 = NaN.  The division form can never
// produce NaN because the denominator is floored.
// ---------------------------------------------------------------------------
float2 safeNormalize(float2 v, float2 fallback) {
    float len = length(v);
    float ok  = step(kNormEps, len);
    return mix(fallback, v / max(len, kNormEps), ok);
}

// Metal :55-60.  NOTE: the argument MUST be the CENTERED coordinate.
// (Kyant's Shaders.kt:70 / :107 / :173 passes the un-centered `coord`, so the
//  quadrant test is always "x >= 0" and only the right-hand radii are ever
//  selected.  That is a bug — do not copy it.)
float radiusAt(float2 c, float4 radii) {
    if (c.x >= 0.0) {
        return (c.y <= 0.0) ? radii.z : radii.y;   // right-top : right-bottom
    }
    return (c.y <= 0.0) ? radii.w : radii.x;       // left-top  : left-bottom
}

// Metal :62-69.  Per-corner radius, exact Euclidean SDF, y-down.
float sdRoundedRect(float2 c, float2 halfSize, float4 radii) {
    float  r           = radiusAt(c, radii);
    float2 innerHalf   = halfSize - float2(r);
    float2 cornerCoord = abs(c) - innerHalf;
    float  outside     = length(max(cornerCoord, 0.0)) - r;
    float  inside      = min(max(cornerCoord.x, cornerCoord.y), 0.0);
    return outside + inside;
}

// Metal :71-81.  Branchless outward unit gradient.  Equivalent to Kyant's
// branchy version (Shaders.kt:40-48) but with Metal's explicit zero guard.
float2 gradSdRoundedRect(float2 c, float2 halfSize, float4 radii) {
    float  r           = radiusAt(c, radii);
    float2 innerHalf   = halfSize - float2(r);
    float2 cornerCoord = abs(c) - innerHalf;

    float  insideCorner = step(0.0, min(cornerCoord.x, cornerCoord.y));
    float  xMajor       = step(cornerCoord.y, cornerCoord.x);
    float2 gradEdge     = float2(xMajor, 1.0 - xMajor);
    float2 gradCorner   = safeNormalize(cornerCoord, float2(0.0));   // Metal :79
    return sign(c) * mix(gradEdge, gradCorner, insideCorner);
}

// Metal :83-85.  KEEP the max(0.0, ...) — Kyant's copy (Shaders.kt:63-65) drops
// it and yields NaN for |x| > 1.
float circleMap(float x) {
    return 1.0 - sqrt(max(0.0, 1.0 - x * x));
}

// Metal :87-89.  MUST stay `float` (highp).  43758.5453 overflows fp16, and
// sin() of a large half-precision argument is pure noise on Mali.  See §6-P5.
float hashNoise(float2 co) {
    return fract(sin(dot(co, float2(12.9898, 78.233))) * 43758.5453);
}

// Metal :171-178 — the whole sourceRect / UV indirection collapses to a
// translate plus a clamp, because on Android the node IS the sampled region.
// `.rgb` of a premultiplied sample, exactly as Metal does (the backdrop is
// premultipliedFirst — BackdropCapturer.swift:557, G9).
// content.eval() returns half4 by language definition; widen to float4 at once
// so that no half-precision value ever enters the arithmetic (§6-P5).
float3 sampleBackdrop(float2 viewPx) {
    float2 nodePx = clamp(viewPx - offset, sampleBounds.xy, sampleBounds.zw);
    return float4(content.eval(nodePx)).rgb;
}

// ===========================================================================
half4 main(float2 fragCoord) {
    // --- coordinate setup.  Metal :183-185 --------------------------------
    float2 pixels   = fragCoord + offset;      // view-local px, top-left origin, y-down
    float2 halfSize = size * 0.5;
    float2 centered = pixels - halfSize;

    // --- SDF + silhouette.  Metal :189-193 --------------------------------
    // Reordered relative to Metal (which builds the full GlassGeometry at :187
    // before testing at :191): the SDF alone decides the early-out, so the
    // gradient / direction / scale work is skipped for every pixel in the
    // padded margin.  Behaviourally identical, materially cheaper (§5.3).
    float sd = sdRoundedRect(centered, halfSize, cornerRadii);

    // fwidth() does not exist in AGSL.  |grad(sd)| == 1 for an exact SDF and we
    // are in device pixels, so fwidth(sd) == 1.0 -> a 2 px feather, which is
    // exactly what iOS produces (fwidth(sd_points) = 1/contentsScale points).
    float aa = 1.0;
    float shapeAlpha = 1.0 - smoothstep(-aa, aa, sd);
    if (shapeAlpha <= 0.001) {
        return half4(0.0);                     // Metal :192
    }

    // --- geometry.  Metal :141-163 (glassGeometry) ------------------------
    float4 maxGradRadius = float4(min(halfSize.x, halfSize.y));      // :147
    float4 gradRadius    = min(cornerRadii * 1.5, maxGradRadius);    // :148
    float2 normal = safeNormalize(
        gradSdRoundedRect(centered, halfSize, gradRadius),
        float2(0.0, 1.0));                                           // :149-150

    float2 radial    = safeNormalize(centered, float2(0.0));         // :152
    float2 direction = safeNormalize(normal + depthEffect * radial,
                                     normal);                        // :153-154

    // Anisotropic refraction height: n^2 . refractionScale yields
    // refractionScale.x on a vertical edge and .y on a horizontal one.
    float2 limit  = max(halfSize, float2(1e-3));                     // :156
    float2 scale2 = clamp(refractionScale, float2(1e-3), limit);     // :157
    float  scale  = max(dot(normal * normal, scale2), 1e-3);         // :158

    float t      = clamp(-min(sd, 0.0) / scale, 0.0, 1.0);           // :160
    float inside = -min(sd, 0.0);                                    // :196

    float3 color;

    if (inside >= scale) {
        // Deep interior: no refraction at all.  Metal :198-199
        color = sampleBackdrop(pixels);
    } else {
        // --- refraction profile.  Metal :165-169 (refractedPixels) --------
        // Hoisted out of both sub-branches; Metal recomputes it identically at
        // :205 and :207.
        // The pow() base is 1-t with t in [0,1], so it is never negative, and
        // the exponent is floored at 1e-3 so pow(0, 0) is unreachable (§6-P4).
        float  profile = circleMap(pow(1.0 - t, max(profilePower, 1e-3)));
        float  amount  = (profile + profileBias * (1.0 - t)) * refractionAmount;
        float2 base    = pixels - amount * direction;   // NOTE the MINUS (:168).
                                                        // Kyant instead negates
                                                        // refractionAmount on the
                                                        // Kotlin side (Lens.kt:49).

        // --- chromatic dispersion.  Metal :201-228 ------------------------
        float dispersionT = clamp(inside / max(dispersionHeight, 1e-3), 0.0, 1.0);
        float spread      = circleMap(1.0 - dispersionT) * dispersionAmount;

        // The literal 2.0 is POINTS in the Metal source (:204) -> scale to px.
        if (spread < 2.0 * unitScale) {
            color = sampleBackdrop(base);                            // :205
        } else {
            // Transverse aberration: taps walk along the tangent of the
            // refraction direction.  R is biased to +, B to -, G stays centred.
            float2 tangent = float2(direction.y, -direction.x);      // :208
            float3 accumulated = float3(0.0);
            float3 weight      = float3(0.0);

            // Metal: maxI = min(spread, 16) with `pixels` in POINTS, i.e. one
            // tap per point.  dispersionTapSpacing == unitScale reproduces that
            // exactly; 1.0 gives sub-point sampling for the "high" tier.
            float maxI = min(spread / max(dispersionTapSpacing, 1e-3),
                             float(kDispersionTaps));                // :212

            for (int i = 0; i < kDispersionTaps; ++i) {
                float u = float(i) / maxI;                           // :215
                // Metal uses `if (u > 1.0) break;` (:216).  A dynamic `if` is
                // used instead: statically unrollable, and the GPU still skips
                // the eval when the whole wave agrees.  The accumulator and the
                // weight are untouched when the test fails, so the result is
                // identical.
                if (u <= 1.0) {
                    float3 tap  = sampleBackdrop(base + tangent * (u - 0.5) * spread);
                    float3 mask = float3(step(0.5, u),                    // R: upper half
                                         step(0.25, u) * step(u, 0.75),   // G: middle band
                                         step(u, 0.5));                   // B: lower half
                    accumulated += tap * mask;
                    weight      += mask;
                }
            }
            color = accumulated / max(weight, float3(1e-6));         // :227
        }
    }

    // --- tone chain.  Metal :231-236 --------------------------------------
    color = clamp(color, 0.0, 1.0);

    float luma = dot(color, float3(0.2126, 0.7152, 0.0722));   // Rec.709, gamma space
    color = mix(float3(luma), color, saturation);              // saturation
    color = mix(color, frostColor.rgb, frostColor.a);          // frost colour + frostAmount
    color = mix(color, tintColor.rgb,  tintColor.a);           // tint

    // --- film grain.  Metal :238-241 ---------------------------------------
    // Metal keys off in.position.xy (drawable device px).  `pixels` is the
    // Android equivalent that stays stable under padding changes; `fragCoord`
    // would make the grain crawl whenever P changes (i.e. on any prop update).
    // See §6-P7.
    if (noiseAmount > 0.0) {
        color += (hashNoise(pixels * 1e-3) - 0.5) * noiseAmount;
    }

    // --- angular highlight.  Metal :243-247 --------------------------------
    // Metal: glow = sin(atan2(n.y, n.x) - highlightAngle).  Expanded via the
    // sine difference identity to n.y*cos(a) - n.x*sin(a), which is exact and
    // removes an atan2.  The v == 0 case matches too: Metal's atan2(0,0) = 0
    // gives sin(-a) = -sin(a); the (1,0) fallback gives 0*cos(a) - 1*sin(a).
    // OPTIMISATION: pass `uniform float2 highlightDir = (cos a, sin a)` from
    // Kotlin and drop the two per-pixel transcendentals entirely (§5.3-3).
    float2 normalized = centered / max(halfSize, float2(1e-4));
    float2 nd   = safeNormalize(normalized, float2(1.0, 0.0));
    float  glow = nd.y * cos(highlightAngle) - nd.x * sin(highlightAngle);
    float  band = 1.0 - smoothstep(0.0, 1.0, t);

    color *= 1.0 + glow * highlightIntensity * band + lightIntensity;

    // --- edge contour.  Metal :249-250.  1.5 is POINTS -> * unitScale -------
    float contour = 1.0 - smoothstep(0.0, 1.5 * unitScale, abs(sd));
    color += contour * highlightIntensity * 0.35 * max(glow, 0.0);

    color = clamp(color, 0.0, 1.0);

    // --- premultiplied output.  Metal :254-255 -----------------------------
    // The only narrowing to half in the whole shader, and it is the last
    // statement.  Explicit constructor, never an implicit conversion.
    float alpha = shapeAlpha * glassOpacity;
    return half4(color * alpha, alpha);
}
```

### 4.2 Kotlin-side uniform upload

```kotlin
/**
 * Mirrors GlassParams (ios/Glass/GlassRenderContext.swift:11-32) field for field,
 * minus sourceRect / viewSize / _pad0, plus offset / sampleBounds / unitScale /
 * dispersionTapSpacing.  See §2.4.
 *
 * All *Dp inputs are multiplied by `density` here — the shader works entirely in
 * device pixels (§2.2).
 */
private fun RuntimeShader.applyGlassParams(
    widthPx: Float,
    heightPx: Float,
    paddingPx: Float,
    density: Float,
    p: GlassParams
) {
    // GlassParams.viewSize and .shapeSize collapse into one uniform (G4)
    setFloatUniform("size", widthPx, heightPx)

    // Kyant idiom — Lens.kt:46
    setFloatUniform("offset", -paddingPx, -paddingPx)

    // Half-pixel inset so bilinear never blends with the transparent-black
    // outside the padded node (§2.7)
    setFloatUniform(
        "sampleBounds",
        0.5f,
        0.5f,
        widthPx + 2f * paddingPx - 0.5f,
        heightPx + 2f * paddingPx - 0.5f
    )

    // px, clamped to min(w, h) / 2, packed (BL, BR, TR, TL)
    // — GlassCornerRadii.swift:27-35 (clamp) and :39-44 (packing), G8
    val lim = min(widthPx, heightPx) * 0.5f
    setFloatUniform(
        "cornerRadii",
        floatArrayOf(
            (p.bottomLeftDp  * density).coerceIn(0f, lim),
            (p.bottomRightDp * density).coerceIn(0f, lim),
            (p.topRightDp    * density).coerceIn(0f, lim),
            (p.topLeftDp     * density).coerceIn(0f, lim)
        )
    )

    // Only used where the Metal source hard-codes a point-valued literal (§2.6)
    setFloatUniform("unitScale", density)

    setFloatUniform(
        "refractionScale",
        p.refractionWidthDp * density,
        p.refractionHeightDp * density
    )
    setFloatUniform("refractionAmount", p.refractionAmountDp * density)
    setFloatUniform("depthEffect", p.depthEffect)
    setFloatUniform("profilePower", p.profilePower)   // GlassRefractionCurve.swift:5
    setFloatUniform("profileBias", p.profileBias)     // GlassRefractionCurve.swift:7

    setFloatUniform("dispersionHeight", p.dispersionHeightDp * density)
    setFloatUniform("dispersionAmount", p.dispersionAmountDp * density)
    // == unitScale reproduces iOS's one-tap-per-point spacing exactly.
    // MUST be <= unitScale — see §6-P8.
    setFloatUniform("dispersionTapSpacing", density)

    // Plain float4, NOT layout(color) — see the colour-space row in §1 and §6-P11.
    setFloatUniform("tintColor", p.tintR, p.tintG, p.tintB, p.tintA)
    setFloatUniform("frostColor", p.frostR, p.frostG, p.frostB, p.frostAmount)

    setFloatUniform("highlightIntensity", p.highlightIntensity)
    setFloatUniform("highlightAngle", p.highlightAngleDeg * PI.toFloat() / 180f)
    setFloatUniform("lightIntensity", p.lightIntensity)
    setFloatUniform("glassOpacity", p.glassOpacity)
    setFloatUniform("saturation", p.saturation)
    setFloatUniform("noiseAmount", p.noiseAmount)
}
```

Per-variant defaults to port verbatim from `GlassVariant.swift:32-67` and `LiquidGlassView.swift:247-273`:

| Prop | `.regular` | `.clear` | Source |
|---|---|---|---|
| `blurRadius` | 0 | 0 | `GlassVariant.swift:37`, `:52` |
| `refractionScale` (w, h) | (20, 20) | (10, 10) | `GlassVariant.swift:38-39`, `:53-54` |
| `refractionAmount` | 60 | 30 | `GlassVariant.swift:40`, `:55` |
| `depthEffect` | 1 | 0 | `GlassVariant.swift:41`, `:56` |
| `profile` (power, bias) | (1, 0) | (1, 0) | `GlassVariant.swift:42`, `:57` |
| `dispersionAmount` | 6 | 10 | `GlassVariant.swift:43`, `:58` |
| `dispersionHeight` | **20** | **10** | `LiquidGlassView.swift:259` resolves to `defaults.height` (G12) |
| `lightIntensity` | 0.0 | 0.0 | `GlassVariant.swift:44`, `:59` |
| `frostAmount` | 0.36 | 0.06 | `GlassVariant.swift:45`, `:60` |
| `saturation` | 1.8 | 1.15 | `GlassVariant.swift:46`, `:61` |
| `highlightIntensity` | 0.25 | 0.35 | `GlassVariant.swift:47`, `:62` |
| `noiseAmount` | 0.05 | 0.06 | `GlassVariant.swift:48`, `:63` |
| `borderOpacity` (not a shader uniform) | 0.28 | 0.4 | `GlassVariant.swift:49`, `:64` |
| `highlightAngle` | 135° = 3π/4 | 135° | `LiquidGlassView.swift:262`; `GlassSurfaceView.swift:34` |
| `glassOpacity` | 1 | 1 | `LiquidGlassView.swift:269` |
| frost colour | `UIColor.systemBackground` | same | `LiquidGlassView.swift:282-284` → Android `?attr/colorSurface` |

### 4.3 `LiquidGlassBlur.agsl` — only if bug-for-bug blur parity is required

Ship this **only** if §3.5's `createBlurEffect` substitution is rejected. Two chained instances (H then V) plus the glass shader = 3 stages, matching iOS's structure exactly.

```glsl
// ============================================================================
//  LiquidGlassBlur.agsl
//  AGSL port of ios/Shaders/LiquidGlass.metal:98-126 (blurFragment).
//  PREFER RenderEffect.createBlurEffect — see §3.5.  This exists only for
//  bug-for-bug parity with the iOS 17-tap sparse Gaussian.
//  No `half` declarations: the tap accumulator is float4 (§6-P5).
// ============================================================================

uniform shader content;
uniform float2 texelStep;   // (1,0) for the H pass, (0,1) for the V pass — PIXELS,
                            // not 1/texWidth.  Metal :103 and :118 were in UV space.
uniform float  radius;      // device px.  Metal: blurRadiusTexels
                            // (GlassSurfaceView.swift:219)

const int kBlurTaps = 8;    // Metal :95

half4 main(float2 coord) {
    // Metal :103-105.  The whole uvRect remap (:101) is gone: on Android the
    // node IS the region, so base == coord.
    if (radius <= 0.01) {
        return half4(content.eval(coord));
    }

    float sigma         = max(radius * 0.5, 0.0001);                  // :107
    float invTwoSigmaSq = -1.0 / (2.0 * sigma * sigma);               // :108
    float stride        = max(radius * 1.5 / float(kBlurTaps), 1.0);  // :110

    // float4, not half4: 17 accumulated taps in fp16 costs ~1e-3 relative error
    // and shows up as banding on smooth gradients.  §6-P5.
    float4 sum       = float4(content.eval(coord));                   // :112
    float  weightSum = 1.0;                                           // :113

    for (int i = 0; i < kBlurTaps; ++i) {
        float  off = (float(i) + 0.5) * stride;                       // :116
        // Metal writes exp2(x * 1.4426950) === exp(x); log2(e) folds away (G11, :117).
        float  w   = exp(off * off * invTwoSigmaSq);
        float2 d   = texelStep * off;                                 // :118

        sum += float4(content.eval(coord + d)) * w;                   // :120
        sum += float4(content.eval(coord - d)) * w;                   // :121
        weightSum += w * 2.0;                                         // :122
    }

    return half4(sum / weightSum);                                    // :125
}
```

Note the H/V edge-behaviour divergence: Metal's H pass reads from the full window capture with `clamp_to_edge` at the *capture* boundary (`:120-121`, sampler at `:91-93`), whereas this AGSL version's input is the padded node, so out-of-node reads return transparent black. Either add an explicit `clamp(coord ± d, sampleBounds.xy, sampleBounds.zw)` (which needs a `sampleBounds` uniform here too) or rely on the additive padding budget of §2.5.

### 4.4 Attribution — Apache-2.0, AndroidLiquidGlass © 2025 Kyant

The following are structurally derived from **AndroidLiquidGlass, Apache License 2.0, Copyright 2025 Kyant** and require an attribution notice in `NOTICE` / `THIRD_PARTY`:

* the `radiusAt` / `sdRoundedRect` / `gradSdRoundedRect` decomposition into three AGSL functions with a `float4 cornerRadii` selector — `backdrop/src/commonMain/kotlin/com/kyant/backdrop/internal/Shaders.kt:22-48`;
* the `uniform float2 size; uniform float2 offset;` device-pixel framing and the `centeredCoord = (coord + offset) - halfSize` line — `internal/Shaders.kt:54-55`, `:69` and `effects/Lens.kt:45-46`;
* the padding-budget concept threaded through the effect chain — `effects/Lens.kt:25-27`, `effects/Blur.kt:16-20`;
* the "one cached `RuntimeShader` per shader-source variant" pattern — `effects/Lens.kt:35-43`.

All refraction, dispersion, tone, highlight and noise **maths** is a translation of this project's own `ios/Shaders/LiquidGlass.metal` and carries no Kyant provenance.

Two Kyant behaviours were deliberately **not** copied:

1. the un-centered `radiusAt(coord, ...)` call (`Shaders.kt:70`, `:107`, `:173`), which makes the quadrant test always take the `x >= 0` branch so only the right-hand radii are ever selected;
2. the unguarded `circleMap` (`Shaders.kt:63-65`), which returns NaN for `|x| > 1`.

---

## 5. Uniform budget & performance

### 5.1 Uniform budget

| | Metal | AGSL |
|---|---|---|
| Declarations | 1 (`constant GlassParams&`) | **21** uniforms + 1 `uniform shader` |
| Scalars | 36 floats (incl. `float2 _pad0`) — 144 B (`LiquidGlass.metal:18-45`) | **35 floats** — 140 B |
| Upload | 1 × `setFragmentBytes` (`GlassRenderContext.swift:132`) | 21 × `setFloatUniform` JNI calls |

Removed vs Metal: `sourceRect` (4), `viewSize` **or** `shapeSize` (2, G4), `_pad0` (2) = 8 floats. Added: `offset` (2), `sampleBounds` (4), `unitScale` (1), `dispersionTapSpacing` (1) = 8 floats. Net wash on bytes, but 21 JNI round-trips instead of one `memcpy`.

**Mitigations, in order of value:**

1. **Only re-upload on change.** Uniform values are retained inside `RuntimeShader` across draws. Track a dirty flag per prop group; on a pure scroll (backdrop moves, props static) you re-upload only `size` / `offset` / `sampleBounds` — 3 calls instead of 21. This mirrors the iOS `invalidate(oldValue != newValue)` pattern at `GlassSurfaceView.swift:16-42`.
2. **Pack the 13 loose scalars into 4 `float4`s.** `refractionAmount / depthEffect / profilePower / profileBias` → `refraction2`; `dispersionHeight / dispersionAmount / dispersionTapSpacing / unitScale` → `dispersion2`; `highlightIntensity / highlightAngle / lightIntensity / glassOpacity` → `highlight2`; `saturation / noiseAmount / _ / _` → `tone2`. That takes 21 → 12 calls. It costs readability; do it only if profiling shows JNI in the trace.
3. Use `setFloatUniform(String, FloatArray)` for the `float4`s to avoid 4-argument boxing.

**Hard rule (§6-P3):** every declared uniform must be set before the first draw *and* must actually be referenced by the compiled shader. Both directions throw.

### 5.2 Per-pixel `content.eval()` count

| Region | Condition | evals | Notes |
|---|---|---|---|
| Outside the silhouette | `shapeAlpha <= 0.001` | **0** | Early-out at the reordered `sd` test. Costs 1 `radiusAt` + 1 `length` + ~12 ALU. |
| Deep interior | `inside >= scale` | **1** | Metal `:198-199` |
| Refraction band, low dispersion | `spread < 2 * unitScale` | **1** | Metal `:204-205` |
| Refraction band, dispersing | otherwise | **floor(min(spread / spacing, kTaps)) + 1** | Metal `:214-225` |

With `dispersionTapSpacing = unitScale` (iOS parity) the tap count is at most `floor(dispersionAmount_dp) + 1` — **7 at `.regular` defaults (6 dp), 11 at `.clear` (10 dp)** — independent of screen density. So `kDispersionTaps = 8` is **lossless for `.regular`** and clips `.clear` from 11 taps to 9 (spread 10 dp / 8 = 1.25 dp spacing instead of 1.0 dp) — imperceptible.

### 5.3 Area analysis — the real cost driver

The dispersion band is where `inside < scale`, i.e. within `refractionScale` px of the edge: **20 dp (`.regular`) / 10 dp (`.clear`)**. For a typical 320 × 56 dp button that band is essentially the *entire* view — there is no cheap interior. Assume worst case.

Worked budget, `.regular` defaults, 1080 × 2400 device at density 3, one 320 × 56 dp glass button:

| Quantity | Value |
|---|---|
| View area | 960 × 168 px = 161 k px |
| Padding `P` (§2.5) | `ceil(60*3 + 6*3 + 0 + 6)` = **204 px** |
| Padded node area | 1368 × 576 = **788 k px** |
| Shader invocations | 788 k (**4.9× the view area**) |
| Of those, past the early-out | ~161 k (20 %) |
| Texture fetches | ~161 k × 7 = **1.13 M** |
| ALU-only invocations | ~627 k × ~14 ops |

**Flags for mid-range Adreno 6xx / Mali-G5x–G7x:**

1. **The 4.9× padded overdraw is the biggest single problem**, and it is *inherited from the iOS design* (`glassBackdropPadding` at `GlassSurfaceView.swift:133-137` with `refractionAmount = 60`), not introduced by the port. iOS pays it only inside its own drawable — the padding lives in the *capture*, not the *draw*. On Android the RenderEffect is evaluated over the whole padded node. **Mitigation: `canvas.clipRect` to the view rect inflated by 2 px before `drawRenderNode`.** HWUI propagates the device clip into the image filter's requested output rect, so this genuinely reduces the filtered area — typically back to ~1.05×. Verify in a systrace `RenderNodeDrawable` frame; if it does not take, the fallback is `RenderEffect.createOffsetEffect` plus a smaller node.
2. **Divergent dependent texture fetches.** The 7 dispersion taps walk along a per-pixel tangent, so neighbouring fragments in a quad read scattered texels. The texture cache hit rate collapses relative to a stencil-shaped blur. On Mali this shows up as texture-unit-bound, not ALU-bound. 1.13 M fetches/frame is fine for one button; **it is not fine for a full-screen glass panel** (a 1080 × 2400 view would be ~18 M fetches → guaranteed frame drops on a G57).
3. **Transcendentals.** After the `atan2` → dot-product rewrite (§4.1), the per-pixel transcendental count is: 1 `pow`, 2 `sqrt` (inside `circleMap`), 3–4 `length` / `inversesqrt` (inside `safeNormalize`), 1 `sin` (hash noise), 2 `cos`/`sin` (highlight angle — removable). That is ~9. Removing the `highlightAngle` pair via a precomputed `uniform float2 highlightDir` is free and worth doing.
4. **The sin-based `hashNoise`.** On several Mali drivers `sin()` of a large argument is computed at reduced precision even under `highp`, producing coarse blotches instead of grain. If the grain looks wrong on a target device, swap to a multiply-fract hash — it is a *different* noise field, but noise is noise.
5. **Shader compile time.** Unrolling 16 dispersion taps generates roughly 16 × (clamp + eval + 3 `step` + 6 mul-add) ≈ 400+ instructions. First-draw jank on Adreno is real. **Warm the shader on a background thread at view attach** by drawing the RenderNode once into a 1 × 1 offscreen, and cache `RuntimeShader` instances per tap count (`Lens.kt:35-43` idiom).

### 5.4 Recommended quality-tier scheme

Add one Android-only prop alongside the existing `GlassMetalOptions` fields (`GlassMetalOptions.swift:45-62`):

```ts
metal: {
  // ...existing: blurRadius, captureQuality, opacity, frost, saturation,
  //              noise, light, refraction, dispersion, highlight, border
  android?: { quality?: 'low' | 'medium' | 'high' }   // default 'medium'
}
```

| Tier | `kDispersionTaps` | `dispersionTapSpacing` | noise | contour highlight | blur | Expected cost vs `high` |
|---|---|---|---|---|---|---|
| `high` | 16 | `1.0` | on | on | `createBlurEffect` | 1.00× |
| `medium` (default) | 8 | `unitScale` | on | on | `createBlurEffect` | ~0.55× |
| `low` | **0 → branch removed** | — | **off** | **off** | `createBlurEffect` | ~0.18× |

Implementation notes:

* Tiers are **separate shader source strings**, string-interpolated in Kotlin and cached — the tap count cannot be a uniform (§1).
* `low` should *textually delete* the dispersion `else` branch (leaving `color = sampleBackdrop(base);`), the `hashNoise` block, and the `contour` lines — **and delete the corresponding `uniform` declarations and their `setFloatUniform` calls**, or you hit the dead-uniform trap (§6-P3).
* Free wins that need no tier: `dispersionAmount == 0` already collapses to 1 eval via the existing `spread < 2 * unitScale` guard, and `noiseAmount == 0` already skips the hash (`LiquidGlass.metal:238`). Both are honoured by the draft.
* Auto-downgrade heuristic worth adding: if `viewArea > 0.25 * screenArea`, force `low` regardless of the prop. A full-screen liquid-glass panel is the pathological case (§5.3-2).

---

## 6. Known AGSL pitfalls that will bite this specific shader

**P1 — `normalize(float2(0,0))` → NaN, and the ternary guard is not enough.**

Metal guards four call sites: `:79` (corner gradient), `:150` (SDF normal), `:152` (radial), `:154` (blended direction). All four are reachable: `:152` at the exact geometric centre, `:79` / `:150` at the inner-corner inflection point, and `:154` when `depthEffect == 1` and the normal is exactly anti-parallel to the radial (which happens on the inner edge of a very eccentric rounded rect).

The port needs the same guards — **but not the same form**. `cond ? normalize(v) : fallback` is only safe if the compiler emits a real branch. If SkSL lowers it to an arithmetic select (`mix` / `fma`), then `NaN * 0 + fallback * 1 = NaN`, because NaN is absorbing under multiplication. The draft's `safeNormalize` uses `v / max(length(v), 1e-6)`, which **cannot** produce NaN for any finite `v` (the denominator is floored, and `0 / 1e-6 = 0`), then selects with `step`. Branchless *and* NaN-free.

A single NaN here does not produce one bad pixel — it propagates through `direction` → `base` → every `eval` coordinate → `color`, and `clamp(NaN, 0, 1)` is implementation-defined. On Adreno it typically yields black; on Mali, garbage. It looks like a driver bug and is a nightmare to bisect.

**P2 — Division by zero in `circleMap` and its inputs.**

`circleMap` itself is safe *if* you keep Metal's `max(0.0, 1.0 - x * x)` (`:84`). Kyant's copy omits it (`Shaders.kt:63-65`) and returns NaN for `|x| > 1`. In our shader `x = pow(1 - t, p)` with `t ∈ [0,1]`, so `x ∈ [0,1]` — but `x = 1.0 - dispersionT` at `:202` is also fed in, and `dispersionT` is only clamped because of `max(dispersionHeight, 1e-3)` at `:201`. **Keep every one of these guards:**

| Guard | Metal | Why reachable |
|---|---|---|
| `max(params.dispersionHeight, 1e-3)` | `:201` | `dispersion.reach: 0` is a legal prop value (`GlassMetalOptions.swift:22`) |
| `max(g.scale, 1e-3)` via the `dot` | `:158`, used at `:160` | `refractionScale` = (0, 0) is legal — `width` / `height` are optional Doubles (`GlassMetalOptions.swift:7-9`) |
| `max(profilePower, 1e-3)` | `:166` | `GlassRefractionCurve.power` defaults to 1 but accepts 0 (`GlassRefractionCurve.swift:5`) |
| `max(weight, float3(1e-6))` | `:227` | Structurally unreachable given the `spread >= 2` invariant, but keep it — see P8 |
| `max(halfSize, float2(1e-4))` | `:243` | Zero-size view during the first layout pass |
| `max(halfSize, float2(1e-3))` | `:156` | Same |

**P3 — The dead-uniform / unset-uniform trap.** Bidirectional, and both sides throw:

* A uniform that is **declared but never set** → `IllegalArgumentException` at draw time from Skia ("uniform ... not set").
* A uniform that is declared but **optimised out** because it is unreferenced (or only referenced inside a statically dead branch) → `setFloatUniform("name", ...)` throws `IllegalArgumentException: unable to find uniform named name`.

This bites exactly when you build the `low` tier by deleting the dispersion / noise / contour blocks: `dispersionHeight`, `dispersionAmount`, `dispersionTapSpacing`, `noiseAmount` and `highlightIntensity` all become dead, and the shared uniform-upload function then crashes. **Gate the uploads on the tier, or keep a per-tier list of live uniform names.** Kyant sidesteps this by only setting `chromaticAberration` when the dispersion shader variant is selected (`Lens.kt:51-53`) — copy that discipline.

**P4 — `pow` with a negative base.**

GLSL leaves `pow(x, y)` undefined for `x < 0`, and drivers disagree (NaN on some, `|x|^y` on others). The only `pow` is `pow(1.0 - t, max(profilePower, 1e-3))` at `:166`. `t` is `clamp(..., 0, 1)` at `:160`, so `1 - t ∈ [0,1]` — **safe, provided you keep the clamp on `t`**. Do not "optimise" the clamp away on the grounds that `sd <= 0` inside the shape. `pow(0, y)` with `y > 0` is defined as 0; the `max(..., 1e-3)` on the exponent is what keeps you out of the undefined `pow(0, 0)`.

**P5 — Half precision: fp16 overflow, and the project-wide `no half` rule.**

> **Constraint from the parallel research track, applied throughout §4:** use `float` / `vec*` everywhere in the shader, with **zero `half` declarations**. fp16 overflow failures were confirmed on Samsung/Mali devices, and — critically — **emulators execute `mediump` at fp32, so this entire class of bug passes CI and only fails on real hardware.** Do not reintroduce `half` as a micro-optimisation.

`half` is fp16: max finite 65504, roughly 3 decimal digits of mantissa. Three concrete hazards in this shader:

* `hashNoise`'s `43758.5453` — representable as a literal, but `sin(x) * 43758.5453` followed by `fract()` in fp16 has *zero* useful mantissa left. The result would be a handful of banded values instead of noise. **Must be `float`** (`LiquidGlass.metal:87-89`).
* Blur accumulation (§4.3): 17 taps summed in `half4` gives ~1e-3 relative error → visible banding on smooth gradients. The draft accumulates in `float4`.
* Intermediate products such as `off * off * invTwoSigmaSq` (`:117`) and `spread * (u - 0.5)` (`:218`) are small here, but any future change that lets a squared pixel distance exceed 65504 (i.e. a radius over ~256 px, entirely plausible at density 3) overflows silently to `inf` in fp16 and then to NaN through the division.

Two `half` touchpoints are imposed by the language and cannot be removed:

1. `main` must return `half4` (SkRuntimeEffect's required signature). The draft's final statement is `return half4(color * alpha, alpha);` — an **explicit** constructor, applied once, at the very end.
2. `content.eval()` returns `half4`. The draft widens it immediately: `float4(content.eval(nodePx)).rgb` in `sampleBackdrop`, and `float4(content.eval(coord))` in the blur. Note that half → float is an implicit promotion and always legal, whereas float → half is **not** implicit in SkSL — which is why every narrowing in the draft is written as an explicit constructor.

**P6 — Loop-unrolling constraints.**

The dispersion loop must satisfy GLSL ES 1.00 Appendix A: `int` counter, constant initialiser, comparison against a **compile-time constant**, `++` / `+= const` step, and the counter must not be modified in the body. Consequences:

* `kDispersionTaps` **cannot be a uniform**. It is a `const int` baked into the source string, string-interpolated from Kotlin (the `$RoundedRectSDF` idiom at `Shaders.kt:61`, `:98`).
* Metal's `if (u > 1.0) break;` (`:216`) is replaced by `if (u <= 1.0) { ... }`. Skia's unroll analyser accepts `break` in current versions, but behaviour varies across the API 33 → API 36 Skia range and there is no upside.
* No `while`, no `do`, no recursion, no dynamic array indexing.
* At 16 taps the unrolled body is ~400 instructions. Some older Adreno drivers have a practical instruction-count ceiling for a single shader before they fall back to a slow path — another reason `medium` / 8 taps is the default.

**P7 — The noise coordinate is *not* `fragCoord`.**

Metal keys the grain off `in.position.xy` (`:239`) — drawable device pixels, which are view-local because the `CAMetalLayer` *is* the view. The naive AGSL translation is `coord`, but `coord` is **padded-node**-local, so its origin shifts by `P` whenever `refractionAmount`, `dispersionAmount` or `blurRadius` changes. The grain field would then visibly jump on any prop animation. Use `pixels` (= `coord + offset`), which is view-local and stable. The draft does this and comments it.

Secondary, cosmetic: iOS's `position.xy` is device px while `pixels` in the *Metal* shader is points, so iOS's grain frequency is `1e-3 * density * pt`. Android's `pixels` is already device px, so `pixels * 1e-3` matches. No adjustment needed.

**P8 — The `spread >= 2` invariant guarantees non-zero channel weights; do not break it.**

In the dispersion loop, if only `u = 0` were active the mask would be `(0, 0, 1)` and `accumulated / max(weight, 1e-6)` would divide R and G by `1e-6` → **red and green forced to black**, i.e. a solid blue rim. The Metal code prevents this structurally: the `spread < 2.0` early-out (`:204`) means `maxI = min(spread, 16) >= 2` (`:212`), so `u` takes at least the values 0, 0.5 and 1.0, giving weights `(2, 1, 2)`.

The AGSL version rescales that threshold to `2.0 * unitScale` and rescales `maxI` by `dispersionTapSpacing`. The invariant survives **iff `dispersionTapSpacing <= unitScale`** — then `spread / spacing >= 2 * unitScale / unitScale = 2`. Two rules follow, both enforced by comment in §4.1:

* `dispersionTapSpacing <= unitScale` (so the `high` tier's `1.0` is safe on any density ≥ 1);
* `kDispersionTaps >= 3` (so indices 0, 1, 2 exist when `maxI == 2`).

Violate either and you get a blue fringe on every glass edge. Keep the `max(weight, 1e-6)` backstop regardless.

**P9 — The coordinate-space origin is not contractually specified.**

Skia's runtime-shader image filter has, across versions, passed `main`'s coordinate in either the node's local space or the filter's device-space origin. Kyant's explicit `offset` uniform (`Lens.kt:46`) exists precisely to absorb this. **Validate empirically on first bring-up** with a throwaway shader:

```glsl
uniform float2 size;
half4 main(float2 c) {
    return half4(c.x / size.x, c.y / size.y, 0.0, 1.0);
}
```

Expect a clean red-green ramp with black at the node's top-left. If the ramp is offset or wrapped, adjust `offset` — everything else in the port is then correct by construction.

**P10 — `content.eval()` filtering is not guaranteed linear.**

For a `RenderEffect` chain input Skia uses linear sampling, which matches `mag_filter::linear, min_filter::linear` (`:91-93`). But if the backdrop is ever routed through `RuntimeShader.setInputShader` with a `BitmapShader`, the default filter mode is **nearest**, and the refraction will alias into visible stair-stepping along the curved edges. Call `BitmapShader.setFilterMode(BitmapShader.FILTER_MODE_LINEAR)` (API 31+).

**P11 — Do not use `layout(color)` for `tintColor` / `frostColor`.**

`layout(color)` invokes Skia's colour management, converting the supplied `Color` into the destination working space. On a standard sRGB window that is near-identity, but on a wide-gamut or HDR window it silently shifts the tint and frost relative to iOS, which does all of its blending in raw `bgra8Unorm` gamma space (`GlassRenderContext.swift:70`). Plain `uniform float4` + `setFloatUniform` passes values through untouched, matching `UIColor.getRed(...)` (`LiquidGlassView.swift:488-498`).

**P12 — `RuntimeShader` construction throws on any compile error**, with the full SkSL error log in the `IllegalArgumentException` message. Because the shader source is string-interpolated per tier (§5.4), a bad interpolation only fails at runtime on the device that selects that tier. **Compile all tier variants once at module init** — constructing a `RuntimeShader` is cheap and does no GPU work — so a broken variant fails loudly and immediately rather than on one specific user's phone.

---

## 7. Summary of decisions

| Question | Decision |
|---|---|
| Does the glass pass need two textures? | **No** — verified single `texture2d` at `LiquidGlass.metal:180-182` and a single `source` binding at `GlassRenderer.swift:145-152`. One `uniform shader content;`. |
| Keep the blur shader? | **No** — use `RenderEffect.createBlurEffect` with `R = 0.866 * (blurRadiusPx - 1)`. Better than iOS at large σ, identical at small σ, and off by default (G3). An AGSL fallback is provided in §4.3 if bug-for-bug parity is mandated. |
| Coordinate space | Device pixels, padded-node-local, with `offset = (-P, -P)` and an explicit `sampleBounds` clamp. All dp props multiplied by density on the Kotlin side. |
| `fwidth` | Replaced by the constant `aa = 1.0` — exact, because the SDF is unit-gradient and we work in pixels. |
| Precision | **Zero `half` declarations.** `float` / `vec*` throughout; the only `half` touchpoints are `main`'s required return type and `content.eval()`'s return, both handled with explicit constructors at the boundary (§6-P5). |
| Dispersion taps | 16 → **8** by default. Lossless at `.regular` defaults (6 dp ⇒ 7 taps), −2 taps at `.clear`. The tap count is baked into the source string; one cached `RuntimeShader` per tier. |
| Vertex stage | Deleted — AGSL has none. `main(float2 coord)` replaces the interpolated `VertexOut`. |
| Uniform layout | `constant GlassParams&` (36 floats, one upload) → 21 individual uniforms (35 floats, 21 JNI calls). Re-upload only on change; pack into `float4`s only if profiling demands it. |
| Biggest remaining risk | The 4.9× padded-node overdraw (§5.3-1) and full-screen glass (§5.3-2). Clip to the view rect + 2 px, and auto-downgrade above 25 % screen coverage. |
| Attribution | Apache-2.0 notice for AndroidLiquidGlass © 2025 Kyant, scoped to the four items enumerated in §4.4. Two Kyant bugs deliberately not copied. |

Three iOS behaviours are worth flagging to the product side while the port is open, since they read as quirks rather than intent:

1. `dispersionHeight` defaults to the *refraction* height (G12, `LiquidGlassView.swift:259`);
2. `blur` defaults to 0 for both variants, so the documented blur is entirely opt-in (G3, `GlassVariant.swift:37`, `:52`);
3. the iOS blur's sparse tap spacing at large radii (§3.5), which the Android port silently fixes by delegating to Skia.
