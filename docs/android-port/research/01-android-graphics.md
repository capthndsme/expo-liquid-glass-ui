# Android Graphics Capabilities for a "Liquid Glass" View

**Scope:** what it takes to reproduce `ios/Shaders/LiquidGlass.metal` (256 lines: separable Gaussian blur pass → SDF rounded-rect refraction + 16-tap chromatic dispersion + angular specular + tint/frost/noise) on Android for React Native / Expo. The view must sample the content *behind* it in an arbitrary React Native view hierarchy, blur it, apply a rounded-rect SDF refraction/lens distortion with chromatic dispersion and an angular specular highlight, and composite a tint on top — matching the Metal-based iOS implementation.

Repo context: `/home/captainhandsome/projects/expo-liquid-glass-view` currently has `expo-module.config.json` → `"platforms": ["apple"]` and **no `android/` directory**. Example app is Expo SDK 56 / RN 0.85 and depends on `react-native-video@^6.16.1` — so video-behind-glass is in scope (see §5).

Everything below is verified against AOSP source, Skia source, or the Xamarin/.NET `android.jar`-generated bindings (which carry exact `ApiSince` metadata). Items I could not confirm are marked **UNVERIFIED**.

---

## 0. API-level cheat sheet (all verified)

| API | Android | Symbol |
|---|---|---|
| 24 | 7.0 | `PixelCopy.request(Surface\|SurfaceView, Bitmap, listener, handler)` |
| 26 | 8.0 | `PixelCopy.request(…, Rect srcRect, …)`; `PixelCopy.request(Window, …)` |
| **29** | **10** | **`RenderNode`**, `RecordingCanvas`, `Canvas.drawRenderNode`, `Canvas.enableZ()/disableZ()`, `ViewTreeObserver.registerFrameCommitCallback`, `HardwareRenderer` |
| **31** | **12** | **`RenderEffect`** + `createBlurEffect` / `createChainEffect` / `createColorFilterEffect` / `createOffsetEffect` / `createBitmapEffect` / `createBlendModeEffect` / `createShaderEffect`; `View.setRenderEffect`; `RenderNode.setRenderEffect`; `Shader.TileMode.DECAL`; window blur (`setBlurBehindRadius`) |
| 32 | 12L | No new API, but `RenderNode` invalidation is materially more reliable than 31 |
| **33** | **13** | **`RuntimeShader`** (ctor + all `set*Uniform` / `setInputShader` / `setInputBuffer`), **`RenderEffect.createRuntimeShaderEffect`** |
| 34 | 14 | `HardwareBufferRenderer`; `PixelCopy.Request.Builder` / `PixelCopy.request(Request, Executor, Consumer<Result>)` |
| 35 | 15 | No RenderEffect/RuntimeShader changes. ANGLE ships as GL system driver on more devices (new divergence source) |
| 36 | 16 | `RuntimeColorFilter`, `RuntimeXfermode`, `RuntimeShader.setInputColorFilter`/`setInputXfermode`, gated `@FlaggedApi(FLAG_RUNTIME_COLOR_FILTERS_BLENDERS)` |

