package expo.modules.liquidglass.glass

import android.graphics.BlendMode
import android.graphics.RenderEffect
import android.graphics.RuntimeShader
import android.graphics.Shader
import android.os.Build
import android.util.Log
import androidx.annotation.RequiresApi
import expo.modules.liquidglass.LOG_TAG
import kotlin.math.ceil
import kotlin.math.ln
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow

/**
 * The blur pyramid behind `metal.progressiveBlur`, plus the edge-extension pass every blur stage
 * runs over.
 *
 * A blur whose radius varies per pixel has no cheap exact form. The first cut here was a separable
 * variable-radius Gaussian in AGSL — 8 taps per side with a per-pixel jitter, the Metal renderer's
 * architecture with a ramped radius. Point-sampling a sharp backdrop at strides up to 14 px aliases
 * against text no matter how the comb is dithered, and the vertical pass then smears the horizontal
 * pass's noise into columns: measured on an API 37 emulator and an Adreno 610 as woven vertical
 * streaks through every fully blurred row. Combs dense enough to fix that cost more per frame than
 * a mid-range GPU can pay under a scrolling list.
 *
 * So: a pyramid. One hwui blur — Skia's own, which downsamples internally and is therefore smooth
 * and nearly free at large sigma — per doubling of radius from ~4.5 px up to the ramp's maximum,
 * cross-faded per pixel by the ramp. Level k contributes only while the local radius lies between
 * level k-1's radius and its own, so each pixel is a linear mix of the two levels that bracket its
 * radius: unimodal, no comb, and the sharp end is the untouched original.
 *
 * RenderEffect offers exactly one way to run branches in parallel, `createBlendModeEffect`, and
 * the stack is built from it: SRC_OVER folds, innermost the identity (the original), each level
 * above it a `blur -> weight` chain whose weight shader scales the blurred sample — premultiplied
 * colour and alpha alike — by its ramp weight w. SRC_OVER of that over the fold below is exactly
 * `w * level + (1 - w) * below`, and with `w = clamp((r - r_below) / (r_k - r_below), 0, 1)` every
 * level below the bracketing pair is fully on and every level above fully off.
 *
 * Edges: hwui's blur smears whatever surrounds the recorded content inward by its reach, and when
 * the content underfills the node that surround is transparent black. [extendEffect] fills the
 * padding with the content's clamped edge pixels first — clamp-to-edge, what the blur itself does
 * at the node's own bounds — so every blur stage is clean right up to the content edge and the
 * glass may read there. Before this the glass stayed a full blur reach inside the content, which
 * copied the row or column at the inset across everything nearer the edge.
 */
@RequiresApi(Build.VERSION_CODES.TIRAMISU)
internal object GlassProgressiveBlur {

  const val OFFSET = "offset"
  const val CROP = "crop"
  const val RAMP_RADII = "rampRadii"
  const val RAMP_LINE = "rampLine"
  const val LEVEL_RADII = "levelRadii"

  /**
   * The smallest level's radius, px: sigma ≈ 2.25 px, close enough to sharp that the crossfade
   * from the original reads as softening rather than as a double image.
   */
  private const val BASE_LEVEL_PX = 4.5f

  /** Levels above the original. Six reach 4.5 .. 144 px by doublings; a wider ramp starts higher. */
  private const val MAX_LEVELS = 6

