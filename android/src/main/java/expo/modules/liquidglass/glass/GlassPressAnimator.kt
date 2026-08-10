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

  private val glowSpring = Spring(0f, stiffness = 300f, dampingRatio = 0.5f, eps = 0.001f, epsV = 0.01f)
  private val xSpring = Spring(0f, stiffness = 300f, dampingRatio = 0.5f, eps = 0.25f, epsV = 2.5f)
  private val ySpring = Spring(0f, stiffness = 300f, dampingRatio = 0.5f, eps = 0.25f, epsV = 2.5f)
  private val scaleSpring = Spring(1f, stiffness = 250f, dampingRatio = 0.65f, eps = 0.001f, epsV = 0.01f)

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
   * UP and CANCEL both land here. Position deliberately *holds* — Kyant springs it back because
   * position drives a lens deformation there; here it only anchors a glow whose amplitude is
   * already heading to zero, and a spring-back would read as the hotspot drifting off the lift
   * point.
   */
  fun releasePress() {
    glowSpring.target = 0f
    scaleSpring.target = 1f
    start()
  }

  /** Hard stop: everything to rest instantly, and nothing left in any queue. */
  fun reset() {
    host.removeCallbacks(step)
    posted = false
    glowSpring.snapTo(0f)
    scaleSpring.snapTo(1f)
    xSpring.velocity = 0f
    ySpring.velocity = 0f
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
  }
}
