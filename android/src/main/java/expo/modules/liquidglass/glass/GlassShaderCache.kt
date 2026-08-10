package expo.modules.liquidglass.glass

import android.graphics.RuntimeShader
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
 * Compiling is cheap (SkSL parse only; the driver's real compile happens lazily on the RenderThread
 * at first draw) so [warmUp] builds every tier at module init. Otherwise a bad string interpolation
 * in a tier no dev device selects would only fail on a user's phone.
 */
@RequiresApi(Build.VERSION_CODES.TIRAMISU)
internal object GlassShaderCache {

  private class Entry(val variant: GlassShaderVariant, val shader: RuntimeShader)

  /** Absent = not attempted yet. Present-but-null = compilation failed; do not retry. */
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

  fun variantOrNull(quality: ShaderQuality): GlassShaderVariant? = entry(quality)?.variant

  fun shaderOrNull(quality: ShaderQuality): RuntimeShader? = entry(quality)?.shader

  fun isAvailable(quality: ShaderQuality): Boolean = entry(quality) != null

  /** Compile every tier once, so a broken variant fails loudly on the dev machine. */
  fun warmUp() {
    for (quality in ShaderQuality.entries) entry(quality)
  }
}
