package expo.modules.liquidglass.glass

/**
 * Quality tiers for the AGSL glass shader.
 *
 * The dispersion tap count **cannot** be a uniform: AGSL follows GLSL ES 1.00 Appendix A, so a
 * `for` loop must have a compile-time-constant bound to be statically unrollable. So each tier is a
 * separate source string with its own compiled [android.graphics.RuntimeShader].
 */
internal enum class ShaderQuality {
  /** No dispersion, no film grain. ~0.18x the cost of [HIGH]. */
  LOW,

  /** 8 taps at one-per-point spacing — exactly what iOS resolves to at `regular` defaults. */
  MEDIUM,

  /** 16 taps at one-per-*pixel* spacing. Finer than iOS. */
  HIGH;

  val dispersionTaps: Int
    get() = when (this) {
      LOW -> 0
      MEDIUM -> 8
      HIGH -> 16
    }
}

/**
 * A compiled-ready shader source plus the set of uniforms that survive compilation.
 *
 * [liveUniforms] is not documentation — it is load-bearing. `setFloatUniform` throws
 * `IllegalArgumentException: unable to find uniform named …` for a uniform the compiler optimised
 * away, and Skia throws at *draw* time for a declared uniform that was never set. Both directions
 * throw, and the `LOW` tier deletes five uniforms, so the uploader consults this set.
 */
internal data class GlassShaderVariant(
  val quality: ShaderQuality,
  val source: String,
  val liveUniforms: Set<String>
)

/**
 * Builds the AGSL translation of `ios/Shaders/LiquidGlass.metal:180-256` (`glassFragment`).
 *
 * **Coordinate space is device pixels, origin at the top-left of the padded backdrop RenderNode.**
 * Verified empirically on device during Phase 1: `main`'s `coord` is node-local, and `content.eval`
 * is identity-aligned with it. Every length-valued uniform is therefore in px, not dp.
 *
 * **Precision policy: there is no `half` declaration anywhere in the generated source.** The only
 * two `half` touchpoints are imposed by the language — `main` must return `half4`, and
 * `content.eval()` returns `half4` — and both are converted explicitly at the boundary. fp16
 * overflow has been observed on Samsung/Mali hardware, and emulators run `mediump` at fp32, so this
 * class of bug passes CI and fails only on real devices.
 *
 * ---
 * The rounded-rect SDF decomposition (`radiusAt` / `sdRoundedRect` / `gradSdRoundedRect` selected by
 * a packed `float4`), the `size` + `offset` device-pixel framing, and the padding budget threaded
 * through the effect chain follow **AndroidLiquidGlass, Apache License 2.0, Copyright 2025 Kyant**
 * (`backdrop/src/commonMain/kotlin/com/kyant/backdrop/internal/Shaders.kt:22-48`, `:54-55`, `:69`;
 * `effects/Lens.kt:25-27`, `:35-46`; `effects/Blur.kt:16-20`). See NOTICE.
 *
 * All refraction, dispersion, tone and noise **maths** is a translation of this project's own
 * Metal shader, with two blocks **deliberately remodeled** against actual iOS 26 glass rather
 * than the Metal fallback — eye-tested against a real iOS 26 button over UI content:
 *
 * 1. **The refraction direction can lean toward the light — as a knob.** Metal (and Kyant — its
 *    `coord + d * grad` looks outward but `Lens.kt:49` uploads the amount *negated*, so both
 *    sample inward) displaces purely along `normal + depthEffect * radial`, and per-edge pixel
 *    solves of real iOS 26 screenshots say Apple does too: the "swirl" the eye reads is the
 *    radial term sweeping through the corners with an edge-hugging profile, not a light-steered
 *    lean (research/04-ios26-edge-evidence, C4/C8). `refractionSwirl` mixes the highlight's
 *    light axis into the displacement direction before normalization for anyone who wants the
 *    stylised twist; it defaults to 0, which is Metal/Kyant/Apple exactly. See MAIN_PROLOGUE.
 *
 * 2. **The highlight is the glass border light, nothing else.** Metal's term (`:243-250`) is a
 *    signed multiplicative wash as wide as `refractionScale` (20 dp at `regular`): it darkens the
 *    whole quadrant opposite the light by up to 25% — a fake inset shadow real glass simply does
 *    not have — vanishes over dark backdrops, and lights one lobe. The replacement is a thin
 *    **additive** two-lobe rim on the light axis and nothing anywhere else; its
 *    `pow(abs(dot(normal, lightDir)), falloff)` model follows Kyant's
 *    `DefaultHighlightShaderString` (`internal/Shaders.kt:170-181`, same license as above). The
 *    Metal contour line and the signed wash are both gone — see the HIGHLIGHT fragment.
 *
 * Two Kyant behaviours are deliberately not copied: its un-centered `radiusAt(coord, …)` call,
 * which makes the quadrant test always take the `x >= 0` branch so only the right-hand radii are
 * ever selected; and its unguarded `circleMap`, which returns NaN for `|x| > 1`.
 */
