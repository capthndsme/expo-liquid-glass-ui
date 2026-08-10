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
import android.graphics.RectF
import android.graphics.RenderEffect
import android.graphics.RenderNode
import android.graphics.Shader
import android.os.Build
import android.util.Log
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
import expo.modules.liquidglass.glass.BackdropSource
import expo.modules.liquidglass.glass.CornerRadii
import expo.modules.liquidglass.glass.GlassAppearance
import expo.modules.liquidglass.glass.GlassDebug
import expo.modules.liquidglass.glass.GlassEnvironment
import expo.modules.liquidglass.glass.GlassShaderCache
import expo.modules.liquidglass.glass.GlassShaderSource
import expo.modules.liquidglass.glass.GlassTier
import expo.modules.liquidglass.glass.ProviderRegistry
import expo.modules.liquidglass.glass.ShaderQuality
import expo.modules.liquidglass.records.GlassMetalOptions
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
  private val shaderRadii = FloatArray(4)
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

  private var provider: BackdropSource? = null

  /** Non-shader tiers only: the effect parameters currently installed on [glassNode]. */
  private var appliedBlurRadius: Float = Float.NaN
  private var appliedSaturation: Float = Float.NaN

  /** The dev-mode topology checks run once per view, not once per attach. */
  private var environmentChecked = false

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
   * Provider-local -> our-local, as of the last recording.
   *
   * The recorded backdrop is only correct for this transform. A pure `(dx, dy)` would cover scroll
   * and drag, but a matrix also survives an ancestor that scales or rotates, and it costs the same
   * to compare.
   */
  private val recordedTransform = Matrix()
  private var hasRecordedTransform = false

  private val localToWindow = Matrix()
  private val providerToWindow = Matrix()
  private val windowToLocal = Matrix()
  private val providerToLocal = Matrix()

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
    resolveProvider(warnOnMiss = false)
    startWatchingGeometry()
    reportRendererIfChanged()
    if (!environmentChecked) {
      environmentChecked = true
      // Posted, not immediate: `canScrollVertically` needs the container's children measured, and
      // a provider mounted in the same commit may not be in the hierarchy yet.
      post { if (isAttachedToWindow) GlassEnvironment.checkGlassView(this, providerId) }
    }
  }

  override fun onDetachedFromWindow() {
    release()
    super.onDetachedFromWindow()
  }

  /** `OnViewDestroys`. Detach is not guaranteed to have run, so this must be idempotent. */
  fun release() {
    stopWatchingGeometry()
    detachFromProvider()
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
      // to be hiding.
      set(GlassShaderSource.CROP, 0.5f, 0.5f, w + 2f * p - 0.5f, h + 2f * p - 0.5f)

      clampedRadii.writeShaderVec(shaderRadii)
      set(
        GlassShaderSource.CORNER_RADII,
        shaderRadii[0], shaderRadii[1], shaderRadii[2], shaderRadii[3]
      )
      set(GlassShaderSource.UNIT_SCALE, d)

      set(
        GlassShaderSource.REFRACTION_SCALE,
        appearance.refractionWidthPx,
        appearance.refractionHeightPx
      )
      set(GlassShaderSource.REFRACTION_AMOUNT, appearance.refractionAmountPx)
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
      set(GlassShaderSource.LIGHT_INTENSITY, appearance.light)
      set(GlassShaderSource.GLASS_OPACITY, appearance.opacity)
      set(GlassShaderSource.SATURATION, appearance.saturation)
      set(GlassShaderSource.NOISE_AMOUNT, appearance.noise)

      // Always set, even at rest — a declared-but-unset uniform throws at draw time. 0 keeps the
      // shader's uniform-coherent branch off.
      set(GlassShaderSource.TOUCH_POS, 0f, 0f)
      set(GlassShaderSource.TOUCH_GLOW, 0f)

      val glassEffect = RenderEffect.createRuntimeShaderEffect(shader, SHADER_INPUT_NAME)
      if (!appearance.hasBlur) {
        glassEffect
      } else {
        // createChainEffect(outer, inner) runs `inner` first, so this is blur -> glass. Written the
        // other way round it still compiles and just looks wrong.
        RenderEffect.createChainEffect(
          glassEffect,
          RenderEffect.createBlurEffect(
            appearance.hwuiBlurRadius,
            appearance.hwuiBlurRadius,
            Shader.TileMode.CLAMP
          )
        )
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

    canvas.restoreToCount(layer)
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

  /** Records the provider's content into [node], padded and aligned to this view. */
  @RequiresApi(Build.VERSION_CODES.Q)
  private fun recordBackdrop(node: RenderNode, pad: Int): Boolean {
    val source = resolveProvider() ?: return false
    val content = source.contentNode

    if (content == null) {
      // The provider is mounted but has not recorded yet. It draws before us in a normal frame, so
      // this only happens when it mounts late.
      if (pendingRetries < MAX_PENDING_RETRIES) {
        pendingRetries++
        invalidate()
      }
      return false
    }
    pendingRetries = 0

    if (!computeProviderToLocal(source.sourceView, providerToLocal)) return false

    val padF = pad.toFloat()
    val paddedWidth = width + pad * 2
    val paddedHeight = height + pad * 2

    node.setPosition(0, 0, paddedWidth, paddedHeight)
    val recording = node.beginRecording(paddedWidth, paddedHeight)
    try {
      // Provider-local -> our-local -> node-local. The provider content that sits under our
      // top-left corner therefore lands at (pad, pad).
      recording.translate(padF, padF)
      recording.concat(providerToLocal)
      recording.drawRenderNode(content)
    } finally {
      node.endRecording()
    }

    recordedTransform.set(providerToLocal)
    hasRecordedTransform = true
    drawnGeneration = source.contentGeneration
    return true
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

  /** Whether this view has moved relative to its provider since the backdrop was recorded. */
  private fun backdropTransformChanged(): Boolean {
    if (!hasRecordedTransform) return false
    val source = provider ?: return false
    if (width <= 0 || height <= 0) return false
    if (!computeProviderToLocal(source.sourceView, providerToLocal)) return false
    return providerToLocal != recordedTransform
  }

  /**
   * The iOS border is a `CAGradientLayer` running black → white → white → black from the
   * bottom-left corner to the top-right, masked by a stroked rounded rect, with the layer's opacity
   * set to `border.opacity` (`LiquidGlassView.swift:108-123`, `:273`). This is that, exactly.
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
    val radius = if (appearance.hasBlur) appearance.hwuiBlurRadius else 0f
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

    // startPoint (0, 1) -> endPoint (1, 0) in CALayer's unit space is bottom-left -> top-right.
    borderPaint.shader = LinearGradient(
      0f,
      height.toFloat(),
      width.toFloat(),
      0f,
      BORDER_GRADIENT_COLORS,
      BORDER_GRADIENT_STOPS,
      Shader.TileMode.CLAMP
    )

    geometryValid = true
  }

  private fun isDarkMode(): Boolean =
    (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) ==
      Configuration.UI_MODE_NIGHT_YES

  private fun resolveProvider(warnOnMiss: Boolean = true): BackdropSource? {
    provider?.let { return it }
    val found = ProviderRegistry.find(providerId, this, warnOnMiss) ?: return null
    provider = found
    found.addConsumer(this)
    return found
  }

  private fun detachFromProvider() {
    provider?.removeConsumer(this)
    provider = null
    drawnGeneration = Int.MIN_VALUE
    pendingRetries = 0
    hasRecordedTransform = false
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

    /** **R4.** Screen coverage at or above which an unrequested quality drops to `LOW`. */
    const val AUTO_LOW_COVERAGE_PERCENT = 25L

    /** Must match the child-shader name passed to `createRuntimeShaderEffect`. */
    const val SHADER_INPUT_NAME = "content"

    const val CLIP_INFLATE_PX = 2f

    val BORDER_GRADIENT_COLORS =
      intArrayOf(Color.BLACK, Color.WHITE, Color.WHITE, Color.BLACK)
    val BORDER_GRADIENT_STOPS = floatArrayOf(0f, 0.25f, 0.75f, 1f)
  }
}
