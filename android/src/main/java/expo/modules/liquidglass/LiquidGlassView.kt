package expo.modules.liquidglass

import android.content.Context
import android.content.res.Configuration
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ColorMatrix
import android.graphics.ColorMatrixColorFilter
import android.graphics.LinearGradient
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PorterDuff
import android.graphics.PorterDuffXfermode
import android.graphics.RadialGradient
import android.graphics.RectF
import android.graphics.RenderEffect
import android.graphics.RenderNode
import android.graphics.Shader
import android.os.Build
import android.util.Log
import android.view.MotionEvent
import android.view.View
import android.view.ViewTreeObserver
import androidx.annotation.RequiresApi
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import expo.modules.liquidglass.enums.GlassBackend
import expo.modules.liquidglass.enums.GlassCornerStyle
import expo.modules.liquidglass.enums.GlassQuality
import expo.modules.liquidglass.enums.GlassVariant
import expo.modules.liquidglass.glass.BackdropConsumer
import expo.modules.liquidglass.glass.BackdropGraph
import expo.modules.liquidglass.glass.BackdropSource
import expo.modules.liquidglass.glass.ContinuousCorners
import expo.modules.liquidglass.glass.CornerRadii
import expo.modules.liquidglass.glass.GlassAppearance
import expo.modules.liquidglass.glass.GlassDebug
import expo.modules.liquidglass.glass.GlassEnvironment
import expo.modules.liquidglass.glass.GlassHdr
import expo.modules.liquidglass.glass.GlassPressAnimator
import expo.modules.liquidglass.glass.GlassShaderCache
import expo.modules.liquidglass.glass.GlassShaderSource
import expo.modules.liquidglass.glass.GlassTier
import expo.modules.liquidglass.glass.GlassProgressiveBlur
import expo.modules.liquidglass.glass.ProviderRegistry
import expo.modules.liquidglass.glass.ShaderQuality
import expo.modules.liquidglass.records.GlassGlowOptions
import expo.modules.liquidglass.records.GlassMetalOptions
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

/**
 * The glass surface.
 *
 * React children are **not** re-parented — `ExpoView` is a `ViewGroup` and React Native's mounting
 * layer applies Yoga frames to them directly. The glass is drawn in `dispatchDraw` *before*
 * `super.dispatchDraw(canvas)`, which keeps children fully interactive and makes `containerStyle`
 * work with no Kotlin code at all.
 *
 * The effect chain goes on this view's own padded [RenderNode] — never on the provider's node, and
 * never via `View.setRenderEffect`, which cannot be cropped and clips to the view bounds.
 *
 * There are three draw paths, picked by [tier]:
 *
 * | Tier    | API   | Path |
 * |---------|-------|------|
 * | `FULL`  | 33+   | the AGSL shader: refraction, dispersion, highlight, frost and tint all in one pass |
 * | `BLUR`  | 31–32 | `createBlurEffect` on the backdrop, then frost and tint on the canvas, clipped |
 * | `SCRIM` | 29–30 | the backdrop untouched, then frost and tint on the canvas, clipped |
 */
