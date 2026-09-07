import type { TGlassActiveRenderer } from "../types";
import type {
  IGlassLuminanceReading,
  ILiquidGlassViewProps,
} from "./liquid-glass-view.interface";

interface INativeLiquidGlassViewProps extends Omit<
  ILiquidGlassViewProps,
  "containerStyle" | "onRendererChange" | "onBackdropLuminance" | "providerId"
> {
  /** A single id on the wire; the JS component routes arrays to `providerIds`. */
  providerId?: string;
  providerIds?: string[];
  onRendererChange?: (event: {
    nativeEvent: { renderer: TGlassActiveRenderer };
  }) => void;
  onBackdropLuminance?: (event: { nativeEvent: IGlassLuminanceReading }) => void;
}
export type { INativeLiquidGlassViewProps };
