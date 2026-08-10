import * as React from "react";
import { memo, useCallback } from "react";
import { View } from "react-native";

import { COMPONENT_NAMES } from "../../constants";
import type { ILiquidGlassViewProps } from "../../interfaces";
import type { TGlassActiveRenderer } from "../../types";
import { supportsNativeGlass } from "../../utils";
import { NativeLiquidGlassView } from "../../views";

const LiquidGlassViewBase: React.FC<ILiquidGlassViewProps> = ({
  children,
  containerStyle,
  style,
  onRendererChange,
  ...nativeProps
}: ILiquidGlassViewProps): React.ReactNode & React.ReactElement => {
  const handleRendererChange = useCallback(
    (event: { nativeEvent: { renderer: TGlassActiveRenderer } }): void =>
      onRendererChange?.(event.nativeEvent.renderer),
    [onRendererChange],
  );

  const content: React.ReactNode = children ? (
    <View pointerEvents="box-none" style={containerStyle}>
      {children}
    </View>
  ) : null;

  // No hardware glass path — an unregistered view manager would fail at render, so degrade to a
  // plain view exactly as LiquidGlassContainer already does.
  if (!supportsNativeGlass) {
    return <View style={style}>{content}</View>;
  }

  return (
    <NativeLiquidGlassView
      {...nativeProps}
      style={style}
      onRendererChange={onRendererChange ? handleRendererChange : undefined}
    >
      {content}
    </NativeLiquidGlassView>
  );
};
LiquidGlassViewBase.displayName = `${COMPONENT_NAMES.LIQUID_GLASS_VIEW}Base`;
const LiquidGlassView: React.NamedExoticComponent<ILiquidGlassViewProps> =
  memo<ILiquidGlassViewProps>(LiquidGlassViewBase);

LiquidGlassView.displayName = COMPONENT_NAMES.LIQUID_GLASS_VIEW;

export { LiquidGlassView };
