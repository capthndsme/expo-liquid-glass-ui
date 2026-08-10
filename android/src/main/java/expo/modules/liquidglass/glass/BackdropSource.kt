package expo.modules.liquidglass.glass

import android.graphics.RenderNode
import android.os.Build
import android.view.View
import androidx.annotation.RequiresApi

/**
 * The seam between a `LiquidGlassProviderView` and the glass views that sample it.
 *
 * `ExpoView` extends `LinearLayout` rather than `FrameLayout`, so this is an interface rather than
 * a base class in the style of Dimezis' `BlurTarget`.
 */
internal interface BackdropSource {
  val providerId: String

  /** The provider itself — glass views need it to work out where they sit inside the recording. */
  val sourceView: View

  /**
   * Bumped whenever the recorded content may have changed.
   *
   * Deliberately **not** bumped from `dispatchDraw`: consumers redraw in response to a change, and
   * a counter that ticks on every draw would make every redraw look like a change, which is the
   * shape of an invalidation loop.
   */
  val contentGeneration: Int

  /**
   * The recorded display list of everything that should show through the glass, or `null` below
   * API 29 / before the provider's first draw.
   *
   * This is a **live reference**, not a snapshot: unchanged children keep re-referencing their own
   * `RenderNode`s, so the content stays current without re-recording.
   */
  @get:RequiresApi(Build.VERSION_CODES.Q)
  val contentNode: RenderNode?

  fun addConsumer(consumer: BackdropConsumer)

  fun removeConsumer(consumer: BackdropConsumer)
}

/**
 * Called after the provider has finished a recording pass.
 *
 * Public only because `LiquidGlassProviderView` has to be public for Expo to instantiate it, and
 * Kotlin will not let a public class narrow an override to `internal`. Not part of this package's
 * API — do not implement it outside the module.
 */
fun interface BackdropConsumer {
  fun onBackdropChanged()
}
