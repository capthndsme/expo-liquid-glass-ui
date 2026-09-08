import Metal
import UIKit

final class BackdropCapturer {

    static let shared = BackdropCapturer()

    private(set) var texture: MTLTexture?

    private(set) var capturedOrigin: CGPoint = .zero

    private(set) var textureSizePoints: CGSize = .zero

    private(set) var textureScale: CGFloat = Tuning.fallbackCaptureScale

    private var requestedScale: CGFloat = Tuning.fallbackCaptureScale

    private enum Tuning {

        static let fallbackCaptureScale: CGFloat = 2.0

        static let maxCapturePixels: CGFloat = 4_500_000

        static let dutyCycle: Double = 0.30

        static let maxStride = 3

        static let strideHysteresisFrames = 45

        static let staleCapturesBeforeIdle = 4
        static let idleStride = 4

        static let digestStride = 97

        static let emptyCapturesBeforeSwitch = 3

        static let costSmoothing: Double = 0.2

        static let shrinkDelay: CFTimeInterval = 1.0

        static let allocationBucket = 64

        static let movementMargin: CGFloat = 220

        static let movementMemory: CFTimeInterval = 0.4

        /// The adaptive sensor's sampling grid, per axis.
        static let luminanceGrid = 12
    }

    private enum Debug {
        static let enabled =
            ProcessInfo.processInfo.environment["EXPO_LIQUID_GLASS_DEBUG"] == "1"
    }

    private var debugCaptures = 0
    private var debugTotalCost: Double = 0
    private var debugWindowStart: CFTimeInterval = 0

    private func recordDebug(cost: Double, region: CGRect, now: CFTimeInterval) {
        guard Debug.enabled else { return }
        debugCaptures += 1
        debugTotalCost += cost

        if debugWindowStart == 0 { debugWindowStart = now }
        let elapsed = now - debugWindowStart
        guard elapsed >= 1.0 else { return }

        let mean = debugTotalCost / Double(debugCaptures) * 1000
        print(String(
            format: "[LiquidGlass] %.0f cap/s  %.2fms each (%.0f%% of a 60Hz frame)  "
                + "stride %d  scale %.2f  region %.0fx%.0f  %dk px  path %@",
            Double(debugCaptures) / elapsed, mean, mean / 16.67 * 100,
            strideFrames, Double(textureScale),
            Double(region.width), Double(region.height), capturedPixelCount / 1000,
            slots.first?.uploadSource == nil ? "zero-copy" : "upload"
        ))

        debugCaptures = 0
        debugTotalCost = 0
        debugWindowStart = now
    }

    private var captureCost: Double = 0

    private var strideFrames = 1
    private var candidateStride = 1
    private var candidateStrideAge = 0
    private var frameCounter = 0

    private var capturedPixelCount: Int = 0

    private var lastDigest: UInt64 = 0
    private var staleCaptures = 0

    /// How a glass-free subtree is drawn — see `drawTree`, which walks the tree either way.
    private enum Strategy {
        /// `CALayer.render(in:)` on each leaf: cheap, and blank on iOS 26.
        case layerRender
        /// `drawHierarchy(in:afterScreenUpdates:)` on each leaf — window-server snapshots.
        case compositedDraw
    }

    private var strategy: Strategy = .layerRender

    private var emptyCaptures = 0

    private var lastRegion: CGRect = .null

    private var capturedRegion: CGRect = .null

    private var lastMovementTime: CFTimeInterval = -.greatestFiniteMagnitude

    private final class Slot {
        let texture: MTLTexture
        let context: CGContext
        let pixelSize: (width: Int, height: Int)
        let bytesPerRow: Int
        let uploadSource: UnsafeMutableRawPointer?

        private let ownedMemory: UnsafeMutableRawPointer?
        private let buffer: MTLBuffer?

        var bufferContents: UnsafeMutableRawPointer? {
            ownedMemory ?? buffer?.contents()
        }

