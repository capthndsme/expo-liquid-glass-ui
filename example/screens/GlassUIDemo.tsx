import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { LiquidGlassProvider } from "expo-liquid-glass-view";
import {
  LiquidGlassButton,
  LiquidGlassSwitch,
  LiquidGlassTabBar,
  LiquidGlassTextInput,
  type LiquidGlassTabIconState,
  type LiquidGlassTabItem,
} from "expo-liquid-glass-ui";
import React, { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

/**
 * The expo-liquid-glass-ui kit — button, switch, tab bar, text input — over a busy stage, with
 * the controls as siblings after the provider per the Android topology rule.
 */

const ion =
  (focused: string, outline: string) =>
  ({ focused: isFocused, color, size }: LiquidGlassTabIconState) => (
    <Ionicons
      name={(isFocused ? focused : outline) as never}
      color={color}
      size={size}
    />
  );

const TAB_ITEMS: LiquidGlassTabItem[] = [
  { key: "home", title: "Home", icon: ion("home", "home-outline") },
  { key: "search", title: "Search", icon: ion("search", "search-outline") },
  { key: "likes", title: "Likes", icon: ion("heart", "heart-outline") },
  { key: "you", title: "You", icon: ion("person", "person-outline") },
];

const CARD_COLORS = ["#FF6B6B", "#FFD93D", "#6BCB77", "#4D96FF", "#B983FF"];

export default function GlassUIDemo(): React.JSX.Element {
  const [tab, setTab] = useState(0);
  const [enabled, setEnabled] = useState(true);
  const [query, setQuery] = useState("");
  const [presses, setPresses] = useState(0);

  return (
    <View style={styles.root}>
      <LiquidGlassProvider style={StyleSheet.absoluteFill}>
        <LinearGradient
          colors={["#20315c", "#101018"]}
          style={StyleSheet.absoluteFill}
        />
        <ScrollView
          contentContainerStyle={styles.stage}
          showsVerticalScrollIndicator={false}
        >
          {Array.from({ length: 14 }, (_, i) => (
            <View
              key={i}
              style={[
                styles.card,
                { backgroundColor: CARD_COLORS[i % CARD_COLORS.length] },
              ]}
            >
              <Text style={styles.cardText}>Stage card {i + 1}</Text>
            </View>
          ))}
        </ScrollView>
      </LiquidGlassProvider>

      <View style={styles.controls} pointerEvents="box-none">
        <LiquidGlassTextInput
          placeholder="Search the stage"
          value={query}
          onChangeText={setQuery}
          leading={<Ionicons name="search" size={18} color="#8E8E93" />}
          style={styles.input}
        />

        <View style={styles.buttonRow} pointerEvents="box-none">
          <LiquidGlassButton onPress={() => setPresses((n) => n + 1)}>
            {presses > 0 ? `Pressed ${presses}` : "Press me"}
          </LiquidGlassButton>
          <LiquidGlassButton
            tint="#0088FFCC"
            onPress={() => setPresses((n) => n + 1)}
          >
            Tinted
          </LiquidGlassButton>
        </View>

        <View style={styles.switchRow} pointerEvents="box-none">
          <Text style={styles.switchLabel}>
            Liquid switch {enabled ? "on" : "off"}
          </Text>
          <LiquidGlassSwitch value={enabled} onValueChange={setEnabled} />
        </View>

        <View style={styles.spacer} pointerEvents="none" />

        <LiquidGlassTabBar
          tabs={TAB_ITEMS}
          selectedIndex={tab}
          onTabSelected={setTab}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#101018",
  },
  stage: {
    paddingTop: 100,
    paddingHorizontal: 24,
    paddingBottom: 160,
    gap: 16,
  },
  card: {
    height: 110,
    borderRadius: 20,
    justifyContent: "flex-end",
    padding: 14,
  },
  cardText: {
    color: "#000000AA",
    fontSize: 15,
    fontWeight: "600",
  },
  controls: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: 108,
    paddingHorizontal: 20,
    paddingBottom: 36,
    gap: 16,
  },
  input: {
    alignSelf: "stretch",
  },
  buttonRow: {
    flexDirection: "row",
    gap: 12,
    justifyContent: "center",
  },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  switchLabel: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "500",
  },
  spacer: {
    flex: 1,
  },
});
