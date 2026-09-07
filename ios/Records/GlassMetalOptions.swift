import ExpoModulesCore

// Mirrors `src/core/interfaces/glass-metal.interface.ts` and the Android
// `records/GlassRecords.kt`. Every field is optional so "not supplied" stays distinguishable
// from a supplied value — the per-variant defaults apply only to fields the caller left out.

public struct GlassRefractionOptions: Record {

    @Field public var amount: Double?

    @Field public var width: Double?

    @Field public var height: Double?

    @Field public var depth: Double?

    /// How far the edge refraction leans toward the highlight's light axis, unitless like
    /// `depth`. Default 0 — measured real iOS 26 carries no lean. Clamped to [-1, 1].
    @Field public var swirl: Double?

    @Field public var curve: GlassRefractionCurve?

    public init() {}
}

public struct GlassDispersionOptions: Record {

    @Field public var amount: Double?

    @Field public var reach: Double?

    /// How much of the fringe follows Kyant's quadrant weighting, 0..1. Default 0 — an even rim
    /// fringe the whole way round.
    @Field public var quadrant: Double?

    public init() {}
}

public struct GlassHighlightOptions: Record {

    @Field public var intensity: Double?

    /// Degrees, screen-space with y increasing downward.
    @Field public var angle: Double?

    /// Depth of the glass border light, points. Default 0.75.
    @Field public var width: Double?

    /// Angular falloff exponent of the two light lobes. Default 1; floored at 0.01.
    @Field public var falloff: Double?

    public init() {}
}

public struct GlassBorderOptions: Record {

    @Field public var width: Double?

    @Field public var opacity: Double?

    public init() {}
}

public struct GlassProgressiveBlurOptions: Record {

    @Field public var startRadius: Double?

    @Field public var endRadius: Double?

    @Field public var direction: GlassBlurDirection?

    @Field public var start: Double?

    @Field public var end: Double?

    public init() {}
}

public struct GlassShapeOptions: Record {

    @Field public var x: Double?

    @Field public var y: Double?

    @Field public var width: Double?

    @Field public var height: Double?

    public init() {}
}

public struct GlassMorphOptions: Record {

    @Field public var x: Double?

    @Field public var y: Double?

    @Field public var width: Double?

    @Field public var height: Double?

    @Field public var cornerRadius: Double?

    @Field public var smoothing: Double?

    public init() {}
}

/// The inner shadow: a soft dark band along the inside of the silhouette, the shape minus itself
/// translated by the offset and blurred by the radius (Kyant's `InnerShadow`). `radius` 0 is off.
public struct GlassInnerShadowOptions: Record {

    /// Blur radius, points. 0 disables.
    @Field public var radius: Double?

    /// Where the shadow is cast, points. Defaults: x 0, y = radius — lit from above, so the
    /// pane's top lip shades the top inner edge.
    @Field public var offsetX: Double?

    @Field public var offsetY: Double?

    /// Strength of the (black) shadow, 0..1. Default 0.15.
    @Field public var opacity: Double?

    public init() {}
}

/// A press that happened somewhere else — the app-choreographed twin of `interactive`. The bar
/// hosting a dragged pill is the canonical case: the finger is on the pill, the bar lights up.
/// Non-nil takes over the press uniforms entirely; `interactive`'s own animator stops reaching
/// the shader until it goes back to nil. Never touches the view's transform.
public struct GlassGlowOptions: Record {

    /// 0 = at rest and the shader's branch is off; 1 = fully lit.
    @Field public var progress: Double = 0

    /// Hotspot, view-local points. Both default to the view's centre.
    @Field public var x: Double?

    @Field public var y: Double?

    /// Whether the press also bends the glass — the backdrop dent and the lens boost. Default
    /// false: a surface hosting someone else's press should light up, not refract harder.
    @Field public var lens: Bool = false

    public init() {}
}

public struct GlassMetalOptions: Record {

    @Field public var blurRadius: Double?
    @Field public var captureQuality: Double?
    @Field public var opacity: Double?

    @Field public var frost: Double?
    @Field public var saturation: Double?
    @Field public var noise: Double?
    @Field public var light: Double?

    /// A whole-surface lens: the backdrop reads enlarged through the pane, contracting toward
    /// the shape's center. 1 = none; clamped to [1, 4].
    @Field public var magnification: Double?

    @Field public var refraction: GlassRefractionOptions?
    @Field public var dispersion: GlassDispersionOptions?
    @Field public var highlight: GlassHighlightOptions?
    @Field public var border: GlassBorderOptions?
    @Field public var innerShadow: GlassInnerShadowOptions?
    @Field public var shape: GlassShapeOptions?
    @Field public var morph: GlassMorphOptions?
    @Field public var progressiveBlur: GlassProgressiveBlurOptions?

    public init() {}
}
