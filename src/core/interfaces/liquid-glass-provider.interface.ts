import type { IGlassSurfaceProps } from "./glass-surface.interface";

interface ILiquidGlassProviderProps extends IGlassSurfaceProps {
  /**
   * Pairs this provider with the `LiquidGlassView`s that read its backdrop. Defaults to
   * `"default"` on both sides, so a single provider needs no explicit id.
   *
   * Pairing is explicit rather than inferred from the view hierarchy on purpose: a hierarchy walk
   * is what broke `expo-blur` inside `Modal`, because a `Modal` is a separate window.
   */
  providerId?: string;
}

export type { ILiquidGlassProviderProps };
