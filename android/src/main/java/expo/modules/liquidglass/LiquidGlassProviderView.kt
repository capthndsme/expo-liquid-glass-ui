package expo.modules.liquidglass

import android.content.Context
import android.graphics.Canvas
import android.graphics.RenderNode
import android.os.Build
import android.view.View
import androidx.annotation.RequiresApi
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView
import expo.modules.liquidglass.glass.BackdropConsumer
import expo.modules.liquidglass.glass.BackdropSource
import expo.modules.liquidglass.glass.GlassDebug
import expo.modules.liquidglass.glass.ProviderRegistry
import java.util.concurrent.CopyOnWriteArrayList

/**
 * Records the content that should show through the glass.
 *
 * Android glass views are **siblings** of this view, not descendants — they are drawn after it and
 * read the display list it records. That is what makes self-exclusion structural: a glass view is
 * never inside the recorded subtree, so it cannot appear in its own backdrop, and there is no
 * suppression flag or recursion guard to get wrong.
 *
 * ```
 * <LiquidGlassProvider providerId="main">   ← this view; owns contentNode
 *     …content…
 * </LiquidGlassProvider>
 * <LiquidGlassView providerId="main" />     ← sibling, drawn after
 * ```
 *
 * The recording happens inside this view's own real render pass: `super.dispatchDraw` goes to the
 * node's `RecordingCanvas` and the node is then drawn to the screen, so there is no second traversal
 * and no extra invalidate. Recording a display list is not rasterization — unchanged children just
 * re-reference their existing `RenderNode`s.
 */
class LiquidGlassProviderView(context: Context, appContext: AppContext) :
  ExpoView(context, appContext), BackdropSource {

  override var providerId: String = DEFAULT_PROVIDER_ID
    set(value) {
      if (field == value) return
      // Re-key in the registry, otherwise consumers keep resolving the old id.
      if (isAttachedToWindow) ProviderRegistry.unregister(this)
      field = value
      if (isAttachedToWindow) ProviderRegistry.register(this)
    }

  override val sourceView: View get() = this

  override var contentGeneration: Int = 0
    private set

  private val consumers = CopyOnWriteArrayList<BackdropConsumer>()

  /** Created only where `RenderNode` exists; `null` below API 29. */
  private val node: RenderNode? =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) RenderNode("LiquidGlassBackdrop") else null

  @get:RequiresApi(Build.VERSION_CODES.Q)
  override val contentNode: RenderNode?
    get() = node?.takeIf { it.hasDisplayList() }

  override fun addConsumer(consumer: BackdropConsumer) {
    consumers.addIfAbsent(consumer)
  }

  override fun removeConsumer(consumer: BackdropConsumer) {
    consumers.remove(consumer)
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    ProviderRegistry.register(this)
  }

  override fun onDetachedFromWindow() {
    ProviderRegistry.unregister(this)
    consumers.clear()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) node?.discardDisplayList()
    super.onDetachedFromWindow()
  }

  override fun dispatchDraw(canvas: Canvas) {
    val node = this.node
    if (node == null ||
      Build.VERSION.SDK_INT < Build.VERSION_CODES.Q ||
      !canvas.isHardwareAccelerated ||
      width <= 0 ||
      height <= 0
    ) {
      // Below API 29, or on a software canvas (screenshots, PDF export, some OEM paths) there is
      // no glass at all — just draw normally.
      super.dispatchDraw(canvas)
      return
    }

    recordAndDraw(node, canvas)

    GlassDebug.onProviderRecorded()
    // Consumers may need to re-run their effect against the content we just recorded. They gate on
    // `contentGeneration`, which is *not* bumped here — see BackdropSource.contentGeneration.
    for (consumer in consumers) consumer.onBackdropChanged()
  }

  @RequiresApi(Build.VERSION_CODES.Q)
  private fun recordAndDraw(node: RenderNode, canvas: Canvas) {
    node.setPosition(0, 0, width, height)
    val recording = node.beginRecording(width, height)
    try {
      // `dispatchDraw` is step 4 of `View.draw()`, so this view's own background, `onDraw` and
      // foreground are already on `canvas` and are deliberately not part of the recording — the
      // backdrop is the *content*, and the provider itself is usually transparent.
      super.dispatchDraw(recording)
    } finally {
      node.endRecording()
    }
    canvas.drawRenderNode(node)
  }

  /**
   * Scrolling and animating children invalidate a descendant without re-running `dispatchDraw` —
   * this is the only signal that the recorded content has actually changed.
   */
  override fun onDescendantInvalidated(child: View, target: View) {
    super.onDescendantInvalidated(child, target)
    contentGeneration++
  }

  override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
    super.onSizeChanged(w, h, oldw, oldh)
    contentGeneration++
  }
}