  private val WEIGHT_SOURCE = """
    uniform shader content;
    uniform float2 offset;      // (-P, -P): node-local to view-local, like the glass shader
    uniform float2 rampRadii;   // (leading, trailing) radius, px
    uniform float4 rampLine;    // xy = view-local px where the ramp begins, zw = unitDir / rampLen
    uniform float2 levelRadii;  // (radius of the level below, radius of this level), px

    half4 main(float2 fragCoord) {
        float2 pixels = fragCoord + offset;

        // Hermite-eased ramp position along the axis, then the local radius.
        float t = clamp(dot(pixels - rampLine.xy, rampLine.zw), 0.0, 1.0);
        t = t * t * (3.0 - 2.0 * t);
        float radius = mix(rampRadii.x, rampRadii.y, t);

        float w = clamp((radius - levelRadii.x) / (levelRadii.y - levelRadii.x), 0.0, 1.0);
        if (w <= 0.0) {
            return half4(0.0);
        }
        // Premultiplied in, premultiplied out: scaling colour and alpha together is what makes
        // SRC_OVER of this over the level below a plain lerp.
        return half4(float4(content.eval(fragCoord)) * w);
    }
  """.trimIndent()

  private val EXTEND_SOURCE = """
    uniform shader content;
    uniform float4 crop;        // node-space content rect (minX, minY, maxX, maxY), px

    half4 main(float2 fragCoord) {
        return content.eval(clamp(fragCoord, crop.xy, crop.zw));
    }
  """.trimIndent()

  private var weightShader: RuntimeShader? = null
  private var weightAttempted = false
  private var extendShader: RuntimeShader? = null
  private var extendAttempted = false

  /** Present-but-null = the compile failed once; don't retry, callers fall back. */
  @Synchronized
  private fun weightOrNull(): RuntimeShader? {
    if (weightAttempted) return weightShader
    weightAttempted = true
    weightShader = try {
      RuntimeShader(WEIGHT_SOURCE)
    } catch (t: Throwable) {
      Log.e(LOG_TAG, "Progressive blur weight AGSL failed to compile; progressive blur falls back", t)
      null
    }
    return weightShader
  }

  @Synchronized
  private fun extendOrNull(): RuntimeShader? {
    if (extendAttempted) return extendShader
    extendAttempted = true
    extendShader = try {
      RuntimeShader(EXTEND_SOURCE)
    } catch (t: Throwable) {
      Log.e(LOG_TAG, "Edge-extension AGSL failed to compile; blur edges stay unextended", t)
      null
    }
    return extendShader
  }

  /** The natural level count for a ramp whose widest radius is [maxPx]: one per doubling from [BASE_LEVEL_PX]. */
  fun levelCount(maxPx: Float): Int {
    if (maxPx <= BASE_LEVEL_PX) return 1
    return min(MAX_LEVELS, ceil(ln(maxPx / BASE_LEVEL_PX) / ln(2f)).toInt() + 1)
  }

  /**
   * Levels the quality tier pays for. Each level is a full-node hwui blur, a weight pass and a
   * blend — measured at ~10 ms per level for two full-width scrims covering 440 dp of a 1080×2400
   * screen on an Adreno 610, against a 23 ms floor for the glass pass alone over the same nodes —
   * so this is the knob that fits the ramp to a device. One level is a plain crossfade between the
   * original and the widest blur and reads as grey crisp text over a haze; two is the least that
   * reads as a melt; three is where it stops improving visibly. LOW is what a view covering more
   * than a quarter of the screen resolves to on its own (see LiquidGlassView.resolveShaderQuality).
   */
  fun levelBudget(quality: ShaderQuality): Int = when (quality) {
    ShaderQuality.LOW -> 2
    ShaderQuality.MEDIUM -> 3
    ShaderQuality.HIGH -> MAX_LEVELS
  }

  /**
   * Level radii, widest last. A crossfade between two Gaussians reads as one blur of some width
   * in between while their sigmas stay within a few-fold of each other, and as a double image
   * beyond that — so few levels spread by 4× or 3×, and four or more run geometrically from
   * [BASE_LEVEL_PX] up to the top, where the first step from the original is too small to see.
   */
  fun levelRadii(maxPx: Float, budget: Int): FloatArray {
    val n = max(1, min(budget, levelCount(maxPx)))
    return when (n) {
      1 -> floatArrayOf(maxPx)
      2 -> floatArrayOf(maxPx / 4f, maxPx)
      3 -> floatArrayOf(maxPx / 9f, maxPx / 3f, maxPx)
      else -> {
        val ratio = (maxPx / BASE_LEVEL_PX).pow(1f / (n - 1))
        FloatArray(n) { k -> BASE_LEVEL_PX * ratio.pow(k) }
      }
    }
  }