        init(
            texture: MTLTexture,
            context: CGContext,
            pixelSize: (width: Int, height: Int),
            bytesPerRow: Int,
            buffer: MTLBuffer?,
            ownedMemory: UnsafeMutableRawPointer?
        ) {
            self.texture = texture
            self.context = context
            self.pixelSize = pixelSize
            self.bytesPerRow = bytesPerRow
            self.buffer = buffer
            self.ownedMemory = ownedMemory
            self.uploadSource = ownedMemory
        }

        deinit { ownedMemory?.deallocate() }
    }

    private var slots: [Slot] = []
    private var slotIndex = 0
    private var smallerSizeSince: CFTimeInterval?

    private init() {}

    func capture(
        window: UIWindow,
        region: CGRect,
        scale: CGFloat,
        frameDuration: CFTimeInterval,
        isUnderLoad: Bool
    ) -> Bool {
        guard !region.isNull, !region.isEmpty,
              window.bounds.width > 0, window.bounds.height > 0
        else { return false }

        if scale != requestedScale {
            requestedScale = scale
            slots.removeAll()
        }

        let clipped = region.intersection(window.bounds)
        guard !clipped.isEmpty else { return false }

        frameCounter &+= 1

        let moved = clipped != lastRegion
        lastRegion = clipped

        if moved { lastMovementTime = CACurrentMediaTime() }

        let mustRefreshGeometry = !capturedRegion.contains(clipped)

        let isMoving = CACurrentMediaTime() - lastMovementTime < Tuning.movementMemory
        let stride = staleCaptures >= Tuning.staleCapturesBeforeIdle
            ? Tuning.idleStride
            : strideFrames
        let dueByCadence = !isMoving && frameCounter % stride == 0
        guard mustRefreshGeometry || dueByCadence else { return false }

        let margin = isMoving ? Tuning.movementMargin : 0
        let target = margin > 0
            ? clipped.insetBy(dx: -margin, dy: -margin).intersection(window.bounds)
            : clipped

        let start = CACurrentMediaTime()
        let didCapture = rasterise(window: window, region: target)
        guard didCapture else { return false }

        capturedRegion = target

        let elapsed = CACurrentMediaTime() - start
        captureCost = captureCost == 0
            ? elapsed
            : captureCost + (elapsed - captureCost) * Tuning.costSmoothing

        updateStride(frameDuration: frameDuration)
        recordDebug(cost: elapsed, region: target, now: start)
        return true
    }

    private func updateStride(frameDuration: CFTimeInterval) {
        let frame = frameDuration > 0 ? frameDuration : 1.0 / 60.0
        let budget = frame * Tuning.dutyCycle
        guard budget > 0, captureCost > 0 else { return }

        let needed = Int((captureCost / budget).rounded(.up))
        let target = min(max(needed, 1), Tuning.maxStride)

        guard target != strideFrames else {
            candidateStride = strideFrames
            candidateStrideAge = 0
            return
        }

        if candidateStride != target {
            candidateStride = target
            candidateStrideAge = 0
            return
        }

        candidateStrideAge += 1
        guard candidateStrideAge >= Tuning.strideHysteresisFrames else { return }

        strideFrames = target
        candidateStrideAge = 0
    }

    private func digest(of slot: Slot, width: Int, height: Int) -> UInt64 {
        guard width > 0, height > 0, let base = slot.bufferContents else { return 0 }

        let rowWords = slot.bytesPerRow / 4
        let cols = min(width, rowWords)
        let rows = min(height, slot.pixelSize.height)
        let total = cols * rows
        guard total > 0 else { return 0 }

        let pixels = base.assumingMemoryBound(to: UInt32.self)
        var hash: UInt64 = 0xcbf29ce484222325
        var index = 0
        while index < total {
            let row = index / cols
            hash = (hash ^ UInt64(pixels[row * rowWords + (index - row * cols)])) &* 0x100000001b3
            index += Tuning.digestStride
        }
        return hash
    }

