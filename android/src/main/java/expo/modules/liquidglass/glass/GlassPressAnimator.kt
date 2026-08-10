package expo.modules.liquidglass.glass

import android.view.View
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

/**
 * The spring choreography behind the Android `interactive` flag: a glow that rises on press and
 * chases the finger, and a subtle whole-view inflation. Values are read back by the host on every
 * animation frame; this class never touches uniforms or scale itself.
 *
 * Spring constants are Kyant's (InteractiveHighlight / DampedDragAnimation, Apache-2.0 — see
 * NOTICE): damping ratio 0.5 / stiffness 300 for glow and position, 0.65 / 250 for scale.
 * Integration is semi-implicit Euler, unconditionally stable at these stiffnesses with the dt
 * clamp below (omega_0 = sqrt(300) is about 17/s; 32 ms steps stay far from the stability edge).
 *
 * The driver is [View.postOnAnimation], re-posted only while a spring is unsettled — the same
 * self-gating standard the geometry pre-draw listener sets: it runs in the Choreographer's
 * animation stage, *before* traversal, so a step's `invalidate()` draws in the same frame, and
 * nothing at all is scheduled once everything has settled. This is deliberately not a persistent
 * `Choreographer.postFrameCallback`, which the geometry watcher's KDoc rejects for burning power
 * at idle.
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
   * The magnetic follow: a fraction of the finger's spring-smoothed displacement from the press
   * origin, in px. Springs back to zero on release because [releasePress] retargets the position
   * springs at the origin. Displacement is clamped so a cross-screen drag cannot tear the view
   * off its layout.
   */
  val followX: Float get() = (posX - originX).coerceIn(-FOLLOW_CLAMP_PX, FOLLOW_CLAMP_PX) * FOLLOW_FRACTION
  val followY: Float get() = (posY - originY).coerceIn(-FOLLOW_CLAMP_PX, FOLLOW_CLAMP_PX) * FOLLOW_FRACTION

  /**
   * The jelly: anisotropic stretch from the position springs' own velocities — stretch along the
   * motion axis, a milder thin across it (Kyant's `DampedDragAnimation` velocity skew, expressed
   * axis-wise). 1 at rest; the springs' settle criteria include velocity, so this decays with the
   * gesture and never sticks.
   */
  val stretchX: Float get() = stretchFor(xSpring.velocity, ySpring.velocity)
  val stretchY: Float get() = stretchFor(ySpring.velocity, xSpring.velocity)

  private fun stretchFor(along: Float, across: Float): Float {
    val a = min(abs(along) * VELOCITY_NORM * STRETCH_ALONG, STRETCH_MAX)
    val c = min(abs(across) * VELOCITY_NORM * STRETCH_ACROSS, STRETCH_MAX)
    return 1f + a - c
  }

  private val glowSpring = Spring(0f, stiffness = 300f, dampingRatio = 0.5f, eps = 0.001f, epsV = 0.01f)
  private val xSpring = Spring(0f, stiffness = 300f, dampingRatio = 0.5f, eps = 0.25f, epsV = 2.5f)
  private val ySpring = Spring(0f, stiffness = 300f, dampingRatio = 0.5f, eps = 0.25f, epsV = 2.5f)
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
   * UP and CANCEL both land here. The position springs retarget the press origin — that is what
   * springs the magnetic follow back to zero (Kyant releases to `startPosition` the same way);
   * the glow rides along and fades before the drift could read as the hotspot wandering.
   */
  fun releasePress() {
    glowSpring.target = 0f
    scaleSpring.target = 1f
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
    // Follow reads (pos - origin): collapsing the origin onto the position zeroes it instantly.
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
    private val stiffness: Float,
    dampingRatio: Float,
    private val eps: Float,
    private val epsV: Float,
  ) {
    var value = initial
    var target = initial
    var velocity = 0f

    private val damping = 2f * dampingRatio * sqrt(stiffness)

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

    /** Fraction of finger displacement the view translates by, and the displacement cap (px). */
    const val FOLLOW_FRACTION = 0.12f
    const val FOLLOW_CLAMP_PX = 300f

    /** px/s → stretch units: a 4000 px/s drag is a fast flick. */
    const val VELOCITY_NORM = 1f / 4000f
    const val STRETCH_ALONG = 0.75f
    const val STRETCH_ACROSS = 0.3f
    const val STRETCH_MAX = 0.12f
  }
}
