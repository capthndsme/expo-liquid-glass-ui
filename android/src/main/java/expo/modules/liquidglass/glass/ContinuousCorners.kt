package expo.modules.liquidglass.glass

import android.graphics.Path
import android.graphics.RectF
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.sin

/**
 * The continuous-corner ("squircle") curve family, shared by the Kotlin `Path`s and the AGSL SDF.
 *
 * One curve, two renderers: a corner is a superellipse quadrant in an E x E cell,
 * `((E-x)/E)^n + ((E-y)/E)^n = 1`, with the circular corner as its exact (E = r, n = 2) member.
 * The constants are calibrated against the PaintCode reverse-engineering of Apple's continuous
 * rounded rect — max deviation 7.3e-3 r, sub-pixel at every UI radius. Method, ground-truth
 * provenance and error tables: `docs/android-port/research/05-continuous-corner-calibration.md`.
 *
 * The resolver and the path builder must stay in lock-step with the shader's `sdGlassRect` /
 * `gradGlassRect` (GlassShaderSource.FUNCTIONS): the border stroke is drawn on these paths *over*
 * the shader's rim, and at a 1 px border against a 0.75 dp rim, sub-pixel disagreement reads as a
 * double edge.
 */
internal object ContinuousCorners {

  /** Apple's corner extent per unit radius — where the curve departs the straight edge. Exact. */
  const val EXTENT = 1.52866483f

  /** Fitted superellipse exponent at full extent (research/05, fit 1). */
  const val N_FULL = 3.3418f

  /** Below this, an exponent is treated as circular — must match the shader's `n > 2.001` test. */
  const val CIRCULAR_N = 2f

  /**
   * Resolves per-corner cell extents and exponents, in the field order of [CornerRadii]
   * (TL, TR, BR, BL — index via [IDX_TL] etc).
   *
   * Rules (research/05): desired `E = EXTENT * r`; if the two desired extents on an edge overflow
   * the side, both scale by `side / sum` and a corner takes the min of its two edges' scales; then
   * a hard cap at `min(halfW, halfH)` keeps every cell inside its quadrant. `clampedTo` guarantees
   * `r_a + r_b <= side`, so the scale never pushes E below r — `E/r` stays in `[1, EXTENT]` and
   * the exponent blend never extrapolates. At the capsule limit (E = r) the exponent lands on
   * exactly 2, which is what makes pills keep true circular ends.
   */
  fun resolve(
    radii: CornerRadii,
    continuous: Boolean,
    width: Float,
    height: Float,
    outExtents: FloatArray,
    outShapes: FloatArray
  ) {
    val r = floatArrayOf(radii.topLeft, radii.topRight, radii.bottomRight, radii.bottomLeft)
    if (!continuous || radii.isZero) {
      for (i in 0..3) {
        outExtents[i] = r[i]
        outShapes[i] = CIRCULAR_N
      }
      return
    }

    fun edgeScale(a: Float, b: Float, side: Float): Float {
      val sum = (a + b) * EXTENT
      return if (sum > side && sum > 0f) side / sum else 1f
    }

    val top = edgeScale(r[IDX_TL], r[IDX_TR], width)
    val bottom = edgeScale(r[IDX_BL], r[IDX_BR], width)
    val left = edgeScale(r[IDX_TL], r[IDX_BL], height)
    val right = edgeScale(r[IDX_TR], r[IDX_BR], height)

    val scale = floatArrayOf(
      min(top, left), // TL
      min(top, right), // TR
      min(bottom, right), // BR
      min(bottom, left) // BL
    )

    val cap = min(width, height) / 2f
    for (i in 0..3) {
      val radius = r[i]
      if (radius <= 0f) {
        outExtents[i] = 0f
        outShapes[i] = CIRCULAR_N
        continue
      }
      val extent = min(radius * EXTENT * scale[i], cap)
      val blend = ((extent / radius - 1f) / (EXTENT - 1f)).coerceIn(0f, 1f)
      outExtents[i] = extent
      outShapes[i] = CIRCULAR_N + (N_FULL - CIRCULAR_N) * blend
    }
  }

