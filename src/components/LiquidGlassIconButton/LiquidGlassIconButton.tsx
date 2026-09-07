import * as React from "react";
import { memo } from "react";

import type { ILiquidGlassIconButtonProps } from "../../interfaces";
import { LiquidGlassButton } from "../LiquidGlassButton/LiquidGlassButton";

/**
 * A circle of glass around one glyph — iOS 26's toolbar button. It is the button with
 * `shape="circle"`: the same jelly, the same press light, the same merge inside a
 * `LiquidGlassGroup`, and an `accessibilityLabel` that is required rather than optional
 * because a circle has no label to read out.
 */
const LiquidGlassIconButtonBase: React.FC<ILiquidGlassIconButtonProps> = ({
  icon,
  ...rest
}: ILiquidGlassIconButtonProps): React.ReactElement => (
  <LiquidGlassButton shape="circle" icon={icon} {...rest} />
);

const LiquidGlassIconButton: React.NamedExoticComponent<ILiquidGlassIconButtonProps> =
  memo<ILiquidGlassIconButtonProps>(LiquidGlassIconButtonBase);
LiquidGlassIconButton.displayName = "LiquidGlassIconButton";

export { LiquidGlassIconButton };
