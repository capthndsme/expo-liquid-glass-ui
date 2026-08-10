package expo.modules.liquidglass.glass

import android.util.Log
import expo.modules.liquidglass.LOG_TAG

/**
 * Diagnostics, off by default. Toggle from JS with `ExpoLiquidGlassModule.setDebugLogging(true)`.
 *
 * The frame counters are the instrument for the two questions this port cannot answer from
 * documentation: whether the backdrop stays current without an explicit invalidate, and whether
 * notifying consumers from a draw pass feeds back into an invalidation loop. At rest both counters
 * must stop moving.
 */
internal object GlassDebug {
  @Volatile
  var enabled: Boolean = false

  private var providerRecordings = 0L
  private var glassDraws = 0L
  private var lastReportMs = 0L

  fun onProviderRecorded() {
    if (!enabled) return
    providerRecordings++
    report()
  }

  fun onGlassDrawn() {
    if (!enabled) return
    glassDraws++
    report()
  }

  fun log(message: String) {
    if (enabled) Log.d(LOG_TAG, message)
  }

  private fun report() {
    val now = System.currentTimeMillis()
    if (lastReportMs == 0L) {
      lastReportMs = now
      return
    }
    if (now - lastReportMs < REPORT_INTERVAL_MS) return
    val seconds = (now - lastReportMs) / 1000.0
    Log.d(
      LOG_TAG,
      "frames/s — provider recordings: %.1f, glass draws: %.1f"
        .format(providerRecordings / seconds, glassDraws / seconds)
    )
    providerRecordings = 0
    glassDraws = 0
    lastReportMs = now
  }

  private const val REPORT_INTERVAL_MS = 1000L
}