    private func rasterise(window: UIWindow, region: CGRect) -> Bool {

        let area = max(region.width * region.height, 1)
        let ceiling = (Tuning.maxCapturePixels / area).squareRoot()
        let pinned = max(((min(requestedScale, ceiling)) * 4).rounded(.down) / 4, 1.0)
        if pinned != textureScale {
            textureScale = pinned
            slots.removeAll()
        }

        let scale = textureScale
        let origin = CGPoint(
            x: (region.minX * scale).rounded(.down) / scale,
            y: (region.minY * scale).rounded(.down) / scale
        )
        let size = CGSize(
            width: region.maxX - origin.x,
            height: region.maxY - origin.y
        )

        guard prepareSlots(for: size) else { return false }

        slotIndex = (slotIndex + 1) % slots.count
        let slot = slots[slotIndex]
        let context = slot.context

        capturedOrigin = origin
        textureSizePoints = CGSize(
            width: CGFloat(slot.pixelSize.width) / scale,
            height: CGFloat(slot.pixelSize.height) / scale
        )

        context.saveGState()

        context.interpolationQuality = .high
        context.setShouldAntialias(true)
        context.setShouldSubpixelPositionFonts(true)
        context.setShouldSubpixelQuantizeFonts(false)

        context.setShouldSmoothFonts(false)

        context.translateBy(x: 0, y: CGFloat(slot.pixelSize.height))
        context.scaleBy(x: scale, y: -scale)
        context.translateBy(x: -origin.x, y: -origin.y)

        let regionRect = CGRect(origin: origin, size: size)
        context.clip(to: regionRect)
        context.clear(regionRect)

        let regionPixelWidth = max(Int(size.width * scale), 1)
        let regionPixelHeight = max(Int(size.height * scale), 1)
        capturedPixelCount = regionPixelWidth * regionPixelHeight

        drawTree(window: window, region: regionRect, context: context)

        context.restoreGState()

        if let uploadSource = slot.uploadSource {
            slot.texture.replace(
                region: MTLRegionMake2D(0, 0, slot.pixelSize.width, slot.pixelSize.height),
                mipmapLevel: 0,
                withBytes: uploadSource,
                bytesPerRow: slot.bytesPerRow
            )
        }

        if strategy == .layerRender,
           isEmpty(slot, width: regionPixelWidth, height: regionPixelHeight) {
            emptyCaptures += 1
            if emptyCaptures >= Tuning.emptyCapturesBeforeSwitch {
                strategy = .compositedDraw
                emptyCaptures = 0
                NSLog(
                    "[LiquidGlass] CALayer.render(in:) returns nothing for this "
                    + "window — switching the backdrop capture to composited "
                    + "snapshots. Seen on iOS 26 and up, and on any window "
                    + "whose blank capture is opaque rather than clear."
                )
            }
        } else {
            emptyCaptures = 0
        }

        let current = digest(of: slot, width: regionPixelWidth, height: regionPixelHeight)
        staleCaptures = current == lastDigest ? staleCaptures + 1 : 0
        lastDigest = current

        texture = slot.texture
        return true
    }

    private func isEmpty(_ slot: Slot, width: Int, height: Int) -> Bool {
        guard let base = slot.bufferContents, width > 8, height > 8 else { return false }

        let rowWords = slot.bytesPerRow / 4
        let columns = min(width, rowWords)
        let pixels = base.assumingMemoryBound(to: UInt32.self)
        let first = pixels[0]

        for row in 0..<8 {
            let y = height * row / 8
            for column in 0..<8 where pixels[y * rowWords + columns * column / 8] != first {
                return false
            }
        }

        // Every sampled pixel matched, so the capture carries no detail at all.
        // That is the signal worth acting on, whatever colour it happens to be.
        //
        // This used to additionally require the uniform colour to be either
        // fully transparent or pure black, which quietly made the recovery
        // light-theme-blind: an app whose window renders cream or white gets a
        // uniform OPAQUE capture when CALayer.render(in:) comes back with
        // nothing, `isEmpty` answered false, the counter never reached
        // emptyCapturesBeforeSwitch, and the strategy never moved to
        // compositedDraw. The glass then refracts a flat field forever — which
        // against a light background is indistinguishable from no glass at all.
        // Dark-themed apps hit the black branch and recovered, so this only
        // ever showed up on light ones.
        //
        // A genuinely flat screen is now also read as empty, and the switch
        // is one-way for the capturer's lifetime — there is no path back to
        // layerRender. So the cost of being wrong here is compositedDraw's
        // slower capture, permanently, on a window that might not have needed
        // it; the cost of being right is a glass surface that is visible at
        // all. It takes emptyCapturesBeforeSwitch consecutive flat frames, so
        // a single splash or transition frame will not trip it.
        return true
    }

