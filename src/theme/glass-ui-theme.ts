import { useColorScheme } from "react-native";

/**
 * The iOS system palette the reference components use, one set per scheme. Values are plain
 * strings (not `PlatformColor`) because several of them feed `Animated` color interpolation,
 * which only understands parseable color strings.
 */
interface IGlassUIPalette {
  /** System blue — tab bar selection. */
  accent: string;
  /** System green — switch on-state. */
  green: string;
  label: string;
  /** Unselected tab items, secondary content. */
  inactive: string;
  placeholder: string;
  /** Switch track in the off position. */
  switchTrack: string;
  /** Wash drawn over the tab bar's glass. */
  tabBarSurface: string;
  /**
   * The same wash for `variant="clear"` — a hint rather than a scrim, so the glass carries
   * legibility instead of the fill. Roughly a quarter of [tabBarSurface]'s alpha.
   */
  tabBarSurfaceClear: string;
  /**
   * The resting tab indicator's wash, and the only thing separating it from the bar — the pill
   * carries no lens of its own to give it an edge.
   *
   * Painted into the accent layer *beneath* the accent icons, not over the pill's glass. The pill
   * is a window onto that layer, so a film on top of the lens washes the very glyph the lens is
   * displaying: at 20% white it turned `#0088FF` into `#38A0FD`. Recorded underneath, it lifts the
   * strip and leaves the glyph at `#0088FF`. (A pill recipe's `metal.tint` takes the same route —
   * see the tab bar.)
   *
   * **A chip, not a hint.** The first round ran this at 0.20 / 0.10, which on the phone read as a
   * faint lift of the bar's frost rather than a selection — the capsule resolved to whatever the
   * page under it happened to be, and mine-app's iOS build had to paint its own 0.92 ground to
   * hold contrast. The user's call on 2026-09-07 is a resting pill that is *almost always a light
   * white pill*: opaque enough to be a surface in either scheme, still translucent enough that
   * the frost shows through and the grab, which fades it out, reads as the chip going clear.
   *
   * **Lightens in both schemes**, which is a deliberate departure from the reference: Kyant sinks
   * the light-theme pill with `Color.Black.copy(0.1f)` and lifts the dark-theme one with
   * `Color.White.copy(0.1f)`. Measured on device, sinking it reads as a hole punched through the
   * bar's shade rather than as a selected chip — the pill already shows a slightly cooler, darker
   * image than the bar beside it (it is a 56dp strip against a 64dp one), so a darkening wash
   * compounds a gap instead of creating one. Lifting both makes the selection read the same way
   * in either scheme: raised.
   *
   * Pass `pillTint` (or a `pillMetal` with a `tint`) to override per app.
   */
  tabIndicatorSurface: string;
}

const GLASS_UI_PALETTE: Record<"light" | "dark", IGlassUIPalette> = {
  light: {
    accent: "#0088FF",
    green: "#34C759",
    label: "#000000",
    inactive: "rgba(60,60,67,0.6)",
    placeholder: "rgba(60,60,67,0.6)",
    switchTrack: "rgba(120,120,120,0.2)",
    // Tuned on device: the light pair needs a hair more of both washes than the dark one to
    // hold the same separation.
    tabBarSurface: "rgba(250,250,250,0.42)",
    tabBarSurfaceClear: "rgba(250,250,250,0.10)",
    tabIndicatorSurface: "rgba(255,255,255,0.55)",
  },
  dark: {
    accent: "#0091FF",
    green: "#30D158",
    label: "#FFFFFF",
    inactive: "rgba(235,235,245,0.6)",
    placeholder: "rgba(235,235,245,0.6)",
    switchTrack: "rgba(120,120,128,0.36)",
    tabBarSurface: "rgba(18,18,18,0.4)",
    tabBarSurfaceClear: "rgba(18,18,18,0.12)",
    tabIndicatorSurface: "rgba(255,255,255,0.30)",
  },
};

interface IGlassUITheme {
  scheme: "light" | "dark";
  colors: IGlassUIPalette;
}

/**
 * The palette for the OS colour scheme — or, given `override`, for a scheme the caller chose.
 * Adaptive glass passes the polarity the backdrop settled on: dark content wants the dark
 * palette's light label over its dark frost, whatever the OS setting says.
 */
function useGlassUITheme(override?: "light" | "dark"): IGlassUITheme {
  const system = useColorScheme() === "dark" ? "dark" : "light";
  const scheme = override ?? system;
  return { scheme, colors: GLASS_UI_PALETTE[scheme] };
}

export { GLASS_UI_PALETTE, useGlassUITheme };
export type { IGlassUIPalette, IGlassUITheme };