  /**
   * Appends the continuous rounded rect to [path] as a clockwise contour.
   *
   * Corners are sampled from the same superellipse the shader evaluates — a polyline, not the
   * PaintCode beziers — so Path and SDF agree exactly by construction (research/05). At
   * [SEGMENTS_PER_CORNER] steps the chord sagitta stays under ~0.1 px for any extent that fits a
   * phone screen; the paths are rebuilt only on geometry change, so the vertex count is free.
   *
   * `P(theta) = C + a*E*cos(theta)^(2/n) + b*E*sin(theta)^(2/n)` for corner point C and unit
   * edge vectors a (incoming, clockwise) and b (outgoing) — at n = 2 this is the circular arc.
   */
  fun addContinuousRoundRect(
    path: Path,
    bounds: RectF,
    extents: FloatArray,
    shapes: FloatArray
  ) {
    val l = bounds.left
    val t = bounds.top
    val rr = bounds.right
    val bb = bounds.bottom

    // Start on the top edge, at the TL corner's exit point.
    path.moveTo(l + extents[IDX_TL], t)
    path.lineTo(rr - extents[IDX_TR], t)
    corner(path, rr, t, -1f, 0f, 0f, 1f, extents[IDX_TR], shapes[IDX_TR]) // TR
    path.lineTo(rr, bb - extents[IDX_BR])
    corner(path, rr, bb, 0f, -1f, -1f, 0f, extents[IDX_BR], shapes[IDX_BR]) // BR
    path.lineTo(l + extents[IDX_BL], bb)
    corner(path, l, bb, 1f, 0f, 0f, -1f, extents[IDX_BL], shapes[IDX_BL]) // BL
    path.lineTo(l, t + extents[IDX_TL])
    corner(path, l, t, 0f, 1f, 1f, 0f, extents[IDX_TL], shapes[IDX_TL]) // TL
    path.close()
  }

  /**
   * One corner: from `C + a*E` to `C + b*E`. `(ax, ay)` points from the corner back along the
   * incoming edge, `(bx, by)` forward along the outgoing edge, both unit.
   *
   * The curve is the superellipse about the corner cell's INNER point `C + a*E + b*E`:
   * `P(theta) = C + a*E*(1 - sin^(2/n) theta) + b*E*(1 - cos^(2/n) theta)` — at n = 2 the
   * circular arc. The tempting "polar" form `C + a*E*cos^p + b*E*sin^p` has the same endpoints
   * but is the superellipse about the CORNER — the corner curve mirrored through its chord,
   * bulging into the shape. It shipped for one build: the border stroked an "inverse squircle"
   * hairline inside the glass, measured on device as exactly `nnorm(p - corner) = 0.99*E`
   * (PLAN F53). The SDF was never wrong — only this path.
   */
  private fun corner(
    path: Path,
    cx: Float,
    cy: Float,
    ax: Float,
    ay: Float,
    bx: Float,
    by: Float,
    extent: Float,
    n: Float
  ) {
    if (extent < MIN_EXTENT_PX) {
      path.lineTo(cx, cy)
      return
    }
    val exponent = 2.0 / n
    for (i in 1..SEGMENTS_PER_CORNER) {
      val theta = (i.toDouble() / SEGMENTS_PER_CORNER) * (Math.PI / 2.0)
      val ca = 1.0 - sin(theta).pow(exponent)
      val sb = 1.0 - cos(theta).pow(exponent)
      path.lineTo(
        cx + (ax * ca.toFloat() + bx * sb.toFloat()) * extent,
        cy + (ay * ca.toFloat() + by * sb.toFloat()) * extent
      )
    }
  }

  // CornerRadii field order.
  const val IDX_TL = 0
  const val IDX_TR = 1
  const val IDX_BR = 2
  const val IDX_BL = 3

  /**
   * The shader's `float4` packing, which is **not** the field order:
   * `.x` = bottom-left, `.y` = bottom-right, `.z` = top-right, `.w` = top-left.
   */
  fun writeShaderVec(values: FloatArray, out: FloatArray) {
    out[0] = values[IDX_BL]
    out[1] = values[IDX_BR]
    out[2] = values[IDX_TR]
    out[3] = values[IDX_TL]
  }

  private const val SEGMENTS_PER_CORNER = 32
  private const val MIN_EXTENT_PX = 0.5f
}