    /// The capture walks the window's view tree itself, in paint order, and draws every
    /// glass-free subtree as one leaf — `CALayer.render(in:)` under `.layerRender`, a
    /// `drawHierarchy` snapshot under `.compositedDraw`. Walking, instead of rendering the window
    /// in one call, is what makes the backdrop *what lies beneath* each glass: the moment the walk
    /// passes a Metal glass view, that view's padded rect becomes a hole in everything painted
    /// after it.
    ///
    /// The kit's controls all draw their content as siblings over the pane — the tab bar's icon
    /// row, a button's label, a chat header's photo overhanging its name pill — and a whole-window
    /// render carried every one of them into the very backdrop the pane refracts. The edge lens
    /// only ever samples inward, so at the top and bottom rims it pulled the glyphs into the band
    /// as vertical streaks of their own colour (iPhone 14 Pro Max, iOS 26, 2026-09-08). Android
    /// never had the problem: a provider records only what sits under the glass. This is that
    /// rule on iOS.
    ///
    /// One texture serves every glass, so where two panes overlap the hole is a compromise: a
    /// glass painted over another loses whatever was painted between them inside the lower
    /// pane's padded rect. That is the tab pill over its bar, and there it is the right answer —
    /// the pill's cutout draws the row it needs on top.
    private func drawTree(window: UIWindow, region: CGRect, context: CGContext) {
        excludedViews.removeAll(keepingCapacity: true)
        holes.removeAll(keepingCapacity: true)
        defer {
            excludedViews.removeAll(keepingCapacity: true)
            holes.removeAll(keepingCapacity: true)
        }

        collectExcludedViews(in: window)

        // `drawHierarchy` draws into UIKit's current context; `render(in:)` takes the CGContext
        // and ignores this.
        UIGraphicsPushContext(context)
        defer { UIGraphicsPopContext() }

        drawSubviews(of: window, window: window, region: region, context: context, holesApplied: 0)
    }

    private var excludedViews: [UIView] = []

    /// The padded window rects of the Metal glass views the walk has passed so far, in paint
    /// order. Append-only within a capture: a subtree records how many it has already clipped
    /// out, and each child clips only the rest.
    private var holes: [CGRect] = []

    private func collectExcludedViews(in view: UIView) {
        for subview in view.subviews {
            if let layer = subview.layer as? NonRenderableLayer, layer.isExcludedFromBackdrop {
                excludedViews.append(subview)
                continue
            }
            collectExcludedViews(in: subview)
        }
    }

    private func leadsToExcludedView(_ view: UIView) -> Bool {
        excludedViews.contains { $0.isDescendant(of: view) }
    }

