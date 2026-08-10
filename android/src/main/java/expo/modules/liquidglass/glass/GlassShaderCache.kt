package expo.modules.liquidglass.glass

import android.graphics.Color
import android.graphics.HardwareRenderer
import android.graphics.PixelFormat
import android.graphics.RenderEffect
import android.graphics.RenderNode
import android.graphics.RuntimeShader
import android.hardware.HardwareBuffer
import android.media.ImageReader
import android.os.Build
import android.util.Log
import androidx.annotation.RequiresApi
import expo.modules.liquidglass.LOG_TAG

/**
 * One compiled [RuntimeShader] per [ShaderQuality], shared process-wide.
 *
 * Sharing is safe because every glass view uploads its uniforms and creates its
 * [android.graphics.RenderEffect] back to back on the UI thread, and
 * `createRuntimeShaderEffect` snapshots the uniform values by value at creation time — a later
 * upload by another view cannot reach into an effect that has already been built.
 *
 * Constructing a [RuntimeShader] only parses SkSL; the driver's real compile happens lazily on the
 * RenderThread at first draw. [warmUp] does both, and does the second one against a scratch surface
 * it can read back — see [probeDriver].
 */
@RequiresApi(Build.VERSION_CODES.TIRAMISU)
internal object GlassShaderCache {

  private class Entry(val variant: GlassShaderVariant, val shader: RuntimeShader)

  /** Absent = not attempted yet. Present-but-null = unusable; do not retry. */
  private val entries = HashMap<ShaderQuality, Entry?>()

  @Synchronized
  private fun entry(quality: ShaderQuality): Entry? {
    if (entries.containsKey(quality)) return entries[quality]
    val variant = GlassShaderSource.variant(quality)
    val entry = try {
      Entry(variant, RuntimeShader(variant.source))
    } catch (t: Throwable) {
      // RuntimeShader's constructor throws IllegalArgumentException carrying the full SkSL error
      // log. Anything else here is a driver/platform surprise, and a crash would be worse than a
      // downgraded tier, so catch broadly.
      Log.e(LOG_TAG, "AGSL shader failed to compile (quality=$quality); falling back", t)
      null
    }
    entries[quality] = entry
    return entry
  }

  @Synchronized
  private fun disable(quality: ShaderQuality) {
    entries[quality] = null
  }

  fun variantOrNull(quality: ShaderQuality): GlassShaderVariant? = entry(quality)?.variant

  fun shaderOrNull(quality: ShaderQuality): RuntimeShader? = entry(quality)?.shader

  fun isAvailable(quality: ShaderQuality): Boolean = entry(quality) != null

  /**
   * Compiles every tier, then verifies each one actually renders.
   *
   * The parse runs here, synchronously, so a bad string interpolation in a tier this device never
   * selects still fails loudly on the developer's machine rather than on one user's phone.
   *
   * The render probe runs on a background thread, because it costs a scratch surface and a real
   * GPU round trip. It is the only way to catch a **silent** driver failure: stage-4 compilation
   * happens on the RenderThread and throws no Java exception, so without a probe the first symptom
   * is an invisible or black glass view on one specific chipset.
   */
  fun warmUp() {
    for (quality in ShaderQuality.entries) entry(quality)

    Thread({
      for (quality in ShaderQuality.entries) {
        val entry = entry(quality) ?: continue
        if (probeDriver(entry.variant) == ProbeResult.FAILED) {
          Log.e(
            LOG_TAG,
            "The AGSL shader compiled but rendered nothing on this GPU (quality=$quality). " +
              "Falling back to the blur tier."
          )
          disable(quality)
        }
      }
    }, "ExpoLiquidGlassWarmUp").apply {
      isDaemon = true
      priority = Thread.MIN_PRIORITY
      start()
    }
  }

  private enum class ProbeResult {
    /** The probe drew and the pixel is non-transparent. */
    OK,

    /** The probe drew and the pixel is transparent — the driver produced nothing. */
    FAILED,

    /** The probe could not be run or read. Says nothing about the shader; keep the tier. */
    INCONCLUSIVE
  }

