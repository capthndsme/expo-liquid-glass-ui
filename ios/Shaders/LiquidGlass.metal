#include <metal_stdlib>
using namespace metal;

// =============================================================================================
//  LiquidGlass.metal — the pre-iOS-26 renderer.
//
//  The glass pass is kept line-for-line in step with the Android AGSL build
//  (android/.../glass/GlassShaderSource.kt), which is where every remodel against real iOS 26
//  glass was measured (docs/android-port/research/04): the continuous-corner SDF family, the
//  additive two-lobe border light, longitudinal dispersion, the press dent and glow, the inner
//  shadow and the whole-surface magnification. One algorithm, two languages; a divergence
//  between them is a bug in whichever side moved last.
//
//  Coordinate space: view-local POINTS, origin at the view's top-left, y down. Every length in
//  GlassParams is in points. (Android works in device pixels and carries a `unitScale`; here a
//  point IS the unit, so the hard-coded point values below need no conversion.)
//
//  Portions of the Android build derive from AndroidLiquidGlass (Apache-2.0, (c) 2025 Kyant) —
//  the rounded-rect SDF decomposition, the highlight's angular falloff model and the press glow;
//  see NOTICE. Those came home to this file with the parity pass.
// =============================================================================================

struct VertexOut {
    float4 position [[position]];
    float2 uv;
};

struct BlurParams {

    float4 uvRect;

    // The progressive ramp (metal.progressiveBlur). rampLine.xy is the view-local point (in
    // points, y-down) where the ramp begins, rampLine.zw is the unit direction divided by the
    // ramp's length so a dot() lands directly in 0..1. rampRadii holds the leading and trailing
    // radii in texels; a negative x disables the ramp and the uniform `radius` applies.
    float4 rampLine;
    float2 rampRadii;
    float2 paddedSize;   // the padded region this pass covers, points

    float2 texelStep;
    float  radius;
    float  padding;      // points of padding on each side: viewPos = uv * paddedSize - padding
};

// Field order and types mirror GlassRenderContext.swift's GlassParams exactly: eight float4s,
// seven float2s, then seventeen floats — every member naturally aligned in both layouts, so
// neither compiler inserts interior padding and every offset agrees (252 bytes of fields, 256
// with the trailing alignment pad on both sides). Reorder one side and the shader reads garbage.
// docs/inspiration-port/tools/check-params-layout.py verifies the two against each other.
struct GlassParams {
    float4 cornerExtents;     // corner-cell extents, points, packed (BL, BR, TR, TL). E = r for a
                              // circular corner, up to 1.5287 r for a continuous one.
    float4 cornerShapes;      // superellipse exponent per corner, same packing. 2 = circular,
                              // 3.3418 = Apple's continuous corner (research/05).
    float4 tintColor;         // straight RGBA
    float4 frostColor;        // rgb = system background, a = frost amount
    float4 sourceRect;        // where this view sits in the sampled texture, UV
    float4 morphRect;         // the morph partner: xy = its center's offset from the SHAPE
                              // center, zw = its half extents. Points, like every length here.
    float4 innerShadow;       // rgb = shadow colour, a = its opacity. a <= 0 turns the band off.
    float4 touch;             // xy = press hotspot (view-local points), z = glow 0..1,
                              // w = the lens gate: 1 for a press on this glass, 0 for one
                              // reported from elsewhere (light only, no dent).

    float2 morphShape;        // (partner corner radius, smoothing); smoothing <= 0 = off
    float2 viewSize;
    float2 shapeSize;         // the primary shape's size; == viewSize unless metal.shape insets it
    float2 shapeOffset;       // the shape center relative to the view center; zero by default
    float2 refractionScale;
    float2 highlightDir;      // (cos angle, sin angle) — the per-pixel sin/cos pair, hoisted
    float2 innerShadowOffset; // points

    float  refractionAmount;
    float  refractionSwirl;   // lean of the displacement toward the light axis; 0 = none
    float  depthEffect;
    float  profilePower;
    float  profileBias;
    float  dispersionHeight;
    float  dispersionAmount;
    float  dispersionQuadrant; // 0 = even rim fringe (iOS), 1 = Kyant's corner weighting
    float  highlightIntensity;
    float  highlightWidth;    // depth of the crisp border light, points
    float  highlightFalloff;  // angular falloff exponent of the two lobes, >= 0.01
    float  lightIntensity;
    float  glassOpacity;
    float  saturation;
    float  noiseAmount;
    float  innerShadowRadius; // points; 0 = off
    float  magnification;     // >= 1; 1 = none. Sampling contracts toward the shape center.
};