    private func drawSubviews(
        of parent: UIView,
        window: UIWindow,
        region: CGRect,
        context: CGContext,
        holesApplied: Int
    ) {
        for subview in parent.subviews {
            guard !subview.isHidden, subview.alpha > 0.01 else { continue }

            let frame = subview.convert(subview.bounds, to: window)

            if excludedViews.contains(subview) {
                // A Metal glass. Its own pixels never enter the capture, and from here on nothing
                // painted over it may either: its padded rect — the reach of its blur and
                // dispersion, `GlassSurfaceView.glassBackdropPadding` — is a hole in everything
                // that follows.
                let padding = (subview.layer as? NonRenderableLayer)?.backdropHolePadding ?? 0
                let hole = frame.insetBy(dx: -padding, dy: -padding)
                if hole.intersects(region) { holes.append(hole) }
                continue
            }

            let leadsToGlass = leadsToExcludedView(subview)

            if subview.clipsToBounds, !frame.intersects(region), !leadsToGlass { continue }

            context.saveGState()
            defer { context.restoreGState() }

            if subview.alpha < 1 { context.setAlpha(subview.alpha) }

            // A view that clips can only paint inside its frame, so holes clear of it are
            // skipped; one that does not may paint children anywhere, and takes them all.
            clipOutHoles(
                from: holesApplied,
                around: subview.clipsToBounds ? frame : nil,
                context: context
            )
            let applied = holes.count

            // Wholly inside the holes: the snapshot would be taken and thrown away.
            guard !context.boundingBoxOfClipPath.isEmpty else { continue }

            guard leadsToGlass else {
                drawLeaf(subview, frame: frame, window: window, region: region, context: context)
                continue
            }

            // A container on the way to a glass: its own fill, then its children one by one.
            // Uniform corners are honoured — Fabric keeps those on the view's layer; a
            // non-uniform radius lives in a background sublayer this walk does not see.
            let radius = subview.layer.cornerRadius
            let outline = radius > 0
                ? UIBezierPath(roundedRect: frame, cornerRadius: radius).cgPath
                : CGPath(rect: frame, transform: nil)

            if subview.clipsToBounds {
                context.beginPath()
                context.addPath(outline)
                context.clip()
            }

            if let background = subview.backgroundColor?.cgColor, background.alpha > 0 {
                context.setFillColor(background)
                context.beginPath()
                context.addPath(outline)
                context.fillPath()
            }

            drawSubviews(
                of: subview, window: window, region: region, context: context,
                holesApplied: applied
            )
        }
    }

    /// Clips the current state to exclude `holes[start...]`. Each hole goes on as the even-odd
    /// difference of the clip's own bounding box and the hole's rect, and successive clips
    /// intersect — so overlapping holes (a pill inside its bar) cut correctly, where a single
    /// even-odd path over all of them would let the overlap back in. `around` is the drawing
    /// view's frame when it clips to bounds, letting holes clear of it be skipped.
    private func clipOutHoles(from start: Int, around frame: CGRect?, context: CGContext) {
        guard start < holes.count else { return }
        for hole in holes[start...] {
            if let frame, !hole.intersects(frame) { continue }
            let everything = context.boundingBoxOfClipPath
            guard everything.intersects(hole) else { continue }
            context.beginPath()
            context.addRect(everything)
            context.addRect(hole)
            context.clip(using: .evenOdd)
        }
    }

    /// One glass-free subtree, drawn whole. `.compositedDraw` takes the window server's snapshot
    /// of it. `.layerRender` renders the layer tree, mapped so the view's bounds land on its
    /// window frame — a scroll view carries its offset in `bounds.origin`, which `render(in:)`
    /// does not apply for the layer it is called on — and then overdraws any SwiftUI hosting
    /// views inside, which `render(in:)` leaves blank.
    private func drawLeaf(
        _ view: UIView,
        frame: CGRect,
        window: UIWindow,
        region: CGRect,
        context: CGContext
    ) {
        switch strategy {
        case .compositedDraw:
            view.drawHierarchy(in: frame, afterScreenUpdates: false)

        case .layerRender:
            let bounds = view.bounds
            guard bounds.width > 0, bounds.height > 0 else { return }

            context.saveGState()
            context.translateBy(x: frame.minX, y: frame.minY)
            context.scaleBy(x: frame.width / bounds.width, y: frame.height / bounds.height)
            context.translateBy(x: -bounds.minX, y: -bounds.minY)
            NonRenderableLayer.isCapturingBackdrop = true
            view.layer.render(in: context)
            NonRenderableLayer.isCapturingBackdrop = false
            context.restoreGState()

            overdrawHostedViews(in: view, window: window, region: region)
        }
    }

