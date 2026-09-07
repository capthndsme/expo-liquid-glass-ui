package expo.modules.liquidglass.glass

import android.graphics.HardwareRenderer
import android.graphics.Matrix
import android.graphics.PixelFormat
import android.graphics.RenderNode
import android.hardware.HardwareBuffer
import android.media.Image
import android.media.ImageReader
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.annotation.RequiresApi

/**
 * The `adaptive` prop's sensor: the mean luminance of the backdrop under a glass view.
 *
 * The providers' content is drawn — through the same provider-to-local transforms the glass
 * records it with, scaled down to [SIZE] x [SIZE] — into a private surface by a private
 * [HardwareRenderer], and read back through an [ImageReader] on the main looper. That is the
 * pattern Compose's `GraphicsLayer.toImageBitmap` uses for its own live layers, and the one the
 * startup shader probe already uses here; the display list is walked by the RenderThread as
 * usual, the GPU rasterises 64 pixels, and nothing blocks on the readback. Modeled on the
 * AndroidLiquidGlass catalog's adaptive-luminance demo (Apache-2.0, see NOTICE), which scales its
 * layer to a 5x5 bitmap and averages it.
 *
 * `PixelCopy` of the window was the alternative: async too, and it sees `SurfaceView` video —
 * but it captures the glass *itself* and whatever the app draws on it, and a label that flips
 * colour on the very value it feeds back into is a feedback loop. This reads the backdrop alone.
 *
 * One request in flight at a time; the host throttles how often it asks.
 */
@RequiresApi(Build.VERSION_CODES.Q)
internal class GlassLuminanceProbe {

  private var reader: ImageReader? = null
  private var renderer: HardwareRenderer? = null
  private val node = RenderNode("GlassLuminanceProbe")
  private val handler = Handler(Looper.getMainLooper())

  private var pending = false
  private var onResult: ((Float) -> Unit)? = null
  private var released = false

  /**
   * @param width the glass view's own size, px — the scale that maps its footprint to the probe
   * @return false when a request is already in flight or the probe could not be set up
   */
  fun request(
    sources: List<BackdropSource>,
    transforms: List<Matrix>,
    width: Int,
    height: Int,
    onResult: (Float) -> Unit
  ): Boolean {
    if (released || pending || width <= 0 || height <= 0) return false
    if (transforms.size < sources.size) return false
    val reader = obtainReader() ?: return false
    val renderer = obtainRenderer(reader) ?: return false

    node.setPosition(0, 0, SIZE, SIZE)
    val canvas = node.beginRecording(SIZE, SIZE)
    try {
      canvas.scale(SIZE.toFloat() / width, SIZE.toFloat() / height)
      for (i in sources.indices) {
        val content = sources[i].contentNode ?: continue
        val save = canvas.save()
        canvas.concat(transforms[i])
        canvas.drawRenderNode(content)
        canvas.restoreToCount(save)
      }
    } finally {
      node.endRecording()
    }

    this.onResult = onResult
    pending = true
    return try {
      renderer.setContentRoot(node)
      // No waitForPresent: the sync is what blocks, briefly; the draw lands on the reader's
      // listener whenever the RenderThread gets to it.
      renderer.createRenderRequest().syncAndDraw()
      true
    } catch (t: Throwable) {
      GlassDebug.log("Luminance probe could not draw: $t")
      pending = false
      false
    }
  }

  fun release() {
    released = true
    pending = false
    onResult = null
    try {
      renderer?.destroy()
    } catch (_: Throwable) {
      // Best-effort teardown.
    }
    renderer = null
    reader?.close()
    reader = null
    node.discardDisplayList()
  }

  private fun obtainReader(): ImageReader? {
    reader?.let { return it }
    return try {
      ImageReader.newInstance(
        SIZE,
        SIZE,
        PixelFormat.RGBA_8888,
        2,
        HardwareBuffer.USAGE_GPU_COLOR_OUTPUT or
          HardwareBuffer.USAGE_GPU_SAMPLED_IMAGE or
          HardwareBuffer.USAGE_CPU_READ_OFTEN
      ).also { created ->
        created.setOnImageAvailableListener({ r -> deliver(r) }, handler)
        reader = created
      }
    } catch (t: Throwable) {
      GlassDebug.log("Luminance probe could not create its reader: $t")
      null
    }
  }

  private fun obtainRenderer(reader: ImageReader): HardwareRenderer? {
    renderer?.let { return it }
    return try {
      HardwareRenderer().also { created ->
        created.setSurface(reader.surface)
        renderer = created
      }
    } catch (t: Throwable) {
      GlassDebug.log("Luminance probe could not create its renderer: $t")
      null
    }
  }

  private fun deliver(reader: ImageReader) {
    val image = try {
      reader.acquireLatestImage()
    } catch (_: Throwable) {
      null
    } ?: return
    val luminance = try {
      readLuminance(image)
    } finally {
      image.close()
    }
    if (released) return
    pending = false
    onResult?.invoke(luminance)
  }

  /**
   * Alpha-weighted mean of Rec.709 luma over the probe, in the sRGB gamma space the shader's own
   * `luma` uses. The surface is premultiplied, so a straight sum of the channels IS the
   * alpha-weighted sum, and dividing by the alpha total leaves the mean of what was actually
   * recorded — a glass overhanging a gap the provider never drew is judged by the content it
   * does cover. Nothing covered at all reads as mid-grey, which flips no polarity.
   */
  private fun readLuminance(image: Image): Float {
    val plane = image.planes[0]
    val buffer = plane.buffer
    val rowStride = plane.rowStride
    val pixelStride = plane.pixelStride
    var sum = 0f
    var cover = 0f
    for (y in 0 until SIZE) {
      for (x in 0 until SIZE) {
        val i = y * rowStride + x * pixelStride
        if (i + 3 >= buffer.limit()) continue
        val r = (buffer.get(i).toInt() and 0xFF) / 255f
        val g = (buffer.get(i + 1).toInt() and 0xFF) / 255f
        val b = (buffer.get(i + 2).toInt() and 0xFF) / 255f
        val a = (buffer.get(i + 3).toInt() and 0xFF) / 255f
        sum += 0.2126f * r + 0.7152f * g + 0.0722f * b
        cover += a
      }
    }
    return if (cover > 1e-3f) (sum / cover).coerceIn(0f, 1f) else 0.5f
  }

  private companion object {
    /** 64 samples: coarse enough to be free, fine enough that one bright card cannot flip a bar. */
    const val SIZE = 8
  }
}
