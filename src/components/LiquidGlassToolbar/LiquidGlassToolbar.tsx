import * as React from "react";
import { memo } from "react";
import { StyleSheet, Text, View } from "react-native";

import { GLASS_BUTTON_METAL, TOOLBAR_HEIGHT } from "../../constants";
import { LiquidGlassView } from "../../core";
import type { ILiquidGlassToolbarProps } from "../../interfaces";
import { useGlassUITheme } from "../../theme";
import { LiquidGlassGroup } from "../LiquidGlassGroup/LiquidGlassGroup";

/**
 * iOS 26's floating navigation row: controls at either end that merge when pressed, and a title
 * between them in a capsule of its own. Nothing spans the width — each end is a
 * `LiquidGlassGroup` of icon buttons, and the title floats, so the content behind shows between
 * them. Touches outside the capsules pass through.
 *
 * ```tsx
 * <LiquidGlassToolbar
 *   title="Library"
 *   leading={<LiquidGlassIconButton icon={back} accessibilityLabel="Back" onPress={goBack} />}
 *   trailing={<>
 *     <LiquidGlassIconButton icon={search} accessibilityLabel="Search" />
 *     <LiquidGlassIconButton icon={more} accessibilityLabel="More" />
 *   </>}
 * />
 * ```
 */
const LiquidGlassToolbarBase: React.FC<ILiquidGlassToolbarProps> = ({
  title,
  leading,
  trailing,
  spacing,
  gap,
  height = TOOLBAR_HEIGHT,
  tint,
  variant,
  metal,
  providerId,
  style,
  titleStyle,
}: ILiquidGlassToolbarProps): React.ReactElement => {
  const { colors } = useGlassUITheme();

  const titleNode =
    typeof title === "string" ? (
      <LiquidGlassView
        variant={variant}
        providerId={providerId}
        cornerRadius={height / 2}
        cornerStyle="continuous"
        tint={tint ?? colors.tabBarSurface}
        metal={metal ?? GLASS_BUTTON_METAL}
        style={{ height }}
        containerStyle={styles.titleCapsule}
      >
        <Text
          numberOfLines={1}
          style={[styles.title, { color: colors.label }, titleStyle]}
        >
          {title}
        </Text>
      </LiquidGlassView>
    ) : (
      title
    );

  return (
    <View pointerEvents="box-none" style={[styles.row, { height }, style]}>
      <View pointerEvents="box-none" style={styles.end}>
        {leading != null ? (
          <LiquidGlassGroup spacing={spacing} gap={gap} providerId={providerId}>
            {leading}
          </LiquidGlassGroup>
        ) : null}
      </View>
      <View pointerEvents="box-none" style={styles.middle}>
        {titleNode}
      </View>
      <View pointerEvents="box-none" style={[styles.end, styles.trailing]}>
        {trailing != null ? (
          <LiquidGlassGroup spacing={spacing} gap={gap} providerId={providerId}>
            {trailing}
          </LiquidGlassGroup>
        ) : null}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
  },
  end: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
  },
  trailing: {
    justifyContent: "flex-end",
  },
  middle: {
    flexShrink: 1,
    alignItems: "center",
    paddingHorizontal: 8,
  },
  titleCapsule: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 18,
  },
  title: {
    fontSize: 17,
    fontWeight: "600",
  },
});

const LiquidGlassToolbar: React.NamedExoticComponent<ILiquidGlassToolbarProps> =
  memo<ILiquidGlassToolbarProps>(LiquidGlassToolbarBase);
LiquidGlassToolbar.displayName = "LiquidGlassToolbar";

export { LiquidGlassToolbar };