    /// The SwiftUI hosting views inside a `.layerRender` leaf, snapshotted over the layer render.
    /// Walks only the leaf, which by construction holds no glass.
    private func overdrawHostedViews(in root: UIView, window: UIWindow, region: CGRect) {
        for subview in root.subviews {
            guard !subview.isHidden, subview.alpha > 0.01 else { continue }

            if isHostingView(subview) {
                let frame = subview.convert(subview.bounds, to: window)
                if frame.intersects(region), !frame.isEmpty {
                    subview.drawHierarchy(in: frame, afterScreenUpdates: false)
                }
                continue
            }

            overdrawHostedViews(in: subview, window: window, region: region)
        }
    }

    private var hostingClasses: [ObjectIdentifier: Bool] = [:]

    private func isHostingView(_ view: UIView) -> Bool {
        let type = type(of: view)
        let key = ObjectIdentifier(type)
        if let known = hostingClasses[key] { return known }

        let isHosting = String(describing: type).contains("HostingView")
        hostingClasses[key] = isHosting
        return isHosting
    }

    private func prepareSlots(for size: CGSize) -> Bool {
        guard let context = GlassRenderContext.shared else { return false }

        func bucketed(_ value: CGFloat) -> Int {
            let pixels = max(Int((value * textureScale).rounded(.up)), 1)
            let bucket = Tuning.allocationBucket
            return ((pixels + bucket - 1) / bucket) * bucket
        }

        let requested = (width: bucketed(size.width), height: bucketed(size.height))

        if let current = slots.first?.pixelSize {
            let fits = requested.width <= current.width && requested.height <= current.height
            let wastes = requested.width * 2 <= current.width || requested.height * 2 <= current.height

            if fits, !wastes {
                smallerSizeSince = nil
                return true
            }

            if fits {
                let now = CACurrentMediaTime()
                let since = smallerSizeSince ?? now
                smallerSizeSince = since
                if now - since < Tuning.shrinkDelay { return true }
            }
        }

        smallerSizeSince = nil

        let device = context.device
        let alignment = context.linearTextureAlignment
        let width = requested.width
        let height = requested.height
        let bytesPerRow = ((width * 4 + alignment - 1) / alignment) * alignment

        var built: [Slot] = []
        built.reserveCapacity(2)

        for index in 0..<2 {
            guard let slot = makeSlot(
                device: device,
                index: index,
                width: width,
                height: height,
                bytesPerRow: bytesPerRow
            ) else { return false }
            built.append(slot)
        }

        slots = built
        slotIndex = 0
        texture = nil
        return true
    }

    private func makeSlot(
        device: MTLDevice,
        index: Int,
        width: Int,
        height: Int,
        bytesPerRow: Int
    ) -> Slot? {
        let descriptor = MTLTextureDescriptor.texture2DDescriptor(
            pixelFormat: .bgra8Unorm,
            width: width,
            height: height,
            mipmapped: false
        )
        descriptor.usage = .shaderRead
        descriptor.storageMode = .shared

        let bitmapInfo = CGImageAlphaInfo.premultipliedFirst.rawValue
            | CGBitmapInfo.byteOrder32Little.rawValue

        #if !targetEnvironment(simulator)

        if let buffer = device.makeBuffer(
            length: bytesPerRow * height,
            options: .storageModeShared
        ) {
            buffer.label = "GlassBackdrop\(index)"

            if let texture = buffer.makeTexture(
                descriptor: descriptor,
                offset: 0,
                bytesPerRow: bytesPerRow
            ), let cgContext = CGContext(
                data: buffer.contents(),
                width: width,
                height: height,
                bitsPerComponent: 8,
                bytesPerRow: bytesPerRow,
                space: CGColorSpaceCreateDeviceRGB(),
                bitmapInfo: bitmapInfo
            ) {
                texture.label = "GlassBackdrop\(index)"
                return Slot(
                    texture: texture,
                    context: cgContext,
                    pixelSize: (width, height),
                    bytesPerRow: bytesPerRow,
                    buffer: buffer,
                    ownedMemory: nil
                )
            }
        }
        #endif

        guard let texture = device.makeTexture(descriptor: descriptor) else { return nil }
        texture.label = "GlassBackdrop\(index)"

        let memory = UnsafeMutableRawPointer.allocate(
            byteCount: bytesPerRow * height,
            alignment: MemoryLayout<UInt32>.alignment
        )

        guard let cgContext = CGContext(
            data: memory,
            width: width,
            height: height,
            bitsPerComponent: 8,
            bytesPerRow: bytesPerRow,
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: bitmapInfo
        ) else {
            memory.deallocate()
            return nil
        }

        return Slot(
            texture: texture,
            context: cgContext,
            pixelSize: (width, height),
            bytesPerRow: bytesPerRow,
            buffer: nil,
            ownedMemory: memory
        )
    }

