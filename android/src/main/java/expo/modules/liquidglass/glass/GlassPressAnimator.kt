package expo.modules.liquidglass.glass

import android.view.View
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt
import kotlin.math.tanh

/**
 * The spring choreography behind the Android `interactive` flag: a glow that rises on press and
 * chases the finger, a subtle whole-view inflation, and the jelly — a rubber-band translation and
 * an anisotropic stretch, both pure functions of one spring-smoothed drag displacement. Values are
 * read back by the host on every animation frame; this class never touches uniforms or scale
 * itself.
 *
 * Model and constants are Kyant's (InteractiveHighlight / LiquidButton / DampedDragAnimation,
 * Apache-2.0 — see NOTICE): glow ζ 0.5 / k 300; position ζ 1.0 / k 1000 while tracking the finger
 * and ζ 0.5 / k 300 for the release return; scale ζ 0.65 / k 250 (the mean of Kyant's 0.6 / 0.7
 * per-axis pair). The two position modes matter: an earlier round ran ζ 0.5 / 300 during the drag
 * as well — that is Kyant's *release* spec — and the underdamped X and Y springs rang
 * independently on every direction change, which read as the view wobbling through a slow curved
 * drag. Tracking is critically damped (lag, never ring); only the way home is bouncy.
 *
 * The jelly is displacement-based, not velocity-based — LiquidButton's `layerBlock`: translation
 * saturates through tanh (linear for small pulls, asymptoting at the view's min dimension), and
 * stretch grows along the displacement's dominant axis, axis-projected so it turns continuously
 * with the drag and never compresses. A velocity-driven cut of this stretch existed and pulsed:
 * |spring velocity| is a rectified oscillation the moment anything rings. Deriving follow, stretch
 * and hotspot from the single smoothed displacement is what keeps the release coherent — one
 * spring decays and everything settles together.
 *
 * Integration is semi-implicit Euler, unconditionally stable at these stiffnesses with the dt
 * clamp below (the stiff tracking spring has omega_0 = sqrt(1000) ≈ 31.6/s; a 32 ms step puts
 * omega_0·dt ≈ 1.0, inside the method's stability bound of 2, with critical damping on top).
 *
 * The driver is [View.postOnAnimation], re-posted only while a spring is unsettled — the same
 * self-gating standard the geometry pre-draw listener sets: it runs in the Choreographer's
 * animation stage, *before* traversal, so a step's `invalidate()` draws in the same frame, and
 * nothing at all is scheduled once everything has settled. This is deliberately not a persistent
 * `Choreographer.postFrameCallback`, which the geometry watcher's KDoc rejects for burning power
 * at idle. A drag held at a fixed displacement settles and stops posting; the held transform and
 * uniforms simply persist — a pinned rubber band costs no frames.
 *
 * [reset] must call `removeCallbacks`: `postOnAnimation` on a detached view parks the runnable in
 * the view's `HandlerActionQueue`, which executes it on the *next attach* — a stale spring step
 * firing into a recycled view. The host calls [reset] from `release()` (detach and destroy both
 * reach it) and when `interactive` flips off.
 */
