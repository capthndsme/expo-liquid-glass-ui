import * as React from "react";
import { memo } from "react";
import { Platform, View } from "react-native";

import { COMPONENT_NAMES, DEFAULT_PROVIDER_ID } from "../../constants";
import type { ILiquidGlassProviderProps } from "../../interfaces";
import { supportsNativeGlass } from "../../utils";
import { NativeLiquidGlassProviderView } from "../../views";

/**
 * Marks the content that should show through the glass.
 *
 * **Android only.** On iOS, web, and Android devices with no glass path this renders a plain
 * `View` and nothing else, so it is safe to wrap unconditionally.
 *
 * Android has no primitive that lets a view sample its siblings' pixels, so the backdrop has to be
 * recorded explicitly. This component records it — and because glass views are its *siblings*
 * rather than its descendants, a glass view can never end up inside its own backdrop.
 *
 * ```tsx
 * <View style={{ flex: 1 }}>
 *   <LiquidGlassProvider style={StyleSheet.absoluteFill}>
 *     <ScrollView>{…}</ScrollView>
 *   </LiquidGlassProvider>
 *
 *   <LiquidGlassView style={styles.panel} />
 * </View>
 * ```
 *
 * A glass view must never sit inside the provider it *reads* — it would refract its own output.
 * Nesting glass inside a **different** provider is the *stacked glass* pattern: the view renders
 * normally, its finished glass is recorded into that provider's backdrop, and glass reading it
 * re-refracts the lower layer. See the README's "Stacked glass" section.
 */
const LiquidGlassProviderBase: React.FC<ILiquidGlassProviderProps> = ({
  children,
  style,
  providerId = DEFAULT_PROVIDER_ID,
}: ILiquidGlassProviderProps): React.ReactNode & React.ReactElement => {
  if (Platform.OS !== "android" || !supportsNativeGlass) {
    return <View style={style}>{children}</View>;
  }

  return (
    <NativeLiquidGlassProviderView providerId={providerId} style={style}>
      {children}
    </NativeLiquidGlassProviderView>
  );
};

LiquidGlassProviderBase.displayName = `${COMPONENT_NAMES.LIQUID_GLASS_PROVIDER}Base`;

const LiquidGlassProvider: React.NamedExoticComponent<ILiquidGlassProviderProps> =
  memo<ILiquidGlassProviderProps>(LiquidGlassProviderBase);

LiquidGlassProvider.displayName = COMPONENT_NAMES.LIQUID_GLASS_PROVIDER;

export { LiquidGlassProvider };
