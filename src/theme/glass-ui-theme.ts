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
   * Wash drawn over the tab indicator's glass. Always the *opposite* polarity to
   * [tabBarSurface] — dark mode gets a dark bar under a light pill, light mode a light bar under
   * a dark pill. The resting pill carries no lens to give it an edge, so the wash is the only
   * thing separating it from the bar; matching polarities make it disappear.
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
    tabIndicatorSurface: "rgba(0,0,0,0.12)",
  },
  dark: {
    accent: "#0091FF",
    green: "#30D158",
    label: "#FFFFFF",
    inactive: "rgba(235,235,245,0.6)",
    placeholder: "rgba(235,235,245,0.6)",
    switchTrack: "rgba(120,120,128,0.36)",
    tabBarSurface: "rgba(18,18,18,0.4)",
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
