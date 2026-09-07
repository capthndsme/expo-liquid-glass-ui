import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import {
  LiquidGlassButton,
  LiquidGlassCard,
  LiquidGlassChip,
  LiquidGlassGroup,
  LiquidGlassIconButton,
  LiquidGlassProvider,
  LiquidGlassSegmentedControl,
  LiquidGlassSheet,
  LiquidGlassSlider,
  LiquidGlassStepper,
  LiquidGlassSwitch,
  LiquidGlassTabBar,
  LiquidGlassTextInput,
  LiquidGlassToast,
  LiquidGlassToolbar,
  type LiquidGlassButtonIconState,
  type LiquidGlassTabIconState,
  type LiquidGlassTabItem,
} from "expo-liquid-glass-ui";
import React, { useCallback, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

/**
 * The expo-liquid-glass-ui kit, every control on one busy stage: a toolbar whose ends merge,
 * button rows that fuse into their neighbours when pressed (`LiquidGlassGroup`), icon buttons,
 * chips, a stepper, the switch, slider and segmented control, a card, a toast and a sheet — with
 * the controls as siblings after the provider per the Android topology rule.
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

const CARD_COLORS = ["#FF6B6B", "#FFD93D", "#6BCB77", "#4D96FF", "#B983FF"];
const CHIPS = ["All", "Photos", "Videos", "Live", "Favourites"];

export default function GlassUIDemo(): React.JSX.Element {
  const [tab, setTab] = useState(0);
  const [enabled, setEnabled] = useState(true);
  const [query, setQuery] = useState("");
  const [presses, setPresses] = useState(0);
  const [status, setStatus] = useState("press things");
  const [chips, setChips] = useState<Set<string>>(() => new Set(["All"]));
  const [count, setCount] = useState(3);
  const [level, setLevel] = useState(0.4);
  const [segment, setSegment] = useState(0);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState(false);
  const [sheet, setSheet] = useState(false);

  const note = useCallback((text: string): void => setStatus(text), []);

  const toggleChip = useCallback((label: string): void => {
    setChips((current) => {
      const next = new Set(current);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }, []);

  const simulateLoad = useCallback((): void => {
    setLoading(true);
    setTimeout(() => setLoading(false), 1400);
  }, []);

  return (
    <View style={styles.root}>
      {/* The provider gets a single child — its native view hosts one subtree cleanly. */}
      <LiquidGlassProvider style={StyleSheet.absoluteFill}>
        <View style={styles.scroll}>
          <LinearGradient
            colors={["#20315c", "#101018"]}
            style={StyleSheet.absoluteFill}
          />
          <ScrollView
            style={styles.scroll}
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
        </View>
      </LiquidGlassProvider>

      <ScrollView
        style={StyleSheet.absoluteFill}
        contentContainerStyle={styles.controls}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <LiquidGlassToolbar
          title="UI kit"
          leading={
            <LiquidGlassIconButton
              icon={glyph("chevron-back")}
              accessibilityLabel="Back"
              onPress={() => note("back")}
            />
          }
          trailing={
            <>
              <LiquidGlassIconButton
                icon={glyph("search")}
                accessibilityLabel="Search"
                onPress={() => note("search")}
              />
              <LiquidGlassIconButton
                icon={glyph("ellipsis-horizontal")}
                accessibilityLabel="More"
                onPress={() => note("more")}
              />
            </>
          }
        />

        <Text style={styles.status}>{status}</Text>

        <LiquidGlassTextInput
          placeholder="Search the stage"
          value={query}
          onChangeText={setQuery}
          leading={<Ionicons name="search" size={18} color="#8E8E93" />}
          style={styles.input}
        />

        <Section title="Buttons — press one, it fuses into its neighbour">
          <LiquidGlassGroup style={styles.center}>
            <LiquidGlassButton
              onPress={() => {
                setPresses((n) => n + 1);
                note("pressed");
              }}
            >
              {presses > 0 ? `Pressed ${presses}` : "Press me"}
            </LiquidGlassButton>
            <LiquidGlassButton
              tint="#0088FFCC"
              icon={glyph("sparkles")}
              onPress={() => note("tinted")}
            >
              Tinted
            </LiquidGlassButton>
          </LiquidGlassGroup>

          <LiquidGlassGroup style={styles.center}>
            <LiquidGlassButton size="small" onPress={() => note("small")}>
              Small
            </LiquidGlassButton>
            <LiquidGlassButton
              size="regular"
              loading={loading}
              onPress={() => {
                simulateLoad();
                note("loading…");
              }}
            >
              Loading
            </LiquidGlassButton>
            <LiquidGlassButton size="large" onPress={() => note("large")}>
              Large
            </LiquidGlassButton>
          </LiquidGlassGroup>

          <LiquidGlassGroup style={styles.center}>
            <LiquidGlassIconButton
              icon={glyph("heart")}
              accessibilityLabel="Like"
              onPress={() => note("like")}
            />
            <LiquidGlassIconButton
              icon={glyph("share-outline")}
              accessibilityLabel="Share"
              onPress={() => note("share")}
            />
            <LiquidGlassIconButton
              icon={glyph("bookmark-outline")}
              accessibilityLabel="Save"
              onPress={() => note("save")}
            />
            <LiquidGlassIconButton
              tint="#FF3B30CC"
              icon={glyph("trash-outline")}
              accessibilityLabel="Delete"
              onPress={() => note("delete")}
            />
          </LiquidGlassGroup>
        </Section>

        <Section title="Chips">
          <LiquidGlassGroup gap={8} style={styles.wrap}>
            {CHIPS.map((label) => (
              <LiquidGlassChip
                key={label}
                label={label}
                icon={label === "Favourites" ? glyph("star") : undefined}
                selected={chips.has(label)}
                onPress={() => {
                  toggleChip(label);
                  note(`chip ${label}`);
                }}
              />
            ))}
          </LiquidGlassGroup>
        </Section>

        <Section title="Stepper · switch">
          <View style={styles.row}>
            <LiquidGlassStepper
              value={count}
              onValueChange={(next) => {
                setCount(next);
                note(`count ${next}`);
              }}
              minimumValue={0}
              maximumValue={12}
            />
            <View style={styles.spacer} />
            <Text style={styles.label}>{enabled ? "on" : "off"}</Text>
            <LiquidGlassSwitch value={enabled} onValueChange={setEnabled} />
          </View>
        </Section>

        <Section title="Slider · segmented">
          <LiquidGlassSlider value={level} onValueChange={setLevel} />
          <LiquidGlassSegmentedControl
            segments={["Day", "Week", "Month"]}
            selectedIndex={segment}
            onChange={setSegment}
          />
        </Section>

        <Section title="Card · toast · sheet">
          <LiquidGlassCard onPress={() => note("card")}>
            <Text style={styles.cardTitle}>A glass card</Text>
            <Text style={styles.cardBody}>
              The bar's material under the scheme's wash. Tap it — it presses
              like the reference, a whisper.
            </Text>
          </LiquidGlassCard>
          <LiquidGlassGroup style={styles.center}>
            <LiquidGlassButton
              icon={glyph("notifications-outline")}
              onPress={() => setToast(true)}
            >
              Toast
            </LiquidGlassButton>
            <LiquidGlassButton
              icon={glyph("chevron-up")}
              onPress={() => setSheet(true)}
            >
              Sheet
            </LiquidGlassButton>
          </LiquidGlassGroup>
        </Section>
      </ScrollView>

      <View style={styles.tabBarHost} pointerEvents="box-none">
        <LiquidGlassTabBar
          tabs={TAB_ITEMS}
          selectedIndex={tab}
          onTabSelected={setTab}
        />
      </View>

      <LiquidGlassToast
        visible={toast}
        message="Saved to your library"
        icon={glyph("checkmark-circle")}
        onDismiss={() => setToast(false)}
        // Below the example's own tab switcher, which sits at the top of every screen.
        offset={104}
      />

      <LiquidGlassSheet
        visible={sheet}
        onDismiss={() => setSheet(false)}
        height={380}
      >
        <Text style={styles.sheetTitle}>Share to</Text>
        <LiquidGlassGroup style={styles.center}>
          <LiquidGlassIconButton
            icon={glyph("logo-apple")}
            accessibilityLabel="AirDrop"
            onPress={() => note("airdrop")}
          />
          <LiquidGlassIconButton
            icon={glyph("chatbubble-outline")}
            accessibilityLabel="Messages"
            onPress={() => note("messages")}
          />
          <LiquidGlassIconButton
            icon={glyph("mail-outline")}
            accessibilityLabel="Mail"
            onPress={() => note("mail")}
          />
          <LiquidGlassIconButton
            icon={glyph("link-outline")}
            accessibilityLabel="Copy link"
            onPress={() => note("link")}
          />
        </LiquidGlassGroup>
        <View style={styles.spacer} />
        <LiquidGlassButton size="large" onPress={() => setSheet(false)}>
          Done
        </LiquidGlassButton>
      </LiquidGlassSheet>
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
    gap: 16,
  },
  status: {
    color: "#FFFFFFB0",
    fontSize: 12,
    fontWeight: "600",
    textAlign: "center",
  },
  input: {
    alignSelf: "stretch",
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
  center: {
    justifyContent: "center",
  },
  wrap: {
    flexWrap: "wrap",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  spacer: {
    flex: 1,
  },
  label: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "500",
  },
  cardTitle: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "700",
    marginBottom: 4,
  },
  cardBody: {
    color: "#FFFFFFCC",
    fontSize: 14,
    lineHeight: 19,
  },
  tabBarHost: {
    position: "absolute",
    left: 20,
    right: 20,
    bottom: 36,
  },
  sheetTitle: {
    color: "#FFFFFF",
    fontSize: 20,
    fontWeight: "700",
    marginBottom: 16,
    marginTop: 4,
  },
});
