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
   * strip and leaves the glyph at `#0088FF`.
   *
   * **Lightens in both schemes**, which is a deliberate departure from the reference: Kyant sinks
   * the light-theme pill with `Color.Black.copy(0.1f)` and lifts the dark-theme one with
   * `Color.White.copy(0.1f)`. Measured on device, sinking it reads as a hole punched through the
   * bar's shade rather than as a selected chip — the pill already shows a slightly cooler, darker
   * image than the bar beside it (it is a 56dp strip against a 64dp one), so a darkening wash
   * compounds a gap instead of creating one. Lifting both makes the selection read the same way
   * in either scheme: raised.
   *
   * The cost is contrast over a very light backdrop, where a white lift on an already
   * white-washed bar has little to work with. Pass `pillTint` to override per app.
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
    tabIndicatorSurface: "rgba(255,255,255,0.20)",
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
    tabIndicatorSurface: "rgba(255,255,255,0.1)",
  },
};

interface IGlassUITheme {
  scheme: "light" | "dark";
  colors: IGlassUIPalette;
}

function useGlassUITheme(): IGlassUITheme {
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  return { scheme, colors: GLASS_UI_PALETTE[scheme] };
}

export { GLASS_UI_PALETTE, useGlassUITheme };
export type { IGlassUIPalette, IGlassUITheme };
