package expo.modules.liquidglass

import android.content.Context
import android.content.res.Configuration
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.RenderEffect
import android.graphics.RenderNode
import android.graphics.Shader
import android.os.Build
import androidx.annotation.RequiresApi
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import expo.modules.liquidglass.enums.GlassBackend
import expo.modules.liquidglass.enums.GlassCornerStyle
import expo.modules.liquidglass.enums.GlassVariant
import expo.modules.liquidglass.glass.BackdropConsumer
import expo.modules.liquidglass.glass.BackdropSource
import expo.modules.liquidglass.glass.CornerRadii
import expo.modules.liquidglass.glass.GlassAppearance
import expo.modules.liquidglass.glass.GlassDebug
import expo.modules.liquidglass.glass.GlassTier
import expo.modules.liquidglass.glass.ProviderRegistry
import expo.modules.liquidglass.records.GlassMetalOptions

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
 * Phase 2: the whole prop surface crosses and resolves. The refraction shader lands in Phase 3;
 * until then the surface is blur + frost + tint + border, clipped to the corner radii.
 */
class LiquidGlassView(context: Context, appContext: AppContext) :
  ExpoView(context, appContext), BackdropConsumer {

  // ---------------------------------------------------------------- props (raw, as they arrive)

  /** Which [LiquidGlassProviderView] supplies this view's backdrop. */
  var providerId: String = DEFAULT_PROVIDER_ID
    set(value) {
      if (field == value) return
      field = value
      detachFromProvider()
      invalidate()
    }

  var variant: GlassVariant = GlassVariant.regular
  var backend: GlassBackend = GlassBackend.auto

  /** Accepted for API parity; Android has no continuous-corner primitive. See the enum's docs. */
  @Suppress("unused")
  var cornerStyle: GlassCornerStyle = GlassCornerStyle.continuous

  /** Already `processColor`ed on the JS side — see the module definition for why. */
  var tint: Int? = null

  /** Apple's internal press deformation. No public equivalent; ignored on iOS's Metal path too. */
  @Suppress("unused")
  var isInteractive: Boolean = false

  var metal: GlassMetalOptions? = null

  /** `internal`, because [CornerRadii] is not part of this package's API. */
  internal var rawCornerRadii: CornerRadii = CornerRadii.ZERO

  // -------------------------------------------------------------------- resolved / derived state

  private val density: Float get() = resources.displayMetrics.density

  private var appearance: GlassAppearance =
    GlassAppearance.resolve(GlassVariant.regular, null, 1f)

  /** [rawCornerRadii] clamped to this view's current size. Recomputed on size change. */
  private var clampedRadii: CornerRadii = CornerRadii.ZERO

  private val clipPath = Path()
  private val borderPath = Path()
  private val bounds = RectF()
  private val borderBounds = RectF()
  private val pathRadii = FloatArray(8)
  private var clipPathValid = false

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
  private var appliedBlurRadius: Float = Float.NaN

  /** The provider's [BackdropSource.contentGeneration] as of our last successful draw. */
  private var drawnGeneration = Int.MIN_VALUE

  /**
   * Bounds the "provider has not drawn yet" retry, so a provider that never produces a display
   * list — zero-sized, or detached mid-flight — cannot spin the main thread.
   */
  private var pendingRetries = 0

  private val location = IntArray(2)
  private val providerLocation = IntArray(2)

  private val fillPaint = Paint().apply { isAntiAlias = true }
  private val borderPaint = Paint().apply {
    isAntiAlias = true
    style = Paint.Style.STROKE
  }

  // --------------------------------------------------------------------------------- lifecycle

  /**
   * The coalescing hook — the analogue of iOS's `setNeedsAppearanceUpdate()`. Prop setters run in
   * JS-map order rather than DSL order, so nothing may be resolved inside one; everything that
   * depends on more than one prop is resolved here, once, after the whole batch has landed.
   */
  fun onPropsUpdated() {
    appearance = GlassAppearance.resolve(variant, metal, density)
    clipPathValid = false
    appliedBlurRadius = Float.NaN
    invalidate()
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    reportRendererIfChanged()
  }

  override fun onDetachedFromWindow() {
    detachFromProvider()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) glassNode?.discardDisplayList()
    super.onDetachedFromWindow()
  }

  /** `OnViewDestroys`. Detach is not guaranteed to have run, so this must be idempotent. */
  fun release() {
    detachFromProvider()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) glassNode?.discardDisplayList()
  }

  override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
    super.onSizeChanged(w, h, oldw, oldh)
    // Size-dependent state belongs here, never in a prop setter — width/height are not yet valid
    // when props arrive.
    clipPathValid = false
  }

  override fun onConfigurationChanged(newConfig: Configuration?) {
    super.onConfigurationChanged(newConfig)
    // Frost resolves against the light/dark background colour, as `traitCollectionDidChange` does.
    invalidate()
  }

  override fun onBackdropChanged() {
    // The provider notifies after every recording pass. Redraw only when the content it recorded
    // has actually changed, otherwise every redraw would provoke the next one.
    val generation = provider?.contentGeneration ?: return
    if (generation != drawnGeneration) invalidate()
  }

  // ------------------------------------------------------------------------------------ drawing

  override fun dispatchDraw(canvas: Canvas) {
    drawGlass(canvas)
    super.dispatchDraw(canvas)
  }

  private fun drawGlass(canvas: Canvas) {
    if (width <= 0 || height <= 0) return
    if (!clipPathValid) rebuildClipPath()

    val opacity = appearance.opacity
    val layer = if (opacity < 1f) {
      canvas.saveLayerAlpha(bounds, (opacity.coerceIn(0f, 1f) * 255f).toInt())
    } else {
      canvas.save()
    }

    if (!clampedRadii.isZero) canvas.clipPath(clipPath)

    drawBackdrop(canvas)
    drawFrostAndTint(canvas)
    canvas.restoreToCount(layer)

    drawBorder(canvas)
  }

  /** The blurred copy of whatever the provider recorded under this view. */
  private fun drawBackdrop(canvas: Canvas) {
    if (!tier.hasLiveBackdrop) return
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

    val pad = appearance.backdropPaddingPx
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
    canvas.translate(-padF, -padF)
    canvas.drawRenderNode(node)
    canvas.restoreToCount(save)

    drawnGeneration = source.contentGeneration
    GlassDebug.onGlassDrawn()
  }

  /**
   * Frost mixes toward the system background — hardcoded white/black rather than resolved from
   * `?attr/colorSurface`, because iOS uses `UIColor.systemBackground` (`#FFFFFF`/`#000000`) and
   * Material's dark default of `#121212` would visibly diverge at the `regular` frost of 0.36.
   */
  private fun drawFrostAndTint(canvas: Canvas) {
    val frost = appearance.frost
    if (frost > 0f) {
      val base = if (isDarkMode()) Color.BLACK else Color.WHITE
      fillPaint.color = base
      fillPaint.alpha = (frost.coerceIn(0f, 1f) * 255f).toInt()
      canvas.drawRect(bounds, fillPaint)
    }

    tint?.let { color ->
      fillPaint.color = color
      canvas.drawRect(bounds, fillPaint)
    }
  }

  /**
   * A flat stroke. iOS uses a `CAGradientLayer`, so this is a known simplification — Phase 3
   * replaces it with the angular highlight the shader produces.
   */
  private fun drawBorder(canvas: Canvas) {
    val strokeWidth = appearance.borderWidthPx
    if (strokeWidth <= 0f || appearance.borderOpacity <= 0f) return

    borderPaint.strokeWidth = strokeWidth
    borderPaint.color = Color.WHITE
    borderPaint.alpha = (appearance.borderOpacity.coerceIn(0f, 1f) * 255f).toInt()
    canvas.drawPath(borderPath, borderPaint)
  }

  @RequiresApi(Build.VERSION_CODES.S)
  private fun applyBlur(node: RenderNode) {
    val radius = if (appearance.hasBlur) appearance.hwuiBlurRadius else 0f
    if (radius == appliedBlurRadius) return
    appliedBlurRadius = radius
    // `createBlurEffect(0f, …)` throws — b/241546169 — so the zero case must skip the stage.
    node.setRenderEffect(
      if (radius > 0f) {
        RenderEffect.createBlurEffect(radius, radius, Shader.TileMode.CLAMP)
      } else {
        null
      }
    )
  }

  private fun rebuildClipPath() {
    bounds.set(0f, 0f, width.toFloat(), height.toFloat())
    clampedRadii = rawCornerRadii.clampedTo(width.toFloat(), height.toFloat())

    clipPath.reset()
    if (!clampedRadii.isZero) {
      clampedRadii.writePathRadii(pathRadii)
      clipPath.addRoundRect(bounds, pathRadii, Path.Direction.CW)
    }

    // The border is stroked, so it needs its own path: inset by half the stroke width so the
    // whole line stays inside the view, with each radius shrunk to match. Per-corner radii are
    // preserved — a single `drawRoundRect` cannot express them.
    val half = appearance.borderWidthPx / 2f
    borderBounds.set(
      bounds.left + half,
      bounds.top + half,
      bounds.right - half,
      bounds.bottom - half
    )
    borderPath.reset()
    if (borderBounds.width() > 0f && borderBounds.height() > 0f) {
      if (clampedRadii.isZero) {
        borderPath.addRect(borderBounds, Path.Direction.CW)
      } else {
        clampedRadii.writePathRadii(pathRadii)
        for (i in pathRadii.indices) pathRadii[i] = (pathRadii[i] - half).coerceAtLeast(0f)
        borderPath.addRoundRect(borderBounds, pathRadii, Path.Direction.CW)
      }
    }

    clipPathValid = true
  }

  private fun isDarkMode(): Boolean =
    (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) ==
      Configuration.UI_MODE_NIGHT_YES

  // ---------------------------------------------------------------------------------- plumbing

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
    const val MAX_PENDING_RETRIES = 8
  }
}
