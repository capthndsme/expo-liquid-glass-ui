import type { ColorValue, StyleProp, ViewStyle } from "react-native";

import type {
  TGlassActiveRenderer,
  TGlassCornerStyle,
  TGlassRenderer,
  TGlassVariant,
} from "../types";
import type { IGlassMetalOptions } from "./glass-metal.interface";
import type { IGlassSurfaceProps } from "./glass-surface.interface";

interface IGlassCornerRadii {
  topLeft?: number;
  topRight?: number;
  bottomRight?: number;
  bottomLeft?: number;
}

type TGlassCornerRadius = number | IGlassCornerRadii;

interface ILiquidGlassViewProps extends IGlassSurfaceProps {
  containerStyle?: StyleProp<ViewStyle>;

  /**
   * Which `LiquidGlassProvider` supplies this view's backdrop. Defaults to `"default"`.
   *
   * An **array** composites several providers in order, first at the bottom — the combined
   * backdrop of the nested-layer pattern: `["default", layerId]` makes glass over a glass bar
   * refract the bar *composited over* the content behind it, exactly what the eye sees under
   * the view.
   *
   * **Android only.** iOS captures the whole window, which already is that composite.
   */
  providerId?: string | string[];

  variant?: TGlassVariant;
  renderer?: TGlassRenderer;
  cornerRadius?: TGlassCornerRadius;
  cornerStyle?: TGlassCornerStyle;
  tint?: ColorValue;

  /**
   * System touch response. Defaults to `false`.
   *
   * **iOS 26+**: passed to `UIGlassEffect.isInteractive`; the OS owns the behaviour. **Android**:
   * a native port of it — a spring-driven specular blooms under the finger, the refraction dents
   * and deepens around it, and the view inflates ~3.5 %, translates a little toward the drag and
   * stretches along it, rubber-band style, all off the UI thread's animation stage with no JS per
   * frame.
   * A bare-glass press held over ~150 ms takes the gesture from ancestor scrollers, so dragging
   * the glass does not scroll it away; quick flicks still scroll. Ignored by the iOS Metal
   * renderer, which has no equivalent.
   */
  interactive?: boolean;
  metal?: IGlassMetalOptions;

  /**
   * A press this glass should respond to, driven by the app rather than by its own touches.
   * **Android only** — iOS has no equivalent.
   *
   * `interactive` covers a press *on this view*. This covers the other case: a control the app is
   * choreographing, whose press belongs to some other view. A tab bar whose pill is being dragged
   * is the canonical one — the finger is on the pill, but it is the bar that lights up under it.
   *
   * Setting it takes over the press entirely; `interactive`'s own animator stops reaching the
   * shader until it goes back to `undefined`. And unlike `interactive` it never writes the view's
   * transform, so it composes with a `transform` style instead of fighting it.
   *
   * Cheap enough to animate per frame with Reanimated's `useAnimatedProps` — it re-uploads
   * uniforms and redraws, and touches nothing else.
   */
  glow?: IGlassGlow;

  onRendererChange?: (renderer: TGlassActiveRenderer) => void;
}

interface IGlassGlow {
  /** 0 = at rest, and the effect costs nothing; 1 = fully lit. */
  progress: number;

  /** Hotspot, view-local dp. Both default to the view's centre. */
  x?: number;
  y?: number;

  /**
   * Whether the press also bends the glass — the backdrop dent under the hotspot and the lens
   * boost `interactive` applies. Default `false`: a surface hosting someone else's press should
   * light up, not start refracting harder. Set it when the press really is on this glass and you
   * are only driving it by hand.
   */
  lens?: boolean;
}

export type {
  ILiquidGlassViewProps,
  IGlassCornerRadii,
  IGlassGlow,
  TGlassCornerRadius,
};
