import QuartzCore
import UIKit

/// The spring choreography behind `interactive` on the Metal path — the Swift twin of the Android
/// `GlassPressAnimator.kt`, same model and constants: a glow that rises on press and chases the
/// finger, a subtle whole-view inflation, and the jelly — a rubber-band translation and an
/// anisotropic stretch, both pure functions of one spring-smoothed drag displacement. Values are
/// read back by the host on every animation frame; this class never touches uniforms or
/// transforms itself.
///
/// Model and constants are Kyant's (InteractiveHighlight / LiquidButton / DampedDragAnimation,
/// Apache-2.0 — see NOTICE): glow ζ 0.5 / k 300; position ζ 1.0 / k 1000 while tracking the
/// finger and ζ 0.5 / k 300 for the release return; scale ζ 0.65 / k 250. Tracking is critically
/// damped (lag, never ring); only the way home is bouncy — running the release spec during the
/// drag made X and Y ring independently on every direction change and read as a wobble.
///
/// The jelly is displacement-based, not velocity-based: translation saturates through tanh
/// (linear for small pulls, asymptoting at the view's min dimension), and stretch grows along
/// the displacement's dominant axis, axis-projected so it turns continuously with the drag and
/// never compresses. Deriving follow, stretch and hotspot from the single smoothed displacement
/// is what keeps the release coherent — one spring decays and everything settles together.
///
/// Integration is semi-implicit Euler with the dt clamp below (the stiff tracking spring has
/// ω₀ ≈ 31.6/s; a 32 ms step puts ω₀·dt ≈ 1.0, inside the method's stability bound of 2, with
/// critical damping on top). The driver is a `CADisplayLink` that exists only while a spring is
/// unsettled — nothing is scheduled once everything has settled, and a drag held at a fixed
/// displacement costs no frames. The link retains this object (its target), so a press that is
/// mid-flight when the host goes away finishes on a dead host and tears itself down.
/// An `NSObject` because `CADisplayLink` dispatches its selector through the Objective-C runtime.
final class GlassPressAnimator: NSObject {

    /// 0 at rest — which is what keeps the shader's uniform-coherent glow branch switched off.
    var glow: CGFloat { min(max(glowSpring.value, 0), 1) }

    /// Touch position, view-local points — the same space the shader's `pixels` lives in.
    var posX: CGFloat { xSpring.value }
    var posY: CGFloat { ySpring.value }

    /// Relative scale for the host to apply; floored away from singularity.
    var scale: CGFloat { max(scaleSpring.value, Tuning.scaleFloor) }

    /// The magnetic follow: the drag displacement through a saturating tanh — an initial
    /// `followSlope` fraction of the pull that asymptotes at the view's min dimension, so a
    /// cross-screen drag meets growing rubber-band resistance instead of a hard stop. Springs
    /// back to zero on release because `releasePress` retargets the position springs at the
    /// origin.
    var followX: CGFloat { follow(xSpring.value - originX) }
    var followY: CGFloat { follow(ySpring.value - originY) }

    /// The jelly stretch, ≥ 1 per axis: `stretchMax` scaled by the displacement's projection
    /// onto the axis (|d·cos θ| = dx²/r — continuous through every drag direction), normalized by
    /// the view's max dimension, with the aspect correction so a wide view does not stretch
    /// further along its long side. The across axis is left alone — the stretch never
    /// compresses.
    var stretchX: CGFloat {
        1 + stretchGain(along: xSpring.value - originX, across: ySpring.value - originY,
                        alongSize: hostSize.width, acrossSize: hostSize.height)
    }
    var stretchY: CGFloat {
        1 + stretchGain(along: ySpring.value - originY, across: xSpring.value - originX,
                        alongSize: hostSize.height, acrossSize: hostSize.width)
    }

    private weak var host: UIView?
    private let onFrame: () -> Void

    private var glowSpring = Spring(0, stiffness: 300, dampingRatio: 0.5, eps: 0.001, epsV: 0.01)
    private var xSpring = Spring(0, stiffness: Tuning.trackStiffness, dampingRatio: Tuning.trackDamping, eps: 0.25, epsV: 2.5)
    private var ySpring = Spring(0, stiffness: Tuning.trackStiffness, dampingRatio: Tuning.trackDamping, eps: 0.25, epsV: 2.5)
    private var scaleSpring = Spring(1, stiffness: 250, dampingRatio: 0.65, eps: 0.001, epsV: 0.01)

    private var originX: CGFloat = 0
    private var originY: CGFloat = 0

    private var displayLink: CADisplayLink?
    private var lastTimestamp: CFTimeInterval = 0

    init(host: UIView, onFrame: @escaping () -> Void) {
        self.host = host
        self.onFrame = onFrame
        super.init()
    }

    deinit {
        displayLink?.invalidate()
    }

    private var hostSize: CGSize { host?.bounds.size ?? .zero }

    private func follow(_ offset: CGFloat) -> CGFloat {
        let maxOffset = min(hostSize.width, hostSize.height)
        if maxOffset < 1 { return 0 }
        return maxOffset * tanh(Tuning.followSlope * offset / maxOffset)
    }