internal object GlassShaderSource {

  // Uniform names. Referenced by GlassShaderVariant.liveUniforms and by the uploader.
  const val SIZE = "size"
  const val OFFSET = "offset"
  const val CROP = "crop"
  const val CORNER_RADII = "cornerRadii"
  const val UNIT_SCALE = "unitScale"
  const val REFRACTION_SCALE = "refractionScale"
  const val REFRACTION_AMOUNT = "refractionAmount"
  const val REFRACTION_SWIRL = "refractionSwirl"
  const val DEPTH_EFFECT = "depthEffect"
  const val PROFILE_POWER = "profilePower"
  const val PROFILE_BIAS = "profileBias"
  const val DISPERSION_HEIGHT = "dispersionHeight"
  const val DISPERSION_AMOUNT = "dispersionAmount"
  const val DISPERSION_TAP_SPACING = "dispersionTapSpacing"
  const val TINT_COLOR = "tintColor"
  const val FROST_COLOR = "frostColor"
  const val HIGHLIGHT_INTENSITY = "highlightIntensity"
  const val HIGHLIGHT_DIR = "highlightDir"
  const val HIGHLIGHT_WIDTH = "highlightWidth"
  const val HIGHLIGHT_FALLOFF = "highlightFalloff"
  const val LIGHT_INTENSITY = "lightIntensity"
  const val GLASS_OPACITY = "glassOpacity"
  const val SATURATION = "saturation"
  const val NOISE_AMOUNT = "noiseAmount"
  const val TOUCH_POS = "touchPos"
  const val TOUCH_GLOW = "touchGlow"

  private val cache = HashMap<ShaderQuality, GlassShaderVariant>()

  @Synchronized
  fun variant(quality: ShaderQuality): GlassShaderVariant =
    cache.getOrPut(quality) { build(quality) }

