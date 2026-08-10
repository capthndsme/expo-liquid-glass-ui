package expo.modules.liquidglass

import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RenderEffect
import android.graphics.RenderNode
import android.graphics.Shader
import android.os.Build
import androidx.annotation.RequiresApi
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import expo.modules.liquidglass.glass.BackdropConsumer
import expo.modules.liquidglass.glass.BackdropSource
import expo.modules.liquidglass.glass.GlassDebug
import expo.modules.liquidglass.glass.GlassTier
import expo.modules.liquidglass.glass.ProviderRegistry

/**
 * The glass surface.
 *
 * React children are **not** re-parented — `ExpoView` is a `ViewGroup` and React Native's mounting
 * layer applies Yoga frames to them directly. The glass is drawn in `dispatchDraw` *before*
 * `super.dispatchDraw(canvas)`, which keeps children fully interactive and makes `containerStyle`
 * work with no Kotlin code at all.
 *
 * The effect chain goes on this view's own padded `RenderNode` — never on the provider's node, and
 * never via `View.setRenderEffect`, which cannot be cropped and clips to the view bounds.
 *
 * Phase 1: a fixed blur, no props and no shader.
 */
class LiquidGlassView(context: Context, appContext: AppContext) :
  ExpoView(context, appContext), BackdropConsumer {

  /** Which [LiquidGlassProviderView] supplies this view's backdrop. */
  var providerId: String = DEFAULT_PROVIDER_ID
    set(value) {
      if (field == value) return
      field = value
      detachFromProvider()
      invalidate()
    }

  /**
   * The Kotlin property name *is* the event name, and it must match `Events("onRendererChange")`
   * exactly — otherwise the event is silently dropped with a "wasn't exported" warning.
   */
  private val onRendererChange by EventDispatcher<Map<String, Any>>()

  /** Last value sent to JS, so we only emit on a genuine change (matching iOS). */
  private var reportedRenderer: String? = null

  /** The tier this view is actually drawing at. Lowered by degradation in later phases. */
  private var tier: GlassTier = GlassTier.supported

  private val glassNode: RenderNode? =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) RenderNode("LiquidGlass") else null

  private var provider: BackdropSource? = null
  private var appliedEffectRadius: Float = Float.NaN

  /** The provider's [BackdropSource.contentGeneration] as of our last successful draw. */
  private var drawnGeneration = Int.MIN_VALUE

  /**
   * Bounds the "provider has not drawn yet" retry, so a provider that never produces a display
   * list — zero-sized, or detached mid-flight — cannot spin the main thread.
   */
  private var pendingRetries = 0

  private val location = IntArray(2)
  private val providerLocation = IntArray(2)

  private val frostPaint = Paint().apply { isAntiAlias = true }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    reportRendererIfChanged()
  }

  override fun onDetachedFromWindow() {
    detachFromProvider()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) glassNode?.discardDisplayList()
    super.onDetachedFromWindow()
  }

  override fun onBackdropChanged() {
    // The provider notifies after every recording pass. Redraw only when the content it recorded
    // has actually changed, otherwise every redraw would provoke the next one.
    val generation = provider?.contentGeneration ?: return
    if (generation != drawnGeneration) invalidate()
  }

  override fun dispatchDraw(canvas: Canvas) {
    drawGlass(canvas)
    super.dispatchDraw(canvas)
  }

  private fun drawGlass(canvas: Canvas) {
    if (!tier.hasLiveBackdrop) return
    if (width <= 0 || height <= 0) return
    // Software canvases (screenshots, PDF export) cannot draw a RenderNode at all.
    if (!canvas.isHardwareAccelerated) return
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return

    val node = glassNode ?: return
    val source = resolveProvider() ?: return
    val content = source.contentNode

    if (content == null) {
      // The provider is mounted but has not recorded yet. It draws before us in a normal frame, so
      // this only happens when it mounts late.
      if (pendingRetries < MAX_PENDING_RETRIES) {
        pendingRetries++
        invalidate()
      }
      return
    }
    pendingRetries = 0

    val pad = PHASE1_PADDING_PX
    val padF = pad.toFloat()
    val paddedWidth = width + pad * 2
    val paddedHeight = height + pad * 2

    getLocationInWindow(location)
    source.sourceView.getLocationInWindow(providerLocation)
    val relX = (location[0] - providerLocation[0]).toFloat()
    val relY = (location[1] - providerLocation[1]).toFloat()

    node.setPosition(0, 0, paddedWidth, paddedHeight)
    val recording = node.beginRecording(paddedWidth, paddedHeight)
    try {
      // Put the provider content that sits under our top-left corner at (pad, pad).
      recording.translate(padF - relX, padF - relY)
      recording.drawRenderNode(content)
    } finally {
      node.endRecording()
    }

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) applyBlur(node)

    val save = canvas.save()
    canvas.clipRect(0f, 0f, width.toFloat(), height.toFloat())
    canvas.translate(-padF, -padF)
    canvas.drawRenderNode(node)
    canvas.restoreToCount(save)

    // Enough of a frost that the surface reads as glass rather than as a blurred rectangle.
    frostPaint.color = PHASE1_FROST_COLOR
    canvas.drawRect(0f, 0f, width.toFloat(), height.toFloat(), frostPaint)

    drawnGeneration = source.contentGeneration
    GlassDebug.onGlassDrawn()
  }

  @RequiresApi(Build.VERSION_CODES.S)
  private fun applyBlur(node: RenderNode) {
    val radius = PHASE1_BLUR_RADIUS_PX
    if (radius == appliedEffectRadius) return
    appliedEffectRadius = radius
    // `createBlurEffect(0f, …)` throws — b/241546169 — so the zero case must skip the stage.
    node.setRenderEffect(
      if (radius > 0f) {
        RenderEffect.createBlurEffect(radius, radius, Shader.TileMode.CLAMP)
      } else {
        null
      }
    )
  }

  private fun resolveProvider(): BackdropSource? {
    provider?.let { return it }
    val found = ProviderRegistry.find(providerId, this) ?: return null
    provider = found
    found.addConsumer(this)
    return found
  }

  private fun detachFromProvider() {
    provider?.removeConsumer(this)
    provider = null
    drawnGeneration = Int.MIN_VALUE
    pendingRetries = 0
  }

  private fun reportRendererIfChanged() {
    val name = tier.rendererName
    if (name == reportedRenderer) return
    reportedRenderer = name
    onRendererChange(mapOf("renderer" to name))
  }

  private companion object {
    /**
     * Phase 1 placeholder. Phase 3 replaces this with the iOS formula:
     * `ceil(max(refraction + dispersion, blur > 0 ? max(blur * 1.5, 16) : 0) + 2)`.
     */
    const val PHASE1_PADDING_PX = 48

    /**
     * HWUI converts radius to sigma as `0.57735 * R + 0.5`, and iOS uses `sigma = 0.5 * radiusPx`.
     * This is `R` for a 40 px iOS-equivalent radius: `(0.5 * 40 - 0.5) / 0.57735`.
     */
    const val PHASE1_BLUR_RADIUS_PX = 33.8f

    const val PHASE1_FROST_COLOR = 0x26FFFFFF

    const val MAX_PENDING_RETRIES = 8
  }
}
