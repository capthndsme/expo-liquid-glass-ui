import ExpoModulesCore

/// `metal.progressiveBlur.direction` — the axis the blur ramp travels along, named for where the
/// blur *increases* toward. `down` is the classic bottom-bar scrim: sharp at the top of the view,
/// melting into blur at its bottom edge. Mirrors Android's `GlassBlurDirection`.
public enum GlassBlurDirection: String, Enumerable {

    case down

    case up

    case left

    case right

    /// Whether the ramp runs along y.
    var vertical: Bool { self == .down || self == .up }

    /// Whether the ramp starts from the far edge of its axis (bottom or right).
    var reversed: Bool { self == .up || self == .left }
}