vertex VertexOut liquid_glass_vertex(const device float4 *vertices [[buffer(0)]],
                                     uint vid [[vertex_id]]) {
    VertexOut out;
    out.position = float4(vertices[vid].xy, 0.0, 1.0);
    out.uv = vertices[vid].zw;
    return out;
}

constant float kNormEps = 1e-6;
constant int kBlurTaps = 8;
constant int kDispersionTaps = 16;

// The faint broad glow under the lit edges, points deep (research/04: ~7 pt on real iOS 26).
constant float kSheenDepth = 7.0;

constexpr sampler linearSampler(mag_filter::linear,
                                min_filter::linear,
                                address::clamp_to_edge);

// ----------------------------------------------------------------------------------- geometry

// NaN-free normalize. A ternary is not safe: if the compiler lowers `cond ? normalize(v) : fb`
// to an arithmetic select then normalize(0) = NaN is still multiplied by 0, and NaN * 0 = NaN.
// The division form cannot produce NaN for any finite v, because the denominator is floored.
inline float2 safeNormalize(float2 v, float2 fallback) {
    float len = length(v);
    float ok = step(kNormEps, len);
    return mix(fallback, v / max(len, kNormEps), ok);
}

// Quadrant-select any per-corner packed float4 (extents, shapes). The argument MUST be the
// CENTERED coordinate, y down.
inline float cornerParam(float2 c, float4 corners) {
    if (c.x >= 0.0) {
        return (c.y <= 0.0) ? corners.z : corners.y;   // right-top : right-bottom
    }
    return (c.y <= 0.0) ? corners.w : corners.x;       // left-top  : left-bottom
}

