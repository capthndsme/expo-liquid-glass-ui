package expo.modules.liquidglass.glass

import android.app.Activity
import android.content.pm.ActivityInfo
import android.os.Build
import android.view.Display
import java.util.concurrent.CopyOnWriteArraySet

/**
 * The process-wide HDR opt-in.
 *
 * HDR here means one thing: the glass border light may exceed SDR white (the shader's
 * `hdrHeadroom` uniform). That needs the *window* in `COLOR_MODE_HDR` — an FP16, extended-sRGB
 * surface — which is a window-level decision with a real cost (double the buffer bandwidth for
 * the whole UI), so it is **opt-in via `ExpoLiquidGlass.setHdrEnabled(true)` and never
 * automatic**. Mixed HDR/SDR UI composition exists from API 34; below that this object is inert.
 *
 * The request is stored process-wide and re-applied on every activity-foreground
 * (`OnActivityEntersForeground` in the module), so it survives activity recreation — rotation,
 * theme change — without the app having to call again.
 *
 * Glass views subscribe via [addListener] to re-resolve their headroom when the request flips at
 * runtime; the per-frame brightness-driven ratio changes reach them through
 * `Display.registerHdrSdrRatioChangedListener` instead (see LiquidGlassView), which is
 * per-display and only registered while HDR is requested.
 */
internal object GlassHdr {

  fun interface Listener {
    fun onHdrStateChanged()
  }

  /** Whether the app has asked for HDR. Applied to the window only on API 34+. */
  @Volatile
  var requested: Boolean = false
    private set

  private val listeners = CopyOnWriteArraySet<Listener>()

  fun addListener(listener: Listener) {
    listeners.add(listener)
  }

  fun removeListener(listener: Listener) {
    listeners.remove(listener)
  }

  /** Main thread. Stores the request, applies it to the window, notifies glass views. */
  fun setRequested(enabled: Boolean, activity: Activity?) {
    val changed = requested != enabled
    requested = enabled
    apply(activity)
    if (changed) {
      for (listener in listeners) listener.onHdrStateChanged()
    }
  }

  /**
   * Main thread. Re-applies the stored request to the (possibly new) window. Idempotent — the
   * mode is only written when it differs, because setting `colorMode` re-allocates the surface.
   */
  fun apply(activity: Activity?) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) return
    val window = activity?.window ?: return
    val mode =
      if (requested) ActivityInfo.COLOR_MODE_HDR else ActivityInfo.COLOR_MODE_DEFAULT
    if (window.colorMode != mode) window.colorMode = mode
  }

  /** Whether this display can report an HDR/SDR ratio at all (panel + platform support). */
  fun isSupported(display: Display?): Boolean =
    Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE &&
      display != null &&
      display.isHdrSdrRatioAvailable

  /**
   * The headroom the shader may use *right now*: the display's live HDR/SDR ratio when HDR is
   * requested and supported, else exactly 1 — which makes the shader bit-identical to SDR.
   */
  fun currentHeadroom(display: Display?): Float {
    if (!requested) return 1f
    if (!isSupported(display)) return 1f
    return display!!.hdrSdrRatio.coerceAtLeast(1f)
  }
}
