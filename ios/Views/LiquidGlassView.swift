import ExpoModulesCore
import UIKit

class LiquidGlassView: ExpoView {

    override class var layerClass: AnyClass { NonRenderableLayer.self }

    private var glassLayerView: UIView?
    private let surface = GlassSurfaceView()
    private var visualEffectView: UIVisualEffectView?

    private let contentContainer = NonRenderableView()

    private let borderLayer = CAGradientLayer()
    private let borderMask = CAShapeLayer()

    private let contentMask = CAShapeLayer()
    private let effectMask = CAShapeLayer()

    var variant: GlassVariant = .regular {
        didSet {
            guard variant != oldValue else { return }
            setNeedsAppearanceUpdate()
            refreshBackend()
        }
    }

    var backend: GlassBackend = .auto {
        didSet {
            guard backend != oldValue else { return }
            refreshBackend()
        }
    }

    /// `CALayerCornerCurve`, honoured by every renderer since the parity pass: `continuous`
    /// renders the calibrated Apple corner family in the Metal SDF, the content mask, the border
    /// and the backdrop fill (`ContinuousCorners`), and the native path hands it to Core
    /// Animation. Before, the Metal SDF was circular under a continuous content clip, and the
    /// border — circular too — sat up to 0.12 r inside the glass at every corner apex.
    var cornerStyle: GlassCornerStyle = .continuous {
        didSet {
            guard cornerStyle != oldValue else { return }
            invalidateShape()
        }
    }

    var cornerRadii: CornerRadiiValues = .uniform(0) {
        didSet {
            guard cornerRadii != oldValue else { return }
            invalidateShape()
        }
    }

    var tint: UIColor = .clear {
        didSet {
            guard tint != oldValue else { return }
            setNeedsAppearanceUpdate()
            applyNativeTint()
            invalidateShape()
        }
    }

    /// iOS 26's `isInteractive`, and below 26 the Metal path's port of it: a spring-driven
    /// specular that blooms under the finger and follows it, the refraction denting and deepening
    /// around it, and a subtle whole-glass inflation, follow and stretch — `GlassPressAnimator`,
    /// the same springs as Android. Touches reach this view whenever it, or a child that does not
    /// consume them, is the hit-test target; an ancestor gesture taking over (a scroll view) lands
    /// as `touchesCancelled`, which releases like a lift.
    var isInteractive: Bool = false {
        didSet {
            guard isInteractive != oldValue else { return }

            if shouldUseNativeGlass {
                visualEffectView?.effect = UIVisualEffect()
            }
            applyNativeTint()

            if !isInteractive {
                // Mid-press prop flip: stop dead and restore rest state.
                pressAnimator?.reset()
                applyPressTransform(.identity)
                pushPressUniforms()
            }
        }
    }

    /// A press choreographed by the app, usually one happening on some *other* view — see
    /// `GlassGlowOptions`. Non-nil takes over the press uniforms entirely; nil hands them straight
    /// back to `interactive`'s animator. Cheap to animate per frame: the uniforms are re-uploaded
    /// and the surface redrawn, nothing else moves. Ignored by the native UIGlassEffect path.
    var glow: GlassGlowOptions? {
        didSet { pushPressUniforms() }
    }

    /// The `adaptive` prop: the Metal path reads the mean luminance of the backdrop under the
    /// view off the capture (every 250 ms at most, only when the backdrop or the geometry moved),
    /// reports it through `onBackdropLuminance`, and lets the frost's polarity follow the
    /// backdrop instead of the colour scheme — dark content under a dark frost, light under a
    /// light one — with hysteresis and a 350 ms crossfade. The native UIGlassEffect adapts on its
    /// own and ignores this.
    var isAdaptive = false {
        didSet {
            guard isAdaptive != oldValue else { return }
            frostPolarityDark = traitCollection.userInterfaceStyle == .dark
            lastEmittedLuminance = nil
            surface.snapFrost(dark: frostPolarityDark)
            surface.isAdaptive = isAdaptive && !isUsingNativeGlass
        }
    }

    let onBackdropLuminance = EventDispatcher()