    private func stretchGain(along: CGFloat, across: CGFloat, alongSize: CGFloat, acrossSize: CGFloat) -> CGFloat {
        if alongSize < 1 || acrossSize < 1 { return 0 }
        let r = (along * along + across * across).squareRoot()
        if r < 1 { return 0 }
        let maxDim = max(alongSize, acrossSize)
        let aspect = min(alongSize / acrossSize, 1)
        return Tuning.stretchMax * min((along * along / r) / maxDim, 1) * aspect
    }

    /// Position snaps to the touch — the glow must bloom under the finger, not glide in.
    func pressDown(x: CGFloat, y: CGFloat) {
        originX = x
        originY = y
        xSpring.retune(stiffness: Tuning.trackStiffness, dampingRatio: Tuning.trackDamping)
        ySpring.retune(stiffness: Tuning.trackStiffness, dampingRatio: Tuning.trackDamping)
        xSpring.snap(to: x)
        ySpring.snap(to: y)
        glowSpring.target = 1
        scaleSpring.target = Tuning.pressScale
        start()
    }

    func follow(x: CGFloat, y: CGFloat) {
        xSpring.target = x
        ySpring.target = y
        start()
    }

    /// Ended and cancelled both land here. The position springs retune to the underdamped
    /// return spec and retarget the press origin — the one deliberate bounce, coherent because
    /// follow, stretch and hotspot all read this same decaying displacement.
    func releasePress() {
        glowSpring.target = 0
        scaleSpring.target = 1
        xSpring.retune(stiffness: Tuning.homeStiffness, dampingRatio: Tuning.homeDamping)
        ySpring.retune(stiffness: Tuning.homeStiffness, dampingRatio: Tuning.homeDamping)
        xSpring.target = originX
        ySpring.target = originY
        start()
    }

    /// Hard stop: everything to rest instantly, and no frame left scheduled.
    func reset() {
        stop()
        glowSpring.snap(to: 0)
        scaleSpring.snap(to: 1)
        xSpring.snap(to: xSpring.value)
        ySpring.snap(to: ySpring.value)
        // Follow and stretch read (pos - origin): collapsing the origin onto the position zeroes both.
        originX = xSpring.value
        originY = ySpring.value
    }

    private func start() {
        guard displayLink == nil else { return }
        let link = CADisplayLink(target: self, selector: #selector(step(_:)))
        link.add(to: .main, forMode: .common)
        displayLink = link
        lastTimestamp = CACurrentMediaTime()
    }

    private func stop() {
        displayLink?.invalidate()
        displayLink = nil
    }

    @objc private func step(_ link: CADisplayLink) {
        guard host != nil, host?.window != nil else {
            stop()
            return
        }
        let now = link.timestamp
        // Clamped so a stalled window (app switch, expensive frame) cannot integrate a huge step.
        let dt = CGFloat(min(max(now - lastTimestamp, 0), Tuning.maxStepSeconds))
        lastTimestamp = now

        glowSpring.step(dt)
        xSpring.step(dt)
        ySpring.step(dt)
        scaleSpring.step(dt)

        let done = glowSpring.settled && xSpring.settled && ySpring.settled && scaleSpring.settled
        if done {
            // Snap and push one final frame so the glow lands at exactly 0 and the branch turns off.
            glowSpring.snap()
            xSpring.snap()
            ySpring.snap()
            scaleSpring.snap()
            stop()
        }
        onFrame()
    }

    private struct Spring {
        var value: CGFloat
        var target: CGFloat
        var velocity: CGFloat = 0
        private var stiffness: CGFloat = 0
        private var damping: CGFloat = 0
        private let eps: CGFloat
        private let epsV: CGFloat

        init(_ initial: CGFloat, stiffness: CGFloat, dampingRatio: CGFloat, eps: CGFloat, epsV: CGFloat) {
            value = initial
            target = initial
            self.eps = eps
            self.epsV = epsV
            retune(stiffness: stiffness, dampingRatio: dampingRatio)
        }

        mutating func retune(stiffness: CGFloat, dampingRatio: CGFloat) {
            self.stiffness = stiffness
            damping = 2 * dampingRatio * stiffness.squareRoot()
        }

        mutating func step(_ dt: CGFloat) {
            velocity += (-stiffness * (value - target) - damping * velocity) * dt
            value += velocity * dt
        }

        var settled: Bool { abs(value - target) < eps && abs(velocity) < epsV }

        mutating func snap() {
            value = target
            velocity = 0
        }

        mutating func snap(to v: CGFloat) {
            value = v
            target = v
            velocity = 0
        }
    }

    private enum Tuning {
        /// iOS's press inflation is subtle; the kit layers bigger scales on top.
        static let pressScale: CGFloat = 1.035
        static let scaleFloor: CGFloat = 0.9
        static let maxStepSeconds: CFTimeInterval = 0.032

        /// Tracking the finger: critically damped and stiff — liquid lag, never a ring.
        static let trackStiffness: CGFloat = 1000
        static let trackDamping: CGFloat = 1

        /// The way home after release: Kyant's return spec — underdamped, the one deliberate bounce.
        static let homeStiffness: CGFloat = 300
        static let homeDamping: CGFloat = 0.5

        /// Initial fraction of the pull the view follows; tanh saturates it at the view's min dimension.
        static let followSlope: CGFloat = 0.12

        /// Stretch gain at a full-max-dimension displacement along an axis, before aspect correction.
        static let stretchMax: CGFloat = 0.12
    }
}
