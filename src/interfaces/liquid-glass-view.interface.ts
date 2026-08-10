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
   * **Android only.** iOS captures the whole window and ignores this.
   */
  providerId?: string;

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
   * stretches with its velocity, all off the UI thread's animation stage with no JS per frame.
   * A bare-glass press held over ~150 ms takes the gesture from ancestor scrollers, so dragging
   * the glass does not scroll it away; quick flicks still scroll. Ignored by the iOS Metal
   * renderer, which has no equivalent.
   */
  interactive?: boolean;
  metal?: IGlassMetalOptions;
  onRendererChange?: (renderer: TGlassActiveRenderer) => void;
}
export type { ILiquidGlassViewProps, IGlassCornerRadii, TGlassCornerRadius };