    private var frostPolarityDark = false
    private var lastEmittedLuminance: Float?

    /// The sensor's result: hysteresis for the polarity, a delta gate for the event.
    private func handleLuminance(_ luminance: Float) {
        let dark = frostPolarityDark
            ? luminance < Self.adaptiveLightAbove
            : luminance < Self.adaptiveDarkBelow
        let flipped = dark != frostPolarityDark
        if flipped {
            frostPolarityDark = dark
            surface.frostDarkTarget = dark ? 1 : 0
        }
        let moved = lastEmittedLuminance.map { abs(luminance - $0) >= Self.luminanceEmitDelta } ?? true
        if moved || flipped {
            lastEmittedLuminance = luminance
            onBackdropLuminance(["luminance": Double(luminance), "dark": dark])
        }
    }

    private static let adaptiveDarkBelow: Float = 0.45
    private static let adaptiveLightAbove: Float = 0.55
    private static let luminanceEmitDelta: Float = 0.02

    var metal = GlassMetalOptions() {
        didSet {
            setNeedsAppearanceUpdate()
            if borderWidth != cachedBorderWidth { invalidateShape() }

            // `metal.shape` moves the SDF's rect, so the radii must re-resolve against it.
            // Written synchronously (unlike the async appearance pass) because layoutSubviews
            // reads it — an async write would leave one frame on the old geometry.
            let newShape = Self.shapeRect(from: metal)
            if newShape != surface.shapeRect {
                surface.shapeRect = newShape
                invalidateShape()
            }
        }
    }

    private static func shapeRect(from metal: GlassMetalOptions) -> CGRect {
        guard let shape = metal.shape,
              let width = shape.width, let height = shape.height,
              width > 0, height > 0
        else { return .zero }
        return CGRect(x: shape.x ?? 0, y: shape.y ?? 0, width: width, height: height)
    }

    private var borderWidth: CGFloat {
        CGFloat(metal.border?.width ?? 1)
    }

    let onRendererChange = EventDispatcher()

    private var isUsingNativeGlass = false
    private var didReportRenderer = false
    private var lastReportedRenderer = ""

    private var hasPendingAppearanceUpdate = false

    private var resolvedFrostColor = SIMD4<Float>(1, 1, 1, 1)

    private var mountedChildren: [UIView] = []

    private var hasAppliedEffectAfterLayout = false

    private var shapeIsValid = false
    private var cachedRadii = CornerRadiiValues()
    private var cachedShapeSize: CGSize = .zero
    private var cachedBorderWidth: CGFloat = -1

    /// The highlight's light angle, radians — the border gradient's axis follows it.
    private var highlightAngle: CGFloat =
        CGFloat(LiquidGlassView.defaultHighlightAngleDegrees) * .pi / 180

    /// Lazily created on the first interactive press; nil means no press has ever happened.
    private var pressAnimator: GlassPressAnimator?

    required init(appContext: AppContext? = nil) {
        super.init(appContext: appContext)

        clipsToBounds = false
        backgroundColor = .clear

        contentContainer.isUserInteractionEnabled = true
        addSubview(contentContainer)

        borderLayer.mask = borderMask

        borderLayer.opacity = 0

        // Pure white light with transparent-white tails: real iOS 26 glass has no dark edge
        // component, so the black end stops this layer used to carry are gone. The axis follows
        // `highlight.angle` — see updateBorderAxis — so one prop steers the shader's rim lobes
        // and this stroke together.
        borderLayer.colors = [
            UIColor.white.withAlphaComponent(0).cgColor,
            UIColor.white.cgColor,
            UIColor.white.cgColor,
            UIColor.white.withAlphaComponent(0).cgColor,
        ]
        borderLayer.locations = [0, 0.25, 0.75, 1]
        borderLayer.startPoint = CGPoint(x: 0.5, y: 1)
        borderLayer.endPoint = CGPoint(x: 0.5, y: 0)
        borderMask.fillColor = UIColor.clear.cgColor
        borderMask.strokeColor = UIColor.white.cgColor
        layer.addSublayer(borderLayer)

        contentMask.fillColor = UIColor.white.cgColor
        effectMask.fillColor = UIColor.white.cgColor

        surface.onLuminance = { [weak self] luminance in self?.handleLuminance(luminance) }

        updateResolvedFrostColor()
        applyAppearance()
        refreshBackend()
    }

