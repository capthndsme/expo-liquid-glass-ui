import CoreGraphics
import UIKit
import simd

/// The continuous-corner ("squircle") curve family, shared by the Core Animation paths and the
/// Metal SDF — the Swift twin of the Android `ContinuousCorners.kt`, same constants.
///
/// One curve, two renderers: a corner is a superellipse quadrant in an E x E cell,
/// `((E-x)/E)^n + ((E-y)/E)^n = 1`, with the circular corner as its exact (E = r, n = 2) member.
/// The constants are calibrated against the PaintCode reverse-engineering of Apple's continuous
/// rounded rect — max deviation 7.3e-3 r, sub-pixel at every UI radius. Method, provenance and
/// error tables: `docs/android-port/research/05-continuous-corner-calibration.md`.
///
/// The resolver and the path builder must stay in lock-step with the shader's `sdGlassRect` /
/// `gradGlassRect`: the border stroke is drawn on these paths *over* the shader's rim, and at a
/// 1 pt border against a 0.75 pt rim, disagreement reads as a double edge — which is exactly what
/// the old circular border did over Apple's continuous content clip, by up to 0.12 r at the
/// corner apex.
enum ContinuousCorners {

    /// Apple's corner extent per unit radius — where the curve departs the straight edge. Exact.
    static let extent: CGFloat = 1.52866483

    /// Fitted superellipse exponent at full extent (research/05, fit 1).
    static let fullExponent: Float = 3.3418

    /// Below this an exponent is circular — must match the shader's `n > 2.001` test.
    static let circularExponent: Float = 2

    struct Resolved: Equatable {
        // Field order TL, TR, BR, BL — the `CornerRadiiValues` order.
        var extentTL: CGFloat = 0
        var extentTR: CGFloat = 0
        var extentBR: CGFloat = 0
        var extentBL: CGFloat = 0
        var shapeTL: Float = ContinuousCorners.circularExponent
        var shapeTR: Float = ContinuousCorners.circularExponent
        var shapeBR: Float = ContinuousCorners.circularExponent
        var shapeBL: Float = ContinuousCorners.circularExponent

        /// The shader's packing, which is NOT the field order:
        /// `.x` = bottom-left, `.y` = bottom-right, `.z` = top-right, `.w` = top-left.
        var extentsSIMD: SIMD4<Float> {
            SIMD4<Float>(Float(extentBL), Float(extentBR), Float(extentTR), Float(extentTL))
        }

        var shapesSIMD: SIMD4<Float> {
            SIMD4<Float>(shapeBL, shapeBR, shapeTR, shapeTL)
        }
    }

    /// Resolves per-corner cell extents and exponents for a rect of `size`.
    ///
    /// Rules (research/05): desired `E = extent * r`; if the two desired extents on an edge
    /// overflow the side, both scale by `side / sum` and a corner takes the min of its two edges'
    /// scales; then a hard cap at `min(halfW, halfH)` keeps every cell inside its quadrant.
    /// `clamped(to:)` guarantees `r_a + r_b <= side`, so the scale never pushes E below r —
    /// `E/r` stays in `[1, extent]` and the exponent blend never extrapolates. At the capsule
    /// limit (E = r) the exponent lands on exactly 2, which is what makes pills keep true
    /// circular ends.
    static func resolve(_ radii: CornerRadiiValues, continuous: Bool, size: CGSize) -> Resolved {
        let r: [CGFloat] = [radii.topLeft, radii.topRight, radii.bottomRight, radii.bottomLeft]
        var extents = r
        var shapes = [Float](repeating: circularExponent, count: 4)

        if continuous, !radii.isZero {
            func edgeScale(_ a: CGFloat, _ b: CGFloat, _ side: CGFloat) -> CGFloat {
                let sum = (a + b) * extent
                return (sum > side && sum > 0) ? side / sum : 1
            }

            let top = edgeScale(r[0], r[1], size.width)
            let bottom = edgeScale(r[3], r[2], size.width)
            let left = edgeScale(r[0], r[3], size.height)
            let right = edgeScale(r[1], r[2], size.height)

            let scale: [CGFloat] = [
                min(top, left),      // TL
                min(top, right),     // TR
                min(bottom, right),  // BR
                min(bottom, left),   // BL
            ]

            let cap = min(size.width, size.height) / 2
            for i in 0..<4 {
                let radius = r[i]
                if radius <= 0 {
                    extents[i] = 0
                    shapes[i] = circularExponent
                    continue
                }
                let e = min(radius * extent * scale[i], cap)
                let blend = min(max((e / radius - 1) / (extent - 1), 0), 1)
                extents[i] = e
                shapes[i] = circularExponent + (fullExponent - circularExponent) * Float(blend)
            }
        }

        return Resolved(
            extentTL: extents[0], extentTR: extents[1], extentBR: extents[2], extentBL: extents[3],
            shapeTL: shapes[0], shapeTR: shapes[1], shapeBR: shapes[2], shapeBL: shapes[3]
        )
    }