  private fun build(quality: ShaderQuality): GlassShaderVariant {
    val taps = quality.dispersionTaps
    // LOW drops the dispersion loop and the film grain. `unitScale` is in every tier: the
    // HIGHLIGHT fragment's sheen band is point-valued.
    val disperses = taps > 0
    val grain = quality != ShaderQuality.LOW

    val live = linkedSetOf(
      SIZE, OFFSET, CROP, CORNER_RADII, UNIT_SCALE,
      REFRACTION_SCALE, REFRACTION_AMOUNT, REFRACTION_SWIRL, DEPTH_EFFECT,
      PROFILE_POWER, PROFILE_BIAS,
      TINT_COLOR, FROST_COLOR,
      HIGHLIGHT_INTENSITY, HIGHLIGHT_DIR, HIGHLIGHT_WIDTH, HIGHLIGHT_FALLOFF,
      LIGHT_INTENSITY, GLASS_OPACITY, SATURATION,
      TOUCH_POS, TOUCH_GLOW
    )
    if (disperses) live += setOf(DISPERSION_HEIGHT, DISPERSION_AMOUNT, DISPERSION_TAP_SPACING)
    if (grain) live += NOISE_AMOUNT

    val src = buildString {
      append(HEADER)

      append(
        """
        uniform shader content;          // chain input: the padded backdrop, blurred or sharp.
                                         // Metal: texture2d<float> source [[texture(0)]]  (:181)

        uniform float2 size;             // view size, px. Metal: viewSize == shapeSize  (:24, :25)
        uniform float2 offset;           // (-P, -P), px — node-local to view-local.
        uniform float4 crop;             // node-space clamp rect (minX, minY, maxX, maxY), px.
                                         // Replaces address::clamp_to_edge + clamp(texUV,0,1)
        uniform float4 cornerRadii;      // px, packed (BL, BR, TR, TL). GlassCornerRadii.swift:39-44

        uniform float2 refractionScale;  // px.  Metal: refractionScale   (:27)
        uniform float  refractionAmount; // px.  Metal: refractionAmount  (:29)
        uniform float  refractionSwirl;  // How far the displacement leans toward the highlight's
                                         // light axis. 0 = Metal/Kyant. No Metal counterpart.
        uniform float  depthEffect;      //      Metal: depthEffect       (:31)
        uniform float  profilePower;     //      Metal: profilePower      (:33)
        uniform float  profileBias;      //      Metal: profileBias       (:34)

        uniform float4 tintColor;        // straight (non-premultiplied) RGBA. Metal: tintColor (:20)
        uniform float4 frostColor;       // rgb = system background, a = frostAmount        (:21)
        uniform float  highlightIntensity;
        uniform float2 highlightDir;     // (cos angle, sin angle) — precomputed on the CPU so the
                                         // per-pixel sin/cos pair disappears entirely.
        uniform float  highlightWidth;   // px. Depth of the glass border light. No Metal
                                         // counterpart — see the HIGHLIGHT fragment.
        uniform float  highlightFalloff; // Angular falloff exponent of the two lobes. Kyant's
                                         // `falloff`, default 1. Guarded >= 0.01 on the CPU.
        uniform float  lightIntensity;
        uniform float  glassOpacity;
        uniform float  saturation;

        uniform float2 touchPos;         // view-local px, same space as `pixels`. No Metal
                                         // counterpart — the `interactive` press glow.
        uniform float  touchGlow;        // 0..1 press progress; 0 turns the branch off.

        """.trimIndent()
      )
      appendLine()

      append(
        """
        // Device px per iOS point. Used ONLY where a point value is hard-coded (the dispersion
        // cutoff, the sheen band).
        uniform float unitScale;

        """.trimIndent()
      )
      appendLine()
      if (disperses) {
        append(
          """
          uniform float dispersionHeight;      // px.  Metal: dispersionHeight  (:36)
          uniform float dispersionAmount;      // px.  Metal: dispersionAmount  (:37)
          uniform float dispersionTapSpacing;  // px between taps. MUST be <= unitScale, or the
                                               // spread >= 2 invariant breaks and every glass edge
                                               // gets a blue fringe.

          const int kDispersionTaps = $taps;   // Metal: constant int kDispersionTaps = 16  (:96)

          """.trimIndent()
        )
        appendLine()
      }
      if (grain) {
        append(
          """
          uniform float noiseAmount;

          """.trimIndent()
        )
        appendLine()
      }

      append(FUNCTIONS)
      if (grain) append(HASH_NOISE)
      append(SAMPLE_BACKDROP)

      append(MAIN_PROLOGUE)
      append(if (disperses) REFRACTION_WITH_DISPERSION else REFRACTION_ONLY)
      append(TONE_CHAIN)
      if (grain) append(GRAIN)
      append(HIGHLIGHT)
      append(TOUCH_GLOW_FRAGMENT)
      append(MAIN_EPILOGUE)
    }

    return GlassShaderVariant(quality, src, live)
  }

  // ---------------------------------------------------------------------------- source fragments

  private val HEADER = """
    // =========================================================================
    //  LiquidGlass.agsl — generated by GlassShaderSource.
    //  AGSL port of ios/Shaders/LiquidGlass.metal:180-256 (glassFragment),
    //  with two deliberate visual divergences: the refraction direction can
    //  lean toward the light (refractionSwirl), and the highlight is the
    //  glass border light (see MAIN_PROLOGUE and the HIGHLIGHT fragment).
    //  Requires API 33 (android.graphics.RuntimeShader).
    //
    //  Coordinate space: DEVICE PIXELS, origin = top-left of the padded backdrop
    //  RenderNode. Every length-valued uniform is px.
    //
    //  Portions derived from AndroidLiquidGlass (Apache-2.0, (c) 2025 Kyant).
    //  See the KDoc on GlassShaderSource and the NOTICE file.
    // =========================================================================

    const float kNormEps = 1e-6;


  """.trimIndent() + "\n"