    private var shouldUseNativeGlass: Bool {
        switch backend {
        case .metal:
            return false
        case .native, .auto:
            if #available(iOS 26.0, *) { return Self.isGlassEffectAvailable }
            return false
        }
    }

    private static let isGlassEffectAvailable: Bool = {
        if #available(iOS 26.0, *) {
            guard let glassEffectClass = NSClassFromString("UIGlassEffect") as? NSObject.Type else {
                return false
            }
            return glassEffectClass.responds(to: NSSelectorFromString("effectWithStyle:"))
        }
        return false
    }()

    private func refreshBackend() {
        let wantsNative = shouldUseNativeGlass

        let useNative = wantsNative || !surface.isOperational

        isUsingNativeGlass = useNative

        if useNative {
            // The press choreography is the Metal path's; Apple's material owns its own.
            pressAnimator?.reset()
            applyPressTransform(.identity)
        }

        if useNative, !wantsNative {
            installFallbackBlur()
        } else if useNative {
            installNativeGlass()
        } else {
            installMetalGlass()
        }

        surface.isAdaptive = isAdaptive && !isUsingNativeGlass

        updateBackdropExclusion()
        restoreChildren()
        reportRenderer()
        invalidateShape()
    }

    private func updateBackdropExclusion() {
        let excluded = !isUsingNativeGlass
        (layer as? NonRenderableLayer)?.isExcludedFromBackdrop = excluded
        contentContainer.isExcludedFromBackdrop = excluded
    }

    private func installNativeGlass() {
        surface.removeFromSuperview()

        let effectView = existingOrNewEffectView()
        applyNativeTint()
        setGlassLayerView(effectView)
    }

    private func installFallbackBlur() {
        surface.removeFromSuperview()

        let effectView = existingOrNewEffectView()
        effectView.effect = UIBlurEffect(style: .systemThinMaterial)
        setGlassLayerView(effectView)
    }

    private func existingOrNewEffectView() -> UIVisualEffectView {
        if let visualEffectView { return visualEffectView }
        let effectView = UIVisualEffectView(effect: nil)

        effectView.isUserInteractionEnabled = true
        visualEffectView = effectView
        return effectView
    }

    private func installMetalGlass() {
        visualEffectView?.removeFromSuperview()
        visualEffectView = nil
        setGlassLayerView(surface)
    }

    private func setGlassLayerView(_ view: UIView) {
        // Identity alone is not proof that the layer is installed. Fabric
        // recycles component views, and a view coming back from the pool still
        // holds its `glassLayerView` reference while the layer itself is no
        // longer in the hierarchy. The old guard read that as "already done"
        // and returned, leaving the view with a glass layer it believes it has
        // and does not.
        guard glassLayerView !== view || view.superview !== self else { return }
        if glassLayerView !== view {
            glassLayerView?.removeFromSuperview()
        }
        insertSubview(view, at: 0)
        glassLayerView = view
    }

    private func applyNativeTint() {
        guard #available(iOS 26.0, *),
              let visualEffectView,
              isUsingNativeGlass,
              shouldUseNativeGlass
        else { return }
        let effect = UIGlassEffect(style: variant == .clear ? .clear : .regular)
        effect.isInteractive = isInteractive
        effect.tintColor = tint.cgColor.alpha > 0 ? tint : nil
        visualEffectView.effect = effect
    }

    private func setNeedsAppearanceUpdate() {
        guard !hasPendingAppearanceUpdate else { return }
        hasPendingAppearanceUpdate = true
        DispatchQueue.main.async { [weak self] in
            guard let self, self.hasPendingAppearanceUpdate else { return }
            self.hasPendingAppearanceUpdate = false
            self.applyAppearance()
        }
    }

    private func applyAppearance() {
        let defaults = variant.metalDefaults

        let refraction = metal.refraction
        let dispersion = metal.dispersion
        let highlight = metal.highlight
        let innerShadow = metal.innerShadow

        surface.blurRadius = resolve(metal.blurRadius, defaults.blur)
        surface.captureQuality = max(CGFloat(metal.captureQuality ?? 1), 0.25)

        // Metal-renderer only, like the rest of `metal`. Two zero radii are off; the surface
        // treats an active ramp as replacing the uniform blur stage.
        if let progressive = metal.progressiveBlur,
           max(progressive.startRadius ?? 0, progressive.endRadius ?? 0) > 0 {
            surface.progressiveBlurStart = CGFloat(progressive.startRadius ?? 0)
            surface.progressiveBlurEnd = CGFloat(progressive.endRadius ?? 0)
            surface.progressiveBlurDirection = progressive.direction ?? .down
            surface.progressiveBlurRampStart = CGFloat(progressive.start ?? 0)
            surface.progressiveBlurRampEnd = CGFloat(progressive.end ?? 1)
        } else {
            surface.progressiveBlurStart = 0
            surface.progressiveBlurEnd = 0
        }

        surface.refractionScale = CGSize(
            width: resolve(refraction?.width, defaults.width),
            height: resolve(refraction?.height, defaults.height)
        )
        surface.refractionAmount = resolve(refraction?.amount, defaults.amount)
        surface.depthEffect = resolve(refraction?.depth, defaults.depthEffect)
        surface.refractionProfile = refraction?.curve?.simd ?? defaults.profile
        // Clamped: the padding budget's outward-excursion bound needs |swirl| <= 1.
        surface.refractionSwirl = min(max(CGFloat(refraction?.swirl ?? 0), -1), 1)

        surface.dispersionAmount = resolve(dispersion?.amount, defaults.dispersion)
        surface.dispersionHeight = resolve(dispersion?.reach, defaults.height)
        // Clamped: the shader's `mix(1, q, t)` is only a blend for t in [0, 1].
        surface.dispersionQuadrant = min(max(CGFloat(dispersion?.quadrant ?? 0), 0), 1)

        surface.highlightIntensity = resolve(highlight?.intensity, defaults.highlight)
        highlightAngle = CGFloat(highlight?.angle ?? Self.defaultHighlightAngleDegrees) * .pi / 180
        surface.highlightAngle = highlightAngle
        surface.highlightWidth = max(resolve(highlight?.width, Self.defaultHighlightWidth), 0)
        // Floored here, not per pixel: pow(0, 0) in the shader is the alternative.
        surface.highlightFalloff = max(CGFloat(highlight?.falloff ?? 1), 0.01)

        surface.frostAmount = resolve(metal.frost, defaults.frost)
        surface.saturation = resolve(metal.saturation, defaults.saturation)
        surface.noiseAmount = resolve(metal.noise, defaults.noise)
        surface.lightIntensity = resolve(metal.light, defaults.light)

        surface.glassOpacity = CGFloat(metal.opacity ?? 1)
        surface.tintRGBA = tint.simdRGBA
        surface.frostRGB = resolvedFrostColor

        // >= 1 only: a magnification below 1 would sample outside the padded capture.
        surface.magnification = min(max(CGFloat(metal.magnification ?? 1), 1), 4)

        // The cast defaults to straight down by one radius — lit from above, the top inner
        // edge shades — which is Kyant's default and what the kit's pressed controls use.
        let shadowRadius = max(CGFloat(innerShadow?.radius ?? 0), 0)
        surface.innerShadowRadius = shadowRadius
        surface.innerShadowOffset = CGPoint(
            x: CGFloat(innerShadow?.offsetX ?? 0),
            y: innerShadow?.offsetY.map { CGFloat($0) } ?? shadowRadius
        )
        surface.innerShadowOpacity = min(
            max(innerShadow?.opacity.map { CGFloat($0) } ?? Self.defaultInnerShadowOpacity, 0), 1
        )

        // Metal-renderer only, like the rest of `metal` — the native UIGlassEffect path has no
        // morph to drive. All-or-nothing: width, height and a positive smoothing make it live.
        if let morph = metal.morph,
           let morphWidth = morph.width, let morphHeight = morph.height,
           (morph.smoothing ?? 0) > 0 {
            surface.morphRect = CGRect(
                x: morph.x ?? 0, y: morph.y ?? 0, width: morphWidth, height: morphHeight
            )
            surface.morphCornerRadius = CGFloat(morph.cornerRadius ?? 0)
            surface.morphSmoothing = CGFloat(morph.smoothing ?? 0)
        } else {
            surface.morphRect = .zero
            surface.morphCornerRadius = 0
            surface.morphSmoothing = 0
        }

        borderLayer.opacity = Float(metal.border?.opacity ?? Double(defaults.borderOpacity))
        updateBorderAxis()
    }

    private func resolve(_ override: Double?, _ fallback: CGFloat) -> CGFloat {
        guard let override else { return fallback }
        return CGFloat(override)
    }

    private func updateResolvedFrostColor() {
        resolvedFrostColor = UIColor.systemBackground
            .resolvedColor(with: traitCollection)
            .simdRGBA
    }

    override func traitCollectionDidChange(_ previous: UITraitCollection?) {
        super.traitCollectionDidChange(previous)
        guard traitCollection.userInterfaceStyle != previous?.userInterfaceStyle else { return }
        updateResolvedFrostColor()
        applyAppearance()
    }

    private func reportRenderer() {

        guard window != nil else { return }

        let name = isUsingNativeGlass
            ? (shouldUseNativeGlass ? "native" : "fallback-blur")
            : "metal"
        guard !didReportRenderer || name != lastReportedRenderer else { return }
        didReportRenderer = true
        lastReportedRenderer = name
        onRendererChange(["renderer": name])
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()

        guard window != nil else {
            hasAppliedEffectAfterLayout = false
            pressAnimator?.reset()
            applyPressTransform(.identity)
            return
        }

        // Re-resolve the backend if the glass layer is not actually ours.
        //
        // `refreshBackend()` — the only thing that installs a glass layer — has
        // exactly three callers: `init`, and the `didSet` on `variant` and on
        // `backend`. Both `didSet`s guard on `!= oldValue`.
        //
        // A RECYCLED view runs none of them. `init` is long past, and Fabric
        // re-applies the same props the view already carried from its previous
        // life, so neither `didSet` fires. The view therefore mounts with
        // whatever hierarchy recycling left it — and `layoutSubviews` goes on
        // to set a perfectly good `UIGlassEffect` on a `UIVisualEffectView`
        // that is no longer in the tree. Nothing paints, and the surface reads
        // as though it never mounted.
        //
        // Reported on iOS 26 as "the glass is unmounting when i view the stream
        // view again": a screen's chrome unmounts wholesale between visits,
        // which is exactly the path that puts these views through the recycle
        // pool. Ported from mine-app's `ios-glass-recycle` patch (2026-08-26).
        //
        // The condition makes this a no-op on an ordinary re-attach, where the
        // layer is still installed.
        if glassLayerView?.superview !== self {
            refreshBackend()
        }

        setNeedsLayout()
        reportRenderer()
    }

    private var contentHost: UIView {
        if isUsingNativeGlass, let visualEffectView {
            return visualEffectView.contentView
        }
        return contentContainer
    }

    private func restoreChildren() {
        guard !mountedChildren.isEmpty else { return }
        let host = contentHost
        for (index, child) in mountedChildren.enumerated() {
            host.insertSubview(child, at: min(index, host.subviews.count))
        }
    }

    override func mountChildComponentView(_ childComponentView: UIView, index: Int) {
        mountedChildren.insert(childComponentView, at: min(index, mountedChildren.count))
        let host = contentHost
        host.insertSubview(childComponentView, at: min(index, host.subviews.count))
    }

    override func unmountChildComponentView(_ childComponentView: UIView, index: Int) {
        mountedChildren.removeAll { $0 === childComponentView }
        childComponentView.removeFromSuperview()
    }

    // MARK: - Interactive presses (Metal path)

    /// Whether a touch on this view should drive the press animator: the Metal path only —
    /// Apple's material choreographs its own `isInteractive`.
    private var pressResponds: Bool {
        isInteractive && !isUsingNativeGlass
    }

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
        super.touchesBegan(touches, with: event)
        guard pressResponds, let touch = touches.first else { return }
        let point = touch.location(in: self)
        obtainPressAnimator().pressDown(x: point.x, y: point.y)
    }

    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {
        super.touchesMoved(touches, with: event)
        guard pressResponds, let touch = touches.first else { return }
        let point = touch.location(in: self)
        pressAnimator?.follow(x: point.x, y: point.y)
    }

    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {
        super.touchesEnded(touches, with: event)
        pressAnimator?.releasePress()
    }

    /// An ancestor recogniser taking the gesture (a scroll view's pan) lands here — released
    /// exactly like a lift, so the glass never sticks inflated.
    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) {
        super.touchesCancelled(touches, with: event)
        pressAnimator?.releasePress()
    }

    private func obtainPressAnimator() -> GlassPressAnimator {
        if let pressAnimator { return pressAnimator }
        let created = GlassPressAnimator(host: self) { [weak self] in self?.onPressFrame() }
        pressAnimator = created
        return created
    }

    /// Animation-stage write-through: fresh uniforms and a fresh transform, drawn by the frame
    /// scheduler's next tick.
    private func onPressFrame() {
        guard let animator = pressAnimator, pressResponds else { return }
        let transform = CGAffineTransform(translationX: animator.followX, y: animator.followY)
            .scaledBy(x: animator.scale * animator.stretchX, y: animator.scale * animator.stretchY)
        applyPressTransform(transform)
        pushPressUniforms()
    }

    /// The inflation, follow and stretch go on this view's own subviews — the glass surface, the
    /// content host and the border — never on this view itself, whose `layer.transform` React
    /// Native owns through the `transform` style. Children ride along inside the content host, so
    /// hit-testing stays correct through the press.
    private func applyPressTransform(_ transform: CGAffineTransform) {
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        glassLayerView?.transform = transform
        contentContainer.transform = transform
        borderLayer.setAffineTransform(transform)
        CATransaction.commit()
    }

    /// Two sources feed the same press uniforms: this view's own `interactive` animator, and a
    /// `glow` record the app drives. An explicit record wins — it is the caller saying "I am
    /// choreographing this".
    private func pushPressUniforms() {
        if let glow {
            surface.glowProgress = CGFloat(min(max(glow.progress, 0), 1))
            surface.glowPoint = CGPoint(
                x: glow.x.map { CGFloat($0) } ?? bounds.midX,
                y: glow.y.map { CGFloat($0) } ?? bounds.midY
            )
            surface.glowLens = glow.lens ? 1 : 0
        } else if pressResponds, let animator = pressAnimator {
            surface.glowProgress = animator.glow
            surface.glowPoint = CGPoint(x: animator.posX, y: animator.posY)
            surface.glowLens = 1
        } else {
            surface.glowProgress = 0
            surface.glowLens = 1
        }
    }

    // MARK: - Shape

    private func invalidateShape() {
        shapeIsValid = false
        setNeedsLayout()
    }

    override func layoutSubviews() {
        super.layoutSubviews()

        // The latch may only close on a SUCCESSFUL application. `applyNativeTint()`
        // guards on `visualEffectView != nil` and `isUsingNativeGlass`; setting
        // the flag before calling it meant a bail left the view holding the
        // blank `UIVisualEffect()` assigned below, with no retry until it next
        // left the window. Hoisting both conditions makes the bail unreachable.
        if !hasAppliedEffectAfterLayout, window != nil, shouldUseNativeGlass,
           isUsingNativeGlass, let visualEffectView {
            hasAppliedEffectAfterLayout = true

            visualEffectView.effect = UIVisualEffect()
            applyNativeTint()
        }

        let center = CGPoint(x: bounds.midX, y: bounds.midY)
        for child in [glassLayerView, contentContainer].compactMap({ $0 }) {
            child.bounds = CGRect(origin: .zero, size: bounds.size)
            child.center = center
        }

        // The glow's default hotspot is the view's centre, so it re-resolves with the size.
        pushPressUniforms()

        let radii = cornerRadii

        guard !shapeIsValid
            || cachedShapeSize != bounds.size
            || cachedRadii != radii
            || cachedBorderWidth != borderWidth
        else { return }

        shapeIsValid = true
        cachedShapeSize = bounds.size
        cachedRadii = radii
        cachedBorderWidth = borderWidth

        let clamped = radii.clamped(to: bounds.size)
        // With `metal.shape` the SDF's rect is smaller than the view, and the radii must clamp
        // against IT — the border layer and content masks below still track the view, which is
        // documented as the shape-inset limitation (canvas views host their own chrome).
        let radiiBasis = surface.shapeRect == .zero ? bounds.size : surface.shapeRect.size
        let resolved = ContinuousCorners.resolve(
            radii.clamped(to: radiiBasis),
            continuous: cornerStyle == .continuous,
            size: radiiBasis
        )
        surface.cornerExtents = resolved.extentsSIMD
        surface.cornerShapes = resolved.shapesSIMD

        applyCornerShaping(clamped)
        applyBorder(clamped)
        updateBackdropFill(clamped)
    }

    private func updateBackdropFill(_ radii: CornerRadiiValues) {
        guard let layer = layer as? NonRenderableLayer else { return }
        guard isUsingNativeGlass, tint.cgColor.alpha > 0 else {
            layer.backdropFillColor = nil
            layer.backdropFillPath = nil
            return
        }
        layer.backdropFillColor = tint.cgColor
        layer.backdropFillPath = path(for: radii).cgPath
    }

    private func applyCornerShaping(_ radii: CornerRadiiValues) {
        contentContainer.layer.cornerCurve = cornerStyle.layerCurve

        // Uniform radii ride Core Animation's own corner curve — for `continuous` that is Apple's
        // exact curve, within 0.8 px of the shader's family at any UI radius. Per-corner radii
        // take the path, which is that family verbatim.
        if radii.isUniform {
            contentContainer.layer.mask = nil
            contentContainer.layer.cornerRadius = radii.topLeft
            contentContainer.clipsToBounds = radii.topLeft > 0
        } else {
            contentContainer.layer.cornerRadius = 0
            contentMask.frame = bounds
            contentMask.path = path(for: radii).cgPath
            contentContainer.layer.mask = contentMask
            contentContainer.clipsToBounds = true
        }

        guard let visualEffectView else { return }
        visualEffectView.layer.cornerCurve = cornerStyle.layerCurve
        if radii.isUniform {
            visualEffectView.layer.mask = nil
            visualEffectView.layer.cornerRadius = radii.topLeft
            visualEffectView.clipsToBounds = true
        } else {
            visualEffectView.layer.cornerRadius = 0
            effectMask.frame = bounds
            effectMask.path = path(for: radii).cgPath
            visualEffectView.layer.mask = effectMask
            visualEffectView.clipsToBounds = true
        }
    }

    private func applyBorder(_ radii: CornerRadiiValues) {

        let visible = !isUsingNativeGlass && borderWidth > 0
        borderLayer.isHidden = !visible
        guard visible else { return }

        CATransaction.begin()
        CATransaction.setDisableActions(true)
        // Bounds and position rather than frame: the layer carries the press transform, and a
        // frame written through a transform is not the geometry it looks like.
        borderLayer.bounds = CGRect(origin: .zero, size: bounds.size)
        borderLayer.position = CGPoint(x: bounds.midX, y: bounds.midY)
        borderMask.frame = CGRect(origin: .zero, size: bounds.size)
        borderMask.lineWidth = borderWidth

        borderMask.path = path(for: radii, inset: borderWidth / 2).cgPath
        updateBorderAxis()
        CATransaction.commit()
    }

    /// Lays the border gradient along the highlight axis. `reach` is half the view's footprint
    /// projected onto that axis, so the extreme corners project exactly onto stops 0 and 1 at
    /// any angle — the geometry the old corner-to-corner diagonal had for its one fixed angle.
    /// Expressed in the layer's unit square, which is what CAGradientLayer's points are.
    private func updateBorderAxis() {
        let w = max(bounds.width, 1)
        let h = max(bounds.height, 1)
        let dx = cos(highlightAngle)
        let dy = sin(highlightAngle)
        let reach = 0.5 * (abs(w * dx) + abs(h * dy))
        borderLayer.startPoint = CGPoint(x: 0.5 - reach * dx / w, y: 0.5 - reach * dy / h)
        borderLayer.endPoint = CGPoint(x: 0.5 + reach * dx / w, y: 0.5 + reach * dy / h)
    }

    /// The clip and border outline. Continuous corners take the calibrated superellipse family —
    /// the same curve the Metal SDF evaluates — so the stroke sits on the refraction fold;
    /// circular corners take arcs.
    private func path(for radii: CornerRadiiValues, inset: CGFloat = 0) -> UIBezierPath {
        let rect = bounds.insetBy(dx: inset, dy: inset)
        guard rect.width > 0, rect.height > 0 else { return UIBezierPath() }

        let adjusted = CornerRadiiValues(
            topLeft: max(0, radii.topLeft - inset),
            topRight: max(0, radii.topRight - inset),
            bottomRight: max(0, radii.bottomRight - inset),
            bottomLeft: max(0, radii.bottomLeft - inset)
        ).clamped(to: rect.size)

        if cornerStyle == .continuous, !adjusted.isZero {
            let resolved = ContinuousCorners.resolve(adjusted, continuous: true, size: rect.size)
            return ContinuousCorners.path(in: rect, resolved: resolved)
        }

        if adjusted.isUniform {
            return UIBezierPath(
                roundedRect: rect,
                cornerRadius: adjusted.topLeft
            )
        }

        let path = UIBezierPath()
        path.move(to: CGPoint(x: rect.minX + adjusted.topLeft, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.maxX - adjusted.topRight, y: rect.minY))
        path.addArc(
            withCenter: CGPoint(x: rect.maxX - adjusted.topRight, y: rect.minY + adjusted.topRight),
            radius: adjusted.topRight, startAngle: -.pi / 2, endAngle: 0, clockwise: true
        )
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY - adjusted.bottomRight))
        path.addArc(
            withCenter: CGPoint(x: rect.maxX - adjusted.bottomRight, y: rect.maxY - adjusted.bottomRight),
            radius: adjusted.bottomRight, startAngle: 0, endAngle: .pi / 2, clockwise: true
        )
        path.addLine(to: CGPoint(x: rect.minX + adjusted.bottomLeft, y: rect.maxY))
        path.addArc(
            withCenter: CGPoint(x: rect.minX + adjusted.bottomLeft, y: rect.maxY - adjusted.bottomLeft),
            radius: adjusted.bottomLeft, startAngle: .pi / 2, endAngle: .pi, clockwise: true
        )
        path.addLine(to: CGPoint(x: rect.minX, y: rect.minY + adjusted.topLeft))
        path.addArc(
            withCenter: CGPoint(x: rect.minX + adjusted.topLeft, y: rect.minY + adjusted.topLeft),
            radius: adjusted.topLeft, startAngle: .pi, endAngle: 3 * .pi / 2, clockwise: true
        )
        path.close()
        return path
    }

    /// 180 puts the lobe axis vertical: top and bottom edges lit, side rims fading to zero at
    /// the midpoints — what real iOS 26 bars measure (research/04).
    private static let defaultHighlightAngleDegrees: Double = 180

    /// The crisp line's depth, points. Apple's line measures 2–3 px on a 238 px icon.
    private static let defaultHighlightWidth: CGFloat = 0.75

    /// Kyant's `InnerShadow` default: black at 15 %.
    private static let defaultInnerShadowOpacity: CGFloat = 0.15
}

extension UIColor {

    var simdRGBA: SIMD4<Float> {
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        guard getRed(&r, green: &g, blue: &b, alpha: &a) else {
            var white: CGFloat = 0
            if getWhite(&white, alpha: &a) {
                return SIMD4<Float>(Float(white), Float(white), Float(white), Float(a))
            }
            return SIMD4<Float>(0, 0, 0, 0)
        }
        return SIMD4<Float>(Float(r), Float(g), Float(b), Float(a))
    }
}