    /// Mean luminance of the current capture inside `uvRect` (the same UV space the surfaces
    /// sample), alpha-weighted, in the sRGB gamma space the shader's own luma uses — the
    /// `adaptive` prop's sensor. Reads the CPU side of the slot that was last rasterised, which
    /// is exactly what the GPU is sampling, so it costs no readback: a grid of at most
    /// `luminanceGrid`² pixels is walked in place. Nil while there is no capture.
    func meanLuminance(in uvRect: SIMD4<Float>) -> Float? {
        guard !slots.isEmpty, texture != nil else { return nil }
        let slot = slots[slotIndex]
        guard let base = slot.bufferContents else { return nil }

        let width = slot.pixelSize.width
        let height = slot.pixelSize.height
        let x0 = max(Int((CGFloat(uvRect.x) * CGFloat(width)).rounded(.down)), 0)
        let y0 = max(Int((CGFloat(uvRect.y) * CGFloat(height)).rounded(.down)), 0)
        let x1 = min(Int((CGFloat(uvRect.x + uvRect.z) * CGFloat(width)).rounded(.up)), width)
        let y1 = min(Int((CGFloat(uvRect.y + uvRect.w) * CGFloat(height)).rounded(.up)), height)
        guard x1 > x0, y1 > y0 else { return nil }

        let stepX = max((x1 - x0) / Tuning.luminanceGrid, 1)
        let stepY = max((y1 - y0) / Tuning.luminanceGrid, 1)
        let rowWords = slot.bytesPerRow / 4
        let pixels = base.assumingMemoryBound(to: UInt32.self)

        var sum: Float = 0
        var cover: Float = 0
        var y = y0
        while y < y1 {
            var x = x0
            while x < x1 {
                // BGRA, little-endian, premultiplied: the packed word reads 0xAARRGGBB, and a
                // premultiplied channel sum IS the alpha-weighted sum.
                let word = pixels[y * rowWords + x]
                let b = Float(word & 0xFF)
                let g = Float((word >> 8) & 0xFF)
                let r = Float((word >> 16) & 0xFF)
                let a = Float((word >> 24) & 0xFF)
                sum += (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
                cover += a / 255
                x += stepX
            }
            y += stepY
        }
        guard cover > 1e-3 else { return 0.5 }
        return min(max(sum / cover, 0), 1)
    }

    func releaseResources() {
        slots.removeAll()
        texture = nil
        emptyCaptures = 0
        textureSizePoints = .zero
        captureCost = 0
        capturedPixelCount = 0
        lastDigest = 0
        staleCaptures = 0
        lastRegion = .null
        capturedRegion = .null
        lastMovementTime = -.greatestFiniteMagnitude
        strideFrames = 1
        candidateStride = 1
        candidateStrideAge = 0
        smallerSizeSince = nil
        textureScale = requestedScale
    }
}
