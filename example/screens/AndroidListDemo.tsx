import { LiquidGlassProvider, LiquidGlassView } from "expo-liquid-glass-view";
import React from "react";
import { FlatList, StyleSheet, Text, View } from "react-native";

/**
 * Phase 4's acceptance case: a list of glass rows scrolling over a **static** backdrop.
 *
 * This is the inverse of `AndroidDemo` and it exercises the one thing that screen cannot. There the
 * glass is pinned and the backdrop scrolls, so the glass never moves relative to its provider and
 * nothing has to notice. Here the provider is motionless and the glass rows are the things in
 * flight — each row's own `dispatchDraw` never re-runs while the list scrolls, because scrolling a
 * `FlatList` re-records the list's display list, not its children's.
 *
 * Without the pre-draw geometry watcher every row would carry its backdrop along like a decal.
 * With it, the bands stay pinned to the world and slide behind the glass.
 */
export default function AndroidListDemo(): React.JSX.Element {
  return (
    <View style={styles.root}>
      <LiquidGlassProvider style={StyleSheet.absoluteFill}>
        <View style={styles.backdrop}>
          {BANDS.map((color, i) => (
            <View key={i} style={[styles.band, { backgroundColor: color }]} />
          ))}
        </View>
      </LiquidGlassProvider>

      <FlatList
        data={ROWS}
        keyExtractor={(n) => String(n)}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <LiquidGlassView
            style={styles.row}
            containerStyle={styles.rowInner}
            cornerRadius={18}
          >
            <Text style={styles.rowText}>Row {item}</Text>
          </LiquidGlassView>
        )}
      />
    </View>
  );
}

const ROWS = Array.from({ length: 24 }, (_, i) => i);

const BANDS = [
  "#ff5f6d",
  "#0d0d0d",
  "#ffc371",
  "#0d0d0d",
  "#47cf73",
  "#0d0d0d",
  "#12c2e9",
  "#0d0d0d",
  "#c471ed",
  "#0d0d0d",
  "#eaeaea",
  "#0d0d0d",
];

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0d0d0d" },
  backdrop: { flex: 1 },
  band: { flex: 1 },
  listContent: { paddingVertical: 120, paddingHorizontal: 20 },
  row: { height: 72, marginVertical: 8 },
  rowInner: { flex: 1, justifyContent: "center", paddingHorizontal: 20 },
  rowText: { color: "#ffffff", fontSize: 16, fontWeight: "600" },
});