  /**
   * Renders the shader once over an opaque white input and reads the centre pixel back.
   *
   * Uses its *own* [RuntimeShader] rather than the shared one, so that priming uniforms off the UI
   * thread cannot race a glass view building a real effect.
   *
   * Only a pixel that reads back fully transparent counts as a failure. At the centre of the probe
   * the signed distance is far inside the shape, so `shapeAlpha` is 1 and `glassOpacity` is 1 —
   * alpha 0 there is not reachable by any correct evaluation of this shader. Anything that stops
   * the probe from running at all is [ProbeResult.INCONCLUSIVE], never a demotion: wrongly
   * demoting a working device costs every user the refraction.
   */
  private fun probeDriver(variant: GlassShaderVariant): ProbeResult {
    var reader: ImageReader? = null
    var renderer: HardwareRenderer? = null
    try {
      reader = ImageReader.newInstance(
        PROBE_PX,
        PROBE_PX,
        PixelFormat.RGBA_8888,
        2,
        HardwareBuffer.USAGE_GPU_COLOR_OUTPUT or
          HardwareBuffer.USAGE_GPU_SAMPLED_IMAGE or
          HardwareBuffer.USAGE_CPU_READ_OFTEN
      )

      val shader = RuntimeShader(variant.source)
      primeUniforms(shader, variant.liveUniforms)

      val node = RenderNode("GlassShaderProbe")
      node.setPosition(0, 0, PROBE_PX, PROBE_PX)
      val canvas = node.beginRecording(PROBE_PX, PROBE_PX)
      try {
        canvas.drawColor(Color.WHITE)
      } finally {
        node.endRecording()
      }
      node.setRenderEffect(RenderEffect.createRuntimeShaderEffect(shader, "content"))

      renderer = HardwareRenderer()
      renderer.setSurface(reader.surface)
      renderer.setContentRoot(node)
      renderer.createRenderRequest().setWaitForPresent(true).syncAndDraw()

      val image = reader.acquireNextImage() ?: return ProbeResult.INCONCLUSIVE
      try {
        val plane = image.planes[0]
        val buffer = plane.buffer
        val centre = (PROBE_PX / 2) * plane.rowStride + (PROBE_PX / 2) * plane.pixelStride
        if (centre + 3 >= buffer.limit()) return ProbeResult.INCONCLUSIVE
        val alpha = buffer.get(centre + 3).toInt() and 0xFF
        return if (alpha == 0) ProbeResult.FAILED else ProbeResult.OK
      } finally {
        image.close()
      }
    } catch (t: Throwable) {
      GlassDebug.log("Shader render probe could not run: $t")
      return ProbeResult.INCONCLUSIVE
    } finally {
      try {
        renderer?.destroy()
      } catch (_: Throwable) {
        // Nothing useful to do; the probe is best-effort.
      }
      reader?.close()
    }
  }

  /**
   * Plausible values for every uniform the variant kept.
   *
   * Chosen so the probe reaches the expensive branches — `dispersionAmount` is above
   * `2 * unitScale`, which is what the shader's own cutoff tests — because the point is to make the
   * driver compile the whole program, not a cheap subset of it.
   */
  private fun primeUniforms(shader: RuntimeShader, live: Set<String>) {
    fun set(name: String, value: Float) {
      if (name in live) shader.setFloatUniform(name, value)
    }

    fun set(name: String, a: Float, b: Float) {
      if (name in live) shader.setFloatUniform(name, a, b)
    }

    fun set(name: String, a: Float, b: Float, c: Float, d: Float) {
      if (name in live) shader.setFloatUniform(name, a, b, c, d)
    }

    val size = PROBE_PX.toFloat()
    set(GlassShaderSource.SIZE, size, size)
    set(GlassShaderSource.OFFSET, 0f, 0f)
    set(GlassShaderSource.CROP, 0.5f, 0.5f, size - 0.5f, size - 0.5f)
    set(GlassShaderSource.CORNER_RADII, 8f, 8f, 8f, 8f)
    set(GlassShaderSource.UNIT_SCALE, 3f)
    set(GlassShaderSource.REFRACTION_SCALE, 12f, 12f)
    set(GlassShaderSource.REFRACTION_AMOUNT, 16f)
    set(GlassShaderSource.DEPTH_EFFECT, 1f)
    set(GlassShaderSource.PROFILE_POWER, 1f)
    set(GlassShaderSource.PROFILE_BIAS, 0f)
    set(GlassShaderSource.DISPERSION_HEIGHT, 12f)
    set(GlassShaderSource.DISPERSION_AMOUNT, 18f)
    set(GlassShaderSource.DISPERSION_TAP_SPACING, 3f)
    set(GlassShaderSource.TINT_COLOR, 0f, 0f, 0f, 0f)
    set(GlassShaderSource.FROST_COLOR, 1f, 1f, 1f, 0.36f)
    set(GlassShaderSource.HIGHLIGHT_INTENSITY, 0.25f)
    set(GlassShaderSource.HIGHLIGHT_DIR, -0.7071f, 0.7071f)
    // Missing from the original list, live in every tier since the highlight remodel — which made
    // the probe throw at draw, land in the broad catch, and report INCONCLUSIVE on every device.
    // The silent-driver-failure detection was itself failing silently.
    set(GlassShaderSource.HIGHLIGHT_WIDTH, 12f)
    set(GlassShaderSource.LIGHT_INTENSITY, 0f)
    set(GlassShaderSource.GLASS_OPACITY, 1f)
    set(GlassShaderSource.SATURATION, 1.8f)
    set(GlassShaderSource.NOISE_AMOUNT, 0.05f)
    // Glow ON in the probe, so the driver compiles the interactive branch too.
    set(GlassShaderSource.TOUCH_POS, 32f, 32f)
    set(GlassShaderSource.TOUCH_GLOW, 1f)
  }

  /** Large enough that the centre pixel is unambiguously inside the shape, small enough to be free. */
  private const val PROBE_PX = 64
}
