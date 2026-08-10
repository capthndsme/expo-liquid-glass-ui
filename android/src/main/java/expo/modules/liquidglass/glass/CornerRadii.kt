package expo.modules.liquidglass.glass

import expo.modules.kotlin.types.Either
import expo.modules.liquidglass.records.GlassCornerRadii
import kotlin.math.min

/** Per-corner radii in pixels. */
internal data class CornerRadii(
  val topLeft: Float,
  val topRight: Float,
  val bottomRight: Float,
  val bottomLeft: Float
) {
  val isZero: Boolean
    get() = topLeft == 0f && topRight == 0f && bottomRight == 0f && bottomLeft == 0f

  /** A radius larger than half the shorter side is not representable; iOS clamps the same way. */
  fun clampedTo(width: Float, height: Float): CornerRadii {
    val limit = min(width, height) / 2f
    return CornerRadii(
      min(topLeft, limit),
      min(topRight, limit),
      min(bottomRight, limit),
      min(bottomLeft, limit)
    )
  }

  /** `Path.addRoundRect` wants eight floats: TL-x, TL-y, TR-x, TR-y, BR-x, BR-y, BL-x, BL-y. */
  fun writePathRadii(out: FloatArray) {
    out[0] = topLeft; out[1] = topLeft
    out[2] = topRight; out[3] = topRight
    out[4] = bottomRight; out[5] = bottomRight
    out[6] = bottomLeft; out[7] = bottomLeft
  }

  /**
   * The shader's `float4` swizzle, which is **not** the same order:
   * `.x` = bottom-left, `.y` = bottom-right, `.z` = top-right, `.w` = top-left.
   */
  fun writeShaderVec(out: FloatArray) {
    out[0] = bottomLeft
    out[1] = bottomRight
    out[2] = topRight
    out[3] = topLeft
  }

  companion object {
    val ZERO = CornerRadii(0f, 0f, 0f, 0f)

    fun from(value: Either<Double, GlassCornerRadii>?, density: Float): CornerRadii {
      if (value == null) return ZERO
      if (value.`is`(Double::class)) {
        val radius = value.first().toFloat() * density
        return CornerRadii(radius, radius, radius, radius)
      }
      val radii = value.second()
      return CornerRadii(
        (radii.topLeft * density).toFloat(),
        (radii.topRight * density).toFloat(),
        (radii.bottomRight * density).toFloat(),
        (radii.bottomLeft * density).toFloat()
      )
    }
  }
}