**Hard floor for the real effect: API 33.** Every Android liquid-glass library in existence lands on the same floor, because AGSL is the only way to run a custom fragment shader inside HWUI. `RuntimeShader` existed at API 31 but was `@hide` (SystemUI's `RippleShader` used it — see the API-31 crash at https://issuetracker.google.com/issues/283693347).

Sources: [RenderNode](https://learn.microsoft.com/en-us/dotnet/api/android.graphics.rendernode?view=net-android-35.0) (`ApiSince=29`), [RenderEffect](https://learn.microsoft.com/en-us/dotnet/api/android.graphics.rendereffect?view=net-android-35.0) (`ApiSince=31`), [RuntimeShader](https://learn.microsoft.com/en-us/dotnet/api/android.graphics.runtimeshader?view=net-android-35.0) (`ApiSince=33`), [createRuntimeShaderEffect](https://learn.microsoft.com/en-us/dotnet/api/android.graphics.rendereffect.createruntimeshadereffect?view=net-android-35.0) (`ApiSince=33`), [createBlurEffect](https://learn.microsoft.com/en-us/dotnet/api/android.graphics.rendereffect.createblureffect?view=net-android-35.0) (`ApiSince=31`).

---

## 1. `RenderNode` as a backdrop source

### Yes — and it is the correct mechanism.

`RenderNode` is public API **29**. Canonical pattern from the class javadoc:

```java
RenderNode renderNode = new RenderNode("myRenderNode");
renderNode.setPosition(0, 0, 50, 50);
RecordingCanvas canvas = renderNode.beginRecording();
try { canvas.drawRect(...); } finally { renderNode.endRecording(); }
```

```java
protected void onDraw(Canvas canvas) {
    if (canvas.isHardwareAccelerated()) {
        if (!myRenderNode.hasDisplayList()) updateDisplayList(myRenderNode);
        canvas.drawRenderNode(myRenderNode);
    }
}
```

**Hardware acceleration is mandatory.** Javadoc: *"RenderNodes can be drawn using a `RecordingCanvas`. **They are not supported in software.** Always make sure that the Canvas you are using to render a display list is hardware accelerated."* And `Canvas.drawRenderNode` (API 29): *"This is only supported in hardware rendering… If `isHardwareAccelerated()` is false then this throws an exception."*

`RecordingCanvas.isHardwareAccelerated()` returns `true` unconditionally (AOSP `RecordingCanvas.java`), so anything you record is on a HW canvas.

**Threading:** *"RenderNode may be created and used on any thread but they are not thread-safe. Only a single thread may interact with a RenderNode at any given time. It is critical that the RenderNode is only used on the same thread it is drawn with."* → UI thread for our case.

### Recording the hierarchy: use `dispatchDraw`, not `rootView.draw()`

The zero-cost pattern (this is what Dimezis BlurView 3.x does, and it is the single most important structural finding):

```java
// inside a provider ViewGroup's dispatchDraw — this IS its real render pass
renderNode.setPosition(0, 0, getWidth(), getHeight());
RecordingCanvas rc = renderNode.beginRecording();
super.dispatchDraw(rc);      // framework does all the work
renderNode.endRecording();
canvas.drawRenderNode(renderNode);   // and this is what actually goes on screen
```

BlurView's own docs on the cost: *"The View snapshotting has basically zero overhead… The RenderNode snapshot is automatically updated whenever the View hierarchy changes, there's 0 additional `invalidate()` or `draw()` calls."* Recording is display-list capture, not rasterization; unchanged children just re-reference their existing RenderNodes.

⚠️ **Caveat:** `dispatchDraw` is step 4 of `View.draw()`. The provider's own `background` (step 1), `onDraw` (step 3) and foreground/scrollbars (step 6) are **not** in the recording. This is exactly why BlurView exposes `setFrameClearDrawable(decorView.getBackground())`.

### `RecordingCanvas` restrictions

Contrary to a common assumption, **there is no large list of throwing ops**. AOSP `RecordingCanvas.java` overrides exactly one method to throw:

```java
@Override public void setBitmap(Bitmap bitmap) { throw new UnsupportedOperationException(); }
@Override public boolean isOpaque() { return false; }
@Override public boolean isHardwareAccelerated() { return true; }
@Override public void setDensity(int density) { /* drop silently */ }
```

The real constraints come from HWUI generally ([hardware-accel guide](https://developer.android.com/topic/performance/hardware-accel)):

- `clipPath()` / `clipRegion()` — supported since **API 18**. Fine.
- Genuinely unsupported at any level: `Paint.setLinearText()`, `Paint.setMaskFilter()`.
- `Canvas.drawPicture()` API 23+, `drawVertices()` API 29+, `Paint.setPathEffect()` for lines API 28+.
- **`Bitmap.Config.HARDWARE` cannot be drawn to a *software* canvas** — BlurView had to wrap its whole software snapshot in try/catch for this. Not an issue on a RecordingCanvas.
- **No pixel readback.** A RenderNode is a display list, not pixels. There is no `getPixels` analogue. This kills the iOS `digest()`/`isEmpty()` approach directly (see §7).

`beginRecording()` throws `IllegalStateException` if *that node* is already recording. Recording different nodes concurrently is normal and safe (it's how the entire View system works).

### Children with their own `RenderEffect` or layer type

- `View.setRenderEffect()` delegates to the view's **backing RenderNode**. Descendants go through `ViewGroup.dispatchDraw` → `drawChild` → `child.draw(Canvas, ViewGroup, long)` → `drawRenderNode(child.mRenderNode)`, so **descendant RenderEffects are honoured** in your recording. The *provider's own* RenderEffect is not (you never draw the provider's node).
- **This is a feedback-loop hazard.** If a liquid-glass view ends up inside the recorded subtree, its own `RenderEffect` — which samples the very node being recorded — creates a cyclic render tree. `@sbaiahmed1/react-native-blur` documents the exact crash: *"transitively references the glass view's own RenderNode, forming a cyclic render tree that stack-overflows the render thread in `RenderNode::prepareTreeImpl`."*
- `LAYER_TYPE_HARDWARE` on a child is just `renderNode.setUseCompositingLayer(true, paint)` on modern HWUI → composes correctly in a recording.
- `LAYER_TYPE_SOFTWARE` child → drawing-cache bitmap + paint, recorded as a `drawBitmap`. Works.
- ⚠️ `setLayerType` on the **glass view itself** is unsupported. BlurView maintainer (#264): *"apart from forcing software rendering, [it] also renders the BlurView into a Bitmap snapshot… this breaks the automatic update mechanism and effectively always renders a static snapshot. The same actually happens with `LAYER_TYPE_HARDWARE` — it's a Layer snapshotting problem, not the software path."*

---

## 2. `RenderEffect` + `RuntimeShader` (AGSL)

### `createRuntimeShaderEffect(shader, uniformShaderName)` — API 33

Javadoc: *"Create a RenderEffect that executes the provided RuntimeShader and passes the contents of the RenderNode that this RenderEffect is installed on as an input to the shader. @param uniformShaderName the uniform name defined in the RuntimeShader's program to which the contents of the RenderNode will be bound."*

```glsl
uniform shader content;          // bound by createRuntimeShaderEffect(shader, "content")
half4 main(float2 fragCoord) {
    return content.eval(fragCoord);
}
```

**Coordinate space:** `RuntimeShader` class javadoc — *"the function receives as an input parameter the position of the pixel within the `Canvas` or `RenderNode` coordinate space (similar to gl_FragCoord)… AGSL matches the screen coordinate system of the Android Canvas which has its origin as the **upper left corner**… the coordinates provided as a parameter in the main function are **local to the canvas**."* Units are **pixels, not normalized UVs** — unlike Metal. Y-down, matching Metal's convention here.

> ⚠️ **Verify empirically before building on it.** Whether the origin passed to `main()` for a `RenderNode`-installed effect is the node's local `(0,0)` (i.e. `setPosition().left/top`) or the device-space origin at draw time is **not documented anywhere I could find**. Every mature implementation (haze, Kyant0, Abdullajon) sidesteps the question by passing explicit `size`/`offset` uniforms rather than trusting the origin. **Do the same, and calibrate with a one-pixel test shader on day one.**

### 🔴 The single most important finding: sampling outside the node bounds returns **transparent black**

Android's native binding (AOSP `libs/hwui/jni/RenderEffect.cpp:155`) calls:

```cpp
SkImageFilters::RuntimeShader(*builder, name.c_str(), nullptr)   // 3-arg overload
```

and Skia's 3-arg overload ([`SkImageFilters.h:402-406`](https://api.skia.org/SkImageFilters_8h_source.html)) is:

```cpp
static sk_sp<SkImageFilter> RuntimeShader(const SkRuntimeShaderBuilder& builder,
                                          std::string_view childShaderName,
                                          sk_sp<SkImageFilter> input) {
  return RuntimeShader(builder, /*sampleRadius=*/0.f, childShaderName, std::move(input));
}
```

In `SkRuntimeImageFilter.cpp`, `sampleRadius` is the **only** thing that outsets the required-input bounds (`applyMaxSampleRadius(mapping, desiredOutput)` in both `onFilterImage` and `onGetInputLayerBounds`). With `sampleRadius = 0`, Skia guarantees the child image covers **exactly the output bounds and nothing more**, and image filters pad outside the crop with **transparent black** (`kDecal` default).

The `sampleRadius` parameter exists precisely to solve this problem — its doc says: *"If greater than 0, the coordinate passed to childShader.eval() will be up to 'sampleRadius' away… from the coordinate passed into the runtime shader. **This allows Skia to provide sampleable values for the image filter without worrying about boundary conditions.**"* **Android never sets it.**

**Consequences for our shader:**

- A multi-tap blur written in AGSL will suck in transparent black near the node edges → dark halo.
- Refraction offsets (`refractedPixels()` pushes up to `refractionAmount` px inward/outward) and the 16-tap tangential dispersion sweep will read transparent black wherever they leave the node.
- `clamp()`-ing coords in-shader (as the Metal version does with `clamp(texUV, 0, 1)`) only smears edge pixels; it does not recover content.

**The fix — pad the node.** The node carrying the RuntimeShaderEffect must be larger than the glass rect by the maximum sample distance, and the shader must draw the glass shape inset within it. This mirrors the iOS `glassBackdropPadding` exactly:

```swift
// ios/Glass/GlassSurfaceView.swift:133
var glassBackdropPadding: CGFloat {
    let refraction = refractionAmount + dispersionAmount
    let blur = blurRadius > 0.01 ? max(blurRadius * 1.5, 16) : 0
    return (max(refraction, blur) + 2).rounded(.up)
}
```

Abdullajon1881/LiquidGlass independently arrives at the same number: `inflate = 2*blur + |refractionAmount| + 4px`.

⚠️ **Edge behaviour is not even stable across devices.** Skia has an optimization (`getAnalyzedShaderView`, `SkImageFilterTypes.cpp:1410-1431`) that can promote decal→clamp when the input image happens to cover the destination. So out-of-bounds reads may be transparent black *or* clamped depending on Skia version and geometry. **Do not rely on either — clamp taps explicitly in-shader against a `uniform vec4 crop` and renormalize weights, *in addition to* padding the node.**

### `createChainEffect(outer, inner)` — API 31

Javadoc: *"Create a RenderEffect that composes 'inner' with 'outer', such that the results of 'inner' are treated as the source bitmap passed to 'outer', i.e. **result = outer(inner(source))**. Consumers should favor explicit chaining of RenderEffect instances at creation time rather than using chain effect."* Native impl is `SkImageFilters::Compose(outer, inner)`.

So for our pipeline: `createChainEffect(runtimeShaderEffect, blurEffect)` → glass shader receives blurred content in its `uniform shader`. That is a direct structural match to the iOS two-pass (`GlassBlurH`/`GlassBlurV` → `GlassComposite`).

### `createBlurEffect` — API 31, both overloads require a `TileMode`

```java
createBlurEffect(float radiusX, float radiusY, Shader.TileMode edgeTreatment)
createBlurEffect(float radiusX, float radiusY, RenderEffect inputEffect, Shader.TileMode edgeTreatment)
```

`edgeTreatment` = *"Policy for how to blur content near edges of the blur kernel."* JNI passes it straight through: `static_cast<SkTileMode>(edgeTreatment)` — 1:1 with Skia's enum.

- **CLAMP** — replicate edge colour outside original bounds. No transparent fringe; smears edge pixels.
- **DECAL** (API 31) — *"transparent black is drawn instead"* outside bounds. **This is the source of "edges go transparent."**
- **MIRROR** / **REPEAT** — seam-free / tiled.

Use `TileMode.isSupported()` — unsupported modes silently fall back to `CLAMP`.

**Radius→sigma:** native calls `Blur::convertRadiusToSigma()` (AOSP `libs/hwui/utils/Blur.cpp`):

```cpp
static const float BLUR_SIGMA_SCALE = 0.57735f;
float Blur::convertRadiusToSigma(float radius) { return radius > 0 ? BLUR_SIGMA_SCALE * radius + 0.5f : 0.0f; }
float Blur::convertSigmaToRadius(float sigma)  { return sigma > 0.5f ? (sigma - 0.5f) / BLUR_SIGMA_SCALE : 0.0f; }
```

The iOS shader uses `sigma = radius * 0.5`. **To match: `androidRadius = (iosRadius*0.5 - 0.5) / 0.57735`.**

Skia progressively downsamples internally for large sigma, so you do **not** need your own downsample pass. BlurView's maintainer confirms: *"on API 31+ the RenderEffect already internally scales the snapshot when needed, so passing a blur radius of 20 and scale factor of 3 is the same as passing a blur radius of 60 and scale factor of 1."* No clamping constant found in AOSP — **UNVERIFIED** whether a hard max radius exists.

🔴 **`createBlurEffect(0f, 0f, …)` throws `IllegalArgumentException: nativePtr is null`** — [b/241546169](https://issuetracker.google.com/issues/241546169), status *Not started*. Compose works around it internally by substituting `createOffsetEffect(0,0)`. We call the platform API directly, so **we must guard `radius > 0` ourselves.** (Same crash expo-blur guards against.)

### `View.setRenderEffect` vs `RenderNode.setRenderEffect` — both API 31

Identical javadoc modulo the noun. `RenderNode.setRenderEffect` returns `boolean` ("True if the value changed"). The View version applies to the view's backing RenderNode.

**`View.setRenderEffect` is the wrong tool for us.** Per Chet Haase, [*RenderNode for Bigger, Better Blurs*](https://medium.com/androiddevelopers/rendernode-for-bigger-better-blurs-ced9f108c7e2): *"RenderEffect applies to the **entire** view; there is no way to crop the effect to just a portion of the view."*

Compose's `Modifier.blur` KDoc states the transparent-edge consequence outright: *"Because the blurred content renders a larger area by the blur radius, this layer is explicitly clipped to the content bounds. It is recommended [to] introduce additional space around the drawn content by the specified blur radius to remain within the content bounds."*

Use a standalone `RenderNode` you size and position yourself — that is precisely how you get the padding from the previous section:

```kotlin
blurNode.setRenderEffect(RenderEffect.createBlurEffect(30f, 30f, Shader.TileMode.CLAMP))
blurNode.setPosition(0, 0, width, 100)
blurNode.translationY = height - 100f
val blurCanvas = blurNode.beginRecording()
blurCanvas.translate(0f, -(height - 100f))
blurCanvas.drawRenderNode(contentNode)
blurNode.endRecording()
canvas.drawRenderNode(blurNode)
```

---

## 3. AGSL language limits

Authoritative source: [AGSL quick reference](https://developer.android.com/develop/ui/views/graphics/agsl/agsl-quick-reference) and [AGSL vs GLSL](https://developer.android.com/develop/ui/views/graphics/agsl/agsl-vs-glsl). **AGSL fixes its feature set at GLSL ES 1.0** (OpenGL ES 2.0) "to provide for maximum device reach."

**Entry point:** `half4 main(float2 fragCoord)`. Both `vec4 main(vec2 …)` and `half4 main(float2 …)` spellings are accepted; `float2`≡`vec2`, `float3x3`≡`mat3`. Return value **must be premultiplied**: *"If your AGSL shader will return transparent colors, be sure to multiply the RGB by A."* The iOS shader already does `float4(color * alpha, alpha)` — direct port. ✔

**Loops — the good news for our 16-tap dispersion:**

> *"Similar to GLSL ES 1.0, 'for' loops are quite limited; the compiler must be able to unroll the loop. This means that the initializer, the test condition, and the `next` statement must use constants so that everything can be computed at compile time. The `next` statement is further limited to using `++, --, +=, or -=`."*

`break` and `continue` **are** allowed. So the iOS pattern ports verbatim:

```glsl
const int kDispersionTaps = 16;
for (int i = 0; i < kDispersionTaps; ++i) {
    float u = float(i) / maxI;
    if (u > 1.0) break;      // legal — dynamic break inside a constant-bound loop
    ...
}
```

⚠️ **But the early `break` does not shrink the program** — the loop is still unrolled to its constant trip count, so the constant *is* your program size and compile cost. This is the shipped `haze` idiom (`const int maxRadius = 150; for (int i = 1; i <= maxRadius; i++) { if (float(i) > radius) break; … }`, commented *"We need to use a constant max size [for] Skia to know the size of the program. We use a large number, along with a break."*). A 16-tap dispersion loop with an early break is entirely fine and cheap.

**Not supported:** `while`, `do-while`, recursion, `discard`, `#define`/any preprocessor (use `const` — the compiler constant-folds and eliminates dead branches).

**🔴 `fwidth`, `dFdx`, `dFdy` are NOT available.** The iOS shader depends on this:

```metal
float aa = max(fwidth(g.sd), 1e-4);
float shapeAlpha = 1.0 - smoothstep(-aa, aa, g.sd);
```

Since `sd` is in **pixel** units and AGSL's `fragCoord` is also in pixels, the SDF changes ~1 unit per pixel, so `aa = 1.0` is a correct and cheap substitute:

```glsl
float shapeAlpha = 1.0 - smoothstep(-1.0, 1.0, g.sd);
```

This is exactly what Kyant0 and Abdullajon both do (`mask = 1 - smoothstep(-1, 1, sd)`), and it doubles as the antialiased clip so you need no `clipPath`. For an SDF built from a normalized/scaled space, pass the analytic Jacobian scalar as a uniform instead. Do **not** try to reconstruct derivatives from neighbouring `eval()` calls — the child is not the SDF.

**Types:** `bool/int/float` + `2/3/4` vectors; `half`/`short` = `mediump`; `mat2/3/4` ≡ `float2x2/3x3/4x4`; `half2x2`… `lowp` is silently promoted to `mediump`. Swizzles support `.xyzw`, `.rgba`, **`.LTRB`** (rect), and constants: `vect.rgb1 == vec4(vect.rgb, 1)`. Structs global-scope only. Variable declarations must be in braced scope (`if (c) int y = 0;` is an error).

**Arrays:** 1-D only, explicit size. *"Arrays cannot be returned from a function, copied, assigned or compared… Arrays can only be indexed using a constant or a loop variable."*

**Built-ins present** (all of which the Metal shader uses): `sin cos atan(y,x) atan(x) pow exp exp2 log log2 sqrt inversesqrt abs sign floor ceil fract mod min max clamp saturate mix step smoothstep length distance dot cross normalize faceforward reflect refract matrixCompMult inverse` + relational `lessThan/any/all/not` + `unpremul toLinearSrgb fromLinearSrgb`. Note Metal's `atan2(y,x)` → AGSL `atan(y,x)`. ✔

**Sampling:** no sampler types. *"Sampler types aren't supported, but you can evaluate other shaders… you can directly evaluate any Android Shader without turning it into a Bitmap first, including other RuntimeShader objects."* Syntax `image.eval(coord)`. **BitmapShader coordinates are NOT normalized** — *"(0,0) in the upper-left corner, and (width, height) in the bottom-right."*

**Arbitrary-offset sampling:** `content.eval(coord + delta)` is syntactically fine and is how everyone does multi-tap work. The constraint is *bounds*, not syntax — see §2's `sampleRadius = 0` finding.

**Multiple `uniform shader` inputs:** the language allows any number, bound via `setInputShader(name, shader)`. **But `createRuntimeShaderEffect` binds exactly one.** haze hit this and worked around it: *"The `RuntimeShaderLiquidGlassDelegate` now uses an expect/actual factory so that Android receives a single-input shader, avoiding the single-content-input limitation of `RenderEffect.createRuntimeShaderEffect`."* See §11 for how the other inputs *can* still be bound (resolved).

**`layout(color)`:** *"AGSL doesn't know if uniform variables contain colors… you can label your vec4 uniform with the `layout(color)` qualifier which lets Android know that the uniform will be used as a color. Doing so allows AGSL to transform the uniform value to the working color space."* Must be set with `setColorUniform`, on `vec3`/`vec4` only; supplied colours are unpremultiplied sRGB. **Recommendation: do NOT use `layout(color)` for `tintColor`/`frostColor`.** The iOS shader uses `.a` as a mix factor, not as alpha, and colour-space conversion would silently shift the result. Use plain `uniform vec4` + `setFloatUniform`.

**Uniform setters** (all API 33): `setFloatUniform(name, f[, f, f, f])`, `setFloatUniform(name, float[])` for `mat2/3/4` and arrays, `setIntUniform(...)`, `setColorUniform(name, int|long|Color)`, `setInputShader(name, Shader)`, `setInputBuffer(name, BitmapShader)` (no colour-space transform, no auto-premultiply — right choice for noise/normal maps). Uninitialized primitive uniforms default to 0; uninitialized colour/shader uniforms are **undefined**.

**Precision:** `half` = `mediump`. **Keep `fragCoord` and all SDF math in `float`/`highp`** — a 1440p device has coordinates up to ~3200, and `mediump` (10-bit mantissa) resolves only ~2048 exactly. Use `half` only for final colour. See §11 for the confirmed production failure this causes.

**Colour management:** working colour space is the destination's, set by `Window#setColorMode`. Provide `toLinearSrgb`/`fromLinearSrgb` around the specular math if you want to match Metal's linear-space lighting.

**Compile errors:** `new RuntimeShader(src)` throws `IllegalArgumentException` carrying the SkSL compiler log. **Construct once, at init, off the draw path.** See §11 for the four distinct throw sites and the silent-driver-failure hazard.

**Uniform-update hazard.** Chet Haase, [*AGSL: Made in the Shade(r)*](https://medium.com/androiddevelopers/agsl-made-in-the-shade-r-7d06d14fe02a): *"there is a bug in the current releases which I discovered… the View does not pick up any changes to uniform values without setting a new RenderEffect."* §11 explains why this is architectural rather than a bug, and what the correct pattern actually is.

**Device/driver gotchas:** see §11 — there is one confirmed, reproducible vendor failure (`half` precision on Samsung/Xiaomi) and several platform bugs.

---

## 4. Multi-pass structure

iOS does: capture → ping/pong separable blur into an intermediate → glass pass sampling it. Android equivalents, ranked:

### ✅ (a)+(b) — Chained RenderEffects on a padded RenderNode. **This is the answer.**

```kotlin
// provider (a ViewGroup) — records its children, zero extra cost
override fun dispatchDraw(canvas: Canvas) {
    if (canvas.isHardwareAccelerated) {
        contentNode.setPosition(0, 0, width, height)
        val rc = contentNode.beginRecording()
        super.dispatchDraw(rc)
        contentNode.endRecording()
        canvas.drawRenderNode(contentNode)
    } else super.dispatchDraw(canvas)
}

// glass view onDraw
val pad = ceil(max(refractionAmount + dispersionAmount, if (blur > 0) max(blur*1.5f, 16f) else 0f) + 2f)
glassNode.setPosition(0, 0, (w + 2*pad).toInt(), (h + 2*pad).toInt())
val rc = glassNode.beginRecording()
rc.translate(pad - relX, pad - relY)          // align provider content under us
rc.drawRenderNode(contentNode)
glassNode.endRecording()

val prep  = RenderEffect.createColorFilterEffect(saturationFilter,
              RenderEffect.createBlurEffect(rAndroid, rAndroid, Shader.TileMode.CLAMP))
glassNode.setRenderEffect(RenderEffect.createChainEffect(shaderEffect, prep))  // shader(prep(src))

canvas.save(); canvas.clipRect(0f, 0f, w.toFloat(), h.toFloat())
canvas.translate(-pad, -pad)
canvas.drawRenderNode(glassNode)
canvas.restore()
```

- **API:** 29 for the nodes, 31 for blur/colour-filter, 33 for the shader.
- **Cost:** one offscreen layer per effect per frame, evaluated on the **RenderThread** (BlurView README: *"On API 31+ the blur is done on the system Render Thread"*). No CPU rasterization, no readback.
- **Intermediate sampleable?** Yes — that's the whole point of `createChainEffect`; the blur's output is what lands in the shader's `uniform shader`.
- The `padding` + `clipRect` combo is what makes the `sampleRadius = 0` problem go away.
- **Do not hand-write the Gaussian in AGSL.** Chet: *"the RenderEffect blur is going to be faster (it's highly optimized)"* than a shader box blur, and Skia's internal downsampling beats an 8-tap separable pass.
- haze's [ADR-0003](https://raw.githubusercontent.com/chrisbanes/haze/main/docs/adr/0003-use-one-android-fused-glass-renderer.md) reaches the same conclusion after Perfetto profiling a Pixel 6: **one fused renderer, one source layer, one retained output layer, one composed native RenderEffect DAG** — because the bottleneck is RenderThread *layer traversal*, not fragment work. They explicitly rejected nested layer stacks.

### ❌ (c) `HardwareRenderer` + `ImageReader`

API 29 (`HardwareRenderer`), 34 (`HardwareBufferRenderer`). Renders a RenderNode tree to a `Surface`. **Rejected:** javadoc warns *"All HardwareRenderer instances share a common render thread… if custom consumers are used such as `SurfaceTexture` or `ImageReader` it is the app's responsibility to consume updates promptly and rapidly. **Failure to do so will cause the render thread to stall on that surface, blocking all HardwareRenderer instances**."* You'd be adding a frame of latency and a stall risk to fix a problem (a) already solves.

### ❌ (d) GLSurfaceView / Vulkan

Would be a `SurfaceView`, i.e. a separate compositor layer that cannot see your window's content at all (§5) — the exact opposite of what we need. Also loses RN's clipping/z-order/alpha integration.

### Fallback ladder below API 33

| API | Capability |
|---|---|
| 33+ | full: blur + saturation + AGSL refraction/dispersion/specular |
| 31–32 | `createBlurEffect` + `ColorMatrix` saturation + `clipPath`/outline rounding + drawn rim + tint wash. **No refraction.** |
| 29–30 | live unblurred backdrop via RenderNode + translucent scrim |
| <29 | flat scrim (what `expo-blur` does by default today) |

This is exactly the tier split Abdullajon1881 uses (`GlassRenderTier.select(apiLevel, requested)`, where requests may only *lower* fidelity).

---

## 5. SurfaceView / TextureView / video

### SurfaceView: you will get a hole, on every capture path

AOSP `SurfaceView.java`: *"The surface is Z ordered so that it is **behind** the window holding its SurfaceView; the SurfaceView **punches a hole in its window** to allow its surface to be displayed."*

```java
@Override public void draw(Canvas canvas) {
    if (mDrawFinished && !isAboveParent()) {
        if ((mPrivateFlags & PFLAG_SKIP_DRAW) == 0) clearSurfaceViewPort(canvas);
    }
    super.draw(canvas);
}
private void clearSurfaceViewPort(Canvas canvas) { canvas.punchHole(0f, 0f, getWidth(), getHeight(), 0f, 0f, alpha); }
```

`punchHole` is on `BaseCanvas` **and** `BaseRecordingCanvas` (so it applies to `RecordingCanvas` too), and natively (`libs/hwui/SkiaCanvas.cpp:267`) it is `SkBlendMode::kDstOut` with black at the given alpha → **fully transparent rect**. Composited over anything opaque, that reads as **black**.

So `rootView.draw(canvas)` *and* `renderNode.beginRecording()` both record the punch-out. **Never video frames.**

- `setZOrderMediaOverlay(true)` → sublayer −1, still below the window → hole still punched. No change.
- `setZOrderOnTop(true)` → sublayer +1 → `isAboveParent()` true → **no hole**, but you capture the app content behind it, still not the video.
- `setSecure(true)` sets the `SurfaceControl.SECURE` layer flag → blocks SurfaceFlinger-mediated capture (screenshots, MediaProjection). Doesn't change hierarchy drawing.

### TextureView: captured on a hardware canvas, invisible on a software one

`TextureView.java` javadoc: *"TextureView **can only be used in a hardware accelerated window. When rendered in software, TextureView will draw nothing.**"* The `final draw()`:

```java
public final void draw(Canvas canvas) {
    mPrivateFlags = (mPrivateFlags & ~PFLAG_DIRTY_MASK) | PFLAG_DRAWN;
    if (canvas.isHardwareAccelerated()) {
        RecordingCanvas recordingCanvas = (RecordingCanvas) canvas;
        TextureLayer layer = getTextureLayer();
        if (layer != null) { applyUpdate(); applyTransformMatrix(); mLayer.setLayerPaint(mLayerPaint);
                             recordingCanvas.drawTextureLayer(layer); }
    }
}
```

→ **RenderNode recording captures TextureView content** (as a live layer reference, not a snapshot). A `new Canvas(bitmap)` capture gets **nothing**. Cost per the javadoc: *"TextureView contents must be copied, internally, from the underlying surface into the view displaying those contents"*; source.android.com adds *"every visible pixel is composited twice"* and recommends SurfaceView from API 24. Structurally ~1 extra frame of latency (**UNVERIFIED** as a documented number). No DRM.

> **This TextureView-vs-SurfaceView distinction is load-bearing.** It is the entire basis for the "require `viewType: 'textureView'` for video" recommendation. Any blanket claim that *"nothing behind SurfaceView/TextureView is capturable"* is wrong for TextureView on a hardware canvas.

### What the RN video libraries actually do

| Library | Default | Force TextureView |
|---|---|---|
| **expo-video** (SDK 57) | **`surfaceView`** — inflates `surface_player_view.xml` with `androidx.media3.ui.PlayerView app:surface_type="surface_view"` | `surfaceType="textureView"` — *"should not be changed at runtime"* |
| **expo-av** (legacy, removed) | TextureView (`VideoTextureView extends TextureView`), no option | n/a |
| **react-native-video v6** (what this repo uses) | `viewType: 'surfaceView'` | `viewType: 'textureView'`; also `'secureView'`. `useTextureView`/`useSecureView` deprecated. *"DRM playback is not supported on textureView."* |
| **react-native-video v7** | `surfaceType: 'surface'` | `surfaceType: 'texture'` (`SURFACE_SECURE` dropped) |

**Both major RN video libraries default to a configuration our capture cannot see.**

### PixelCopy

| Signature | API |
|---|---|
| `request(Surface\|SurfaceView, Bitmap, listener, handler)` | 24 |
| `request(Surface\|SurfaceView, Rect srcRect, Bitmap, listener, handler)` | 26 |
| `request(Window[, Rect], Bitmap, listener, handler)` | 26 |
| `request(PixelCopy.Request, Executor, Consumer<PixelCopy.Result>)` | 34 |

API-34 builder: `PixelCopy.Request.Builder.ofWindow(Window)` / `ofWindow(View)` / `ofSurface(Surface)` / `ofSurface(SurfaceView)`, then `.setSourceRect(Rect)` / `.setDestinationBitmap(Bitmap)` (null ⇒ auto ARGB_8888) / `.build()` (single-use). `Result.getStatus()` / `getBitmap()`.

**🔴 The `Window` overload does NOT capture SurfaceView content.** `PixelCopy.sourceForWindow()` resolves to `root.mSurface` — *your own window's* Surface — and `Readback::copySurfaceInto` grabs it with `ANativeWindow_getLastQueuedBuffer2`, i.e. the buffer HWUI produced, **not** a SurfaceFlinger composite. That buffer contains the punch-hole. To get video you must call `request(SurfaceView, …)` separately and composite yourself.

| Content behind | SW `Canvas` | HW `Canvas` / RenderNode | `PixelCopy(Window)` | `PixelCopy(SurfaceView)` |
|---|---|---|---|---|
| Ordinary views | ✔ | ✔ | ✔ | n/a |
| TextureView video | ✘ | **✔** | ✔ | n/a |
| SurfaceView video | ✘ hole | ✘ hole | ✘ hole | **✔** |
| DRM L1 / protected | ✘ | ✘ | ✘ | ✘ `ERROR_SOURCE_INVALID` |

Other PixelCopy facts: async on the RenderThread (doesn't block UI); reads the **last queued** buffer so it is ≥1 frame stale; `sync_wait` on the producer fence with a 500 ms timeout → `ERROR_TIMEOUT`; then a Skia `drawImageRect` + blocking `readPixels` GPU→CPU readback that forces a flush. Destination must be mutable and non-recycled (**hardware bitmaps are rejected** — they're immutable). Window overload requires a non-null DecorView that has drawn at least once — javadoc recommends pairing with an `OnDrawListener`; better, use `ViewTreeObserver.registerFrameCommitCallback` (API 29), whose own javadoc says it is *"useful in combination with `PixelCopy` to capture the current rendered content of the UI reliably."* Cost: Google publishes no numbers; community reports ~5–30 ms for a full-screen 1080p copy (**UNVERIFIED**) — **not viable per-frame at 60 Hz** unless you use `setSourceRect` + a small destination.

### Alternatives for video-behind-glass

- **PixelCopy on the SurfaceView, downscaled** (small `srcRect`, 1/8-scale dest) — no permission, no consent, and the downscale is half your blur anyway. Pragmatic if you must support SurfaceView.
- **MediaProjection** — captures the true composite (video included) but **requires user consent per session**; Android 14 forbids reusing the consent Intent or calling `createVirtualDisplay()` twice, and mandates a `mediaProjection` foreground service. Non-starter for a UI effect.
- **Own the Surface**: give ExoPlayer a `SurfaceTexture` you created. Full control, no readback; you take over scaling/rotation/lifecycle and lose DRM.
- **`ExoPlayer.setVideoEffects`** (media3 `@UnstableApi`) blurs *the video only*, can't see UI behind it, and *"does not work with DRM-protected content"*.
- **`ExoPlayer.setVideoFrameMetadataListener` gives you no pixels** — it's `(presentationTimeUs, releaseTimeNs, Format, MediaFormat)`. A timing signal, not a capture path.
- **🔵 Platform window blur** (`WindowManager.LayoutParams.setBlurBehindRadius`, API 31): the compositor blurs everything below your window, **including SurfaceView layers**, with zero readback and no permission. But it blurs behind a *window*, not a *view* — you'd have to host the glass in a separate translucent window. Also *"can be disabled at runtime, e.g. during battery saving mode, when multimedia tunneling is used or when minimal post processing is requested"* — listen via `addCrossWindowBlurEnabledListener`.

**Recommendation:** document `surfaceType="textureView"` / `viewType: 'textureView'` as the requirement for video-behind-glass, detect `SurfaceView` descendants at runtime and warn.

---

## 6. Excluding self from the capture — Dimezis/BlurView analysis

[Dimezis/BlurView](https://github.com/Dimezis/BlurView), Apache-2.0, ~4k★, current `version-3.2.0`. **Note:** `RenderEffectBlur.java` / `DeferredBlurController` no longer exist on master; 3.x replaced them with `RenderNodeBlurController`.

### Three paths

```java
if (BlurTarget.canUseHardwareRendering) {                     // API >= 31
    blurController = new RenderNodeBlurController(this, target, overlayColor, scaleFactor, applyNoise);
} else {
    algorithm = if (SDK_INT >= Q) OpenGLBlurAlgorithm() else RenderScriptBlur(context);
    blurController = new PreDrawBlurController(this, target, overlayColor, algorithm, scaleFactor, applyNoise);
}
```

### Self-exclusion: two mechanisms, and only one is good

**API 31+ — structural.** `BlurTarget` is a `FrameLayout` that records **its own children** in `dispatchDraw` (code in §1). The BlurView is a **sibling drawn after** the target, so it is simply never in the recording. No filtering, no marker, no recursion guard. README: *"The BlurTarget may not contain a BlurView that targets the same BlurTarget."* Maintainer on #251: *"this won't be fixed no matter how inconvenient it is. This is just the way the new API works."*

**API <31 — marker-canvas.** `class BlurViewCanvas extends Canvas` used purely as a type tag:

```java
// PreDrawBlurController.draw
if (canvas instanceof BlurViewCanvas) return false;   // -> BlurView.draw skips super.draw()
```

This drops the BlurView **and all its children** from the snapshot, breaking the `updateBlur → rootView.draw → BlurView.draw → updateBlur` recursion (issues #24, #110, #166 `StackOverflowError at ViewGroup.buildOrderedChildList`).

### `RenderNodeBlurController` (API 31+)

```java
private void drawSnapshot() {
    RecordingCanvas rc = blurNode.beginRecording();
    if (frameClearDrawable != null) frameClearDrawable.draw(rc);
    rc.drawRenderNode(target.renderNode);
    applyBlur();
    blurNode.endRecording();
}
private void applyBlur() {
    float r = blurRadius * scaleFactor;
    blurNode.setRenderEffect(RenderEffect.createBlurEffect(r, r, Shader.TileMode.CLAMP));
}
```

Then `canvas.clipRect(0,0,w,h); canvas.drawRenderNode(blurNode)`.

Key choices worth copying:

- **`blurNode` is target-sized, not BlurView-sized**, so the blur kernel samples real surrounding content — no mirrored-edge fakery (v2 used `TileMode.MIRROR` for exactly that reason). Same principle as our padding requirement.
- No manual downscale — Skia already downsamples.
- Cross-window guard: if `!target.renderNode.hasDisplayList()` the target hasn't drawn yet → `blurView.invalidate()` and retry.
- API-31-only workaround: `if (SDK_INT == S) applyBlur();` — *"blurNode doesn't get re-rendered on setting new translation/scale/rotation."*

### Transform math (`BlurViewTransform`)

`getLocationOnScreen()` gives the **visual** (post-transform) position; you need the **layout** position:

```java
float layoutLeft = visualLeft + pivotX * (scaleX * cosR - 1) - pivotY * scaleY * sinR;
float layoutTop  = visualTop  + pivotY * (scaleY * cosR - 1) + pivotX * scaleX * sinR;
```

Hardware path then counter-transforms via **RenderNode properties** rather than a canvas matrix:

```java
blurNode.setPivotX(blurView.getWidth()/2f  - layoutTranslationX);
blurNode.setPivotY(blurView.getHeight()/2f - layoutTranslationY);
blurNode.setTranslationX(layoutTranslationX);   // = -layoutLeft
blurNode.setTranslationY(layoutTranslationY);
blurNode.setScaleX(1f / t.scaleX);
blurNode.setScaleY(1f / t.scaleY);
blurNode.setRotationZ(-t.rotationDeg);
```

**Ancestor transforms are NOT compensated** — only the BlurView's own. Open bugs #242 (regression in 3.1.0), #183.

### 🔴 What naive `drawViewGroupChildren` gets wrong

`View` has three draw entry points; naive iteration picks the wrong one:

1. `public void draw(Canvas)` — "render yourself completely": background → onDraw → dispatchDraw → decorations. Applies **none** of the view's own transform/alpha/clip.
2. `boolean draw(Canvas, ViewGroup, long)` — internal, called only from `ViewGroup.drawChild`. **This is where transform, alpha, clipping, layers and shadows live.**
3. `ViewGroup.dispatchDraw(Canvas)` — builds the ordered child list, draws disappearing children + `ViewGroupOverlay`, applies scroll/padding clips.

Calling `child.draw(canvas)` in a loop skips **all** of 2 and 3, so you lose:

- **Transforms** — `translationX/Y/Z`, `scaleX/Y`, `rotation/rotationX/rotationY`, pivots, `setAnimationMatrix`, legacy `Animation` `Transformation`. Every running animation snaps to its start pose.
- **Alpha** — `setAlpha`, `Animation` alpha, `onSetAlpha` are applied by the parent (`saveLayerAlpha` / alpha-modulated hardware layer). Everything renders opaque.
- **Clipping** — `clipToPadding`, `clipChildren`, `setClipBounds`, `clipToOutline`, and the parent's `canvas.translate(-mScrollX, -mScrollY)`. A RecyclerView renders unscrolled and outside its bounds.
- **Z-order / elevation** — `buildOrderedChildList()` sorts by `getZ() = elevation + translationZ`; `getChildDrawingOrder()` is honoured (ViewPager, RecyclerView, CoordinatorLayout). Index order ≠ paint order. **Shadows are drawn by the parent** → naive capture is shadowless. Note also that `Canvas.enableZ()` (API 29) is a no-op on a software canvas, so a Bitmap capture loses Z-reordering and shadows even via the correct path.
- **Disappearing children & `ViewGroupOverlay`** — `getChildAt()` sees neither.
- **Hardware/software layers** — `setLayerPaint`'s ColorFilter/alpha/Xfermode is bypassed.
- **RenderNode-only content** — `RippleDrawable` (#185), `EdgeEffect` stretch overscroll (`RenderNode.stretch()`, and it's *stateful*: #234 *"when the BlurView requests the EdgeEffect to be drawn on a software canvas, it resets its state and cancels the overstretch animation"*), and Compose's `DrawStretchOverscrollModifier` which throws `IllegalArgumentException: Software rendering doesn't support drawRenderNode` (#223).
- **Compose** — rendering a `ComposeView` to an external canvas breaks recomposition entirely (#195, still open for <31).
- **Recursion** — `StackOverflowError`, or `IllegalStateException: Underflow in restore` from re-entrant traversal.

**BlurView's answer: never touch children.** Either one `rootView.draw(canvas)` call, or (better) let the provider record its real `super.dispatchDraw()`.

### Documented caveats worth inheriting

- *"TextureView can be blurred only on API 31+. Everything else (which is SurfaceView-based) can't be blurred."*
- Blur runs on the **main thread by design**: *"Because blurring on other threads would introduce 1-2 frames of latency."*
- *"The BlurView never invalidates itself or other Views in the hierarchy and updates only when needed. It supports multiple BlurViews on the screen without triggering a draw loop."*
- Rounded corners are DIY: `setOutlineProvider(BACKGROUND)` + `setClipToOutline(true)`.
- Overlapping blur views produce a visible seam (#225, won't fix). Blur "popping" as high-contrast content crosses the edge is *"a fundamental problem of this kind of approach"* (#161).
- `blurView.animate().rotation(...)` bypasses the setters — must hook `setUpdateListener` + `notifyRotationChanged`.
- **README says nothing about "don't blur while scrolling"** — that's folklore; the real scroll issues are #161/#257/#269.

---

## 7. Frame scheduling

### Use `ViewTreeObserver.OnPreDrawListener` on the **provider**, not Choreographer

| Mechanism | API | Fires | Verdict |
|---|---|---|---|
| `ViewTreeObserver.OnPreDrawListener` | 1 | Only when the tree is **actually about to draw** | ✅ **the right hook** — self-gating; if nothing invalidated, no callback, no work |
| `ViewTreeObserver.OnDrawListener` | 16 | About to draw; *"views cannot be modified in any way"* — no `invalidate()`/`requestLayout()` | ✗ too restrictive |
| `Choreographer.postFrameCallback` | 16 | Every vsync regardless of whether anything changed | ✗ burns power at idle; the iOS `CADisplayLink` analogue but wrong here |
| `View.postOnAnimation` | 16 | Next animation step (Choreographer `CALLBACK_ANIMATION`) | ✗ same problem |
| `ViewTreeObserver.registerFrameCommitCallback` | 29 | After the frame is submitted to the swap chain; *"useful in combination with PixelCopy"*; *"Only works with hardware rendering"* | ✅ **only** for the PixelCopy/video path |

BlurView registers on the target's VTO, plus the BlurView's own **only when they're in different windows** (dialog/bottom-sheet fix, #216), and always returns `true` (never cancels the frame).

### Avoiding the invalidation loop

Two distinct strategies, both from BlurView:

**(a) In-place mutation → never invalidate.** *"Not invalidating a View here, just updating the Bitmap. This relies on the HW accelerated bitmap drawing behavior in Android. If the bitmap was drawn on HW accelerated canvas, it holds a reference to it and on next drawing pass the updated content of the bitmap will be rendered on the screen."*

**(b) New resource each frame → invalidate + generation gate.**

```java
private boolean shouldUpdate() {
    if (blurAlgorithm.canModifyBitmap()) return true;
    int generation = rootView.contentGeneration;
    rootView.getLocationOnScreen(rootLocation);
    blurView.getLocationOnScreen(blurViewLocation);
    return forceNextCapture
        || generation != lastGeneration
        || left != lastLeft || top != lastTop
        || scaleX != lastScaleX || scaleY != lastScaleY || rotation != lastRotation;
}
```

`contentGeneration` is bumped in **both** `BlurTarget.dispatchDraw` *and* `onDescendantInvalidated` — critical, because a scrolling RecyclerView invalidates a descendant *without* re-running the parent's `dispatchDraw` (HWUI composes child render nodes directly). Sibling BlurView redraws don't bump it, which is what breaks the loop.

**In our architecture (RenderNode + RenderEffect) this problem largely evaporates**: the RenderNode is a live reference, so no `invalidate()` is needed for content changes at all. You only need to invalidate when *your own* uniforms change (position, size, interaction state).

### 🔴 The Android analogue of iOS's pixel-buffer hash: **there isn't one, and you don't need one**

`BackdropCapturer.digest()` (FNV-1a over every 97th pixel, `Tuning.digestStride = 97`) exists because `CALayer.render(in:)` unconditionally rasterizes into CPU memory. On Android with a RenderNode you never touch pixels, so there is nothing to hash — and the mechanism that made hashing necessary is gone.

The Android substitutes, in order of preference:

1. **The pre-draw callback itself is the change signal.** No draw pass ⇒ nothing changed ⇒ no callback. This subsumes iOS's `staleCaptures`/`idleStride` logic entirely.
2. **`ViewGroup.onDescendantInvalidated(View, View)`** (API 26) on the provider — catches descendant-only invalidations that don't re-run `dispatchDraw`. Combine into a monotonic `contentGeneration` counter.
3. **Geometry change detection** — `getLocationOnScreen` + scale/rotation, compared frame over frame (BlurView's `shouldUpdate`). This replaces iOS's `mustRefreshGeometry` / `movementMargin`.
4. **`RenderNode` setters return `boolean`** ("True if the value changed") — the platform's own idiom for "should I request a new frame". The javadoc explicitly recommends `needsUpdate |= node.setTranslationY(y); if (needsUpdate) view.invalidate();` and notes it *"minimizes JNI transitions"*.
5. Only if you genuinely need pixels (the PixelCopy/video path): `registerFrameCommitCallback` → `PixelCopy` → hash the small bitmap. Expensive; last resort.

Skydoves/Cloudy claims its equivalent *"parks at zero frames once it settles"* using approach 1.

**iOS features that have no Android counterpart and should be dropped:** the adaptive `strideFrames`/`captureCost` duty-cycle controller, the double-buffered `Slot` ring, and `isEmpty()`/`.compositedDraw` strategy switching. All of those exist to amortize a CPU rasterization cost that the RenderNode path doesn't incur.

---

## 8. Reference implementations

| Repo | Licence | ★ | Compose / View | Backdrop capture | Refraction API |
|---|---|---|---|---|---|
| [**Abdullajon1881/LiquidGlass**](https://github.com/Abdullajon1881/LiquidGlass) | Apache-2.0 | 0 | **Compose + View + Expo/RN** | RenderNode in `dispatchDraw` | 33+ |
| [Dimezis/BlurView](https://github.com/Dimezis/BlurView) | Apache-2.0 | 4036 | **View** | RenderNode 31+ / SW bitmap <31 | blur only |
| [Kyant0/AndroidLiquidGlass](https://github.com/Kyant0/AndroidLiquidGlass) | Apache-2.0 | 3153 | Compose only | `GraphicsLayer.record` | 33+ |
| [chrisbanes/haze](https://github.com/chrisbanes/haze) | Apache-2.0 | — | Compose only | `GraphicsLayer.record` | 33+ (`haze-glass`, 2.0.0-alpha04) |
| [skydoves/Cloudy](https://github.com/skydoves/Cloudy) | Apache-2.0 | 1249 | Compose | — | 33+ |
| [QmDeve/AndroidLiquidGlassView](https://github.com/QmDeve/AndroidLiquidGlassView) | MIT | 280 | **View** | `target.draw()` on RecordingCanvas ⚠️ | 33+ only |
| [Mortd3kay/liquid-glass-android](https://github.com/Mortd3kay/liquid-glass-android) | NOASSERTION | 180 | Compose | — | 33+ |

**`Abdullajon1881/LiquidGlass` is the closest existing precedent** — the only repo with Compose + classic Views + an Expo module in one tree. Zero stars, three days of commits, possibly largely generated: **treat as a design reference, never a dependency.** But its architecture is exactly right:

```kotlin
// liquidglass-view/.../BackdropRecorder.kt
if (SDK_INT >= 29 && canvas.isHardwareAccelerated && width > 0 && height > 0) {
    val node = contentNode ?: RenderNode("LiquidGlassBackdrop").also { contentNode = it }
    node.setPosition(0, 0, width, height)
    val recording = node.beginRecording(width, height)
    try { drawContent(recording) } finally { node.endRecording() }
    canvas.drawRenderNode(node)
} else drawContent(canvas)
for (consumer in consumers) consumer.postInvalidateOnAnimation()
```

```kotlin
// internal/GlassViewRenderer.kt — inflate = 2*blur + |refractionAmount| + 4px
val shaderEffect = RenderEffect.createRuntimeShaderEffect(shader, GlassUniforms.CONTENT)
return RenderEffect.createChainEffect(shaderEffect, prep)   // prep = blur -> ColorMatrix saturation
```

Its RN binding: `LiquidGlassProviderExpoView : ExpoView(), LiquidGlassBackdropSource`, paired by string `providerId` through a registry; the glass view **draws in its own `onDraw`** rather than wrapping a child, *"so React Native (Paper and Fabric) keeps full ownership of child mounting indices."* Its own doc states the invariant plainly: *"Glass must not live inside the provider subtree — it would draw the provider's layer into the very recording that produces it."*

**RN-specific precedents:**

- **`expo-blur` Android**: no `RenderEffect` of its own; delegates to `com.github.Dimezis:BlurView`. **JS default is `blurMethod: 'none'` = a fake semi-transparent overlay** with ARGB values from Apple's iOS 14 Sketch Kit. Real blur requires wrapping content in `<BlurTargetView>` (`ExpoBlurTargetView` proxies `addView`/`removeView`/`getChildAt` so RN children are genuinely parented under the Dimezis `BlurTarget`; `onLayout`/`requestLayout` are no-ops because RN's hierarchy manager owns layout). Breaking change in SDK 55. **Cannot cross an RN `Modal` boundary** — [expo/expo#44165](https://github.com/expo/expo/issues/44165) — because Modal is a separate native window. Docs also note *"blur fails to update when BlurView renders before dynamic content (e.g. FlatList) — render BlurView after."*
- **[`@sbaiahmed1/react-native-blur`](https://github.com/sbaiahmed1/react-native-blur)** (MIT, 322★, Fabric-only, most serious RN Android attempt): documents the cyclic-render-tree crash and works around it with a shared throttled software capture (`CAPTURE_DOWNSAMPLE = 3`, `BACKDROP_REFRESH_MS = 33`), excluding self on **both** `draw()` **and** `dispatchDraw()` — because a ViewGroup with nothing to paint gets `PFLAG_SKIP_DRAW` and `dispatchDraw` is called directly, bypassing a `draw()`-only guard. **Copy that detail.**
- **`@callstack/liquid-glass`**: iOS only; Android export is literally `export const LiquidGlassView = View`.
- **`uginy/react-native-liquid-glass`** (in `example/package.json`): **no licence file** — treat as all-rights-reserved. Captures **one static software screenshot** into a process-global bitmap of a heuristically-chosen view; it refracts a frozen frame. `ior`/`magnification` props are dead.
- **`react-native-skia` `<BackdropFilter>`**: only sees content inside the same Skia `<Canvas>` — cannot see native RN views behind it.

### The consensus shader technique (matches our Metal almost 1:1)

Kyant0's [`Shaders.kt`](https://raw.githubusercontent.com/Kyant0/AndroidLiquidGlass/kmp/backdrop/src/commonMain/kotlin/com/kyant/backdrop/internal/Shaders.kt) (Apache-2.0) is essentially the same algorithm as `LiquidGlass.metal` — including `radiusAt()`, `sdRoundedRect`, **analytic** `gradSdRoundedRect`, `circleMap(x) = 1 - sqrt(1 - x*x)`, the `depthEffect` radial blend, and the `if (-sd >= refractionHeight) return content.eval(coord)` early-out. Our Metal has all of these. **This makes it a near-mechanical port.**

Deltas to plan for:

1. `fwidth` → `aa = 1.0` (§3).
2. Blur moves out of the shader into `createBlurEffect`; saturation moves into `createColorFilterEffect(ColorMatrix.setSaturation)`. Both via `createChainEffect`.
3. Metal UV-space sampling (`pixels / viewSize`, `sourceRect` remap) → AGSL **pixel-space** `content.eval()`. `sourceRect`/`uvRect` uniforms collapse into a single pixel offset.
4. `atan2(y,x)` → `atan(y,x)`.
5. Node padding replaces the iOS backdrop-region padding, using the same formula.
6. Kyant0's dispersion is 7 spectral taps vs our 16 masked taps — ours ports fine (constant bound + `break` is legal), but 7 is cheaper if fill rate bites.
7. Kyant0 documented limits to inherit: rounded-rect shapes only; *"discontinuities at some corners"* if `refractionHeight > minCornerRadius` or `refractionAmount > minDimension`.

Perf reference (haze, Pixel 6, 1080×2400, 60 Hz, P90 CPU frame time): 1 glass effect **5.6 ms**, 3 effects **5.2 ms**, 9 effects **8.1 ms**.

---

## 9. Recommended architecture

### 9.1 View / RenderNode topology

```
DecorView
└── ReactRootView  (RN's own hierarchy — untouched)
    └── …
        └── <LiquidGlassProvider providerId="main">        ← ExpoView, implements BackdropSource
            │       owns  contentNode : RenderNode
            │       records super.dispatchDraw() into it, then draws it
            ├── (all normal RN app content — lists, images, video, …)
            └── …
        │
        ├── <LiquidGlassView providerId="main">            ← SIBLING of the provider, drawn AFTER it
        │       owns  glassNode : RenderNode  (padded)
        │       reads provider.contentNode, never its own subtree
        └── <LiquidGlassView providerId="main">            ← more glass views, all siblings
```

**The exclusion is structural, not filtered.** A glass view is never inside the recorded subtree, so it can never appear in its own backdrop. There is no marker canvas, no recursion guard, no `instanceof` check, and therefore no `StackOverflowError`/cyclic-render-tree failure class. This is the API-31+ Dimezis `BlurTarget` model and the Abdullajon model, and both projects state the same invariant: *"the BlurTarget may not contain a BlurView that targets the same BlurTarget"* / *"Glass must not live inside the provider subtree."*

Pairing is by string `providerId` through a process-level registry — the ergonomics proven by `expo-blur`'s `<BlurTargetView>` + `appContext.findView`. Do **not** walk up the hierarchy to auto-discover a root: that is what `expo-blur` did before SDK 55 and it is precisely what broke inside RN `Modal` ([expo/expo#44165](https://github.com/expo/expo/issues/44165)).

Because `expo-modules-core`'s `ExpoView` extends `ViewGroup` but not `FrameLayout`, the provider implements a `BackdropSource` seam rather than subclassing Dimezis' `BlurTarget`.

### 9.2 Who records the backdrop

The **provider**, inside its own real render pass. No extra draw, no extra invalidate:

```kotlin
class LiquidGlassProviderView(context: Context, appContext: AppContext)
    : ExpoView(context, appContext), BackdropSource {

    internal val contentNode = RenderNode("LiquidGlassBackdrop")
    internal var contentGeneration = 0
        private set

    override fun dispatchDraw(canvas: Canvas) {
        if (Build.VERSION.SDK_INT >= 29 && canvas.isHardwareAccelerated && width > 0 && height > 0) {
            contentNode.setPosition(0, 0, width, height)
            val rc = contentNode.beginRecording(width, height)
            try { super.dispatchDraw(rc) } finally { contentNode.endRecording() }
            canvas.drawRenderNode(contentNode)          // this is what actually reaches the screen
        } else {
            super.dispatchDraw(canvas)                   // <29 / software: no glass, just draw
        }
        contentGeneration++
        consumers.forEach { it.onBackdropChanged() }
    }

    // scrolling children invalidate a descendant WITHOUT re-running dispatchDraw
    override fun onDescendantInvalidated(child: View, target: View) {
        super.onDescendantInvalidated(child, target)
        contentGeneration++
    }
}
```

Notes:
- Recording is display-list capture, not rasterization. Unchanged children re-reference their existing RenderNodes → *"basically zero overhead."*
- `dispatchDraw` is step 4 of `View.draw()`, so the provider's own background/onDraw/foreground are **not** captured. If the provider needs a background in the backdrop, draw it into `rc` first (Dimezis' `setFrameClearDrawable` equivalent).
- `contentNode` is a **live reference**, not a snapshot. Content changes need no `invalidate()` on the glass views at all.

### 9.3 Where the RenderEffect chain is applied

On a **second, padded RenderNode owned by each glass view** — never on the provider's node, and never via `View.setRenderEffect` (which cannot be cropped and clips to bounds).

```kotlin
class LiquidGlassView(...) : ExpoView(...), BackdropConsumer {

    private val glassNode = RenderNode("LiquidGlass")
    private val shader = RuntimeShader(GLASS_AGSL)      // built ONCE, at init, in try/catch

    override fun onDraw(canvas: Canvas) {
        val provider = registry.find(providerId) ?: return fallback(canvas)
        if (!provider.contentNode.hasDisplayList()) { invalidate(); return }   // provider hasn't drawn yet
        if (!canvas.isHardwareAccelerated) return fallback(canvas)

        // 1. padding — identical formula to iOS GlassSurfaceView.glassBackdropPadding
        val pad = ceil(max(refractionAmount + dispersionAmount,
                           if (blurRadius > 0f) max(blurRadius * 1.5f, 16f) else 0f) + 2f)
        val pw = (width  + 2 * pad).toInt()
        val ph = (height + 2 * pad).toInt()

        // 2. record the provider's backdrop into the padded node, aligned under us
        val (relX, relY) = locationRelativeTo(provider)
        glassNode.setPosition(0, 0, pw, ph)
        val rc = glassNode.beginRecording(pw, ph)
        try {
            rc.translate(pad - relX, pad - relY)
            rc.drawRenderNode(provider.contentNode)
        } finally { glassNode.endRecording() }

        // 3. uniforms — pixel space, origin passed explicitly (never trust the implicit one)
        shader.setFloatUniform("uNodeSize",  pw.toFloat(), ph.toFloat())
        shader.setFloatUniform("uGlassRect", pad, pad, width.toFloat(), height.toFloat())
        shader.setFloatUniform("uCrop",      0f, 0f, pw.toFloat(), ph.toFloat())   // in-shader clamp
        shader.setFloatUniform("uCornerRadii", cornerRadii)                        // float[4]
        …

        // 4. build a NEW RenderEffect every time uniforms change (see §11 — reassigning the
        //    same instance is a no-op, and the builder is snapshotted by value)
        val shaderEffect = RenderEffect.createRuntimeShaderEffect(shader, "content")
        var prep: RenderEffect? = null
        if (blurRadius > 0f) {                                   // guard: 0f crashes, b/241546169
            val r = (blurRadius * 0.5f - 0.5f) / 0.57735f        // match iOS sigma = radius*0.5
            prep = RenderEffect.createBlurEffect(r, r, Shader.TileMode.CLAMP)
        }
        if (saturation != 1f) {
            val cf = ColorMatrixColorFilter(ColorMatrix().apply { setSaturation(saturation) })
            prep = if (prep != null) RenderEffect.createColorFilterEffect(cf, prep)
                   else              RenderEffect.createColorFilterEffect(cf)
        }
        glassNode.setRenderEffect(
            if (prep != null) RenderEffect.createChainEffect(shaderEffect, prep)   // shader(prep(src))
            else shaderEffect
        )

        // 5. draw the visible sub-rect only
        val save = canvas.save()
        canvas.clipRect(0f, 0f, width.toFloat(), height.toFloat())
        canvas.translate(-pad, -pad)
        canvas.drawRenderNode(glassNode)
        canvas.restoreToCount(save)
    }
}
```

Pipeline shape: `glassNode.contents` → `blur` → `saturation ColorFilter` → `runtimeShader` → clipped to the glass rect. That is a 1:1 structural match to the iOS `GlassBlurH`/`GlassBlurV` → `GlassComposite` chain, with Skia's optimized separable blur replacing our hand-written one.

### 9.4 Frame scheduling

Drive from `ViewTreeObserver.OnPreDrawListener` on the **provider** (self-gating: no draw pass ⇒ no callback ⇒ no work), combined with the `contentGeneration` counter from §9.2 and a geometry check (`getLocationOnScreen` + scale/rotation). Never `Choreographer.postFrameCallback` — it fires every vsync regardless and burns power at idle. Drop the iOS adaptive-stride controller, the double-buffered slot ring, and the pixel digest entirely: they amortize a CPU rasterization cost that this path does not incur.

### 9.5 Summary of binding decisions

1. **Topology — copy Dimezis 3.x.** Provider records `super.dispatchDraw`; glass views are siblings drawn above it; pair by `providerId` registry.
2. **Self-exclusion is structural.** No marker canvases, no recursion guards. If a software fallback is ever added, guard **both** `draw()` and `dispatchDraw()` (`PFLAG_SKIP_DRAW` makes a `draw()`-only guard insufficient).
3. **Render** = padded `RenderNode` + `createChainEffect(runtimeShaderEffect, blur→saturation)`, `clipRect` at draw time. Padding = `ceil(max(refraction + dispersion, blur>0 ? max(blur*1.5, 16) : 0) + 2)` — identical to iOS.
4. **Never hand-roll the blur in AGSL.** Convert radius with `sigma = 0.57735*r + 0.5`.
5. **Schedule** off `OnPreDrawListener` on the provider (+ `onDescendantInvalidated` → generation counter).
6. **Construct a new `RenderEffect` object whenever uniforms change** (§11).
7. **Clamp taps in-shader in addition to padding** — decal-vs-clamp is device-dependent (§2).
8. **Guard `blurRadius > 0`** before `createBlurEffect` (b/241546169).
9. **try/catch both shader construction and effect creation**, plus a visual fallback for silent driver failures; warm the shader at startup (§11).
10. **Tier down**: 33+ full · 31–32 blur+saturation+outline clip, no refraction · 29–30 live backdrop + scrim · <29 scrim. Update `expo-module.config.json` to `"platforms": ["apple", "android"]`.
11. **Accept and document**: `SurfaceView` content is uncapturable on every path; `TextureView` content *is* captured on a hardware canvas. Require `surfaceType="textureView"` / `viewType: 'textureView'` for video; detect `SurfaceView` descendants and warn. RN `Modal` is a separate window — a glass view inside one needs its own provider.

---

## 10. Open questions to settle empirically (day-one test harness)

1. **Coordinate space** of `fragCoord` and `content.eval()` for a RenderEffect on a standalone `RenderNode` — node-local vs device-space, and how `setPosition`/`translationX` affect it. Mitigate by passing explicit `size`/`offset` uniforms regardless. **UNVERIFIED.**
2. Confirm the **transparent-black-outside-bounds** behaviour and that the padding fixes it (write a shader that evals at `coord + (500,500)` and look for the halo).
3. ~~Whether additional `uniform shader` inputs can be pre-bound~~ → **RESOLVED, see §11.**
4. ~~Whether the uniform-refresh bug still exists on 14/15/16~~ → **RESOLVED (it is architectural, not a bug), see §11.**
5. ~~AGSL uniform count/size limits~~ → **RESOLVED (no documented limit; driver `GL_MAX_FRAGMENT_UNIFORM_VECTORS`, ES2 floor 16 vec4), see §11.**
6. Whether a **hard max blur radius** exists in HWUI. **UNVERIFIED.**
7. RN 0.85 / Expo SDK 56 `minSdkVersion` (not stated in either changelog) — determines how much fallback code is actually reachable. **UNVERIFIED.**
8. TextureView's extra frame of latency as a documented number. **UNVERIFIED.**
9. PixelCopy full-screen 1080p cost in ms (community reports 5–30 ms). **UNVERIFIED.**

---

## 11. Addendum — AGSL / RuntimeShader deep dive

### 11.1 Resolved open questions

**Q3 — Can extra `uniform shader` inputs be bound manually? ✅ YES, but only *before* creating the RenderEffect.**

Mechanism, traced through source:

1. `RuntimeShader.setInputShader()`/`setInputBuffer()` call `nativeUpdateShader(...)` **immediately**, mutating the native `SkRuntimeShaderBuilder` (AOSP `RuntimeShader.java:499-532`).
2. `createRuntimeShaderEffect` calls `SkImageFilters::RuntimeShader(*builder, name, nullptr)` — passing the builder **by value**. `SkRuntimeImageFilter` stores its own copy including all uniforms **and all already-bound children** (`SkRuntimeImageFilter.cpp:44-55, 94`).
3. At draw, `onFilterImage` overwrites **only** the named child and leaves every other child as captured:
   ```cpp
   for (int i = 0; i < inputCount; i++)
       fRuntimeEffectBuilder.child(fChildShaderNames[i].c_str()) = inputs[i];
   sk_sp<SkShader> shader = fRuntimeEffectBuilder.makeShader();
   ```

So a pre-bound `BitmapShader` noise texture works. **Bind it before `createRuntimeShaderEffect`, never after.**

Skia itself supports N inputs (`RuntimeShader(builder, names[], inputs[], count)`), but AOSP never exposes it. Real bug from assuming otherwise: [haze#947](https://github.com/chrisbanes/haze/issues/947) — a shader declaring both `uniform shader content` and `uniform shader blurredContent` left `blurredContent` silently unbound; fix (PR #951) was to chain `RenderEffect`s in front of the single content input.

**Q4 — Is the uniform-refresh behaviour a bug? ❌ No — it is architectural.**

The by-value builder snapshot in step 2 above *is* the cause; it will never be "fixed". Worse, HWUI short-circuits on pointer identity:

```cpp
// libs/hwui/RenderProperties.cpp:52-56
if (mImageFilter.get() == imageFilter) return false;
```

→ **Re-assigning the same `RenderEffect` object is a guaranteed no-op.** Required pattern, every frame a uniform changes:

```
set uniforms → set input shaders → construct a NEW RenderEffect → assign it
```

**Q5 — Uniform count/size limits.** No documented Skia/AGSL limit. Real ceiling is the driver's `GL_MAX_FRAGMENT_UNIFORM_VECTORS`; ES 2.0 mandates a minimum of **16 vec4s (64 floats)**; real Mali/Adreno parts expose 128–1024 vec4. Our `GlassParams` (~20 scalars + 4 vec4s ≈ 11 vec4) fits under even that floor. Exceeding it fails as a **silent driver link failure on the RenderThread** — no Java exception, just black. **UNVERIFIED** beyond the ES2 mandated minimum.

### 11.2 Loop / control-flow enforcement (exact rules)

AGSL compiles with `SkRuntimeEffect::Options{}`, defaulting to `SkSL::Version::k100` ⇒ `ProgramConfig::strictES2Mode() == true`. Enforced at `new RuntimeShader(...)`:

- `while` → `"while loops are not supported"` (`SkSLForStatement.cpp:193-194`)
- `do…while` → `"do-while loops are not supported"` (`SkSLDoStatement.cpp:25`)
- `for` must be unrollable: *"In strict-ES2, loops must be unrollable or it's an error"* (`SkSLForStatement.cpp:133-138`), via `Analysis::GetLoopUnrollInfo` — *"Ensures that a for-loop meets the strict requirements of The OpenGL ES Shading Language 1.00, Appendix A, Section 4."*

Conditions, with exact compiler error strings (`SkSLGetLoopUnrollInfo.cpp`):
- init must be a var declaration → `"missing init declaration"`, `"invalid init declaration"`
- index must be scalar `int` or `float` → `"invalid type for loop index"`
- initializer constant → `"loop index initializer must be a constant expression"`
- condition must be `index <op> constant`, op ∈ `< <= > >= == !=` → `"expected loop index on left hand side of condition"`, `"invalid relational operator"`, `"loop index must be compared with a constant expression"`
- increment `++ -- += -=` by a constant → `"invalid operator in loop expression"`, `"loop index must be modified by a constant expression"`
- index must not be assigned in the body → `"loop index must not be modified within body of the loop"`
- `static constexpr int kLoopTerminationLimit = 100000;` → `"loop must guarantee termination in fewer iterations"`

`break`/`continue` allowed. **Recursion forbidden** — `CheckProgramStructure.cpp`: `"potential recursion (function call cycle) not allowed"`, `kProgramStackDepthLimit = 50`; detected statically including indirect cycles. Function calls otherwise fine; `in`/`out`/`inout` are copy-in/copy-out.

**Arrays:** indexable only by a constant or loop index — `Analysis::ValidateIndexingForES2`, error `"index expression must be constant"`. And the definition of constant-index-expression **excludes all function calls, including built-ins** (`SkSLIsConstantExpression.cpp`: *"Function calls are completely disallowed in SkSL constant-(index)-expressions"*). So `myArray[int(floor(x))]` will **not** compile — do not table-drive the dispersion masks.

### 11.3 Derivatives — confirmed unavailable, with mechanism

`sksl_shared.sksl:247-252` tags all six overloads `$es3`:

```
$pure $es3 $genType  dFdx($genType p);
$pure $es3 $genType  dFdy($genType p);
$pure $es3 $genType  fwidth($genType p);
```

and `SkSLFunctionCall.cpp:1170-1171` — *"Reject ES3 function calls in strict ES2 mode"* — `if (context.fConfig->strictES2Mode() && function.modifierFlags().isES3())`. Calling them is a compile error at construction. Corroborated by [flutter#180959](https://github.com/flutter/flutter/issues/180959). The `aa = 1.0` substitution in §3 stands.

### 11.4 `half` precision — confirmed production failure

`half` is genuinely `mediump`: magnitude `{2^-14, 2^14}`, **relative precision 2^-10** (~3 decimal digits). Mali/Adreno/PowerVR implement true fp16. **The Android emulator and desktop Skia typically execute mediump at fp32 — so `half` bugs pass in CI and fail on OEM silicon.**

Confirmed: [haze#520](https://github.com/chrisbanes/haze/issues/520) — Galaxy S23 / Android 14, progressive blur visually clipped or absent, reproduced on a Xiaomi tablet. Root cause per [haze#528](https://github.com/chrisbanes/haze/pull/528): *"Seems to be caused by usage of `half` types in the runtime shader, leading to overflow… on certain OEM hardware."* In-code comment: *"Need to use float and vec here for higher precision, otherwise we see visually clipping on certain devices (Samsung for example)."* [haze#530](https://github.com/chrisbanes/haze/pull/530) removed `half` entirely: *"Correctness is more important than possible performance improvements."*

`half` resolves integers exactly only to **2048** — smaller than every modern phone's long edge. Never store coordinates, accumulators, Gaussian weights, sigmas, or distances in `half`/`short`. **Use `float`/`vec*` throughout; zero `half`.**

### 11.5 `layout(color)` semantics

Marks a uniform as a colour so Skia transforms it into the shader's working colour space. Must be set with `setColorUniform(name, int|long|Color)` — *"the provided sRGB color will be transformed into the shader program's output colorspace."* `vec3`/`vec4` only. Mismatched setter throws `IllegalArgumentException`: *"if the shader does not have a uniform with that name or if the uniform is declared with a type other than vec4 or a corresponding layout(color) annotation."*

It handles **colour-space conversion only** — it does **not** premultiply. Colours from `content.eval()` are **already premultiplied and already in the working space**; mixing them with a raw non-`layout(color)` uniform is the classic wrong-tint bug. Per §3, prefer plain `uniform vec4` + `setFloatUniform` for `tintColor`/`frostColor` since their `.a` is a mix factor, not alpha.

### 11.6 Compile-error behaviour — four throw sites

| Stage | Trigger | Result |
|---|---|---|
| 1 | `new RuntimeShader(src)` → `nativeCreateBuilder` | **`IllegalArgumentException` with raw SkSL error text**, synchronously. `libs/hwui/jni/Shader.cpp`: `if (result.effect.get() == nullptr) { doThrowIAE(env, result.errorText.c_str()); }` |
| 2 | `set*Uniform` / `setInputShader` with bad name or type | `IllegalArgumentException` |
| 3 | `createRuntimeShaderEffect(shader, name)` | `IllegalArgumentException`: *"unable to find a uniform with the name '%s' of the correct type defined by the provided RuntimeShader"* (`RenderEffect.cpp:141-157`) |
| 4 | **Draw time** — `builder->makeShader()` on RenderThread | 🔴 **No Java exception.** Black output, nothing drawn, or a native crash. |

Stage 1 is only Skia's SkSL front-end. Translation to GLSL/SPIR-V and the *driver's* compile happen lazily on the RenderThread at first draw. **Wrap construction *and* effect creation in try/catch AND keep a non-shader visual fallback** ([haze#1117](https://github.com/chrisbanes/haze/issues/1117)).

**Warm the shader at startup.** HWUI's `ShaderCache : GrContextOptions::PersistentCache` (`libs/hwui/pipeline/skia/ShaderCache.cpp`) is backed by `FileBlobCache` keyed by a driver/GPU identity blob — **an OS or GPU-driver update invalidates the entire cache**, so a cold first draw pays a RenderThread driver compile. Do it off-screen at init, not on first user interaction.

### 11.7 Other platform hazards

- 🔴 **`createBlurEffect(0f, 0f, …)`** → `IllegalArgumentException: nativePtr is null`, [b/241546169](https://issuetracker.google.com/issues/241546169), *Not started*. Compose substitutes `createOffsetEffect(0,0)` internally. We call the platform API directly ⇒ **guard `radius > 0` ourselves.** Production hit: [haze#352](https://github.com/chrisbanes/haze/issues/352).
- API 31 only: `draw()` called inconsistently while scrolling — [b/318679450](https://issuetracker.google.com/issues/318679450), *Not started*; mainly the Android 12 emulator. Moot at our 33 floor.
- No credible generic "RuntimeShader is broken on Mali/Exynos" platform bug exists — **UNVERIFIED as a platform issue**; the evidence is app-level and precision-rooted (§11.4). Adjacent non-AGSL precedent: Mali-T760 silent fragment-shader failures (google/filament#974), PowerVR GE8320 crashes in `glCompileShader` (filament#3660, #5118, #7162).
- **Software canvas**: `IllegalArgumentException: Software rendering doesn't support drawRenderNode`. Breaks Robolectric/Roborazzi screenshot tests — guard software-rendered test paths.
- **`setInputBuffer(name, BitmapShader)`** bypasses colour management (*"No color space transformation is applied… Bitmaps that return false for `Bitmap#isPremultiplied()` are not automatically premultiplied"*) but **still honours the BitmapShader's own tiling and filtering** — it is the *only* way to get CLAMP/REPEAT/MIRROR semantics on a sampled input inside AGSL.
- API 36 adds `RuntimeColorFilter` / `RuntimeXfermode` / `setInputColorFilter` / `setInputXfermode`, flag-gated. Not needed, but it's where the platform is heading.
- ⚠️ **SurfaceView content is invisible to `RenderEffect` and every capture path** (§5). **TextureView content is NOT** — it is captured by a RenderNode recording on a hardware canvas via `recordingCanvas.drawTextureLayer(layer)`, and draws nothing only on a *software* canvas. Do not conflate the two.

### 11.8 AGSL implementation checklist

1. **Gate on API 33**, not 31. `createRuntimeShaderEffect` is 33+.
2. **`float`/`vec*` everywhere; zero `half`/`short`.** Emulator will not catch violations.
3. Replace `fwidth()` SDF antialiasing with `aa = 1.0` (or a pixel-scale uniform) — derivatives are ES3 and rejected.
4. 16-tap dispersion loop: constant bound + `break` is fine; the constant is your program size.
5. **Clamp tap coordinates in-shader** against a `uniform vec4 crop` and renormalize weights — AOSP passes `sampleRadius = 0`, and decal-vs-clamp is device-dependent.
6. Design for **one** content input; bind extra shaders via `setInputShader`/`setInputBuffer` **before** `createRuntimeShaderEffect`, or chain RenderEffects.
7. Every frame uniforms change: set uniforms → **build a new `RenderEffect`** → assign. Reusing the object is a guaranteed no-op.
8. Guard blur radius > 0 before `createBlurEffect` (b/241546169).
9. try/catch `RuntimeShader(...)` **and** `createRuntimeShaderEffect(...)`, plus a visual fallback for silent driver failures; warm the shader at startup.
10. No `layout(color)` for tint/frost — their `.a` is a mix factor, not alpha.

---

## Sources

**Official Android docs:** [AGSL overview](https://developer.android.com/develop/ui/views/graphics/agsl) · [AGSL vs GLSL](https://developer.android.com/develop/ui/views/graphics/agsl/agsl-vs-glsl) · [Using AGSL](https://developer.android.com/develop/ui/views/graphics/agsl/using-agsl) · [AGSL quick reference](https://developer.android.com/develop/ui/views/graphics/agsl/agsl-quick-reference) · [Hardware acceleration](https://developer.android.com/topic/performance/hardware-accel) · [expo-blur](https://docs.expo.dev/versions/latest/sdk/blur-view/)

**API-level metadata (android.jar-generated bindings):** [RenderNode](https://learn.microsoft.com/en-us/dotnet/api/android.graphics.rendernode?view=net-android-35.0) · [RecordingCanvas](https://learn.microsoft.com/en-us/dotnet/api/android.graphics.recordingcanvas?view=net-android-35.0) · [Canvas.DrawRenderNode](https://learn.microsoft.com/en-us/dotnet/api/android.graphics.canvas.drawrendernode?view=net-android-35.0) · [Canvas.EnableZ](https://learn.microsoft.com/en-us/dotnet/api/android.graphics.canvas.enablez?view=net-android-35.0) · [RenderEffect](https://learn.microsoft.com/en-us/dotnet/api/android.graphics.rendereffect?view=net-android-35.0) · [createBlurEffect](https://learn.microsoft.com/en-us/dotnet/api/android.graphics.rendereffect.createblureffect?view=net-android-35.0) · [createRuntimeShaderEffect](https://learn.microsoft.com/en-us/dotnet/api/android.graphics.rendereffect.createruntimeshadereffect?view=net-android-35.0) · [RuntimeShader](https://learn.microsoft.com/en-us/dotnet/api/android.graphics.runtimeshader?view=net-android-35.0) · [View.SetRenderEffect](https://learn.microsoft.com/en-us/dotnet/api/android.views.view.setrendereffect?view=net-android-35.0) · [RenderNode.SetRenderEffect](https://learn.microsoft.com/en-us/dotnet/api/android.graphics.rendernode.setrendereffect?view=net-android-35.0) · [HardwareRenderer](https://learn.microsoft.com/en-us/dotnet/api/android.graphics.hardwarerenderer?view=net-android-35.0) · [HardwareBufferRenderer](https://learn.microsoft.com/en-us/dotnet/api/android.graphics.hardwarebufferrenderer?view=net-android-35.0) · [registerFrameCommitCallback](https://learn.microsoft.com/en-us/dotnet/api/android.views.viewtreeobserver.registerframecommitcallback?view=net-android-35.0)

**AOSP source:** [RenderNode.java](https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/graphics/java/android/graphics/RenderNode.java) · [RecordingCanvas.java](https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/graphics/java/android/graphics/RecordingCanvas.java) · [RenderEffect.java](https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/graphics/java/android/graphics/RenderEffect.java) · [RuntimeShader.java](https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/graphics/java/android/graphics/RuntimeShader.java) · [jni/RenderEffect.cpp](https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/libs/hwui/jni/RenderEffect.cpp) · [jni/Shader.cpp](https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/libs/hwui/jni/Shader.cpp) · [utils/Blur.cpp](https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/libs/hwui/utils/Blur.cpp) · [HardwareRenderer.java](https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/graphics/java/android/graphics/HardwareRenderer.java)

**Skia source:** [SkImageFilters.h](https://api.skia.org/SkImageFilters_8h_source.html) · [SkRuntimeImageFilter.cpp](https://github.com/google/skia/blob/main/src/effects/imagefilters/SkRuntimeImageFilter.cpp) · [SkSLGetLoopUnrollInfo.cpp](https://github.com/google/skia/blob/main/src/sksl/analysis/SkSLGetLoopUnrollInfo.cpp) · [SkSLForStatement.cpp](https://github.com/google/skia/blob/main/src/sksl/ir/SkSLForStatement.cpp) · [sksl_shared.sksl](https://github.com/google/skia/blob/main/src/sksl/sksl_shared.sksl) · [SkSL & Runtime Effects](https://skia.org/docs/user/sksl/)

**Articles:** [AGSL: Made in the Shade(r)](https://medium.com/androiddevelopers/agsl-made-in-the-shade-r-7d06d14fe02a) · [RenderNode for Bigger, Better Blurs](https://medium.com/androiddevelopers/rendernode-for-bigger-better-blurs-ced9f108c7e2)

**Libraries:** [Dimezis/BlurView](https://github.com/Dimezis/BlurView) · [Abdullajon1881/LiquidGlass](https://github.com/Abdullajon1881/LiquidGlass) · [Kyant0/AndroidLiquidGlass](https://github.com/Kyant0/AndroidLiquidGlass) · [chrisbanes/haze](https://github.com/chrisbanes/haze) · [skydoves/Cloudy](https://github.com/skydoves/Cloudy) · [QmDeve/AndroidLiquidGlassView](https://github.com/QmDeve/AndroidLiquidGlassView) · [sbaiahmed1/react-native-blur](https://github.com/sbaiahmed1/react-native-blur)

**Issue trackers:** [b/241546169](https://issuetracker.google.com/issues/241546169) (BlurEffect 0 crash) · [b/318679450](https://issuetracker.google.com/issues/318679450) (API 31 draw while scrolling) · [b/283693347](https://issuetracker.google.com/issues/283693347) (API 31 RuntimeShader @hide) · [expo/expo#44165](https://github.com/expo/expo/issues/44165) (BlurTargetView / Modal) · [haze#520](https://github.com/chrisbanes/haze/issues/520) · [haze#528](https://github.com/chrisbanes/haze/pull/528) · [haze#530](https://github.com/chrisbanes/haze/pull/530) · [haze#947](https://github.com/chrisbanes/haze/issues/947) · [haze#1117](https://github.com/chrisbanes/haze/issues/1117) · [flutter#180959](https://github.com/flutter/flutter/issues/180959)