  private val FUNCTIONS = """
    // NaN-free normalize. Metal guards each normalize with a length test (:79, :150, :152, :154).
    // A ternary is NOT safe: if SkSL lowers `cond ? normalize(v) : fb` to an arithmetic select then
    // normalize(0) = NaN is still multiplied by 0, and NaN * 0 = NaN. The division form cannot
    // produce NaN for any finite v, because the denominator is floored.
    float2 safeNormalize(float2 v, float2 fallback) {
        float len = length(v);
        float ok = step(kNormEps, len);
        return mix(fallback, v / max(len, kNormEps), ok);
    }

    // Metal :55-60. The argument MUST be the CENTERED coordinate, y-down.
    float radiusAt(float2 c, float4 radii) {
        if (c.x >= 0.0) {
            return (c.y <= 0.0) ? radii.z : radii.y;   // right-top : right-bottom
        }
        return (c.y <= 0.0) ? radii.w : radii.x;       // left-top  : left-bottom
    }

    // Metal :62-69. Per-corner radius, exact Euclidean SDF.
    float sdRoundedRect(float2 c, float2 halfSize, float4 radii) {
        float r = radiusAt(c, radii);
        float2 innerHalf = halfSize - float2(r);
        float2 cornerCoord = abs(c) - innerHalf;
        float outside = length(max(cornerCoord, 0.0)) - r;
        float inside = min(max(cornerCoord.x, cornerCoord.y), 0.0);
        return outside + inside;
    }

    // Metal :71-81. Branchless outward unit gradient.
    float2 gradSdRoundedRect(float2 c, float2 halfSize, float4 radii) {
        float r = radiusAt(c, radii);
        float2 innerHalf = halfSize - float2(r);
        float2 cornerCoord = abs(c) - innerHalf;

        float insideCorner = step(0.0, min(cornerCoord.x, cornerCoord.y));
        float xMajor = step(cornerCoord.y, cornerCoord.x);
        float2 gradEdge = float2(xMajor, 1.0 - xMajor);
        float2 gradCorner = safeNormalize(cornerCoord, float2(0.0));
        return sign(c) * mix(gradEdge, gradCorner, insideCorner);
    }

    // Metal :83-85. KEEP the max(0.0, …): without it this returns NaN for |x| > 1.
    float circleMap(float x) {
        return 1.0 - sqrt(max(0.0, 1.0 - x * x));
    }

  """.trimIndent() + "\n"

  // Metal :87-89. MUST stay float: 43758.5453 has no useful fp16 mantissa left after the multiply,
  // and sin() of a large half-precision argument is pure noise on Mali.
  private val HASH_NOISE = """
    float hashNoise(float2 co) {
        return fract(sin(dot(co, float2(12.9898, 78.233))) * 43758.5453);
    }

  """.trimIndent() + "\n"

  // Metal :171-178. The whole sourceRect / UV indirection collapses to a translate plus a clamp,
  // because on Android the node IS the sampled region.
  //
  // The clamp is mandatory, not defensive: out-of-bounds `content.eval` returns transparent black,
  // not the clamped edge texel — measured on device in Phase 1. Reading `.rgb` of premultiplied
  // transparent black gives *black*, so an unclamped tap paints a black rim and black corner blobs
  // hugging the SDF boundary.
  private val SAMPLE_BACKDROP = """
    float3 sampleBackdrop(float2 viewPx) {
        // The `interactive` dent: samples near the finger are pulled toward it, which reads as a
        // magnifying bulge travelling with the touch — the glass flexing, not just lighting up.
        // Living here means every read warps coherently (interior, rim band, all dispersion taps)
        // for the cost of a length() per sample, and geometry (sd, normals, t) stays un-warped.
        // d == 0 at the touch point, so there is no normalize() and no NaN to guard.
        if (touchGlow > 0.0) {
            float2 d = viewPx - touchPos;
            float f = 1.0 - smoothstep(0.0, 0.6 * min(size.x, size.y), length(d));
            viewPx -= d * (f * f * 0.22 * touchGlow);
        }
        float2 nodePx = clamp(viewPx - offset, crop.xy, crop.zw);
        // content.eval() returns half4 by language definition; widen at once so no half-precision
        // value ever enters the arithmetic.
        return float4(content.eval(nodePx)).rgb;
    }

  """.trimIndent() + "\n"