    /// The continuous rounded rect as a clockwise contour.
    ///
    /// Corners are sampled from the same superellipse the shader evaluates — a polyline, not the
    /// PaintCode beziers — so path and SDF agree exactly by construction. At `segmentsPerCorner`
    /// steps the chord sagitta stays under ~0.1 px for any extent that fits a phone screen, and
    /// the paths are rebuilt only on geometry change.
    ///
    /// The curve is the superellipse about the corner cell's INNER point: `P(theta) = C +
    /// a*E*(1 - sin^(2/n) theta) + b*E*(1 - cos^(2/n) theta)` for corner point C and unit edge
    /// vectors a (incoming, clockwise) and b (outgoing) — at n = 2 the circular arc. The tempting
    /// "polar" form has the same endpoints but bulges into the shape (an inverse squircle; it
    /// shipped once on Android and stroked a hairline inside the glass).
    static func path(in rect: CGRect, resolved c: Resolved) -> UIBezierPath {
        let path = UIBezierPath()
        let l = rect.minX
        let t = rect.minY
        let r = rect.maxX
        let b = rect.maxY

        path.move(to: CGPoint(x: l + c.extentTL, y: t))
        path.addLine(to: CGPoint(x: r - c.extentTR, y: t))
        corner(path, cx: r, cy: t, ax: -1, ay: 0, bx: 0, by: 1, extent: c.extentTR, n: c.shapeTR)
        path.addLine(to: CGPoint(x: r, y: b - c.extentBR))
        corner(path, cx: r, cy: b, ax: 0, ay: -1, bx: -1, by: 0, extent: c.extentBR, n: c.shapeBR)
        path.addLine(to: CGPoint(x: l + c.extentBL, y: b))
        corner(path, cx: l, cy: b, ax: 1, ay: 0, bx: 0, by: -1, extent: c.extentBL, n: c.shapeBL)
        path.addLine(to: CGPoint(x: l, y: t + c.extentTL))
        corner(path, cx: l, cy: t, ax: 0, ay: 1, bx: 1, by: 0, extent: c.extentTL, n: c.shapeTL)
        path.close()
        return path
    }

    /// One corner: from `C + a*E` to `C + b*E`. `(ax, ay)` points from the corner back along the
    /// incoming edge, `(bx, by)` forward along the outgoing edge, both unit.
    private static func corner(
        _ path: UIBezierPath,
        cx: CGFloat, cy: CGFloat,
        ax: CGFloat, ay: CGFloat,
        bx: CGFloat, by: CGFloat,
        extent: CGFloat,
        n: Float
    ) {
        if extent < minExtent {
            path.addLine(to: CGPoint(x: cx, y: cy))
            return
        }
        let exponent = 2.0 / Double(n)
        for i in 1...segmentsPerCorner {
            let theta = (Double(i) / Double(segmentsPerCorner)) * (Double.pi / 2)
            let ca = CGFloat(1 - pow(sin(theta), exponent))
            let sb = CGFloat(1 - pow(cos(theta), exponent))
            path.addLine(to: CGPoint(
                x: cx + (ax * ca + bx * sb) * extent,
                y: cy + (ay * ca + by * sb) * extent
            ))
        }
    }

    private static let segmentsPerCorner = 32
    private static let minExtent: CGFloat = 0.5
}
