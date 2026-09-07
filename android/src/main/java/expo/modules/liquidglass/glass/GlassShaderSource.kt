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
 * The rounded-rect SDF decomposition (`cornerParam` / `sdGlassRect` / `gradGlassRect` selected by
 * a packed `float4`; named `radiusAt` / `sdRoundedRect` / `gradSdRoundedRect` before the
 * continuous-corner generalization), the `size` + `offset` device-pixel framing, and the padding
 * budget threaded
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
  const val CORNER_EXTENTS = "cornerExtents"
  const val CORNER_SHAPES = "cornerShapes"
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
  const val DISPERSION_QUADRANT = "dispersionQuadrant"
  const val TINT_COLOR = "tintColor"
  const val FROST_COLOR = "frostColor"
  const val HIGHLIGHT_INTENSITY = "highlightIntensity"
  const val HIGHLIGHT_DIR = "highlightDir"
  const val HIGHLIGHT_WIDTH = "highlightWidth"
  const val HIGHLIGHT_FALLOFF = "highlightFalloff"
  const val LIGHT_INTENSITY = "lightIntensity"
  const val GLASS_OPACITY = "glassOpacity"
  const val SATURATION = "saturation"
  const val HDR_HEADROOM = "hdrHeadroom"
  const val NOISE_AMOUNT = "noiseAmount"
  const val TOUCH_POS = "touchPos"
  const val TOUCH_GLOW = "touchGlow"
  const val TOUCH_LENS = "touchLens"
  const val SHAPE_RECT = "shapeRect"
  const val MORPH_RECT = "morphRect"
  const val MORPH_SHAPE = "morphShape"

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
      SIZE, OFFSET, CROP, CORNER_EXTENTS, CORNER_SHAPES, UNIT_SCALE,
      REFRACTION_SCALE, REFRACTION_AMOUNT, REFRACTION_SWIRL, DEPTH_EFFECT,
      PROFILE_POWER, PROFILE_BIAS,
      TINT_COLOR, FROST_COLOR,
      HIGHLIGHT_INTENSITY, HIGHLIGHT_DIR, HIGHLIGHT_WIDTH, HIGHLIGHT_FALLOFF,
      LIGHT_INTENSITY, GLASS_OPACITY, SATURATION, HDR_HEADROOM,
      TOUCH_POS, TOUCH_GLOW, TOUCH_LENS, SHAPE_RECT, MORPH_RECT, MORPH_SHAPE
    )
    if (disperses) {
      live += setOf(
        DISPERSION_HEIGHT, DISPERSION_AMOUNT, DISPERSION_TAP_SPACING, DISPERSION_QUADRANT
      )
    }
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
        uniform float4 cornerExtents;    // px, packed (BL, BR, TR, TL) like the old cornerRadii.
                                         // Corner-cell size: E = r for circular, up to 1.5287*r
                                         // for continuous (ContinuousCorners.resolve).
        uniform float4 cornerShapes;     // superellipse exponent per corner, same packing.
                                         // 2 = circular corner exactly; 3.3418 = Apple continuous
                                         // (research/05-continuous-corner-calibration).

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

        uniform float  hdrHeadroom;      // display HDR/SDR ratio, >= 1. Exactly 1.0 = SDR, and
                                         // the shader is bit-identical to the pre-HDR build.
                                         // > 1 only when the app opted the window into
                                         // COLOR_MODE_HDR (GlassHdr) on an HDR panel: then the
                                         // glass border light may exceed SDR white, while the
                                         // backdrop seen through the glass stays SDR (HIGHLIGHT).

        uniform float2 touchPos;         // view-local px, same space as `pixels`. No Metal
                                         // counterpart — the `interactive` press glow.
        uniform float  touchGlow;        // 0..1 press progress; 0 turns the branch off.
        uniform float  touchLens;        // 0..1 gate on the press's *optical* half — the backdrop
                                         // dent and the refraction boost. 1 for a press on this
                                         // view (`interactive`). 0 for a press being reported from
                                         // elsewhere (`glow`), where only the light belongs here:
                                         // a bar hosting a grabbed pill lights up, it does not
                                         // start refracting harder. See GlassGlowOptions.

        uniform float4 shapeRect;        // The primary shape: xy = its center's offset from the
                                         // view center, zw = its half extents — px. The uploader
                                         // defaults it to (0, 0, size * 0.5), the view-filling
                                         // shape, unless `metal.shape` insets it. Metal:
                                         // shapeSize + shapeOffset.
        uniform float4 morphRect;        // The morph partner: xy = its center's offset from the
                                         // SHAPE center, zw = its half extents — px. Metal:
                                         // morphRect, identically.
        uniform float2 morphShape;       // (corner radius, smoothing), px. smoothing <= 0 turns
                                         // the merge branch off and the field is bit-identical
                                         // to the single-shape build. Metal: morphShape.

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
          uniform float dispersionQuadrant;    // 0 = the rim fringes evenly all the way round
                                               // (iOS/Metal). 1 = Kyant's quadrant weighting; see
                                               // the REFRACTION_WITH_DISPERSION fragment.

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

    // Metal :55-60, generalized: quadrant-select any per-corner packed float4 (extents, shapes).
    // The argument MUST be the CENTERED coordinate, y-down. NB: `packed` is a reserved word in
    // SkSL — hence `corners`.
    float cornerParam(float2 c, float4 corners) {
        if (c.x >= 0.0) {
            return (c.y <= 0.0) ? corners.z : corners.y;   // right-top : right-bottom
        }
        return (c.y <= 0.0) ? corners.w : corners.x;       // left-top  : left-bottom
    }

    // Metal :62-69, extended to the continuous-corner family (research/05): a corner is a
    // superellipse quadrant in an E x E cell, and (E = r, n = 2) IS the circular corner — the
    // else-branch below is the original Euclidean SDF verbatim, with E in place of r. The edge
    // and interior algebra cancels E exactly as it cancelled r, so straight edges stay exact for
    // any extent.
    //
    // The corner branch is the n-norm field with a first-order Euclidean correction,
    // sd ~ (g - E) / |grad g|. Measured against the true curve: error <= 0.11 px at 20 px depth,
    // growing only where the refraction profile has already decayed to ~0 (research/05 tables).
    // pow() is only ever called with a strictly positive base (the qp > 0 guards), so the
    // GLSL-undefined pow(x<0) and pow(0, 0) cases are unreachable.
    float sdGlassRect(float2 c, float2 halfSize, float4 extents, float4 shapes) {
        // The host resolves the view's own extents; the min() is for rects it cannot see — a
        // `metal.shape` smaller than the radii resolved against it. innerHalf < 0 breaks the SDF.
        float E = min(cornerParam(c, extents), min(halfSize.x, halfSize.y));
        float n = cornerParam(c, shapes);
        float2 innerHalf = halfSize - float2(E);
        float2 q = abs(c) - innerHalf;
        float2 qp = max(q, float2(0.0));
        float outside;
        if (n > 2.001 && qp.x > 0.0 && qp.y > 0.0) {
            float g = max(pow(pow(qp.x, n) + pow(qp.y, n), 1.0 / n), kNormEps);
            float2 dg = pow(qp / g, float2(n - 1.0));
            outside = (g - E) / max(length(dg), kNormEps);
        } else {
            outside = length(qp) - E;
        }
        float inside = min(max(q.x, q.y), 0.0);
        return outside + inside;
    }

    // Metal :71-81, same extension. In the corner cell the outward direction is the n-norm
    // field's gradient (qp/g)^(n-1), which at n = 2 is qp itself — the original normalize
    // direction. pow(0, n-1) with n > 2 is defined (0), so a cell-boundary qp component is safe.
    float2 gradGlassRect(float2 c, float2 halfSize, float4 extents, float4 shapes) {
        float E = min(cornerParam(c, extents), min(halfSize.x, halfSize.y));
        float n = cornerParam(c, shapes);
        float2 innerHalf = halfSize - float2(E);
        float2 q = abs(c) - innerHalf;

        float insideCorner = step(0.0, min(q.x, q.y));
        float xMajor = step(q.y, q.x);
        float2 gradEdge = float2(xMajor, 1.0 - xMajor);
        float2 qp = max(q, float2(0.0));
        float2 dir = qp;
        if (n > 2.001) {
            float g = max(pow(pow(qp.x, n) + pow(qp.y, n), 1.0 / n), kNormEps);
            dir = pow(qp / g, float2(n - 1.0));
        }
        float2 gradCorner = safeNormalize(dir, float2(0.0));
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
    float4 sampleBackdrop(float2 viewPx) {
        // The `interactive` dent: samples near the finger are pulled toward it, which reads as a
        // magnifying bulge travelling with the touch — the glass flexing, not just lighting up.
        // Living here means every read warps coherently (interior, rim band, all dispersion taps)
        // for the cost of a length() per sample, and geometry (sd, normals, t) stays un-warped.
        // d == 0 at the touch point, so there is no normalize() and no NaN to guard.
        if (touchGlow * touchLens > 0.0) {
            float2 d = viewPx - touchPos;
            float f = 1.0 - smoothstep(0.0, 0.6 * min(size.x, size.y), length(d));
            viewPx -= d * (f * f * 0.22 * touchGlow * touchLens);
        }
        float2 nodePx = clamp(viewPx - offset, crop.xy, crop.zw);
        // content.eval() returns half4 by language definition; widen at once so no half-precision
        // value ever enters the arithmetic. The node is PREMULTIPLIED: un-premultiply and carry
        // the alpha out, so a partially-covered texel — a capsule layer's anti-aliased corner,
        // anything a small provider never drew — keeps its true hue instead of reading as black.
        // The epilogue folds this coverage into the output alpha: glass over nothing recorded
        // passes the real content behind it through rather than painting black.
        float4 c = float4(content.eval(nodePx));
        return float4(c.rgb / max(c.a, 1e-4), c.a);
    }

  """.trimIndent() + "\n"

  private val MAIN_PROLOGUE = """
    half4 main(float2 fragCoord) {
        // Metal :183-185
        float2 pixels = fragCoord + offset;        // view-local px, top-left origin, y-down
        // Shape-centered, not view-centered: with `metal.shape` absent the uploader sends
        // shapeRect = (0, 0, size * 0.5) and both lines are the historical ones exactly.
        // Sampling positions stay `pixels` — only geometry moves.
        float2 halfSize = shapeRect.zw;
        float2 centered = pixels - size * 0.5 - shapeRect.xy;

        // Reordered relative to Metal, which builds the whole GlassGeometry at :187 before testing
        // at :191. The SDF alone decides the early-out, so the gradient / direction / scale work is
        // skipped for every pixel in the padded margin — which is most of them.
        float sd = sdGlassRect(centered, halfSize, cornerExtents, cornerShapes);

        // The morph partner (Metal: glassGeometry's morph fold), BEFORE the early-out: the
        // smooth-min neck lies outside both source shapes, so a coverage test on the primary SDF
        // alone would discard exactly the pixels the merge exists to draw. The fold is the
        // polynomial smooth-min — I. Quilez's smin, published mid-2000s and folklore since — and
        // everything downstream reads the merged field, which is what fuses the two shapes into
        // one pane of liquid instead of two panes overlapping. The partner's corners are
        // circular (n = 2): its radius is a single scalar, and the continuous-corner family
        // stays a primary-shape refinement.
        float2 morphHalf = morphRect.zw;
        float2 morphCoord = centered - morphRect.xy;
        float morphR = min(morphShape.x, min(morphHalf.x, morphHalf.y));
        float morphH = 1.0;
        if (morphShape.y > 0.0 && morphHalf.x > 0.0 && morphHalf.y > 0.0) {
            float sdB = sdGlassRect(morphCoord, morphHalf, float4(morphR), float4(2.0));
            float k = morphShape.y;
            morphH = clamp(0.5 + 0.5 * (sdB - sd) / k, 0.0, 1.0);
            sd = mix(sdB, sd, morphH) - k * morphH * (1.0 - morphH);
        }

        // fwidth() does not exist in AGSL. |grad(sd)| == 1 for an exact SDF and we are in device
        // pixels, so fwidth(sd) == 1.0 — a 2 px feather, which is exactly what iOS produces
        // (fwidth(sd_points) = 1/contentsScale points). The smooth-min field is not exact in the
        // blend zone (|grad| dips below 1), which only widens the feather there — the seam is
        // softer, never harder.
        float aa = 1.0;
        float shapeAlpha = 1.0 - smoothstep(-aa, aa, sd);
        if (shapeAlpha <= 0.001) {
            return half4(0.0);                     // Metal :192
        }

        // Metal :141-163 (glassGeometry). The 1.5x inflation applies to the corner-cell extents
        // now — for circular corners that is exactly Metal's radius inflation, and for continuous
        // ones it widens the same look-tuning band around the softer corner.
        float4 maxGradExtent = float4(min(halfSize.x, halfSize.y));      // :147
        float4 gradExtents = min(cornerExtents * 1.5, maxGradExtent);    // :148
        float2 normal = safeNormalize(
            gradGlassRect(centered, halfSize, gradExtents, cornerShapes),
            float2(0.0, 1.0));                                           // :149-150

        // The merged field's gradient: the two shapes' gradients blended by the same hermite
        // weight — standard SDF practice (the exact derivative's dh terms are dropped), smooth
        // everywhere the weight is. morphH == 1.0 covers both "no partner" and "far on the
        // primary's side", so the extra gradient is only ever computed near the partner.
        if (morphH < 1.0) {
            float4 maxGradB = float4(min(morphHalf.x, morphHalf.y));
            float4 gradExtentsB = min(float4(morphR) * 1.5, maxGradB);
            float2 normalB = safeNormalize(
                gradGlassRect(morphCoord, morphHalf, gradExtentsB, float4(2.0)),
                float2(0.0, 1.0));
            normal = safeNormalize(mix(normalB, normal, morphH), normal);
        }

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
        // with press progress; this is that, riding the existing uniform. 1.0 at rest, and 1.0 for
        // a press reported from another view, which lights this glass without bending it further.
        float touchBoost = 1.0 + 0.35 * touchGlow * touchLens;

        float3 color;
        // Backdrop coverage under this pixel's sample(s); the epilogue multiplies it into the
        // output alpha, so glass over un-recorded regions transmits reality instead of black.
        float bdAlpha = 1.0;

  """.trimIndent() + "\n"

  /**
   * The `spreadMag < 2 * unitScale` guard is what keeps `maxI >= 2`, so `u` takes at least 0, 0.5
   * and 1.0 and every channel mask fires. If only `u = 0` were active the mask would be (0,0,1) and
   * the divide would force red and green to black — a solid blue rim on every glass edge. The guard
   * tests the *magnitude*, which is what makes the quadrant weighting safe: it drives the spread
   * through zero along the centre lines, and the untested signed value would sail straight past a
   * `< 2` test on the negative side and into a two-tap walk.
   */
  private val REFRACTION_WITH_DISPERSION = """
        if (inside >= scale) {
            float4 sIn = sampleBackdrop(pixels);                         // Metal :198-199
            color = sIn.rgb;
            bdAlpha = sIn.a;
        } else {
            // Metal :165-169 (refractedPixels), hoisted: Metal recomputes it identically at :205
            // and :207. The pow() base is 1-t with t clamped to [0,1] so it is never negative, and
            // the exponent is floored so pow(0, 0) is unreachable.
            float profile = circleMap(pow(1.0 - t, max(profilePower, 1e-3)));
            float amount = (profile + profileBias * (1.0 - t)) * refractionAmount * touchBoost;
            float2 base = pixels - amount * direction;                   // NOTE the minus (:168)

            float dispersionT = clamp(inside / max(dispersionHeight, 1e-3), 0.0, 1.0);
            float spread = circleMap(1.0 - dispersionT) * dispersionAmount * touchBoost;

            // Kyant's quadrant weighting, blended in by `dispersionQuadrant`
            // (internal/Shaders.kt:`dispersionIntensity`, Apache-2.0 — see NOTICE). The product of
            // the normalized centered coordinates is 0 along BOTH centre lines and +/-1 at the
            // corners, so the fringe lives where the eye already reads the shape bending — the
            // capsule's ends — and dies out along its flanks. Left signed on purpose: the sign
            // flips between adjacent quadrants, which walks the taps the other way and so reverses
            // the hue order. That alternation is the effect's whole signature, and abs() would
            // quietly delete it.
            //
            // |weight| <= 1 always, so this only ever SHRINKS the spread — the padding budget
            // (GlassAppearance.dispersionOutwardReachPx) stays a valid bound and needs no change.
            float2 quadrant = centered / max(halfSize, float2(1e-3));
            spread *= mix(1.0, quadrant.x * quadrant.y, dispersionQuadrant);

            // Magnitude from here down: a negative spread is a direction, not a smaller one.
            float spreadMag = abs(spread);

            // The literal 2.0 is POINTS in the Metal source (:204).
            if (spreadMag < 2.0 * unitScale) {
                float4 sBase = sampleBackdrop(base);                     // :205
                color = sBase.rgb;
                bdAlpha = sBase.a;
            } else {
                // LONGITUDINAL aberration: taps walk along the displacement axis itself — R
                // sampled deepest, B shallowest, G centred. Metal walks the tangent (:208) and
                // the first port copied it; per-channel phase solves of real iOS 26 measured the
                // spread along the displacement direction with blue as the outermost fringe
                // (research/04, C26). `base - direction * s` deepens the sample for positive s,
                // so the R half of the mask (u > 0.5) lands deepest.
                float3 accumulated = float3(0.0);
                float3 weight = float3(0.0);
                float aAccum = 0.0;
                float aTaps = 0.0;

                // Metal: maxI = min(spread, 16) with `pixels` in POINTS — one tap per point.
                // dispersionTapSpacing == unitScale reproduces that exactly.
                float maxI = min(spreadMag / max(dispersionTapSpacing, 1e-3),
                                 float(kDispersionTaps));                // :212

                for (int i = 0; i < kDispersionTaps; ++i) {
                    float u = float(i) / maxI;                           // :215
                    // Metal writes `if (u > 1.0) break;` (:216). A dynamic `if` is used instead: it
                    // stays statically unrollable across the whole API 33-36 Skia range, and the GPU
                    // still skips the eval when the wave agrees. The accumulator and weight are
                    // untouched when the test fails, so the result is identical.
                    if (u <= 1.0) {
                        float4 tap = sampleBackdrop(base - direction * (u - 0.5) * spread);
                        float3 mask = float3(step(0.5, u),                   // R: upper half
                                             step(0.25, u) * step(u, 0.75),  // G: middle band
                                             step(u, 0.5));                  // B: lower half
                        accumulated += tap.rgb * mask;
                        weight += mask;
                        aAccum += tap.a;
                        aTaps += 1.0;
                    }
                }
                color = accumulated / max(weight, float3(1e-6));         // :227
                bdAlpha = aAccum / max(aTaps, 1.0);
            }
        }

  """.trimIndent().prependIndent("    ") + "\n"

  private val REFRACTION_ONLY = """
        {
            float4 s;
            if (inside >= scale) {
                s = sampleBackdrop(pixels);                              // Metal :198-199
            } else {
                // Metal :165-169 (refractedPixels). The LOW tier stops here: no chromatic
                // dispersion.
                float profile = circleMap(pow(1.0 - t, max(profilePower, 1e-3)));
                float amount = (profile + profileBias * (1.0 - t)) * refractionAmount * touchBoost;
                s = sampleBackdrop(pixels - amount * direction);         // NOTE the minus (:168)
            }
            color = s.rgb;
            bdAlpha = s.a;
        }

  """.trimIndent().prependIndent("    ") + "\n"

  // Metal :231-236. Rec.709 luma, computed in gamma space exactly as Metal does.
  //
  // The frost/tint pair used to be two `mix`es straight onto the transmitted colour, and the
  // epilogue then multiplied the whole output alpha by `bdAlpha`. That is wrong wherever the
  // provider recorded nothing: a glass card overhanging the gap between two cards lost its frost,
  // its tint and its shape alpha all at once and punched a hard-edged hole to the window
  // background. Glass over nothing is still glass — you lose what it transmits, not the pane.
  //
  // So the two are separated and composited by their real coverage. Expanding the original pair,
  //
  //     mix(mix(t, F, fa), T, ta) = t*(1-fa)*(1-ta) + F*fa*(1-ta) + T*ta
  //
  // the transmitted term carries weight `(1-fa)(1-ta)`, which is exactly `1 - surfaceAlpha`, and
  // the rest is the surface's own premultiplied colour. Weighting the transmitted term by
  // `bdAlpha` and dividing by the resulting coverage is ordinary source-over — and at `bdAlpha
  // == 1` every line below algebraically collapses back to the two `mix`es, so fully-covered
  // glass is bit-for-bit what it always was.
  private val TONE_CHAIN = """
        color = clamp(color, 0.0, 1.0);

        float luma = dot(color, float3(0.2126, 0.7152, 0.0722));
        color = mix(float3(luma), color, saturation);

        float surfaceAlpha = frostColor.a + tintColor.a * (1.0 - frostColor.a);
        float3 surfacePremul =
            frostColor.rgb * (frostColor.a * (1.0 - tintColor.a)) + tintColor.rgb * tintColor.a;
        float transmitWeight = (1.0 - surfaceAlpha) * bdAlpha;
        // Coverage of the finished pane: its own surface, plus whatever it actually transmits.
        // With no surface at all this is just `bdAlpha` — clear glass over nothing IS nothing.
        float cover = surfaceAlpha + transmitWeight;
        color = (color * transmitWeight + surfacePremul) / max(cover, 1e-4);

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
  // HDR: only the border light glints past SDR white. The interior is min()'d to 1.0 first —
  // glass does not amplify what is behind it — and the rim's additive term scales by 75% of the
  // available headroom (full headroom reads as a torch, not a glint; eye-tuned on the Nothing
  // Phone (2)). The sheen stays SDR: it is a broad wash, and boosting it lifts whole quadrants.
  // At hdrHeadroom == 1 every line below reduces to the pre-HDR build bit-for-bit: min(x, 1.0)
  // followed by the epilogue clamp is the old single clamp, and the glint factor is 1.
  private val HIGHLIGHT = """
        float rim = pow(abs(dot(normal, lobeDir)), highlightFalloff);
        float rimT = clamp(inside / max(highlightWidth, 1e-3), 0.0, 1.0);
        float rimBand = 1.0 - smoothstep(0.0, 1.0, rimT);

        float sheenT = clamp(inside / (7.0 * unitScale), 0.0, 1.0);
        float sheen = 1.0 - smoothstep(0.0, 1.0, sheenT);

        float glint = 1.0 + (hdrHeadroom - 1.0) * 0.75;

        // The body of the glass may exceed SDR only through its own light: `lightIntensity`
        // scales into the headroom, so LIT glass over a white backdrop genuinely brightens,
        // while light = 0 keeps the interior pinned at SDR no matter the backdrop — glass does
        // not amplify what it merely transmits.
        color = min(color * (1.0 + lightIntensity * glint), hdrHeadroom);
        color += rim * rimBand * highlightIntensity * glint;
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
  //
  // HDR: the SDR shimmer (flat 0.08 wash + Kyant's broad 0.15 lobe) is untouched — that lobe
  // spans 1.5x the view at full strength across half of it, and scaling THAT by headroom washes
  // the whole surface to white (shipped for one build; the user's finger found it in minutes).
  // The headroom goes instead into a separate TIGHT core: ~90 dp reach, squared falloff — a
  // fingertip-sized light igniting under the glass, absolute-sized because a finger is the same
  // size on every view. At headroom 1 the core term is exactly zero: pre-HDR build, bit for bit.
  private val TOUCH_GLOW_FRAGMENT = """
        if (touchGlow > 0.0) {
            float touchRadius = 1.5 * min(size.x, size.y);
            float touchDist = distance(pixels, touchPos);
            float touchFalloff = 1.0 - smoothstep(touchRadius * 0.5, touchRadius, touchDist);
            color += (0.08 + 0.15 * touchFalloff) * touchGlow;

            float hotFalloff = 1.0 - smoothstep(0.0, 90.0 * unitScale, touchDist);
            color += 0.35 * (hdrHeadroom - 1.0) * hotFalloff * hotFalloff * touchGlow;
        }

  """.trimIndent().prependIndent("    ") + "\n"

  // Metal :252-255. The narrowing to half is the last statement of the shader and is written as an
  // explicit constructor — float -> half is not an implicit conversion in SkSL.
  //
  // The upper clamp is the HDR ceiling: 1.0 on an SDR window (identical to the Metal source), up
  // to the display's live ratio on an opted-in HDR window. Values above 1 survive premultiply on
  // the FP16 surface; on an SDR surface the uniform is pinned to 1 by the uploader, so nothing
  // out of range is ever emitted there.
  private val MAIN_EPILOGUE = """
        color = clamp(color, 0.0, hdrHeadroom);

        // `cover` (TONE_CHAIN) folds the backdrop's coverage in: where the provider recorded
        // nothing — a small layer's margins, a capsule layer's corners, the gap between two cards
        // an overhanging pane crosses — the glass stops *transmitting* and thins to its own frost
        // and tint, instead of shading premultiplied black or vanishing outright.
        float alpha = shapeAlpha * glassOpacity * cover;
        return half4(color * alpha, alpha);
    }
  """.trimIndent() + "\n"
}
