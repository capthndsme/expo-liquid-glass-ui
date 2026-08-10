package expo.modules.liquidglass.glass

import android.os.Build
import android.view.SurfaceView
import android.view.View
import android.view.ViewGroup
import expo.modules.liquidglass.LiquidGlassProviderView

/**
 * Dev-mode checks for the mistakes this architecture makes possible.
 *
 * Android's provider is a required wrapper that iOS does not need, and every failure below renders
 * as "the glass just doesn't work" rather than as an error. Each check runs once per view, after
 * layout, and only when the app is debuggable — see [GlassDebug.devMode].
 */
internal object GlassEnvironment {

  /**
   * Runs on a glass view once it is attached and laid out.
   *
   * Deliberately *not* run at attach time: `canScrollVertically` needs the container's children
   * measured before it can answer, and a provider mounted in the same commit may not have been
   * added to the hierarchy yet.
   */
  fun checkGlassView(glass: View, providerId: String) {
    GlassDebug.resolveDevMode(glass.context)
    if (!GlassDebug.devMode) return
    checkNotInsideProvider(glass, providerId)
    checkOverscrollAncestors(glass)
  }

  /**
   * **R10.** A glass view inside a provider's subtree is part of that provider's recording, so its
   * own output becomes part of the backdrop every glass view reading that provider sees. When the
   * ids also match it is a straight feedback loop.
   *
   * Self-exclusion on Android is *structural* — a glass view is a sibling of the provider, never a
   * descendant — which is what removes the whole class of recursion guards the iOS path needs. It
   * only holds if the topology is actually right.
   */
  private fun checkNotInsideProvider(glass: View, providerId: String) {
    var parent = glass.parent
    while (parent is View) {
      if (parent is LiquidGlassProviderView) {
        val sameId = parent.providerId == providerId
        GlassDebug.warnOnce(
          "inside-provider:$providerId:$sameId",
          if (sameId) {
            "A <LiquidGlassView providerId=\"$providerId\"> is INSIDE the <LiquidGlassProvider> " +
              "it reads from. It will refract its own output. Glass views must be SIBLINGS of " +
              "the provider, drawn after it — never children of it."
          } else {
            "A <LiquidGlassView providerId=\"$providerId\"> is inside a <LiquidGlassProvider " +
              "providerId=\"${parent.providerId}\">, so it is part of that provider's backdrop " +
              "and will show up inside any glass reading it. This is rarely what you want."
          }
        )
        return
      }
      parent = parent.parent
    }
  }

  /**
   * **R11.** Android 12+ draws overscroll as a stretch, and the stretch is a pixel-space
   * `RenderEffect` on the scrolling container's `RenderNode` — not a view transform.
   *
   * Glass inside that container is warped along with the backdrop already baked into it, while the
   * provider is a sibling subtree and stays flat, so the two disagree for as long as the overscroll
   * is held. Nothing here can compensate: the effect is invisible to `getLocationInWindow`,
   * `View.getMatrix()` and our own transform walk, and no public API exposes the stretch amount —
   * `EdgeEffect.getDistance()` is API 31+, but `ScrollView` and `RecyclerView` keep their
   * `EdgeEffect` instances private.
   */
  private fun checkOverscrollAncestors(glass: View) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return
    var parent = glass.parent
    while (parent is View) {
      val view = parent as View
      if (view.overScrollMode != View.OVER_SCROLL_NEVER && isScrollable(view)) {
        GlassDebug.warnOnce(
          "overscroll:${view.javaClass.simpleName}",
          "A <LiquidGlassView> is inside a scrolling ${view.javaClass.simpleName} with stretch " +
            "overscroll enabled. While the list is overscrolled the glass and its backdrop are " +
            "warped together but the provider behind them is not, so they visibly disagree. Set " +
            "overScrollMode=\"never\" on that list."
        )
        return
      }
      parent = view.parent
    }
  }

  private fun isScrollable(view: View): Boolean =
    view.isScrollContainer ||
      view.canScrollVertically(1) ||
      view.canScrollVertically(-1) ||
      view.canScrollHorizontally(1) ||
      view.canScrollHorizontally(-1)

  /**
   * **R7 / D4.** `SurfaceView` composites out of process, so no `Canvas` or `RenderNode` path can
   * see it — it is a hole in every backdrop we record. `TextureView` *is* capturable by a hardware
   * `RecordingCanvas`, which is why TextureView-backed playback is the documented requirement for
   * video behind glass.
   *
   * Re-run from the provider's own recording pass rather than once at attach: a `SurfaceView`
   * almost never exists when the provider first attaches. It arrives when the video mounts, which
   * for anything data-driven is later — and a one-shot scan misses it entirely. The provider only
   * re-records on a structural change, which is exactly when a new one can appear, so the scan is
   * both cheap and correctly timed.
   *
   * @return true when there is nothing to be gained by scanning again — either a `SurfaceView` was
   *   found and reported, or this is not a debuggable build.
   */
  fun checkProviderSubtree(provider: ViewGroup): Boolean {
    GlassDebug.resolveDevMode(provider.context)
    if (!GlassDebug.devMode) return true
    val found = findSurfaceView(provider) ?: return false
    GlassDebug.warnOnce(
      "surfaceview:${found.javaClass.name}",
      "A ${found.javaClass.simpleName} (a SurfaceView) is inside a <LiquidGlassProvider>. " +
        "SurfaceView composites out of process and cannot be captured by any Canvas or " +
        "RenderNode path, so it will be a hole in the backdrop. For video, use TextureView-backed " +
        "playback — expo-video accepts surfaceType=\"textureView\"."
    )
    return true
  }

  private fun findSurfaceView(view: View): View? {
    if (view is SurfaceView) return view
    if (view !is ViewGroup) return null
    for (i in 0 until view.childCount) {
      findSurfaceView(view.getChildAt(i))?.let { return it }
    }
    return null
  }
}
