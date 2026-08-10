import type { IGlassSurfaceProps } from "./glass-surface.interface";

/**
 * Props for `LiquidGlassStack` — declarative stacked glass.
 *
 * Direct children must be `LiquidGlassStack.Layer` elements, bottom to top. Anything else is
 * dropped with a dev warning.
 */
interface ILiquidGlassStackProps extends IGlassSurfaceProps {}

/**
 * Props for `LiquidGlassStack.Layer`.
 *
 * The first layer is the stack's base content and lays out in normal flow (`flex: 1`) — its
 * `style` must not set `position: "absolute"`, because that view is the flow child of the
 * innermost provider. Every later layer is an overlay: an `absoluteFill` wrap with
 * `pointerEvents="box-none"`, with `style` merged on top.
 */
interface ILiquidGlassStackLayerProps extends IGlassSurfaceProps {}

export type { ILiquidGlassStackProps, ILiquidGlassStackLayerProps };