  private val MAIN_PROLOGUE = """
    half4 main(float2 fragCoord) {
        // Metal :183-185
        float2 pixels = fragCoord + offset;        // view-local px, top-left origin, y-down
        float2 halfSize = size * 0.5;
        float2 centered = pixels - halfSize;

        // Reordered relative to Metal, which builds the whole GlassGeometry at :187 before testing
        // at :191. The SDF alone decides the early-out, so the gradient / direction / scale work is
        // skipped for every pixel in the padded margin — which is most of them.
        float sd = sdRoundedRect(centered, halfSize, cornerRadii);

        // fwidth() does not exist in AGSL. |grad(sd)| == 1 for an exact SDF and we are in device
        // pixels, so fwidth(sd) == 1.0 — a 2 px feather, which is exactly what iOS produces
        // (fwidth(sd_points) = 1/contentsScale points).
        float aa = 1.0;
        float shapeAlpha = 1.0 - smoothstep(-aa, aa, sd);
        if (shapeAlpha <= 0.001) {
            return half4(0.0);                     // Metal :192
        }

        // Metal :141-163 (glassGeometry)
        float4 maxGradRadius = float4(min(halfSize.x, halfSize.y));      // :147
        float4 gradRadius = min(cornerRadii * 1.5, maxGradRadius);       // :148
        float2 normal = safeNormalize(
            gradSdRoundedRect(centered, halfSize, gradRadius),
            float2(0.0, 1.0));                                           // :149-150

        float2 radial = safeNormalize(centered, float2(0.0));            // :152

        // The light axis: highlightDir rotated +90 degrees — the same axis the HIGHLIGHT lobes
        // sit on, so `highlight.angle` steers both. Mixing it into the displacement direction
        // before normalizing leans the edge refraction toward the light — a stylisation knob,
        // OFF by default: measured real iOS 26 glass carries no such lean (research/04, C8);
        // its perceived twist is the radial term below sweeping through the corners. At swirl 0
        // the sum is exactly Metal :153-154, which is also Kyant's `grad`.
        float2 lobeDir = float2(-highlightDir.y, highlightDir.x);
        float2 direction = safeNormalize(
            normal + depthEffect * radial + refractionSwirl * lobeDir, normal);

        // Anisotropic refraction height: n^2 . refractionScale yields refractionScale.x on a
        // vertical edge and .y on a horizontal one.
        float2 limit = max(halfSize, float2(1e-3));                      // :156
        float2 scale2 = clamp(refractionScale, float2(1e-3), limit);     // :157
        float scale = max(dot(normal * normal, scale2), 1e-3);           // :158

        float t = clamp(-min(sd, 0.0) / scale, 0.0, 1.0);                // :160
        float inside = -min(sd, 0.0);                                    // :196

        // The `interactive` press deepens the lens — Kyant's components animate their lens amount
        // with press progress; this is that, riding the existing uniform. 1.0 at rest.
        float touchBoost = 1.0 + 0.35 * touchGlow;

        float3 color;

  """.trimIndent() + "\n"

