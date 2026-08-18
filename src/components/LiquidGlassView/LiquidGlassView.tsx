import * as React from "react";
import { forwardRef, memo, useCallback, useContext } from "react";
import type { View as RNView } from "react-native";
import { Platform, processColor, View } from "react-native";

import { COMPONENT_NAMES } from "../../constants";
import { GlassStackProviderContext } from "../../context";
import type { ILiquidGlassViewProps } from "../../interfaces";
import type { TGlassActiveRenderer } from "../../types";
import { supportsNativeGlass } from "../../utils";
import { NativeLiquidGlassView } from "../../views";

const LiquidGlassViewBase = forwardRef<RNView, ILiquidGlassViewProps>(
  (
    {
      children,
      containerStyle,
      style,
      onRendererChange,
      providerId,
      tint,
      ...nativeProps
    }: ILiquidGlassViewProps,
    ref: React.ForwardedRef<RNView>,
  ): React.ReactElement => {
    // Inside a LiquidGlassStack layer, the stack supplies the id of the provider recording
    // everything below that layer. An explicit prop always wins; `undefined` outside any stack
    // falls through to the native default. An array is a combined backdrop and rides the
    // `providerIds` wire prop instead.
    const stackProviderId = useContext(GlassStackProviderContext);
    const resolvedProviderId = providerId ?? stackProviderId;
    const singleProviderId = Array.isArray(resolvedProviderId)
      ? undefined
      : resolvedProviderId;
    const combinedProviderIds = Array.isArray(resolvedProviderId)
      ? resolvedProviderId
      : undefined;
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
      return (
        <View ref={ref} style={style}>
          {content}
        </View>
      );
    }

    // Android declares `tint` as an Int and expects a processed colour. Expo's `Color` converter,
    // which iOS uses, rejects `rgba()` and `PlatformColor` and mis-reads `#RRGGBBAA` as `#AARRGGBB`
    // — so the platforms genuinely need different wire formats here.
    const nativeTint =
      Platform.OS === "android" ? (processColor(tint) ?? undefined) : tint;

    return (
      <NativeLiquidGlassView
        {...nativeProps}
        ref={ref}
        providerId={singleProviderId}
        providerIds={combinedProviderIds}
        tint={nativeTint as ILiquidGlassViewProps["tint"]}
        style={style}
        onRendererChange={onRendererChange ? handleRendererChange : undefined}
      >
        {content}
      </NativeLiquidGlassView>
    );
  },
);
LiquidGlassViewBase.displayName = `${COMPONENT_NAMES.LIQUID_GLASS_VIEW}Base`;

/**
 * The ref is forwarded to the native view so this component can be wrapped in Reanimated's
 * `createAnimatedComponent` and driven by `useAnimatedProps` — which is the only way to animate
 * `metal` or `glow` at display rate, since both change every frame of a gesture and neither can
 * wait on a React render.
 *
 * One caveat comes with that: animated props are written straight to the native view, so they skip
 * the `providerId` array handling and the `processColor` above. Animate `metal` and `glow` freely;
 * keep `providerId` and `tint` on the component itself.
 */
const LiquidGlassView: React.NamedExoticComponent<
  ILiquidGlassViewProps & React.RefAttributes<RNView>
> = memo(LiquidGlassViewBase);

LiquidGlassView.displayName = COMPONENT_NAMES.LIQUID_GLASS_VIEW;

export { LiquidGlassView };
