import Metal
import QuartzCore
import UIKit

final class GlassSurfaceView: UIView, GlassFrameParticipant {

    override class var layerClass: AnyClass { CAMetalLayer.self }

    private var metalLayer: CAMetalLayer { layer as! CAMetalLayer }
    private let context = GlassRenderContext.shared

    private var core: GlassSurfaceCore!

    var isOperational: Bool { context != nil }

    var cornerRadii = SIMD4<Float>(repeating: 0) { didSet { invalidate(oldValue != cornerRadii) } }
    var blurRadius: CGFloat = 0 { didSet { invalidate(oldValue != blurRadius) } }

    /// `metal.progressiveBlur`, resolved: radii in points at the ramp's leading and trailing
    /// edges, the axis, and the ramp window as fractions of the view's extent along it. Both
    /// radii zero = off. When on, it replaces the uniform `blurRadius` stage.
    var progressiveBlurStart: CGFloat = 0 { didSet { invalidate(oldValue != progressiveBlurStart) } }
    var progressiveBlurEnd: CGFloat = 0 { didSet { invalidate(oldValue != progressiveBlurEnd) } }
    var progressiveBlurDirection: GlassBlurDirection = .down {
        didSet { invalidate(oldValue != progressiveBlurDirection) }
    }
    var progressiveBlurRampStart: CGFloat = 0 {
        didSet { invalidate(oldValue != progressiveBlurRampStart) }
    }
    var progressiveBlurRampEnd: CGFloat = 1 {
        didSet { invalidate(oldValue != progressiveBlurRampEnd) }
    }

    private var hasProgressiveBlur: Bool {
        max(progressiveBlurStart, progressiveBlurEnd) > 0.01
    }
    var refractionScale = CGSize(width: 32, height: 32) {
        didSet { invalidate(oldValue != refractionScale) }
    }

    var refractionAmount: CGFloat = 60 { didSet { invalidate(oldValue != refractionAmount) } }

    var refractionProfile = SIMD2<Float>(1, 0) {
        didSet { invalidate(oldValue != refractionProfile) }
    }

    var dispersionHeight: CGFloat = 20 { didSet { invalidate(oldValue != dispersionHeight) } }

    var depthEffect: CGFloat = 1 { didSet { invalidate(oldValue != depthEffect) } }
    var noiseAmount: CGFloat = 0.06 { didSet { invalidate(oldValue != noiseAmount) } }
    var dispersionAmount: CGFloat = 12 { didSet { invalidate(oldValue != dispersionAmount) } }
    var highlightIntensity: CGFloat = 0.5 { didSet { invalidate(oldValue != highlightIntensity) } }
    var highlightAngle: CGFloat = .pi * 0.75 { didSet { invalidate(oldValue != highlightAngle) } }
    var lightIntensity: CGFloat = 0.08 { didSet { invalidate(oldValue != lightIntensity) } }
    var glassOpacity: CGFloat = 1 { didSet { invalidate(oldValue != glassOpacity) } }

    var tintRGBA = SIMD4<Float>(repeating: 0) { didSet { invalidate(oldValue != tintRGBA) } }

    /// The primary shape as a sub-rect of the view (`metal.shape`), view-local points. `.zero`
    /// means the shape fills the view — the historical behaviour, bit for bit.
    var shapeRect: CGRect = .zero { didSet { invalidate(oldValue != shapeRect) } }

    /// The morph partner, view-local points, top-left origin. `.zero` (or a zero smoothing) is
    /// off. The partner must lie within the view's bounds — the drawable clips at them.
    var morphRect: CGRect = .zero { didSet { invalidate(oldValue != morphRect) } }
    var morphCornerRadius: CGFloat = 0 { didSet { invalidate(oldValue != morphCornerRadius) } }
    var morphSmoothing: CGFloat = 0 { didSet { invalidate(oldValue != morphSmoothing) } }

    var frostAmount: CGFloat = 0.3 { didSet { invalidate(oldValue != frostAmount) } }
    var frostRGB = SIMD4<Float>(1, 1, 1, 1) { didSet { invalidate(oldValue != frostRGB) } }
    var saturation: CGFloat = 1.7 { didSet { invalidate(oldValue != saturation) } }

    private var lastUVRect: SIMD4<Float>?
    private var needsRedraw = true
    private var isSubscribed = false
    private var renderScale: CGFloat = 1

