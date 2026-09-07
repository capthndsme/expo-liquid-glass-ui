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
   * **iOS 26+**: passed to `UIGlassEffect.isInteractive`; the OS owns the behaviour. **Android
   * and the iOS Metal renderer (iOS below 26)**: a native port of it, the same springs on both —
   * a spring-driven specular blooms under the finger, the refraction dents and deepens around it,
   * and the glass inflates ~3.5 %, translates a little toward the drag and stretches along it,
   * rubber-band style, all off the platform's animation stage with no JS per frame. On Android a
   * bare-glass press held over ~150 ms takes the gesture from ancestor scrollers, so dragging the
   * glass does not scroll it away; quick flicks still scroll. On iOS an ancestor recogniser
   * taking the touch releases the press like a lift.
   */
  interactive?: boolean;
  metal?: IGlassMetalOptions;

  /**
   * A press this glass should respond to, driven by the app rather than by its own touches.
   * Shader renderers — Android and the iOS Metal renderer; iOS 26's native glass ignores it.
   *
   * `interactive` covers a press *on this view*. This covers the other case: a control the app is
   * choreographing, whose press belongs to some other view. A tab bar whose pill is being dragged
   * is the canonical one — the finger is on the pill, but it is the bar that lights up under it.
   *
   * Setting it takes over the press uniforms entirely; `interactive`'s own animator stops reaching
   * the shader until it goes back to `undefined`. And unlike `interactive` it never writes the
   * view's transform, so it composes with a `transform` style instead of fighting it.
   *
   * Cheap enough to animate per frame with Reanimated's `useAnimatedProps` — it re-uploads
   * uniforms and redraws, and touches nothing else.
   */
  glow?: IGlassGlow;

  /**
   * Adaptive glass. Defaults to `false`.
   *
   * On, the shader renderers (Android, and iOS below 26) read the mean luminance of the backdrop
   * under the view — Android renders the provider content into an 8×8 probe off the RenderThread,
   * iOS samples the capture it already holds — at most four times a second and only when the
   * backdrop or the view moved. Two things follow from it: the frost's polarity tracks the
   * backdrop instead of the colour scheme (dark content under a dark frost, light under a light
   * one, with hysteresis at 0.45 / 0.55 and a 350 ms crossfade), and `onBackdropLuminance` fires
   * so the content *on* the glass can flip to match — which is what `useAdaptiveGlass` and the
   * kit's `adaptive` props do. iOS 26's native glass adapts on its own and ignores this.
   */
  adaptive?: boolean;

  /**
   * The adaptive sensor's reading: the backdrop's mean luminance under the view, `0`–`1` in sRGB
   * gamma space, and the polarity the glass has settled on. Fires when the value has moved by at
   * least 0.02 or the polarity flipped; requires `adaptive`.
   */
  onBackdropLuminance?: (reading: IGlassLuminanceReading) => void;

  onRendererChange?: (renderer: TGlassActiveRenderer) => void;
}

interface IGlassLuminanceReading {
  /** Mean luminance of the backdrop under the glass, `0` (black) to `1` (white). */
  luminance: number;
  /** Whether the glass has settled on the dark polarity — a dark frost, wanting light content. */
  dark: boolean;
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
  IGlassLuminanceReading,
  TGlassCornerRadius,
};