// The rounded-rect SDF, extended to the continuous-corner family (research/05): a corner is a
// superellipse quadrant in an E x E cell, and (E = r, n = 2) IS the circular corner — the
// else-branch is the original Euclidean SDF verbatim, with E in place of r. The edge and
// interior algebra cancels E exactly as it cancelled r, so straight edges stay exact for any
// extent.
//
// The corner branch is the n-norm field with a first-order Euclidean correction,
// sd ~ (g - E) / |grad g|. Measured against the true curve: error <= 0.11 px at 20 px depth,
// growing only where the refraction profile has already decayed to ~0. pow() is only ever
// called with a strictly positive base (the qp > 0 guards), so pow(x < 0) and pow(0, 0) are
// unreachable.
inline float sdGlassRect(float2 c, float2 halfSize, float4 extents, float4 shapes) {
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

// Same extension for the gradient. In the corner cell the outward direction is the n-norm
// field's gradient (qp/g)^(n-1), which at n = 2 is qp itself — the original normalize direction.
inline float2 gradGlassRect(float2 c, float2 halfSize, float4 extents, float4 shapes) {
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

// KEEP the max(0.0, …): without it this returns NaN for |x| > 1.
inline float circleMap(float x) {
    return 1.0 - sqrt(max(0.0, 1.0 - x * x));
}

inline float hashNoise(float2 co) {
    return fract(sin(dot(co, float2(12.9898, 78.233))) * 43758.5453);
}

// The merged field: the primary shape with the morph partner folded in by the polynomial
// smooth-min (I. Quilez's smin, published mid-2000s and folklore since). Everything downstream
// reads this field and its blended gradient, which is what fuses two nearby shapes into one
// pane of liquid instead of two panes overlapping. `morphH` comes out as the blend weight —
// 1.0 both when there is no partner and far on the primary's side — for the gradient blend.
//
// The partner's corners are circular (n = 2): its radius is a single scalar, and the
// continuous-corner family stays a primary-shape refinement.
inline float mergedSd(float2 centered, constant GlassParams &params, thread float &morphH) {
    float2 halfSize = params.shapeSize * 0.5;
    float sd = sdGlassRect(centered, halfSize, params.cornerExtents, params.cornerShapes);

    float2 morphHalf = params.morphRect.zw;
    morphH = 1.0;
    if (params.morphShape.y > 0.0 && morphHalf.x > 0.0 && morphHalf.y > 0.0) {
        float2 morphCoord = centered - params.morphRect.xy;
        float morphR = min(params.morphShape.x, min(morphHalf.x, morphHalf.y));
        float sdB = sdGlassRect(morphCoord, morphHalf, float4(morphR), float4(2.0));
        float k = params.morphShape.y;
        morphH = clamp(0.5 + 0.5 * (sdB - sd) / k, 0.0, 1.0);
        sd = mix(sdB, sd, morphH) - k * morphH * (1.0 - morphH);
    }
    return sd;
}

// ------------------------------------------------------------------------------------- blur

fragment float4 blurFragment(VertexOut in [[stage_in]],
                             texture2d<float> source [[texture(0)]],
                             constant BlurParams &params [[buffer(1)]]) {
    float2 base = params.uvRect.xy + in.uv * params.uvRect.zw;

    float radius = params.radius;
    if (params.rampRadii.x >= 0.0) {
        // The local radius from a Hermite-eased ramp over view-local points. Both passes cover
        // the same padded region, so in.uv maps identically in each.
        float2 viewPos = in.uv * params.paddedSize - params.padding;
        float t = clamp(dot(viewPos - params.rampLine.xy, params.rampLine.zw), 0.0, 1.0);
        t = t * t * (3.0 - 2.0 * t);
        radius = mix(params.rampRadii.x, params.rampRadii.y, t);
    }

    if (radius <= 0.01) {
        return source.sample(linearSampler, base);
    }

    float sigma = max(radius * 0.5, 0.0001);
    float invTwoSigmaSq = -1.0 / (2.0 * sigma * sigma);

    float stride = max(radius * 1.5 / float(kBlurTaps), 1.0);
    // Per-pixel comb jitter — the sparse-tap plaid fix, measured on the Android port of this
    // exact loop. Sub-pixel at the stride floor, so the small-radius look this pass has always
    // had is untouched.
    float jitter = hashNoise(in.uv * 587.0 + params.texelStep) - 0.5;

    float4 sum = source.sample(linearSampler, base);
    float weightSum = 1.0;

    for (int i = 0; i < kBlurTaps; ++i) {
        float offset = (float(i) + 0.5 + jitter) * stride;
        float weight = exp2(offset * offset * invTwoSigmaSq * 1.4426950);
        float2 delta = params.texelStep * offset;

        sum += source.sample(linearSampler, base + delta) * weight;
        sum += source.sample(linearSampler, base - delta) * weight;
        weightSum += weight * 2.0;
    }

    return sum / weightSum;
}

// ------------------------------------------------------------------------------------ glass

// Every backdrop read passes through here, which is what keeps the press dent coherent:
// samples near the finger are pulled toward it, so the interior, the rim band and every
// dispersion tap warp together as a magnifying bulge travelling with the touch, while geometry
// (sd, normals, t) stays un-warped. d == 0 at the touch point, so there is no normalize() and no
// NaN to guard. The branch is uniform-coherent — free while nothing is pressed.
inline float3 sampleBackdrop(texture2d<float> source,
                             float2 pixels,
                             constant GlassParams &params) {
    float lens = params.touch.z * params.touch.w;
    if (lens > 0.0) {
        float2 d = pixels - params.touch.xy;
        float f = 1.0 - smoothstep(0.0, 0.6 * min(params.viewSize.x, params.viewSize.y), length(d));
        pixels -= d * (f * f * 0.22 * lens);
    }
    float2 uv = pixels / params.viewSize;
    float2 texUV = params.sourceRect.xy + uv * params.sourceRect.zw;

    return source.sample(linearSampler, clamp(texUV, float2(0.0), float2(1.0))).rgb;
}

fragment float4 glassFragment(VertexOut in [[stage_in]],
                              texture2d<float> source [[texture(0)]],
                              constant GlassParams &params [[buffer(1)]]) {
    float2 halfSize = params.shapeSize * 0.5;
    float2 pixels = in.uv * params.viewSize;
    // Shape-centered, not view-centered: with `metal.shape` unset the offset is zero and this is
    // the historical line exactly. Sampling positions stay `pixels` — only geometry moves.
    float2 centered = pixels - params.viewSize * 0.5 - params.shapeOffset;

    // The SDF alone decides the early-out — before any gradient work, and on the MERGED field,
    // because the smooth-min neck lies outside both source shapes: a coverage test on the
    // primary SDF alone would discard exactly the pixels the merge exists to draw.
    float morphH = 1.0;
    float sd = mergedSd(centered, params, morphH);

    float aa = max(fwidth(sd), 1e-4);
    float shapeAlpha = 1.0 - smoothstep(-aa, aa, sd);
    if (shapeAlpha <= 0.001) {
        return float4(0.0);
    }

    // Normals from corner cells inflated 1.5x — for circular corners that is exactly the
    // original radius inflation, and for continuous ones it widens the same look-tuning band
    // around the softer corner.
    float4 maxGradExtent = float4(min(halfSize.x, halfSize.y));
    float4 gradExtents = min(params.cornerExtents * 1.5, maxGradExtent);
    float2 normal = safeNormalize(
        gradGlassRect(centered, halfSize, gradExtents, params.cornerShapes),
        float2(0.0, 1.0));

    // The merged field's gradient: the two shapes' gradients blended by the same hermite
    // weight — standard SDF practice (the exact derivative's dh terms are dropped), smooth
    // everywhere the weight is. Only ever computed near the partner.
    if (morphH < 1.0) {
        float2 morphHalf = params.morphRect.zw;
        float2 morphCoord = centered - params.morphRect.xy;
        float morphR = min(params.morphShape.x, min(morphHalf.x, morphHalf.y));
        float4 maxGradB = float4(min(morphHalf.x, morphHalf.y));
        float4 gradExtentsB = min(float4(morphR) * 1.5, maxGradB);
        float2 normalB = safeNormalize(
            gradGlassRect(morphCoord, morphHalf, gradExtentsB, float4(2.0)),
            float2(0.0, 1.0));
        normal = safeNormalize(mix(normalB, normal, morphH), normal);
    }

    float2 radial = safeNormalize(centered, float2(0.0));

    // The light axis: highlightDir rotated +90 degrees — the same axis the border-light lobes
    // sit on, so `highlight.angle` steers both. Mixing it into the displacement direction
    // before normalizing leans the edge refraction toward the light — a stylisation knob, OFF
    // by default: measured real iOS 26 glass carries no such lean (research/04, C8); its
    // perceived twist is the radial term sweeping through the corners.
    float2 lobeDir = float2(-params.highlightDir.y, params.highlightDir.x);
    float2 direction = safeNormalize(
        normal + params.depthEffect * radial + params.refractionSwirl * lobeDir, normal);

    // Anisotropic refraction height: n^2 . refractionScale yields refractionScale.x on a
    // vertical edge and .y on a horizontal one.
    float2 limit = max(halfSize, float2(1e-3));
    float2 scale2 = clamp(params.refractionScale, float2(1e-3), limit);
    float scale = max(dot(normal * normal, scale2), 1e-3);

    float t = clamp(-min(sd, 0.0) / scale, 0.0, 1.0);
    float inside = -min(sd, 0.0);

    // The press deepens the lens — Kyant's components animate their lens amount with press
    // progress; this is that. 1.0 at rest, and 1.0 for a press reported from another view,
    // which lights this glass without bending it further.
    float glow = params.touch.z;
    float touchBoost = 1.0 + 0.35 * glow * params.touch.w;

    // The whole-surface lens (research/04, C16): sampling contracts toward the shape center by
    // the magnification, so the backdrop reads enlarged through the pane. Geometry is untouched
    // — the edge band still bends off the true silhouette — and >= 1 only ever samples inward.
    float2 samplePx = pixels;
    if (params.magnification > 1.0001) {
        samplePx = pixels - centered * (1.0 - 1.0 / params.magnification);
    }

    float3 color;

    if (inside >= scale) {
        color = sampleBackdrop(source, samplePx, params);
    } else {
        float profile = circleMap(pow(1.0 - t, max(params.profilePower, 1e-3)));
        float amount = (profile + params.profileBias * (1.0 - t))
            * params.refractionAmount * touchBoost;
        float2 base = samplePx - amount * direction;

        float dispersionT = clamp(inside / max(params.dispersionHeight, 1e-3), 0.0, 1.0);
        float spread = circleMap(1.0 - dispersionT) * params.dispersionAmount * touchBoost;

        // Kyant's quadrant weighting, blended in by `dispersionQuadrant`: the product of the
        // normalized centered coordinates is 0 along both centre lines and +/-1 at the corners,
        // so the fringe lives where the eye already reads the shape bending — a capsule's ends —
        // and dies out along its flanks. Left signed on purpose: the sign flips between
        // adjacent quadrants, which walks the taps the other way and reverses the hue order.
        float2 quadrant = centered / max(halfSize, float2(1e-3));
        spread *= mix(1.0, quadrant.x * quadrant.y, params.dispersionQuadrant);
        // Magnitude from here down: a negative spread is a direction, not a smaller one.
        float spreadMag = abs(spread);

        if (spreadMag < 2.0) {
            color = sampleBackdrop(source, base, params);
        } else {
            // LONGITUDINAL aberration: taps walk along the displacement axis itself — R sampled
            // deepest, B shallowest, G centred. Per-channel phase solves of real iOS 26 measured
            // the spread along the displacement direction with blue as the outermost fringe
            // (research/04, C26); the tangent walk this pass used to do puts the fringe on the
            // wrong axis. `base - direction * s` deepens the sample for positive s, so the R half
            // of the mask (u > 0.5) lands deepest.
            float3 accumulated = float3(0.0);
            float3 weight = float3(0.0);
            float maxI = min(spreadMag, float(kDispersionTaps));   // one tap per point

            for (int i = 0; i < kDispersionTaps; ++i) {
                float u = float(i) / maxI;
                if (u > 1.0) break;

                float3 tap = sampleBackdrop(source, base - direction * (u - 0.5) * spread, params);
                float3 mask = float3(step(0.5, u),
                                     step(0.25, u) * step(u, 0.75),
                                     step(u, 0.5));

                accumulated += tap * mask;
                weight += mask;
            }

            color = accumulated / max(weight, float3(1e-6));
        }
    }

    color = clamp(color, 0.0, 1.0);

    float luma = dot(color, float3(0.2126, 0.7152, 0.0722));
    color = mix(float3(luma), color, params.saturation);
    color = mix(color, params.frostColor.rgb, params.frostColor.a);
    color = mix(color, params.tintColor.rgb, params.tintColor.a);

    // Keyed off `pixels`, which is view-local and stable, so the grain field does not jump when
    // the drawable resizes mid-animation.
    if (params.noiseAmount > 0.0) {
        color += (hashNoise(pixels * 1e-3) - 0.5) * params.noiseAmount;
    }

    // The glass border light, and nothing else — remodeled against real iOS 26 glass. The signed
    // multiplicative wash this pass used to carry (`sin(pos_angle - angle)` over the whole
    // refraction band) darkened the quadrant opposite the light by up to 25 %, an inset shadow
    // real glass does not have, and vanished over dark backdrops; the separate contour line on
    // top was the over-thick edge. What remains: a thin ADDITIVE rim lighting both light-axis
    // lobes — `pow(abs(dot(normal, light)), falloff)`, Kyant's falloff model — fading over its own
    // `highlightWidth`, plus the faint broad sheen under the lit edges (~0.18x the rim's weight,
    // measured +13/255 over ~25 px). `abs()` is what lights both lobes; `normal`, not the
    // position angle, is what holds a long edge at constant intensity.
    float rim = pow(abs(dot(normal, lobeDir)), params.highlightFalloff);
    float rimT = clamp(inside / max(params.highlightWidth, 1e-3), 0.0, 1.0);
    float rimBand = 1.0 - smoothstep(0.0, 1.0, rimT);

    float sheenT = clamp(inside / kSheenDepth, 0.0, 1.0);
    float sheen = 1.0 - smoothstep(0.0, 1.0, sheenT);

    // Glass does not amplify what it merely transmits: the interior is pinned at 1 before the
    // rim is added on top.
    color = min(color * (1.0 + params.lightIntensity), float3(1.0));
    color += rim * rimBand * params.highlightIntensity;
    color += rim * sheen * params.highlightIntensity * 0.18;

    // The inner shadow — Kyant's `InnerShadow`, as an SDF band: the blurred coverage of the
    // shape minus itself translated by the offset, `S \ (S + o)`. Blur is linear and the blurred
    // coverage of a set is a smoothstep of its SDF, so the band is ss(sd of S ∩ (S + o)) −
    // ss(sd of S) with sd of the intersection = max of the two fields. Offset (0, +r) shades the
    // top inner edge: light from above, and the pane's top lip casts inward. Evaluated on the
    // merged field, so a morph partner shades as one piece.
    if (params.innerShadow.a > 0.0 && params.innerShadowRadius > 0.0) {
        float r = params.innerShadowRadius;
        float shiftedH = 1.0;
        float sdShifted = mergedSd(centered - params.innerShadowOffset, params, shiftedH);
        float shade = smoothstep(-r, r, max(sd, sdShifted)) - smoothstep(-r, r, sd);
        color = mix(color, params.innerShadow.rgb, clamp(shade, 0.0, 1.0) * params.innerShadow.a);
    }

    // The press glow, per Kyant's InteractiveHighlight: a flat 0.08 wash plus a 0.15 radial lobe,
    // additive, radius 1.5x the view's min dimension, full strength inside half that radius.
    // Uniform-coherent, so it costs nothing at rest.
    if (glow > 0.0) {
        float touchRadius = 1.5 * min(params.viewSize.x, params.viewSize.y);
        float touchDist = distance(pixels, params.touch.xy);
        float touchFalloff = 1.0 - smoothstep(touchRadius * 0.5, touchRadius, touchDist);
        color += (0.08 + 0.15 * touchFalloff) * glow;
    }

    color = clamp(color, 0.0, 1.0);

    float alpha = shapeAlpha * params.glassOpacity;
    return float4(color * alpha, alpha);
}