    init() {
        super.init(frame: .zero)

        isUserInteractionEnabled = false
        backgroundColor = .clear

        let own = metalLayer
        core = GlassSurfaceCore(layer: own)
        own.device = context?.device
        own.pixelFormat = .bgra8Unorm
        own.isOpaque = false

        own.framebufferOnly = true

        own.presentsWithTransaction = false

        own.maximumDrawableCount = 3
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    var renderCore: GlassSurfaceCore { core }

    private func invalidate(_ changed: Bool) {
        guard changed else { return }
        needsRedraw = true
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()

        if window == nil {
            unsubscribe()
            lastUVRect = nil
        } else {
            updateContentsScale()
            subscribe()
        }
    }

    private func subscribe() {
        guard !isSubscribed, isOperational, window != nil else { return }
        GlassFrameScheduler.shared.add(self)
        isSubscribed = true
        needsRedraw = true
    }

    private func unsubscribe() {
        guard isSubscribed else { return }
        GlassFrameScheduler.shared.remove(self)
        isSubscribed = false
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        updateContentsScale()
        needsRedraw = true
    }

    private func updateContentsScale() {
        let scale = window?.screen.nativeScale ?? UIScreen.main.scale
        guard scale != renderScale else { return }
        renderScale = scale
        metalLayer.contentsScale = scale
        needsRedraw = true
    }

    var glassWindow: UIWindow? { window }

    var glassRegionInWindow: CGRect? {
        guard let window, bounds.width > 1, bounds.height > 1, !isHidden, alpha > 0.01 else {
            return nil
        }
        return convert(bounds, to: window)
    }

    var captureQuality: CGFloat = 1 { didSet { invalidate(oldValue != captureQuality) } }

    var glassCaptureScale: CGFloat {
        max(renderScale * captureQuality, 1)
    }

    var glassBackdropPadding: CGFloat {
        let refraction = refractionAmount + dispersionAmount
        // Whichever blur stage runs, the padding must budget for its largest radius.
        let maxBlur = max(blurRadius, max(progressiveBlurStart, progressiveBlurEnd))
        let blur = maxBlur > 0.01 ? max(maxBlur * 1.5, 16) : 0
        return (max(refraction, blur) + 2).rounded(.up)
    }

    func glassDrawRequest(backdrop: MTLTexture, captureScale: CGFloat, backdropDidChange: Bool)
        -> GlassDrawRequest?
    {
        guard isOperational, window != nil, bounds.width > 1, bounds.height > 1 else {
            lastUVRect = nil
            return nil
        }

        let padding = glassBackdropPadding
        let paddedUVRect = backdropUVRect(inset: -padding)

        let moved = paddedUVRect != lastUVRect
        lastUVRect = paddedUVRect

        guard let paddedUVRect, let viewUVRect = backdropUVRect(inset: 0) else { return nil }
        guard needsRedraw || moved || backdropDidChange else { return nil }
        needsRedraw = false

        let viewSize = SIMD2<Float>(Float(bounds.width), Float(bounds.height))
        let paddedSize = CGSize(
            width: bounds.width + padding * 2,
            height: bounds.height + padding * 2
        )

        var frost = frostRGB
        frost.w = Float(frostAmount)

        let needsBlur = blurRadius > 0.01 || hasProgressiveBlur

        // The progressive ramp, resolved to the blur shader's units: the origin point on the
        // ramp window's leading edge, and a direction vector carrying the inverse ramp length so
        // the shader's dot() lands directly in 0..1. Radii convert to texels like blurRadius.
        var rampLine = SIMD4<Float>(repeating: 0)
        var rampRadii = SIMD2<Float>(-1, -1)
        if hasProgressiveBlur {
            let dir = progressiveBlurDirection
            let extent = dir.vertical ? bounds.height : bounds.width
            let rampStart = min(max(progressiveBlurRampStart, 0), 1)
            let rampEnd = max(min(max(progressiveBlurRampEnd, 0), 1), rampStart + 0.001)
            let lead = rampStart * extent
            let rampLen = max((rampEnd - rampStart) * extent, 0.001)
            let sign: CGFloat = dir.reversed ? -1 : 1
            rampLine = SIMD4<Float>(
                Float(dir.vertical ? 0 : (dir.reversed ? bounds.width - lead : lead)),
                Float(dir.vertical ? (dir.reversed ? bounds.height - lead : lead) : 0),
                Float(dir.vertical ? 0 : sign / rampLen),
                Float(dir.vertical ? sign / rampLen : 0)
            )
            rampRadii = SIMD2<Float>(
                Float(progressiveBlurStart * captureScale),
                Float(progressiveBlurEnd * captureScale)
            )
        }

        let sourceRect = needsBlur
            ? SIMD4<Float>(
                Float(padding / paddedSize.width),
                Float(padding / paddedSize.height),
                Float(bounds.width / paddedSize.width),
                Float(bounds.height / paddedSize.height)
            )
            : viewUVRect

        let hasShapeRect = shapeRect.width > 0 && shapeRect.height > 0
        let shapeCenter = hasShapeRect
            ? CGPoint(x: shapeRect.midX, y: shapeRect.midY)
            : CGPoint(x: bounds.width * 0.5, y: bounds.height * 0.5)
        let shapeSize = hasShapeRect
            ? SIMD2<Float>(Float(shapeRect.width), Float(shapeRect.height))
            : viewSize

        // Partner offsets are relative to the SHAPE center — the coordinate the shader's
        // `centered` uses — so `metal.shape` and `metal.morph` compose without either knowing
        // about the other.
        let morphActive =
            morphSmoothing > 0.01 && morphRect.width > 0 && morphRect.height > 0
        let morphSimd = morphActive
            ? SIMD4<Float>(
                Float(morphRect.midX - shapeCenter.x),
                Float(morphRect.midY - shapeCenter.y),
                Float(morphRect.width * 0.5),
                Float(morphRect.height * 0.5)
            )
            : SIMD4<Float>(repeating: 0)

        let glass = GlassParams(
            cornerRadii: cornerRadii,
            tintColor: tintRGBA,
            frostColor: frost,
            sourceRect: sourceRect,
            morphRect: morphSimd,
            morphShape: SIMD2<Float>(
                Float(morphCornerRadius),
                morphActive ? Float(morphSmoothing) : 0
            ),
            viewSize: viewSize,
            shapeSize: shapeSize,
            shapeOffset: SIMD2<Float>(
                Float(shapeCenter.x - bounds.width * 0.5),
                Float(shapeCenter.y - bounds.height * 0.5)
            ),
            refractionScale: SIMD2<Float>(
                Float(refractionScale.width),
                Float(refractionScale.height)
            ),
            refractionAmount: Float(refractionAmount),
            depthEffect: Float(depthEffect),
            profilePower: refractionProfile.x,
            profileBias: refractionProfile.y,
            dispersionHeight: Float(dispersionHeight),
            dispersionAmount: Float(dispersionAmount),
            highlightIntensity: Float(highlightIntensity),
            highlightAngle: Float(highlightAngle),
            lightIntensity: Float(lightIntensity),
            glassOpacity: Float(glassOpacity),
            saturation: Float(saturation),
            noiseAmount: Float(noiseAmount)
        )

        let blurPixelSize = needsBlur
            ? (
                width: max(Int((paddedSize.width * captureScale).rounded()), 8),
                height: max(Int((paddedSize.height * captureScale).rounded()), 8)
            )
            : (width: 0, height: 0)

        return GlassDrawRequest(
            surface: core,
            backdrop: backdrop,
            glass: glass,
            uvRect: paddedUVRect,
            drawableSize: CGSize(
                width: (bounds.width * renderScale).rounded(),
                height: (bounds.height * renderScale).rounded()
            ),
            needsBlur: needsBlur,
            blurRadiusTexels: Float(blurRadius * captureScale),
            blurPixelSize: blurPixelSize,
            blurRampLine: rampLine,
            blurRampRadii: rampRadii,
            blurPaddedSize: SIMD2<Float>(Float(paddedSize.width), Float(paddedSize.height)),
            blurPadding: Float(padding)
        )
    }

    private func backdropUVRect(inset: CGFloat) -> SIMD4<Float>? {
        guard let window else { return nil }

        let capturer = BackdropCapturer.shared
        let size = capturer.textureSizePoints
        guard size.width > 0, size.height > 0 else { return nil }

        let origin = capturer.capturedOrigin
        let frame = convert(bounds, to: window).insetBy(dx: inset, dy: inset)

        return SIMD4<Float>(
            Float((frame.minX - origin.x) / size.width),
            Float((frame.minY - origin.y) / size.height),
            Float(frame.width / size.width),
            Float(frame.height / size.height)
        )
    }
}
