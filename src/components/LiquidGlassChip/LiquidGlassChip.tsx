import * as React from "react";
import { memo } from "react";
import { StyleSheet } from "react-native";

import { CHIP_CONTENT_GAP } from "../../constants";
import type { ILiquidGlassChipProps } from "../../interfaces";
import { useGlassUITheme } from "../../theme";
import { LiquidGlassButton } from "../LiquidGlassButton/LiquidGlassButton";

/**
 * A small selectable capsule — a filter, a tag, a choice. The `small` button with a selected
 * state: selected, it wears the accent as its wash and a white label; unselected it is bare
 * glass (or `tint`). Chips inside a `LiquidGlassGroup` merge into their neighbours when pressed
 * like every other member, which is what a row of them wants.
 */
const LiquidGlassChipBase: React.FC<ILiquidGlassChipProps> = ({
  label,
  icon,
  selected = false,
  onPress,
  disabled = false,
  accentColor,
  tint,
  variant,
  metal,
  providerId,
  style,
  textStyle,
}: ILiquidGlassChipProps): React.ReactElement => {
  const { colors } = useGlassUITheme();
  return (
    <LiquidGlassButton
      size="small"
      tint={selected ? accentColor ?? colors.accent : tint}
      icon={icon}
      onPress={onPress}
      disabled={disabled}
      variant={variant}
      metal={metal}
      providerId={providerId}
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      style={style}
      contentStyle={styles.content}
      textStyle={[styles.label, textStyle]}
    >
      {label}
    </LiquidGlassButton>
  );
};

const styles = StyleSheet.create({
  content: {
    gap: CHIP_CONTENT_GAP,
  },
  label: {
    fontWeight: "500",
  },
});

const LiquidGlassChip: React.NamedExoticComponent<ILiquidGlassChipProps> =
  memo<ILiquidGlassChipProps>(LiquidGlassChipBase);
LiquidGlassChip.displayName = "LiquidGlassChip";

export { LiquidGlassChip };