internal class GlassPressAnimator(
  private val host: View,
  private val onFrame: () -> Unit,
) {

  /** 0 at rest — which is what keeps the shader's uniform-coherent glow branch switched off. */
  val glow: Float get() = glowSpring.value.coerceIn(0f, 1f)

  /** Touch position, view-local px — the same space the shader's `pixels` lives in. */
  val posX: Float get() = xSpring.value
  val posY: Float get() = ySpring.value

  /** Relative scale for the host to multiply onto its own base; floored away from singularity. */
  val scale: Float get() = max(scaleSpring.value, SCALE_FLOOR)

  /**
   * The magnetic follow: the drag displacement through a saturating tanh — an initial
   * [FOLLOW_SLOPE] fraction of the pull that asymptotes at the view's min dimension, so a
   * cross-screen drag meets growing rubber-band resistance instead of a hard stop (Kyant's
   * `maxOffset * tanh(slope * offset / maxOffset)`). Springs back to zero on release because
   * [releasePress] retargets the position springs at the origin.
   */
  val followX: Float get() = followFor(xSpring.value - originX)
  val followY: Float get() = followFor(ySpring.value - originY)

  /**
   * The jelly stretch, ≥ 1 per axis: [STRETCH_MAX] scaled by the displacement's projection onto
   * the axis (|d·cos θ| = dx²/r — continuous through every drag direction, no axis handoff),
   * normalized by the view's max dimension, with Kyant's aspect correction so a wide view does
   * not stretch further along its long side. The across axis is simply left alone — Kyant's
   * stretch never compresses. Held displacement holds its stretch; release decays it on the same
   * spring as the follow.
   */
  val stretchX: Float get() = 1f + stretchGain(xSpring.value - originX, ySpring.value - originY, host.width, host.height)
  val stretchY: Float get() = 1f + stretchGain(ySpring.value - originY, xSpring.value - originX, host.height, host.width)

  private fun followFor(offset: Float): Float {
    val maxOffset = min(host.width, host.height).toFloat()
    if (maxOffset < 1f) return 0f
    return maxOffset * tanh(FOLLOW_SLOPE * offset / maxOffset)
  }

  private fun stretchGain(along: Float, across: Float, alongSize: Int, acrossSize: Int): Float {
    if (alongSize < 1 || acrossSize < 1) return 0f
    val r = sqrt(along * along + across * across)
    if (r < 1f) return 0f
    val maxDim = max(alongSize, acrossSize).toFloat()
    val aspect = min(alongSize.toFloat() / acrossSize.toFloat(), 1f)
    return STRETCH_MAX * min((along * along / r) / maxDim, 1f) * aspect
  }

  private val glowSpring = Spring(0f, stiffness = 300f, dampingRatio = 0.5f, eps = 0.001f, epsV = 0.01f)
  private val xSpring = Spring(0f, stiffness = TRACK_STIFFNESS, dampingRatio = TRACK_DAMPING, eps = 0.25f, epsV = 2.5f)
  private val ySpring = Spring(0f, stiffness = TRACK_STIFFNESS, dampingRatio = TRACK_DAMPING, eps = 0.25f, epsV = 2.5f)
  private val scaleSpring = Spring(1f, stiffness = 250f, dampingRatio = 0.65f, eps = 0.001f, epsV = 0.01f)

  private var originX = 0f
  private var originY = 0f

  private var posted = false
  private var lastFrameNanos = 0L

  private val step = object : Runnable {
    override fun run() {
      posted = false
      if (!host.isAttachedToWindow) return
      val now = System.nanoTime()
      // Clamped so a stalled window (app switch, expensive frame) cannot integrate a huge step.
      val dt = min((now - lastFrameNanos) / 1e9f, MAX_DT_SECONDS)
      lastFrameNanos = now

      glowSpring.step(dt)
      xSpring.step(dt)
      ySpring.step(dt)
      scaleSpring.step(dt)

      val done = glowSpring.settled && xSpring.settled && ySpring.settled && scaleSpring.settled
      if (done) {
        // Snap and push one final frame so the glow lands at exactly 0 and the branch turns off.
        glowSpring.snap()
        xSpring.snap()
        ySpring.snap()
        scaleSpring.snap()
      }
      onFrame()
      if (!done) schedule()
    }
  }

  /** Position snaps to the touch — the glow must bloom under the finger, not glide in. */
  fun pressDown(x: Float, y: Float) {
    originX = x
    originY = y
    xSpring.retune(TRACK_STIFFNESS, TRACK_DAMPING)
    ySpring.retune(TRACK_STIFFNESS, TRACK_DAMPING)
    xSpring.snapTo(x)
    ySpring.snapTo(y)
    glowSpring.target = 1f
    scaleSpring.target = PRESS_SCALE
    start()
  }

  fun follow(x: Float, y: Float) {
    xSpring.target = x
    ySpring.target = y
    start()
  }

  /**
   * UP and CANCEL both land here. The position springs retune to the underdamped return spec and
   * retarget the press origin — the one deliberate bounce, and it is coherent because follow,
   * stretch and hotspot all read this same decaying displacement (Kyant releases to
   * `startPosition` the same way); the glow rides along and fades before the drift could read as
   * the hotspot wandering.
   */
  fun releasePress() {
    glowSpring.target = 0f
    scaleSpring.target = 1f
    xSpring.retune(HOME_STIFFNESS, HOME_DAMPING)
    ySpring.retune(HOME_STIFFNESS, HOME_DAMPING)
    xSpring.target = originX
    ySpring.target = originY
    start()
  }

  /** Hard stop: everything to rest instantly, and nothing left in any queue. */
  fun reset() {
    host.removeCallbacks(step)
    posted = false
    glowSpring.snapTo(0f)
    scaleSpring.snapTo(1f)
    xSpring.snapTo(xSpring.value)
    ySpring.snapTo(ySpring.value)
    // Follow and stretch read (pos - origin): collapsing the origin onto the position zeroes both.
    originX = xSpring.value
    originY = ySpring.value
  }

  private fun start() {
    if (posted) return
    lastFrameNanos = System.nanoTime()
    schedule()
  }

  private fun schedule() {
    posted = true
    host.postOnAnimation(step)
  }

  private class Spring(
    initial: Float,
    stiffness: Float,
    dampingRatio: Float,
    private val eps: Float,
    private val epsV: Float,
  ) {
    var value = initial
    var target = initial
    var velocity = 0f

    private var stiffness = 0f
    private var damping = 0f

    init {
      retune(stiffness, dampingRatio)
    }

    fun retune(stiffness: Float, dampingRatio: Float) {
      this.stiffness = stiffness
      this.damping = 2f * dampingRatio * sqrt(stiffness)
    }

    fun step(dt: Float) {
      velocity += (-stiffness * (value - target) - damping * velocity) * dt
      value += velocity * dt
    }

    val settled: Boolean get() = abs(value - target) < eps && abs(velocity) < epsV

    fun snap() {
      value = target
      velocity = 0f
    }

    fun snapTo(v: Float) {
      value = v
      target = v
      velocity = 0f
    }
  }

  private companion object {
    /** iOS's press inflation is subtle; the toolkit can layer bigger scales on top later. */
    const val PRESS_SCALE = 1.035f

    /** Paranoia floor: `computeProviderToLocal` inverts our matrix, and 0 is not invertible. */
    const val SCALE_FLOOR = 0.9f

    const val MAX_DT_SECONDS = 0.032f

    /** Tracking the finger: critically damped and stiff — liquid lag, never a ring (Kyant's value spec). */
    const val TRACK_STIFFNESS = 1000f
    const val TRACK_DAMPING = 1f

    /** The way home after release: Kyant's return spec — underdamped, the one deliberate bounce. */
    const val HOME_STIFFNESS = 300f
    const val HOME_DAMPING = 0.5f

    /** Initial fraction of the pull the view follows; tanh saturates it at the view's min dimension. */
    const val FOLLOW_SLOPE = 0.12f

    /** Stretch gain at a full-max-dimension displacement along an axis, before aspect correction. */
    const val STRETCH_MAX = 0.12f
  }
}