  /**
   * The `spread < 2 * unitScale` guard is what keeps `maxI >= 2`, so `u` takes at least 0, 0.5 and
   * 1.0 and every channel mask fires. If only `u = 0` were active the mask would be (0,0,1) and the
   * divide would force red and green to black — a solid blue rim on every glass edge.
   */
  private val REFRACTION_WITH_DISPERSION = """
        if (inside >= scale) {
            color = sampleBackdrop(pixels);                              // Metal :198-199
        } else {
            // Metal :165-169 (refractedPixels), hoisted: Metal recomputes it identically at :205
            // and :207. The pow() base is 1-t with t clamped to [0,1] so it is never negative, and
            // the exponent is floored so pow(0, 0) is unreachable.
            float profile = circleMap(pow(1.0 - t, max(profilePower, 1e-3)));
            float amount = (profile + profileBias * (1.0 - t)) * refractionAmount * touchBoost;
            float2 base = pixels - amount * direction;                   // NOTE the minus (:168)

            float dispersionT = clamp(inside / max(dispersionHeight, 1e-3), 0.0, 1.0);
            float spread = circleMap(1.0 - dispersionT) * dispersionAmount * touchBoost;

            // The literal 2.0 is POINTS in the Metal source (:204).
            if (spread < 2.0 * unitScale) {
                color = sampleBackdrop(base);                            // :205
            } else {
                // LONGITUDINAL aberration: taps walk along the displacement axis itself — R
                // sampled deepest, B shallowest, G centred. Metal walks the tangent (:208) and
                // the first port copied it; per-channel phase solves of real iOS 26 measured the
                // spread along the displacement direction with blue as the outermost fringe
                // (research/04, C26). `base - direction * s` deepens the sample for positive s,
                // so the R half of the mask (u > 0.5) lands deepest.
                float3 accumulated = float3(0.0);
                float3 weight = float3(0.0);

                // Metal: maxI = min(spread, 16) with `pixels` in POINTS — one tap per point.
                // dispersionTapSpacing == unitScale reproduces that exactly.
                float maxI = min(spread / max(dispersionTapSpacing, 1e-3),
                                 float(kDispersionTaps));                // :212

                for (int i = 0; i < kDispersionTaps; ++i) {
                    float u = float(i) / maxI;                           // :215
                    // Metal writes `if (u > 1.0) break;` (:216). A dynamic `if` is used instead: it
                    // stays statically unrollable across the whole API 33-36 Skia range, and the GPU
                    // still skips the eval when the wave agrees. The accumulator and weight are
                    // untouched when the test fails, so the result is identical.
                    if (u <= 1.0) {
                        float3 tap = sampleBackdrop(base - direction * (u - 0.5) * spread);
                        float3 mask = float3(step(0.5, u),                   // R: upper half
                                             step(0.25, u) * step(u, 0.75),  // G: middle band
                                             step(u, 0.5));                  // B: lower half
                        accumulated += tap * mask;
                        weight += mask;
                    }
                }
                color = accumulated / max(weight, float3(1e-6));         // :227
            }
        }

  """.trimIndent().prependIndent("    ") + "\n"

  private val REFRACTION_ONLY = """
        if (inside >= scale) {
            color = sampleBackdrop(pixels);                              // Metal :198-199
        } else {
            // Metal :165-169 (refractedPixels). The LOW tier stops here: no chromatic dispersion.
            float profile = circleMap(pow(1.0 - t, max(profilePower, 1e-3)));
            float amount = (profile + profileBias * (1.0 - t)) * refractionAmount * touchBoost;
            color = sampleBackdrop(pixels - amount * direction);         // NOTE the minus (:168)
        }

  """.trimIndent().prependIndent("    ") + "\n"

  // Metal :231-236. Rec.709 luma, computed in gamma space exactly as Metal does.
  private val TONE_CHAIN = """
        color = clamp(color, 0.0, 1.0);

        float luma = dot(color, float3(0.2126, 0.7152, 0.0722));
        color = mix(float3(luma), color, saturation);
        color = mix(color, frostColor.rgb, frostColor.a);
        color = mix(color, tintColor.rgb, tintColor.a);

  """.trimIndent().prependIndent("    ") + "\n"

  // Metal :238-241. Metal keys off in.position.xy — drawable device px, which are view-local because
  // the CAMetalLayer *is* the view. `fragCoord` is padded-node-local, so its origin shifts by P
  // whenever refractionAmount / dispersionAmount / blurRadius changes and the grain field would jump
  // on every prop animation. `pixels` is view-local and stable.
  private val GRAIN = """
        if (noiseAmount > 0.0) {
            color += (hashNoise(pixels * 1e-3) - 0.5) * noiseAmount;
        }

  """.trimIndent().prependIndent("    ") + "\n"

