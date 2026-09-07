import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import {
  GLASS_BUTTON_METAL,
  GLASS_PILL_DRAGGED_METAL,
  GLASS_PILL_METAL,
  LiquidGlassButton,
  LiquidGlassGroup,
  LiquidGlassProvider,
  LiquidGlassTabBar,
  LiquidGlassView,
  type LiquidGlassButtonIconState,
  type LiquidGlassTabIconState,
  type LiquidGlassTabItem,
} from "expo-liquid-glass-ui";
import React, { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

/**
 * `metal.tint` on the stage — the wash that lives in a recipe, so it crossfades with everything
 * else the recipe animates. Two tab bars (a blue pill through and through, and one that only
 * colours in the hand), a button row tinted both ways, and plain glass with a recipe tint.
 *
 * Kept off the ui kit tab on purpose: nothing in the kit is tinted by default, and the kit tab
 * shows the defaults. The thing to look at on the pills is the active glyph — the bar paints a
 * pill tint *beneath* it, so a blue pill does not swallow its own icon.
 */

const ion =
  (focused: string, outline: string) =>
  ({ focused: isFocused, color, size }: LiquidGlassTabIconState) =>
    (
      <Ionicons
        name={(isFocused ? focused : outline) as never}
        color={color}
        size={size}
      />
    );

const glyph =
  (name: string) =>
  ({ color, size }: LiquidGlassButtonIconState) =>
    <Ionicons name={name as never} color={color} size={size} />;

const TAB_ITEMS: LiquidGlassTabItem[] = [
  { key: "home", title: "Home", icon: ion("home", "home-outline") },
  { key: "search", title: "Search", icon: ion("search", "search-outline") },
  { key: "likes", title: "Likes", icon: ion("heart", "heart-outline") },
  { key: "you", title: "You", icon: ion("person", "person-outline") },
];

/** A blue pill at rest and a deeper blue in the hand; the accent goes white to sit on it. */
const BLUE_PILL_REST = { ...GLASS_PILL_METAL, tint: "#0088FFB3" };
const BLUE_PILL_HELD = { ...GLASS_PILL_DRAGGED_METAL, tint: "#0088FFE0" };
/** The kit's default at rest, warm only while grabbed — the crossfade on its own. */
const WARM_PILL_HELD = { ...GLASS_PILL_DRAGGED_METAL, tint: "#FF9F0AB3" };
/** The recipe route to a coloured button; `tint` on the button itself is the other. */
const RED_BUTTON = { ...GLASS_BUTTON_METAL, tint: "#FF3B30CC" };

const CARD_COLORS = ["#FF6B6B", "#FFD93D", "#6BCB77", "#4D96FF", "#B983FF"];

export default function TintDemo(): React.JSX.Element {
  const [blue, setBlue] = useState(1);
  const [warm, setWarm] = useState(2);
  const [status, setStatus] = useState("drag a pill");

  return (
    <View style={styles.root}>
      {/* The provider gets a single child — its native view hosts one subtree cleanly. */}
      <LiquidGlassProvider style={StyleSheet.absoluteFill}>
        <View style={styles.scroll}>
          <LinearGradient
            colors={["#2d5a8a", "#7a3b5e", "#101018"]}
            style={StyleSheet.absoluteFill}
          />
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.stage}
            showsVerticalScrollIndicator={false}
          >
            {Array.from({ length: 12 }, (_, i) => (
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
        </View>
      </LiquidGlassProvider>

      <ScrollView
        style={StyleSheet.absoluteFill}
        contentContainerStyle={styles.controls}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.status}>{status}</Text>

        <Section title="Blue pill · pillMetal + pillDraggedMetal tint, white accent">
          <LiquidGlassTabBar
            tabs={TAB_ITEMS}
            selectedIndex={blue}
            onTabSelected={(index) => {
              setBlue(index);
              setStatus(`blue pill → ${TAB_ITEMS[index].title}`);
            }}
            accentColor="#FFFFFF"
            pillMetal={BLUE_PILL_REST}
            pillDraggedMetal={BLUE_PILL_HELD}
          />
        </Section>

        <Section title="Warm in the hand · pillDraggedMetal tint only">
          <LiquidGlassTabBar
            tabs={TAB_ITEMS}
            selectedIndex={warm}
            onTabSelected={(index) => {
              setWarm(index);
              setStatus(`warm pill → ${TAB_ITEMS[index].title}`);
            }}
            pillDraggedMetal={WARM_PILL_HELD}
          />
        </Section>

        <Section title="Buttons · the tint prop, and the recipe's">
          <LiquidGlassGroup>
            <LiquidGlassButton
              tint="#0088FFCC"
              icon={glyph("cart")}
              onPress={() => setStatus("tint prop")}
            >
              Prop
            </LiquidGlassButton>
            <LiquidGlassButton
              metal={RED_BUTTON}
              icon={glyph("flame")}
              onPress={() => setStatus("metal.tint")}
            >
              Recipe
            </LiquidGlassButton>
            <LiquidGlassButton onPress={() => setStatus("untinted")}>
              Plain
            </LiquidGlassButton>
          </LiquidGlassGroup>
        </Section>

        <Section title="Glass · metal.tint on the view">
          <View style={styles.row}>
            <LiquidGlassView
              cornerRadius={20}
              metal={{ tint: "#34C759AA" }}
              style={styles.swatch}
              containerStyle={styles.swatchContent}
            >
              <Text style={styles.label}>recipe</Text>
            </LiquidGlassView>
            <LiquidGlassView
              cornerRadius={20}
              tint="#AF52DEAA"
              style={styles.swatch}
              containerStyle={styles.swatchContent}
            >
              <Text style={styles.label}>prop</Text>
            </LiquidGlassView>
            <LiquidGlassView
              cornerRadius={20}
              tint="#AF52DEAA"
              metal={{ tint: "#34C759AA" }}
              style={styles.swatch}
              containerStyle={styles.swatchContent}
            >
              <Text style={styles.label}>both</Text>
              <Text style={styles.sublabel}>recipe wins</Text>
            </LiquidGlassView>
          </View>
        </Section>
      </ScrollView>
    </View>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#101018",
  },
  scroll: {
    flex: 1,
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
    paddingTop: 104,
    paddingHorizontal: 20,
    paddingBottom: 140,
    gap: 20,
  },
  status: {
    color: "#FFFFFFB0",
    fontSize: 12,
    fontWeight: "600",
    textAlign: "center",
  },
  section: {
    gap: 12,
  },
  sectionTitle: {
    color: "#FFFFFFA0",
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginTop: 4,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  swatch: {
    flex: 1,
    height: 96,
  },
  swatchContent: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "600",
  },
  sublabel: {
    color: "#FFFFFFB0",
    fontSize: 11,
    fontWeight: "500",
  },
});
