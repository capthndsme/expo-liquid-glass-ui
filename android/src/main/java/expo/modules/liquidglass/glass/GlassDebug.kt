package expo.modules.liquidglass.glass

import android.content.Context
import android.content.pm.ApplicationInfo
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

  /**
   * True when the host app is debuggable.
   *
   * Gates the correctness warnings in [GlassEnvironment], which fire without anyone asking for
   * them — every mistake they catch renders as "the glass just doesn't work", so waiting for a
   * developer to opt in would defeat the point. They stay out of release builds.
   *
   * Resolved from a **view's** context rather than at module init: `AppContext.reactContext` is
   * still null when `OnCreate` runs, so reading it there silently left this false and disabled
   * every check.
   */
  @Volatile
  var devMode: Boolean = false
    private set

  @Volatile
  private var devModeResolved = false

  fun resolveDevMode(context: Context) {
    if (devModeResolved) return
    devModeResolved = true
    devMode = (context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0
  }

  private val warned = java.util.Collections.newSetFromMap(
    java.util.concurrent.ConcurrentHashMap<String, Boolean>()
  )

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

  /**
   * Logs [message] at most once per [key] for the life of the process.
   *
   * The conditions these describe are per-frame, so an ungated warning would produce thousands of
   * identical lines and bury itself.
   */
  fun warnOnce(key: String, message: String) {
    if (!devMode && !enabled) return
    if (!warned.add(key)) return
    Log.w(LOG_TAG, message)
  }

  /**
   * [warnOnce] at INFO, for topologies that are supported but worth a line in the log — stacked
   * glass being the one so far. Same gating, same once-per-process dedupe.
   */
  fun infoOnce(key: String, message: String) {
    if (!devMode && !enabled) return
    if (!warned.add(key)) return
    Log.i(LOG_TAG, message)
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