  /**
   * The clamp-to-edge fill: every pixel of the node outside [crop] takes the nearest content
   * pixel. Null when the shader is unusable, in which case blur edges are simply not extended.
   *
   * @param crop node-space content rect, half a pixel in — the same rect the glass clamps to.
   */
  fun extendEffect(crop: FloatArray): RenderEffect? {
    val shader = extendOrNull() ?: return null
    return try {
      shader.setFloatUniform(CROP, crop[0], crop[1], crop[2], crop[3])
      RenderEffect.createRuntimeShaderEffect(shader, "content")
    } catch (t: Throwable) {
      Log.e(LOG_TAG, "Edge-extension effect failed to build; blur edges stay unextended", t)
      null
    }
  }

  /**
   * The pyramid, or null when the weight shader is unusable (callers substitute a uniform hwui
   * blur at [GlassAppearance.fallbackBlurPx]).
   *
   * @param widthPx  view width, px — not the padded node's.
   * @param heightPx view height, px.
   * @param padPx    padding on each side of the node.
   */
  fun buildEffect(
    appearance: GlassAppearance,
    quality: ShaderQuality,
    widthPx: Float,
    heightPx: Float,
    padPx: Float
  ): RenderEffect? {
    val shader = weightOrNull() ?: return null

    val maxPx = max(appearance.progStartPx, appearance.progEndPx)
    val radii = levelRadii(maxPx, levelBudget(quality))

    val direction = appearance.progDirection
    val extent = if (direction.vertical) heightPx else widthPx
    val rampLen = max((appearance.progRampEnd - appearance.progRampStart) * extent, 1e-3f)
    val lead = appearance.progRampStart * extent

    // The origin sits on the leading edge of the ramp window; the direction vector carries the
    // inverse length so the shader's dot() lands directly in 0..1.
    val originX = if (direction.vertical) 0f else if (direction.reversed) widthPx - lead else lead
    val originY = if (!direction.vertical) 0f else if (direction.reversed) heightPx - lead else lead
    val sign = if (direction.reversed) -1f else 1f
    val dirX = if (direction.vertical) 0f else sign / rampLen
    val dirY = if (direction.vertical) sign / rampLen else 0f

    return try {
      // Innermost: the original, untouched — what the sharp end of the ramp shows.
      var stack: RenderEffect = RenderEffect.createOffsetEffect(0f, 0f)
      var below = 0f
      for (radiusPx in radii) {
        val hwui = appearance.hwuiRadius(radiusPx)
        if (hwui <= 0f) continue
        // createRuntimeShaderEffect snapshots the uniforms, so one shader serves every level.
        shader.setFloatUniform(OFFSET, -padPx, -padPx)
        shader.setFloatUniform(RAMP_RADII, appearance.progStartPx, appearance.progEndPx)
        shader.setFloatUniform(RAMP_LINE, originX, originY, dirX, dirY)
        shader.setFloatUniform(LEVEL_RADII, below, radiusPx)
        // createChainEffect(outer, inner) runs `inner` first: blur, then weight.
        val weighted = RenderEffect.createChainEffect(
          RenderEffect.createRuntimeShaderEffect(shader, "content"),
          RenderEffect.createBlurEffect(hwui, hwui, Shader.TileMode.CLAMP)
        )
        stack = RenderEffect.createBlendModeEffect(stack, weighted, BlendMode.SRC_OVER)
        below = radiusPx
      }
      stack
    } catch (t: Throwable) {
      Log.e(LOG_TAG, "Progressive blur pyramid failed to build; progressive blur falls back", t)
      null
    }
  }
}