class LiquidGlassView(context: Context, appContext: AppContext) :
  ExpoView(context, appContext), BackdropConsumer {

  // ---------------------------------------------------------------- props (raw, as they arrive)

  /** Which [LiquidGlassProviderView] supplies this view's backdrop. */
  var providerId: String = DEFAULT_PROVIDER_ID
    set(value) {
      if (field == value) return
      field = value
      detachFromProviders()
      invalidate()
    }

  /**
   * Combined backdrop: multiple providers composited in list order — first at the bottom. The
   * nested-layer pattern reads `[screen, layer]`, so a pill over a glass bar refracts the bar
   * *composited over* the content behind it, exactly what the eye sees under the pill — Kyant's
   * `CombinedBackdrop`, ported. When set (non-empty) this wins over [providerId].
   */
  var providerIds: List<String>? = null
    set(value) {
      if (field == value) return
      field = value
      detachFromProviders()
      invalidate()
    }

  var variant: GlassVariant = GlassVariant.regular
  var backend: GlassBackend = GlassBackend.auto

  /**
   * iOS's `CALayerCornerCurve`, honoured for real since the squircle port: `continuous` renders
   * the calibrated Apple corner family in the SDF, the clip and the border
   * (`ContinuousCorners`, research/05). No setter side effects needed — `onPropsUpdated`
   * invalidates geometry and effect after every prop batch.
   */
  var cornerStyle: GlassCornerStyle = GlassCornerStyle.continuous

  /** Already `processColor`ed on the JS side — see the module definition for why. */
  var tint: Int? = null

  /**
   * iOS 26's `isInteractive`, ported: a spring-driven specular that blooms under the finger and
   * follows it, plus a subtle whole-view inflation. Still ignored by iOS's Metal path — this is
   * the Android implementation of the system behaviour.
   */
  var isInteractive: Boolean = false
    set(value) {
      if (field == value) return
      field = value
      if (!value) {
        // Mid-press prop flip: stop dead and restore rest state, including any RN transform.
        ownsGesture = false
        removeCallbacks(holdToOwnRunnable)
        pressAnimator?.reset()
        applyPressTransform(1f, 1f, 0f, 0f)
        effectDirty = true
        invalidate()
      }
    }

  /**
   * A press choreographed by the app, usually one happening on some *other* view — see
   * [GlassGlowOptions]. Non-null takes over the press uniforms entirely, so [isInteractive]'s own
   * animator stops reaching the shader while this is set; null hands them straight back.
   *
   * Cheap to animate: the glass uniforms are re-uploaded and the view redrawn, and nothing else in
   * the pipeline is touched — no geometry rebuild, no backdrop re-record, no change to the padding
   * budget. Reanimated's `useAnimatedProps` drives it per frame without a JS round trip.
   */
  var glow: GlassGlowOptions? = null
    set(value) {
      field = value
      effectDirty = true
      invalidate()
    }

  var metal: GlassMetalOptions? = null

  /** `internal`, because [CornerRadii] is not part of this package's API. */
  internal var rawCornerRadii: CornerRadii = CornerRadii.ZERO

  // -------------------------------------------------------------------- resolved / derived state

  private val density: Float get() = resources.displayMetrics.density

  private var appearance: GlassAppearance =
    GlassAppearance.resolve(GlassVariant.regular, null, 1f)

  /**
   * `metal.android.quality`, or null when the caller left the choice to us.
   *
   * The distinction is the whole of **R4**: an explicit value is an escape hatch and is honoured
   * exactly, size be damned, while an absent one is resolved from screen coverage by
   * [resolveShaderQuality].
   */
  private var requestedQuality: ShaderQuality? = null

  /** Which compiled shader variant this view actually draws with. */
  private var shaderQuality: ShaderQuality = ShaderQuality.MEDIUM

  /** `metal.android.maxTier`, resolved. Null means "whatever the device supports". */
  private var tierCeiling: GlassTier? = null

  /** The tier this view is actually drawing at. */
  private var tier: GlassTier = resolveTier()

  /** [rawCornerRadii] clamped to this view's current size. Recomputed on size change. */
  private var clampedRadii: CornerRadii = CornerRadii.ZERO

  private val clipPath = Path()
  private val borderPath = Path()
  private val bounds = RectF()
  private val borderBounds = RectF()
  private val pathRadii = FloatArray(8)

  /** Per-corner cell extents/exponents in [CornerRadii] field order (TL, TR, BR, BL). */
  private val cornerExtents = FloatArray(4)
  private val cornerShapes = FloatArray(4)
  private val borderExtents = FloatArray(4)
  private val borderShapes = FloatArray(4)

  /** Scratch for the shader's (BL, BR, TR, TL) packing. */
  private val shaderVec = FloatArray(4)
  private var geometryValid = false

  /**
   * The Kotlin property name *is* the event name, and it must match `Events("onRendererChange")`
   * exactly — otherwise the event is silently dropped with a "wasn't exported" warning.
   */
  private val onRendererChange by EventDispatcher<Map<String, Any>>()

  /** Last value sent to JS, so we only emit on a genuine change (matching iOS). */
  private var reportedRenderer: String? = null

  private val glassNode: RenderNode? =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) RenderNode("LiquidGlass") else null

  /** Resolved in [requestedProviderIds] order; empty until every requested id resolves. */
  private val providers = ArrayList<BackdropSource>()

  /** Non-shader tiers only: the effect parameters currently installed on [glassNode]. */
  private var appliedBlurRadius: Float = Float.NaN
  private var appliedSaturation: Float = Float.NaN

  /** The dev-mode topology checks run once per view, not once per attach. */
  private var environmentChecked = false

  /** Lazily created on the first interactive press; null means no press has ever happened. */
  private var pressAnimator: GlassPressAnimator? = null

  /**
   * The press factors we last multiplied/added in, so the base (RN `transform` styles included)
   * can be recovered at any time — the animator must never stomp a transform the app owns.
   */
  private var lastScaleFactorX = 1f
  private var lastScaleFactorY = 1f
  private var lastFollowX = 0f
  private var lastFollowY = 0f

  /** True while an interactive press on bare glass (no child claimed) owns the event stream. */
  private var ownsGesture = false

  /**
   * Hold-to-own: a bare-glass press still held after [HOLD_TO_OWN_MS] takes the gesture from
   * ancestor scrollers, so dragging interactive glass follows and stretches instead of scrolling
   * away. Quick flicks stay scrolls — they breach the scroller's touch slop before this fires —
   * and JS responders (a `PanResponder` drag wrapper) grant even faster, so they keep winning too.
   */
  private val holdToOwnRunnable = Runnable {
    if (ownsGesture && isInteractive && isAttachedToWindow) {
      parent?.requestDisallowInterceptTouchEvent(true)
    }
  }

  /**
   * Shader tier only. HWUI short-circuits `setRenderEffect` on pointer identity and Skia snapshots
   * the uniform values when the effect is created, so a *new* [RenderEffect] must be built whenever
   * a uniform changes. These two together are the "has anything changed" test.
   */
  private var effectDirty = true
  private var appliedPadding = -1

  /** The provider's [BackdropSource.contentGeneration] as of our last successful draw. */
  private var drawnGeneration = Int.MIN_VALUE

  /**
   * Bounds the "provider has not drawn yet" retry, so a provider that never produces a display
   * list — zero-sized, or detached mid-flight — cannot spin the main thread.
   */
  private var pendingRetries = 0

  /**
   * [BackdropGraph]'s verdict on this view's providers, latched.
   *
   * Checked once per resolve because the answer cannot change without one: it depends on the view
   * tree and on who samples whom, and both of those go through [detachFromProviders].
   */
  private var backdropGraphChecked = false
  private var backdropGraphFaulted = false

  /**
   * Provider-local -> our-local, as of the last recording.
   *
   * The recorded backdrop is only correct for this transform. A pure `(dx, dy)` would cover scroll
   * and drag, but a matrix also survives an ancestor that scales or rotates, and it costs the same
   * to compare.
   */
  /** One matrix per provider, in [providers] order; empty means nothing recorded yet. */
  private val recordedTransforms = ArrayList<Matrix>()

  private val localToWindow = Matrix()
  private val providerToWindow = Matrix()
  private val windowToLocal = Matrix()
  private val providerToLocal = Matrix()

  /**
   * The shader's sampling clamp: the provider content actually recorded, half a pixel in — see
   * [updateShaderCrop]. Blur stages read an edge-extended copy of that content (see
   * [GlassProgressiveBlur.extendEffect]), so nothing outside it can leak into what the glass
   * samples and no further inset is needed. Valid only while [hasShaderCrop]; falls back to the
   * full node rect.
   */
  private val shaderCropRect = RectF()
  private var hasShaderCrop = false
  private val mappedContentRect = RectF()

  /**
   * The glass moving is not the same event as the backdrop changing, and nothing else reports it.
   *
   * When an **ancestor** moves this view — a `FlatList` scrolling its rows, a Reanimated transform
   * on a wrapper, `Animated` with the native driver — this view is not dirty, so `dispatchDraw`
   * never re-runs and the recorded backdrop offset silently goes stale: the glass carries its old
   * backdrop along like a decal. Measured on device before this listener existed.
   *
   * A pre-draw listener is the right instrument because it is **self-gating** — it is dispatched
   * from `ViewRootImpl.performTraversals`, so no traversal means no callback and no work. That is
   * why this is not a `Choreographer.postFrameCallback`, which would fire every vsync forever and
   * burn power at idle.
   */
  private val preDrawListener = ViewTreeObserver.OnPreDrawListener {
    if (backdropTransformChanged()) invalidate()
    true
  }

  /** The observer we registered with, so detach removes the listener from the *same* one. */
  private var observedTree: ViewTreeObserver? = null

  // ------------------------------------------------------------------------------- HDR headroom

  /** Last ratio read from the display. Only consulted when [GlassHdr.requested] is true. */
  private var hdrHeadroom = 1f

  /** The display the ratio listener is registered on — unregister needs the same instance. */
  private var ratioDisplay: android.view.Display? = null

  /**
   * Brightness moves the ratio continuously, so this fires often while HDR is on — each change
   * is one effect rebuild, the same cost as one press-animation frame. Only registered while
   * [GlassHdr.requested] and the display reports a ratio, so SDR sessions never pay it.
   */
  private val ratioConsumer = java.util.function.Consumer<android.view.Display> { d ->
    if (Build.VERSION.SDK_INT >= 34) {
      val ratio = d.hdrSdrRatio.coerceAtLeast(1f)
      if (abs(ratio - hdrHeadroom) > 0.01f) {
        hdrHeadroom = ratio
        effectDirty = true
        invalidate()
      }
    }
  }

  /** The runtime opt-in flipping (setHdrEnabled with views mounted) lands here. */
  private val hdrStateListener = GlassHdr.Listener {
    post {
      if (!isAttachedToWindow) return@post
      syncHdrListener()
      hdrHeadroom = GlassHdr.currentHeadroom(display)
      effectDirty = true
      invalidate()
    }
  }

  /** Registers/unregisters the per-display ratio listener to match the current opt-in state. */
  private fun syncHdrListener() {
    if (Build.VERSION.SDK_INT < 34) return
    val d = display
    val want = GlassHdr.requested && isAttachedToWindow && GlassHdr.isSupported(d)
    if (want && ratioDisplay == null) {
      d!!.registerHdrSdrRatioChangedListener(context.mainExecutor, ratioConsumer)
      ratioDisplay = d
    } else if (!want && ratioDisplay != null) {
      ratioDisplay?.unregisterHdrSdrRatioChangedListener(ratioConsumer)
      ratioDisplay = null
    }
  }

  private fun releaseHdr() {
    GlassHdr.removeListener(hdrStateListener)
    if (Build.VERSION.SDK_INT >= 34) {
      ratioDisplay?.unregisterHdrSdrRatioChangedListener(ratioConsumer)
    }
    ratioDisplay = null
    hdrHeadroom = 1f
  }

  private val fillPaint = Paint().apply { isAntiAlias = true }

  /** Additive blend for the press wash; allocated once, installed and removed per draw. */
  private val addXfermode = PorterDuffXfermode(PorterDuff.Mode.ADD)
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
    appliedSaturation = Float.NaN
    requestedQuality = when (metal?.android?.quality) {
      GlassQuality.low -> ShaderQuality.LOW
      GlassQuality.medium -> ShaderQuality.MEDIUM
      GlassQuality.high -> ShaderQuality.HIGH
      null -> null
    }
    shaderQuality = resolveShaderQuality()
    tierCeiling = metal?.android?.maxTier?.tier
    // A tier that was lowered because its shader would not compile can come back if the caller
    // switches to a quality that does, so re-resolve rather than latching.
    tier = resolveTier()
    reportRendererIfChanged()
    geometryValid = false
    appliedBlurRadius = Float.NaN
    effectDirty = true
    invalidate()
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    // Eager, and quiet about a miss: in every sanctioned topology the provider is an earlier
    // sibling, so it attaches first and learns about this consumer before either view draws —
    // which keeps its first frame recorded now that consumer-less providers skip recording.
    // A miss here is legitimate (a provider mounted later in the same commit); the draw-path
    // resolve keeps the warnings.
    resolveProviders(warnOnMiss = false)
    startWatchingGeometry()
    GlassHdr.addListener(hdrStateListener)
    syncHdrListener()
    hdrHeadroom = GlassHdr.currentHeadroom(display)
    reportRendererIfChanged()
    if (!environmentChecked) {
      environmentChecked = true
      // Posted, not immediate: `canScrollVertically` needs the container's children measured, and
      // a provider mounted in the same commit may not be in the hierarchy yet.
      post {
        if (isAttachedToWindow) {
          for (id in requestedProviderIds()) GlassEnvironment.checkGlassView(this, id)
        }
      }
    }
  }

  override fun onDetachedFromWindow() {
    release()
    super.onDetachedFromWindow()
  }

  /** `OnViewDestroys`. Detach is not guaranteed to have run, so this must be idempotent. */
  fun release() {
    stopWatchingGeometry()
    releaseHdr()
    detachFromProviders()
    // A parked postOnAnimation would otherwise fire on the next attach of a recycled view.
    ownsGesture = false
    removeCallbacks(holdToOwnRunnable)
    pressAnimator?.reset()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) glassNode?.discardDisplayList()
  }

  private fun startWatchingGeometry() {
    stopWatchingGeometry()
    val observer = viewTreeObserver
    if (!observer.isAlive) return
    observer.addOnPreDrawListener(preDrawListener)
    observedTree = observer
  }

  private fun stopWatchingGeometry() {
    val observer = observedTree ?: return
    observedTree = null
    // The observer is merged and replaced when a view moves between hierarchies, so remove from the
    // one we actually registered with; a dead observer's own list is already gone.
    if (observer.isAlive) {
      observer.removeOnPreDrawListener(preDrawListener)
    } else {
      viewTreeObserver.removeOnPreDrawListener(preDrawListener)
    }
  }

  override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
    super.onSizeChanged(w, h, oldw, oldh)
    // Size-dependent state belongs here, never in a prop setter — width/height are not yet valid
    // when props arrive. R4's coverage test is size-dependent, so it is resolved here too, and a
    // change of variant has to be pushed through the tier because a tier can be lowered by a
    // quality whose shader will not compile.
    val quality = resolveShaderQuality()
    if (quality != shaderQuality) {
      shaderQuality = quality
      tier = resolveTier()
      reportRendererIfChanged()
    }
    geometryValid = false
    effectDirty = true
  }

  override fun onConfigurationChanged(newConfig: Configuration?) {
    super.onConfigurationChanged(newConfig)
    // Frost resolves against the light/dark background colour, as `traitCollectionDidChange` does.
    effectDirty = true
    invalidate()
  }

  override fun onBackdropChanged() {
    // The provider notifies after every recording pass. Redraw only when the content it recorded
    // has actually changed, otherwise every redraw would provoke the next one.
    if (providers.isEmpty()) return
    var generation = 0
    for (source in providers) generation += source.contentGeneration
    if (generation != drawnGeneration) invalidate()
  }

  // ------------------------------------------------------------------------------------ drawing

  override fun dispatchDraw(canvas: Canvas) {
    drawGlass(canvas)
    super.dispatchDraw(canvas)
  }

  // ------------------------------------------------------------------------- interactive presses

  /**
   * Pure observer — the return value is `super`'s, untouched. The full event stream flows through
   * here whenever anything in this subtree (including [onTouchEvent] below) is the touch target,
   * and an ancestor that steals the gesture (a scroller, a `PanResponder` grant via RN's
   * `JSResponderHandler`) hands us ACTION_CANCEL, which releases like an UP.
   */
  override fun dispatchTouchEvent(ev: MotionEvent): Boolean {
    if (isInteractive) when (ev.actionMasked) {
      MotionEvent.ACTION_DOWN -> {
        // Base captured before the first scale write of this press, so an RN transform applied
        // between presses is respected.
        obtainPressAnimator().pressDown(ev.x, ev.y)
      }
      MotionEvent.ACTION_MOVE -> pressAnimator?.follow(ev.x, ev.y)
      MotionEvent.ACTION_UP,
      MotionEvent.ACTION_CANCEL -> {
        ownsGesture = false
        removeCallbacks(holdToOwnRunnable)
        pressAnimator?.releasePress()
      }
    }
    return super.dispatchTouchEvent(ev)
  }

  /**
   * The claim, kept separate from the observation: `ViewGroup` consults this only when no child
   * claimed the DOWN, and returning true there is what keeps MOVE/UP arriving for a press on bare
   * glass. RN is unaffected — its responder pipeline is fed from the root's intercept hook
   * regardless of native claims, and RN child views claim their own DOWNs anyway.
   */
  override fun onTouchEvent(event: MotionEvent): Boolean {
    if (super.onTouchEvent(event)) return true
    if (!isInteractive) return false
    if (event.actionMasked == MotionEvent.ACTION_DOWN) {
      ownsGesture = true
      postDelayed(holdToOwnRunnable, HOLD_TO_OWN_MS)
    }
    return true
  }

  // ------------------------------------------------------------------ resolved press uniforms
  //
  // Two sources feed the same three uniforms: this view's own `interactive` animator, and a `glow`
  // record the app drives. An explicit record wins — it is the caller saying "I am choreographing
  // this", and silently mixing the two would make a mid-press prop change look like a glitch.

  /** 0 at rest, which is what keeps the shader's uniform-coherent press branch switched off. */
  private val effectiveGlow: Float
    get() {
      val external = glow ?: return if (isInteractive) pressAnimator?.glow ?: 0f else 0f
      return external.progress.toFloat().coerceIn(0f, 1f)
    }

  /** Hotspot in view-local px — the space the shader calls `pixels`. */
  private val effectiveGlowX: Float
    get() {
      val external = glow ?: return pressAnimator?.posX ?: 0f
      return external.x?.let { it.toFloat() * density } ?: (width * 0.5f)
    }

  private val effectiveGlowY: Float
    get() {
      val external = glow ?: return pressAnimator?.posY ?: 0f
      return external.y?.let { it.toFloat() * density } ?: (height * 0.5f)
    }

  /** Gates the dent and the lens boost; see the `touchLens` uniform. */
  private val effectiveGlowLens: Float
    get() {
      val external = glow ?: return 1f
      return if (external.lens) 1f else 0f
    }

  private fun obtainPressAnimator(): GlassPressAnimator {
    pressAnimator?.let { return it }
    val created = GlassPressAnimator(this) { onPressFrame() }
    pressAnimator = created
    return created
  }

  /** Animation-stage write-through: fresh uniforms, fresh transform, and a draw this same frame. */
  private fun onPressFrame() {
    val animator = pressAnimator ?: return
    effectDirty = true
    applyPressTransform(
      animator.scale * animator.stretchX,
      animator.scale * animator.stretchY,
      animator.followX,
      animator.followY,
    )
    invalidate()
  }

  private fun applyPressTransform(
    factorX: Float,
    factorY: Float,
    followX: Float,
    followY: Float,
  ) {
    scaleX = (scaleX / lastScaleFactorX) * factorX
    scaleY = (scaleY / lastScaleFactorY) * factorY
    translationX = (translationX - lastFollowX) + followX
    translationY = (translationY - lastFollowY) + followY
    lastScaleFactorX = factorX
    lastScaleFactorY = factorY
    lastFollowX = followX
    lastFollowY = followY
  }

  private fun drawGlass(canvas: Canvas) {
    if (width <= 0 || height <= 0) return
    if (!geometryValid) rebuildGeometry()

    val drewShader =
      tier == GlassTier.FULL &&
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
        drawShaderGlass(canvas)

    if (!drewShader) {
      // The shader path only declines when there is no backdrop to shade — no provider yet, or a
      // software canvas — so the fallback must not try to draw one either.
      drawCompositedGlass(canvas, allowBackdrop = tier != GlassTier.FULL)
    }

    drawBorder(canvas)
  }

  // -------------------------------------------------------------------------- the shader path

  /**
   * Returns false when there is nothing to shade, so the caller can fall back to a plain scrim
   * rather than leaving the view invisible.
   */
  @RequiresApi(Build.VERSION_CODES.TIRAMISU)
  private fun drawShaderGlass(canvas: Canvas): Boolean {
    // A software canvas (screenshots, PDF export, some OEM paths) cannot draw a RenderNode at all.
    if (!canvas.isHardwareAccelerated) return false
    val node = glassNode ?: return false

    val pad = appearance.backdropPaddingPx(GlassTier.FULL)
    if (!recordBackdrop(node, pad)) return false

    if (effectDirty || pad != appliedPadding) {
      val effect = buildShaderEffect(pad)
      if (effect == null) {
        // The tier check passed at construction, so this is a driver or platform surprise. Drop to
        // the blur tier for the rest of this view's life rather than flickering between the two.
        tier = GlassTier.BLUR
        reportRendererIfChanged()
        return false
      }
      node.setRenderEffect(effect)
      effectDirty = false
      appliedPadding = pad
    }

    // R3: the effect is evaluated over the padded node, which at `regular` defaults is ~4.9x the
    // view's area. HWUI propagates the device clip into the image filter's requested output rect,
    // so clipping first genuinely shrinks the shaded region. Inflated by 2 px because the SDF
    // feather spans sd in [-1, +1] and its outer half lies beyond the view rect.
    val save = canvas.save()
    canvas.clipRect(
      -CLIP_INFLATE_PX,
      -CLIP_INFLATE_PX,
      width + CLIP_INFLATE_PX,
      height + CLIP_INFLATE_PX
    )
    canvas.translate(-pad.toFloat(), -pad.toFloat())
    canvas.drawRenderNode(node)
    canvas.restoreToCount(save)

    GlassDebug.onGlassDrawn()
    return true
  }

  /**
   * Uploads the uniforms and builds a fresh [RenderEffect].
   *
   * Every `setFloatUniform` is gated on the variant's live-uniform set. A uniform the compiler
   * optimised out — which is exactly what the `LOW` tier does to five of them — makes
   * `setFloatUniform` throw `unable to find uniform named …`, and a declared uniform that is never
   * set throws at draw time instead. Both directions throw, so neither list may drift.
   */
  @RequiresApi(Build.VERSION_CODES.TIRAMISU)
  private fun buildShaderEffect(pad: Int): RenderEffect? {
    val variant = GlassShaderCache.variantOrNull(shaderQuality) ?: return null
    val shader = GlassShaderCache.shaderOrNull(shaderQuality) ?: return null
    val live = variant.liveUniforms

    val w = width.toFloat()
    val h = height.toFloat()
    val p = pad.toFloat()
    val d = density

    fun set(name: String, value: Float) {
      if (name in live) shader.setFloatUniform(name, value)
    }

    fun set(name: String, a: Float, b: Float) {
      if (name in live) shader.setFloatUniform(name, a, b)
    }

    fun set(name: String, a: Float, b: Float, c: Float, e: Float) {
      if (name in live) shader.setFloatUniform(name, a, b, c, e)
    }

    return try {
      set(GlassShaderSource.SIZE, w, h)
      set(GlassShaderSource.OFFSET, -p, -p)
      // Half-pixel inset so Skia's bilinear filter never blends the outermost real texel with the
      // transparent black outside the node — that shows up as a dark hairline the clamp is supposed
      // to be hiding. When the provider content underfills the node, the clamp tightens further to
      // the content itself — see updateShaderCrop.
      val nodeCrop = floatArrayOf(0.5f, 0.5f, w + 2f * p - 0.5f, h + 2f * p - 0.5f)
      val crop = if (hasShaderCrop) {
        floatArrayOf(
          shaderCropRect.left, shaderCropRect.top,
          shaderCropRect.right, shaderCropRect.bottom
        )
      } else {
        nodeCrop
      }
      set(GlassShaderSource.CROP, crop[0], crop[1], crop[2], crop[3])

      // The blur stage, if any. Progressive replaces uniform when both are asked for — one ramp
      // already contains a flat blur as its degenerate case, and running both would double-blur.
      // If the pyramid is unusable on this driver, degrade to a uniform hwui blur at the ramp's
      // mean rather than dropping the stage: a scrim that suddenly stops blurring reads as a bug,
      // a scrim that blurs evenly reads as conservative.
      val blurStage: RenderEffect? = when {
        appearance.hasProgressiveBlur ->
          GlassProgressiveBlur.buildEffect(appearance, shaderQuality, w, h, p)
            ?: appearance.hwuiRadius(appearance.fallbackBlurPx).takeIf { it > 0f }?.let {
              RenderEffect.createBlurEffect(it, it, Shader.TileMode.CLAMP)
            }
        appearance.hasBlur ->
          RenderEffect.createBlurEffect(
            appearance.hwuiBlurRadius,
            appearance.hwuiBlurRadius,
            Shader.TileMode.CLAMP
          )
        else -> null
      }

      // hwui's blur smears whatever surrounds the recorded content inward by its reach, and when
      // the content underfills the node that surround is transparent black. Fill the padding with
      // the content's clamped edge pixels before any blur runs — see GlassProgressiveBlur — so
      // every stage is clean right up to the content edge, where the clamp above lets the glass
      // read. Skipped when the content covers the node: there is nothing to extend.
      val underfilled = hasShaderCrop && !crop.contentEquals(nodeCrop)
      val blurInput: RenderEffect? =
        if (blurStage != null && underfilled) GlassProgressiveBlur.extendEffect(crop) else null

      // Resolved by rebuildGeometry, which drawGlass runs before this. Circular style resolves to
      // (E = r, n = 2), which the shader's corner branch reduces to the pre-squircle SDF exactly.
      ContinuousCorners.writeShaderVec(cornerExtents, shaderVec)
      set(
        GlassShaderSource.CORNER_EXTENTS,
        shaderVec[0], shaderVec[1], shaderVec[2], shaderVec[3]
      )
      ContinuousCorners.writeShaderVec(cornerShapes, shaderVec)
      set(
        GlassShaderSource.CORNER_SHAPES,
        shaderVec[0], shaderVec[1], shaderVec[2], shaderVec[3]
      )
      set(GlassShaderSource.UNIT_SCALE, d)

      set(
        GlassShaderSource.REFRACTION_SCALE,
        appearance.refractionWidthPx,
        appearance.refractionHeightPx
      )
      set(GlassShaderSource.REFRACTION_AMOUNT, appearance.refractionAmountPx)
      set(GlassShaderSource.REFRACTION_SWIRL, appearance.refractionSwirl)
      set(GlassShaderSource.DEPTH_EFFECT, appearance.refractionDepth)
      set(GlassShaderSource.PROFILE_POWER, appearance.curvePower)
      set(GlassShaderSource.PROFILE_BIAS, appearance.curveBias)

      set(GlassShaderSource.DISPERSION_HEIGHT, appearance.dispersionReachPx)
      set(GlassShaderSource.DISPERSION_AMOUNT, appearance.dispersionAmountPx)
      // iOS takes one tap per *point*, so `density` reproduces it exactly. The invariant that keeps
      // every channel weight non-zero is `spacing <= unitScale`, hence the min.
      set(
        GlassShaderSource.DISPERSION_TAP_SPACING,
        if (shaderQuality == ShaderQuality.HIGH) min(1f, d) else d
      )
      set(GlassShaderSource.DISPERSION_QUADRANT, appearance.dispersionQuadrant)

      val tintColor = tint
      set(
        GlassShaderSource.TINT_COLOR,
        if (tintColor == null) 0f else Color.red(tintColor) / 255f,
        if (tintColor == null) 0f else Color.green(tintColor) / 255f,
        if (tintColor == null) 0f else Color.blue(tintColor) / 255f,
        if (tintColor == null) 0f else Color.alpha(tintColor) / 255f
      )
      val frostBase = if (isDarkMode()) 0f else 1f
      set(
        GlassShaderSource.FROST_COLOR,
        frostBase, frostBase, frostBase,
        appearance.frost.coerceIn(0f, 1f)
      )

      set(GlassShaderSource.HIGHLIGHT_INTENSITY, appearance.highlightIntensity)
      set(GlassShaderSource.HIGHLIGHT_DIR, appearance.highlightCos, appearance.highlightSin)
      set(GlassShaderSource.HIGHLIGHT_WIDTH, appearance.highlightWidthPx)
      set(GlassShaderSource.HIGHLIGHT_FALLOFF, appearance.highlightFalloff)
      set(GlassShaderSource.LIGHT_INTENSITY, appearance.light)
      set(GlassShaderSource.GLASS_OPACITY, appearance.opacity)
      set(GlassShaderSource.SATURATION, appearance.saturation)
      set(GlassShaderSource.NOISE_AMOUNT, appearance.noise)
      // Pinned to 1.0 whenever the opt-in is off or unsupported, which keeps the shader
      // bit-identical to the pre-HDR build everywhere the window is SDR.
      set(
        GlassShaderSource.HDR_HEADROOM,
        if (GlassHdr.requested) hdrHeadroom.coerceAtLeast(1f) else 1f
      )

      // Always set, even at rest — a declared-but-unset uniform throws at draw time. Rest values
      // keep the shader's uniform-coherent branch off; MotionEvent coords are already view-local
      // px, the same space as the shader's `pixels`.
      set(GlassShaderSource.TOUCH_POS, effectiveGlowX, effectiveGlowY)
      set(GlassShaderSource.TOUCH_GLOW, effectiveGlow)
      set(GlassShaderSource.TOUCH_LENS, effectiveGlowLens)

      // Always set, like the touch uniforms. Both rects convert the records' top-left corners
      // into center offsets — the same packing the Metal renderer uses: the shape's from the
      // view center, the partner's from the SHAPE center, so the two knobs compose without
      // either knowing about the other. Defaults reproduce the view-filling shape exactly.
      val shapeW = if (appearance.hasShape) appearance.shapeWidthPx else w
      val shapeH = if (appearance.hasShape) appearance.shapeHeightPx else h
      val shapeCx = if (appearance.hasShape) appearance.shapeXPx + shapeW * 0.5f else w * 0.5f
      val shapeCy = if (appearance.hasShape) appearance.shapeYPx + shapeH * 0.5f else h * 0.5f
      set(
        GlassShaderSource.SHAPE_RECT,
        shapeCx - w * 0.5f, shapeCy - h * 0.5f,
        shapeW * 0.5f, shapeH * 0.5f
      )
      set(
        GlassShaderSource.MORPH_RECT,
        appearance.morphXPx + appearance.morphWidthPx * 0.5f - shapeCx,
        appearance.morphYPx + appearance.morphHeightPx * 0.5f - shapeCy,
        appearance.morphWidthPx * 0.5f,
        appearance.morphHeightPx * 0.5f
      )
      set(
        GlassShaderSource.MORPH_SHAPE,
        appearance.morphRadiusPx,
        if (appearance.hasMorph) appearance.morphSmoothingPx else 0f
      )

      val glassEffect = RenderEffect.createRuntimeShaderEffect(shader, SHADER_INPUT_NAME)

      if (blurStage == null) {
        glassEffect
      } else {
        // createChainEffect(outer, inner) runs `inner` first, so this is extend -> blur -> glass.
        // Written the other way round it still compiles and just looks wrong.
        val stage =
          if (blurInput != null) RenderEffect.createChainEffect(blurStage, blurInput) else blurStage
        RenderEffect.createChainEffect(glassEffect, stage)
      }
    } catch (t: Throwable) {
      Log.e(LOG_TAG, "Failed to build the glass RenderEffect; falling back to blur", t)
      null
    }
  }

  // ------------------------------------------------------- the blur / scrim / no-backdrop paths

  /**
   * Everything below API 33, plus the "no backdrop yet" fallback for the shader tier.
   *
   * The blur tier has no refraction, no dispersion and no highlight — it is a clipped, blurred,
   * frosted, tinted rectangle. That is an honest degradation, not an approximation of the shader.
   */
  private fun drawCompositedGlass(canvas: Canvas, allowBackdrop: Boolean) {
    val opacity = appearance.opacity
    val layer = if (opacity < 1f) {
      canvas.saveLayerAlpha(bounds, (opacity.coerceIn(0f, 1f) * 255f).toInt())
    } else {
      canvas.save()
    }

    if (!clampedRadii.isZero) canvas.clipPath(clipPath)

    if (allowBackdrop) drawBlurredBackdrop(canvas)
    drawFrostAndTint(canvas)
    drawPressWash(canvas)

    canvas.restoreToCount(layer)
  }

  /**
   * Press feedback for every frame the shader does not draw — the BLUR and SCRIM tiers, and the
   * FULL tier's declined frames — so a press never loses its glow mid-gesture. Same model as the
   * shader fragment: flat 0.08 wash plus a 0.15 radial lobe, additive. Fed by whichever source
   * owns the press, `interactive` or [glow]; only the *optical* half of a press is shader-only, and
   * this is the other half.
   *
   * `PorterDuffXfermode(ADD)`, not `BlendMode.PLUS`: minSdk is 24 and this path runs there.
   * Drawn inside the rounded clip and the opacity layer, so shape and `metal.opacity` behave
   * exactly like the frost above.
   */
  private fun drawPressWash(canvas: Canvas) {
    val glow = effectiveGlow
    if (glow <= 0f) return

    fillPaint.xfermode = addXfermode
    fillPaint.color = Color.WHITE
    fillPaint.alpha = (0.08f * glow * 255f).toInt()
    canvas.drawRect(bounds, fillPaint)

    val radius = 1.5f * min(width, height).toFloat()
    if (radius > 0f) {
      // Stops 0 / 0.5 / 1 = white / white / transparent — full strength inside half the radius,
      // the RadialGradient approximation of the shader's smoothstep falloff.
      fillPaint.shader = RadialGradient(
        effectiveGlowX, effectiveGlowY, radius,
        intArrayOf(Color.WHITE, Color.WHITE, Color.TRANSPARENT),
        floatArrayOf(0f, 0.5f, 1f),
        Shader.TileMode.CLAMP
      )
      fillPaint.alpha = (0.15f * glow * 255f).toInt()
      canvas.drawRect(bounds, fillPaint)
      fillPaint.shader = null
    }
    fillPaint.xfermode = null
  }

  private fun drawBlurredBackdrop(canvas: Canvas) {
    if (!tier.hasLiveBackdrop) return
    if (!canvas.isHardwareAccelerated) return
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return

    val node = glassNode ?: return
    val pad = appearance.backdropPaddingPx(tier)
    if (!recordBackdrop(node, pad)) return

    // Gated on the tier, not only on the API level. SCRIM is "the backdrop drawn straight through"
    // by definition, and a view lowered to SCRIM on a modern device would otherwise still get a
    // blur that a genuine API 29–30 device cannot produce — which would make the fallback untestable
    // anywhere but on hardware that old.
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      if (tier == GlassTier.BLUR) applyFallbackEffect(node) else clearFallbackEffect(node)
    }

    val padF = pad.toFloat()
    val save = canvas.save()
    canvas.translate(-padF, -padF)
    canvas.drawRenderNode(node)
    canvas.restoreToCount(save)

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

  // ------------------------------------------------------------------------------ shared plumbing

  /**
   * Records the providers' content into [node], padded and aligned to this view — composited in
   * [providers] order, first at the bottom, each through its own provider-to-local transform.
   */
  @RequiresApi(Build.VERSION_CODES.Q)
  private fun recordBackdrop(node: RenderNode, pad: Int): Boolean {
    val sources = resolveProviders()
    if (sources.isEmpty()) return false
    if (!backdropGraphIsSafe(sources)) return false

    // Every layer must be ready — recording a partial composite would flash the missing layer in.
    for (source in sources) {
      if (source.contentNode == null) {
        if (pendingRetries < MAX_PENDING_RETRIES) {
          pendingRetries++
          invalidate()
        }
        return false
      }
    }
    pendingRetries = 0

    while (recordedTransforms.size < sources.size) recordedTransforms.add(Matrix())
    while (recordedTransforms.size > sources.size) {
      recordedTransforms.removeAt(recordedTransforms.size - 1)
    }
    for (i in sources.indices) {
      if (!computeProviderToLocal(sources[i].sourceView, providerToLocal)) {
        // A singular transform mid-animation has no inverse; drawing nothing this frame is
        // correct — the view has no area.
        recordedTransforms.clear()
        return false
      }
      recordedTransforms[i].set(providerToLocal)
    }
    updateShaderCrop(sources, pad)

    val padF = pad.toFloat()
    val paddedWidth = width + pad * 2
    val paddedHeight = height + pad * 2

    node.setPosition(0, 0, paddedWidth, paddedHeight)
    val recording = node.beginRecording(paddedWidth, paddedHeight)
    try {
      for (i in sources.indices) {
        // Vetted above; a detach racing us just drops that layer for one frame.
        val content = sources[i].contentNode ?: continue
        val save = recording.save()
        // Provider-local -> our-local -> node-local. The provider content that sits under our
        // top-left corner therefore lands at (pad, pad).
        recording.translate(padF, padF)
        recording.concat(recordedTransforms[i])
        recording.drawRenderNode(content)
        recording.restoreToCount(save)
      }
    } finally {
      node.endRecording()
    }

    // The same sum onBackdropChanged compares against, so the two never disagree about "changed".
    var generation = 0
    for (source in sources) generation += source.contentGeneration
    drawnGeneration = generation
    return true
  }

  /**
   * Tightens the shader's `crop` clamp to the provider content actually recorded into the node.
   *
   * The padded node is transparent wherever the provider's mapped bounds do not reach. A
   * screen-sized provider always covers it, but a *small* provider — the nested-layer pattern: a
   * switch track, a tab bar recorded for its own pill — leaves the node's margins empty, and
   * `.rgb` of that premultiplied transparent black paints black bands exactly where
   * SAMPLE_BACKDROP's clamp is supposed to be extending edge texels. Intersecting the mapped
   * provider bounds into `crop` restores edge-extend semantics at the *content* boundary.
   *
   * The content rect is additionally inset by the blur's reach: the blur stage runs before the
   * shader samples, and content texels within one blur reach of the empty margin have already
   * been mixed toward transparent black — clamping just inside that band keeps the extended edge
   * at full strength.
   *
   * For a full-node provider the intersection IS the node rect, so the uniforms never change and
   * no extra effect rebuilds happen. During relative motion between a glass view and a small
   * provider the rect changes per frame; rebuilding the effect then is the same cost the press
   * animator already pays every frame. A rotated or skewed provider chain has no node-space rect
   * and falls back to the full node rect — the pre-fix behavior.
   */
  private fun updateShaderCrop(sources: List<BackdropSource>, pad: Int) {
    val p = pad.toFloat()
    val nodeL = 0.5f
    val nodeT = 0.5f
    val nodeR = width + 2f * p - 0.5f
    val nodeB = height + 2f * p - 0.5f

    // The union bounding box of every layer's mapped rect. For a combined backdrop whose first
    // layer is the screen, that is the whole node and the clamp stays at the node rect.
    var unionL = Float.POSITIVE_INFINITY
    var unionT = Float.POSITIVE_INFINITY
    var unionR = Float.NEGATIVE_INFINITY
    var unionB = Float.NEGATIVE_INFINITY
    var rectLike = sources.isNotEmpty()
    for (i in sources.indices) {
      val matrix = recordedTransforms.getOrNull(i)
      if (matrix == null || !matrix.rectStaysRect()) {
        rectLike = false
        break
      }
      mappedContentRect.set(
        0f, 0f,
        sources[i].sourceView.width.toFloat(), sources[i].sourceView.height.toFloat()
      )
      matrix.mapRect(mappedContentRect)
      mappedContentRect.offset(p, p)
      unionL = min(unionL, mappedContentRect.left)
      unionT = min(unionT, mappedContentRect.top)
      unionR = max(unionR, mappedContentRect.right)
      unionB = max(unionB, mappedContentRect.bottom)
    }

    var l = nodeL
    var t = nodeT
    var r = nodeR
    var b = nodeB
    if (rectLike) {
      // Half a pixel in, so bilinear filtering never blends the outermost real texel with whatever
      // lies beyond it. The blur reach is deliberately *not* added: blur stages run over an
      // edge-extended copy of the content, which has nothing beyond the edge to smear inward.
      val inset = 0.5f
      l = max(nodeL, unionL + inset)
      t = max(nodeT, unionT + inset)
      r = min(nodeR, unionR - inset)
      b = min(nodeB, unionB - inset)
      // Content entirely outside (or thinner than the inset): collapse to its centre line rather
      // than handing the shader an inverted rect.
      if (r < l) {
        val cx = (l + r) * 0.5f
        l = cx
        r = cx
      }
      if (b < t) {
        val cy = (t + b) * 0.5f
        t = cy
        b = cy
      }
    }

    if (!hasShaderCrop ||
      shaderCropRect.left != l || shaderCropRect.top != t ||
      shaderCropRect.right != r || shaderCropRect.bottom != b
    ) {
      shaderCropRect.set(l, t, r, b)
      hasShaderCrop = true
      effectDirty = true
    }
  }

  /**
   * Provider-local -> our-local, via the window.
   *
   * Both walks stop at the topmost `View` rather than the window itself. Whatever the `ViewRootImpl`
   * contributes above that is common to both — [ProviderRegistry] only ever pairs views in the same
   * window — and cancels in the composition, so there is nothing to be gained by chasing it.
   *
   * Returns false when our own transform is singular (a zero scale mid-animation), which is the one
   * case that has no inverse. Drawing nothing for that frame is correct: the view has no area.
   */
  private fun computeProviderToLocal(providerView: View, out: Matrix): Boolean {
    accumulateLocalToWindow(this, localToWindow)
    accumulateLocalToWindow(providerView, providerToWindow)
    if (!localToWindow.invert(windowToLocal)) return false
    out.set(windowToLocal)
    out.preConcat(providerToWindow)
    return true
  }

  /**
   * The public-API equivalent of `View.transformMatrixToGlobal`, which is `@hide`. Mirrors it
   * exactly: recurse to the parent, undo the parent's scroll, apply this view's offset within it,
   * then this view's own transform.
   */
  private fun accumulateLocalToWindow(view: View, out: Matrix) {
    out.reset()
    accumulate(view, out)
  }

  private fun accumulate(view: View, out: Matrix) {
    val parent = view.parent
    if (parent is View) {
      accumulate(parent, out)
      out.preTranslate(-parent.scrollX.toFloat(), -parent.scrollY.toFloat())
    }
    out.preTranslate(view.left.toFloat(), view.top.toFloat())
    val transform = view.matrix
    if (!transform.isIdentity) out.preConcat(transform)
  }

  /** Whether this view has moved relative to any of its providers since the backdrop was recorded. */
  private fun backdropTransformChanged(): Boolean {
    if (recordedTransforms.isEmpty() || recordedTransforms.size != providers.size) return false
    if (width <= 0 || height <= 0) return false
    for (i in providers.indices) {
      if (!computeProviderToLocal(providers[i].sourceView, providerToLocal)) return false
      if (providerToLocal != recordedTransforms[i]) return true
    }
    return false
  }

  /**
   * The iOS Metal-fallback border is a `CAGradientLayer` running black → white → white → black
   * corner to corner (`LiquidGlassView.swift:108-123`, `:273`). Android deliberately diverges:
   * real iOS 26 glass has **no black in its edge** — eye-tested, the edge is purely the glass
   * border *light* — so the same four stops keep their geometry but the black ends are replaced
   * with transparent white, and the axis follows `highlight.angle` instead of being pinned to the
   * bottom-left→top-right diagonal. The opaque middle band covers the two corners the shader's
   * rim lobes light; the stroke fades out where they die. See [rebuildGeometry].
   */
  private fun drawBorder(canvas: Canvas) {
    val strokeWidth = appearance.borderWidthPx
    if (strokeWidth <= 0f || appearance.borderOpacity <= 0f) return
    if (borderPath.isEmpty) return

    borderPaint.strokeWidth = strokeWidth
    borderPaint.color = Color.WHITE
    borderPaint.alpha = (appearance.borderOpacity.coerceIn(0f, 1f) * 255f).toInt()
    canvas.drawPath(borderPath, borderPaint)
  }

  /**
   * The API 31–32 tier's effect chain: blur, then saturation.
   *
   * Saturation is a `ColorMatrixColorFilter` here rather than shader arithmetic, which is the one
   * place the two paths genuinely differ. `ColorMatrix.setSaturation` uses (0.213, 0.715, 0.072)
   * against the shader's Rec.709 (0.2126, 0.7152, 0.0722) — a difference below one 8-bit step — but
   * it saturates the *blurred backdrop only*, whereas the shader saturates the refracted,
   * dispersion-averaged colour. Without refraction there is nothing to diverge from.
   */
  @RequiresApi(Build.VERSION_CODES.S)
  private fun applyFallbackEffect(node: RenderNode) {
    // A progressive ramp collapses to its mean here — this tier has no shader to ramp with.
    val radius = when {
      appearance.hasProgressiveBlur ->
        appearance.hwuiRadius(appearance.fallbackBlurPx).coerceAtLeast(0f)
      appearance.hasBlur -> appearance.hwuiBlurRadius
      else -> 0f
    }
    val saturation = appearance.saturation
    if (radius == appliedBlurRadius && saturation == appliedSaturation) return
    appliedBlurRadius = radius
    appliedSaturation = saturation

    // `createBlurEffect(0f, …)` throws — b/241546169 — so the zero case must skip the stage.
    var effect: RenderEffect? =
      if (radius > 0f) {
        RenderEffect.createBlurEffect(radius, radius, Shader.TileMode.CLAMP)
      } else {
        null
      }

    if (saturation != 1f) {
      val filter = ColorMatrixColorFilter(ColorMatrix().apply { setSaturation(saturation) })
      effect = if (effect == null) {
        RenderEffect.createColorFilterEffect(filter)
      } else {
        RenderEffect.createColorFilterEffect(filter, effect)
      }
    }

    node.setRenderEffect(effect)
  }

  /**
   * Strips whatever [applyFallbackEffect] last installed, for a view that has since dropped to
   * SCRIM. The sentinel pair is the identity chain, so a later `applyFallbackEffect` with those
   * exact values still correctly does nothing.
   */
  @RequiresApi(Build.VERSION_CODES.S)
  private fun clearFallbackEffect(node: RenderNode) {
    if (appliedBlurRadius == 0f && appliedSaturation == 1f) return
    appliedBlurRadius = 0f
    appliedSaturation = 1f
    node.setRenderEffect(null)
  }

  private fun rebuildGeometry() {
    val w = width.toFloat()
    val h = height.toFloat()
    bounds.set(0f, 0f, w, h)
    clampedRadii = rawCornerRadii.clampedTo(w, h)

    // One resolver feeds the clip path, the border path and the shader uniforms, so all three
    // renderers sit on the same curve — the whole point of the (E, n) family (research/05).
    val continuous = cornerStyle == GlassCornerStyle.continuous
    ContinuousCorners.resolve(clampedRadii, continuous, w, h, cornerExtents, cornerShapes)

    clipPath.reset()
    if (!clampedRadii.isZero) {
      if (continuous) {
        ContinuousCorners.addContinuousRoundRect(clipPath, bounds, cornerExtents, cornerShapes)
      } else {
        clampedRadii.writePathRadii(pathRadii)
        clipPath.addRoundRect(bounds, pathRadii, Path.Direction.CW)
      }
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
      } else if (continuous) {
        val borderRadii = clampedRadii.insetBy(half)
        ContinuousCorners.resolve(
          borderRadii, true, borderBounds.width(), borderBounds.height(),
          borderExtents, borderShapes
        )
        ContinuousCorners.addContinuousRoundRect(
          borderPath, borderBounds, borderExtents, borderShapes
        )
      } else {
        clampedRadii.writePathRadii(pathRadii)
        for (i in pathRadii.indices) pathRadii[i] = (pathRadii[i] - half).coerceAtLeast(0f)
        borderPath.addRoundRect(borderBounds, pathRadii, Path.Direction.CW)
      }
    }

    // Laid along the highlight axis, so one prop steers the shader lobes, the swirl and this
    // stroke together. `reach` is half the view's footprint projected onto that axis: the extreme
    // corners project exactly onto stops 0 and 1 at any angle, the way the CALayer original's
    // corner-to-corner endpoints did for its fixed diagonal.
    val dirX = appearance.highlightCos
    val dirY = appearance.highlightSin
    val cx = width / 2f
    val cy = height / 2f
    val reach = 0.5f * (abs(width * dirX) + abs(height * dirY))
    borderPaint.shader = LinearGradient(
      cx - reach * dirX,
      cy - reach * dirY,
      cx + reach * dirX,
      cy + reach * dirY,
      BORDER_GRADIENT_COLORS,
      BORDER_GRADIENT_STOPS,
      Shader.TileMode.CLAMP
    )

    geometryValid = true
  }

  private fun isDarkMode(): Boolean =
    (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) ==
      Configuration.UI_MODE_NIGHT_YES

  private fun requestedProviderIds(): List<String> =
    providerIds?.takeIf { it.isNotEmpty() } ?: listOf(providerId)

  /**
   * Which providers this view would draw into its own node, without binding to them.
   *
   * [BackdropGraph] asks this of *other* views mid-walk, where resolving for real would attach
   * consumers to providers on their behalf and make a provider start recording for a view that has
   * not drawn yet. A faulted view answers with nothing, because that is what it will actually
   * sample: its backdrop is off.
   */
  internal fun peekSampledSources(): List<BackdropSource> {
    if (backdropGraphFaulted) return emptyList()
    if (providers.isNotEmpty()) return providers
    val peeked = ArrayList<BackdropSource>(2)
    for (id in requestedProviderIds()) {
      peeked.add(ProviderRegistry.find(id, this, warnOnMiss = false) ?: return emptyList())
    }
    return peeked
  }

  /**
   * The cycle check, run from the draw path rather than from attach.
   *
   * [BackdropGraph] walks the providers' subtrees, and at attach time the subtree that closes the
   * loop may not be mounted — a screen inside a provider builds after the provider does. By the
   * first draw the tree is whole, and bailing here still happens *before* anything is recorded, so
   * the frame that discovers the loop never builds one.
   */
  private fun backdropGraphIsSafe(sources: List<BackdropSource>): Boolean {
    if (backdropGraphFaulted) return false
    if (backdropGraphChecked) return true
    backdropGraphChecked = true
    val fault = BackdropGraph.inspect(this, sources) ?: return true
    // Not gated on dev mode. The alternative to this line is a SIGSEGV in the RenderThread with a
    // backtrace that names nothing of ours, which is not a thing to ship quietly to a release user.
    GlassDebug.warnOnce(
      "backdrop-graph:${fault.kind}:${fault.providerId}",
      BackdropGraph.describe(fault)
    )
    // Order matters: detaching resets the verdict along with the rest of the consumer state.
    detachFromProviders()
    backdropGraphChecked = true
    backdropGraphFaulted = true
    return false
  }

  /**
   * All requested providers, or nothing: partial resolution is never cached, so a provider
   * mounted later in the same commit is picked up by the draw-path retry, and no consumer leaks
   * onto the ones that did resolve.
   */
  private fun resolveProviders(warnOnMiss: Boolean = true): List<BackdropSource> {
    // A view whose graph is unsafe stays unbound until something changes the topology, which is
    // exactly what clears the latch.
    if (backdropGraphFaulted) return emptyList()
    if (providers.isNotEmpty()) return providers
    for (id in requestedProviderIds()) {
      val found = ProviderRegistry.find(id, this, warnOnMiss)
      if (found == null) {
        providers.clear()
        return emptyList()
      }
      providers.add(found)
    }
    for (source in providers) source.addConsumer(this)
    return providers
  }

  private fun detachFromProviders() {
    for (source in providers) source.removeConsumer(this)
    providers.clear()
    drawnGeneration = Int.MIN_VALUE
    pendingRetries = 0
    recordedTransforms.clear()
    // Every route here is a topology change — a new id, a detach, a re-parent — so the graph gets
    // a fresh verdict rather than inheriting one from wherever this view used to live.
    backdropGraphChecked = false
    backdropGraphFaulted = false
  }

  /**
   * **R4.** Which shader variant to draw with, when the caller has not said.
   *
   * Measured on a Galaxy S23 (Adreno 740, 120 Hz, 8.33 ms budget) with one animating glass view
   * over a static provider, `dumpsys gfxinfo` sampled over ~480 frames per step, two passes:
   *
   * | coverage | jank pass A | jank pass B | p50 |
   * |---------:|------------:|------------:|----:|
   * |       5% |        0.6% |        0.2% |  5ms |
   * |      10% |        2.1% |        1.2% |  6ms |
   * |      25% |        0.2% |        2.1% |  6ms |
   * |      50% |        3.3% |       17.9% |  7ms |
   * |      75% |       40.4% |       77.8% |  9ms |
   * |     100% |       49.9% |       79.6% | 10ms |
   *
   * The *cliff* is between 50% and 75%, but the threshold is set at **25%** because pass B — the
   * warmer, later run — is already at 18% jank at 50% while 25% holds. A cold measurement at 50%
   * looks fine and is not; sustained load is the case that matters.
   *
   * Only [ShaderQuality.LOW] is below the [ShaderQuality.MEDIUM] default, so this is a single step,
   * and it is worth being precise about how much that step buys. Interleaved low/medium/high at
   * 100% coverage, three rounds, to cancel thermal drift:
   *
   * | quality | jank (3 rounds)      | p50  | p90  |
   * |---------|----------------------|-----:|-----:|
   * | `LOW`   | 71.3 / 71.9 / 74.8 % |  9ms | 10ms |
   * | `MEDIUM`| 79.3 / 81.1 / 84.9 % | 10ms | 11ms |
   * | `HIGH`  | 83.5 / 82.3 / 86.0 % | 11ms | 12ms |
   *
   * So quality is monotonic and reproducible, but each step is worth about **1 ms** — and all three
   * are far past the 8.33 ms budget. The downgrade is a cheap marginal win, not a rescue: at high
   * coverage the cost is fill rate over a full-screen shader pass and a full-screen padded node, not
   * the dispersion tap count. Nothing at this layer makes full-screen glass hold 120 Hz; only less
   * glass does. Taken anyway because it costs a caller nothing and chromatic fringing is invisible
   * on a surface that large.
   *
   * (An earlier non-interleaved batch appeared to show 21% jank at `LOW` against 29% at `MEDIUM`.
   * That gap was thermal state, not quality — hence the interleaving.)
   *
   * An explicit `metal.android.quality` is never overridden — a caller who asks for `high` on a
   * full-screen view owns that.
   */
  private fun resolveShaderQuality(): ShaderQuality {
    requestedQuality?.let { return it }
    val metrics = resources.displayMetrics
    val screenArea = metrics.widthPixels.toLong() * metrics.heightPixels.toLong()
    if (screenArea <= 0L) return ShaderQuality.MEDIUM
    val viewArea = width.toLong() * height.toLong()
    val coversTooMuch = viewArea * 100L >= screenArea * AUTO_LOW_COVERAGE_PERCENT
    return if (coversTooMuch) ShaderQuality.LOW else ShaderQuality.MEDIUM
  }

  /**
   * The device's ceiling, lowered if the AGSL source will not compile on this platform, and lowered
   * again by [tierCeiling] if the caller asked for less.
   */
  private fun resolveTier(): GlassTier {
    val device = when {
      GlassTier.supported != GlassTier.FULL -> GlassTier.supported
      Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU -> GlassTier.BLUR
      GlassShaderCache.isAvailable(shaderQuality) -> GlassTier.FULL
      else -> GlassTier.BLUR
    }
    val ceiling = tierCeiling ?: return device
    return GlassTier.weakest(device, ceiling)
  }

  private fun reportRendererIfChanged() {
    // Props can land before the first attach, and iOS guards this the same way (`window != nil`).
    if (!isAttachedToWindow) return
    val name = tier.rendererName
    if (name == reportedRenderer) return
    reportedRenderer = name
    onRendererChange(mapOf("renderer" to name))
  }

  private companion object {
    const val MAX_PENDING_RETRIES = 8

    /**
     * How long a bare-glass interactive press must hold before it takes the gesture from ancestor
     * scrollers. Longer than a flick's slop-breach, shorter than a deliberate drag's wind-up.
     */
    const val HOLD_TO_OWN_MS = 150L

    /** **R4.** Screen coverage at or above which an unrequested quality drops to `LOW`. */
    const val AUTO_LOW_COVERAGE_PERCENT = 25L

    /** Must match the child-shader name passed to `createRuntimeShaderEffect`. */
    const val SHADER_INPUT_NAME = "content"

    const val CLIP_INFLATE_PX = 2f

    /**
     * White with transparent-white tails. The iOS Metal fallback paints the tails BLACK — the
     * "heavy dark corner" this port deliberately does not reproduce, because real iOS 26 glass
     * has no dark edge component anywhere (neither does Kyant's `Plain`/`Default` highlight).
     */
    val BORDER_GRADIENT_COLORS =
      intArrayOf(0x00FFFFFF, Color.WHITE, Color.WHITE, 0x00FFFFFF)
    val BORDER_GRADIENT_STOPS = floatArrayOf(0f, 0.25f, 0.75f, 1f)
  }
}