  // Metal :243-250, deliberately remodeled — the KDoc up top owns the why; the constraints live
  // here.
  //
  // Metal's signed multiplicative wash — `sin(pos_angle - highlightAngle)` over the whole
  // refraction band — is GONE, not reweighted. It darkened the quadrant opposite the light by up
  // to 25%, and real iOS 26 glass has no inset shadow: away from the border light the interior is
  // flat. The highlight itself is 180-degree periodic by construction now; only the swirl lean
  // (MAIN_PROLOGUE, lobeDir flips sign at angle + 180) still tells the two apart. Metal's contour
  // line (:249-250) is folded in too: at a 1.5 dp band the rim IS the crisp line, and a separate
  // contour on top is exactly the over-thick edge this remodel removes.
  //
  // What remains is the glass border light. Falloff model per Kyant's DefaultHighlightShaderString
  // (pow(abs(dot(normal, lightDir)), falloff)): `normal` — not the position angle — is what holds
  // a long edge at constant intensity, and abs() is what lights BOTH light-axis lobes. `lobeDir`
  // (MAIN_PROLOGUE, shared with the swirl) is `highlightDir` rotated +90 degrees, which is what
  // lets `highlight.angle` keep its established meaning: the default 135 lights the top-left and
  // bottom-right lobes. `highlightFalloff` reaches the GPU already floored at 0.01, so pow(0, 0)
  // is unreachable.
  //
  // The rim is ADDED, not multiplied — that is what makes it read over a black backdrop — and it
  // fades over its own `highlightWidth` (default 0.75 dp) rather than borrowing the 20 dp
  // `refractionScale`. Kyant draws the same idea as a ~0.5 dp stroked layer at 0.38 alpha; this
  // SDF band is the single-pass equivalent.
  //
  // Two companions, both measured off real iOS 26 screenshots (research/04-ios26-edge-evidence):
  //
  // `sheen` — the faint broad glow under the lit edges: same lobes, ~7 pt deep, ~0.18x the rim's
  // weight (measured +13/255 over ~25 px at intensity-comparable defaults). This is what lets the
  // crisp line drop to hairline width without the edge going dead.
  //
  // There is deliberately NO drawn dark line. One shipped for a single round as a multiplicative
  // "flank contour" after a dark 1-2 px line was measured on a real icon's edges — then
  // per-channel solves showed that line is the refraction FOLD imaging a dark stripe (achromatic,
  // exactly backdrop-under-transfer where the true stripe is green: content, not ink;
  // research/04, C21). Our profile folds the same way (|dD/dd| > 1 near the edge), so the look
  // emerges from refraction alone; inking it on top double-darkens every strong edge.
  private val HIGHLIGHT = """
        float rim = pow(abs(dot(normal, lobeDir)), highlightFalloff);
        float rimT = clamp(inside / max(highlightWidth, 1e-3), 0.0, 1.0);
        float rimBand = 1.0 - smoothstep(0.0, 1.0, rimT);

        float sheenT = clamp(inside / (7.0 * unitScale), 0.0, 1.0);
        float sheen = 1.0 - smoothstep(0.0, 1.0, sheenT);

        color *= 1.0 + lightIntensity;
        color += rim * rimBand * highlightIntensity;
        color += rim * sheen * highlightIntensity * 0.18;

  """.trimIndent().prependIndent("    ") + "\n"

  // The `interactive` press glow, per Kyant's InteractiveHighlight (Apache-2.0, see NOTICE): a
  // flat 0.08 wash plus a 0.15 radial lobe, additive, radius 1.5x the view's min dimension, full
  // strength inside half that radius. `pixels`, not fragCoord — same reasoning as GRAIN: the glow
  // must not jump when the padding P changes mid-press (refraction props animating).
  //
  // The falloff is written `1.0 - smoothstep(lo, hi, d)`, NOT Kyant's `smoothstep(hi, lo, d)` —
  // reversed edges are undefined in GLSL ES, and Mali is where "undefined" stops meaning
  // "works anyway". The branch is uniform-coherent (GRAIN's pattern): free while idle, and it
  // cannot be optimised out, which is what keeps both uniforms live in every tier.
  private val TOUCH_GLOW_FRAGMENT = """
        if (touchGlow > 0.0) {
            float touchRadius = 1.5 * min(size.x, size.y);
            float touchDist = distance(pixels, touchPos);
            float touchFalloff = 1.0 - smoothstep(touchRadius * 0.5, touchRadius, touchDist);
            color += (0.08 + 0.15 * touchFalloff) * touchGlow;
        }

  """.trimIndent().prependIndent("    ") + "\n"

  // Metal :252-255. The narrowing to half is the last statement of the shader and is written as an
  // explicit constructor — float -> half is not an implicit conversion in SkSL.
  private val MAIN_EPILOGUE = """
        color = clamp(color, 0.0, 1.0);

        float alpha = shapeAlpha * glassOpacity;
        return half4(color * alpha, alpha);
    }
  """.trimIndent() + "\n"
}
