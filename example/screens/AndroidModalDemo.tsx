import {
  LiquidGlassProvider,
  LiquidGlassView,
  setGlassDebugLogging,
  type GlassActiveRenderer,
} from "expo-liquid-glass-ui";
import React, { useEffect, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

/**
 * The last day-one check: glass inside a React Native `<Modal>`.
 *
 * A `Modal` is a **separate window** — RN mounts it in its own `Dialog`, with its own view root and
 * its own coordinate space. Two consequences follow, and both are demonstrated here:
 *
 * 1. **A provider does not cross the window boundary.** `ProviderRegistry.find` matches on
 *    `rootView` identity, so a glass view in the modal cannot resolve a provider in the activity —
 *    it warns in dev builds instead of silently drawing a `RenderNode` positioned in some other
 *    window's coordinate space. This is the failure mode that broke `expo-blur` before SDK 55
 *    (expo/expo#44165), and it is why pairing is by explicit id rather than by walking up the tree.
 *
 * 2. **A modal cannot refract the activity behind it, at all.** Not a library limitation: a provider
 *    records a view tree, and the activity is not in the modal's tree. Anything you want to show
 *    through modal glass has to be inside the modal.
 *
 * The `providerId` namespace is per-window, not global, so the modal is free to reuse `"default"`.
 * It deliberately does not here — using a distinct id keeps the two cases below unambiguous.
 */
export default function AndroidModalDemo(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [paired, setPaired] = useState<GlassActiveRenderer | null>(null);
  const [orphan, setOrphan] = useState<GlassActiveRenderer | null>(null);

  useEffect(() => {
    setGlassDebugLogging(true);
    return () => setGlassDebugLogging(false);
  }, []);

  return (
    <View style={styles.root}>
      <LiquidGlassProvider style={StyleSheet.absoluteFill}>
        <View style={styles.backdrop}>
          {BANDS.map((color, i) => (
            <View key={i} style={[styles.band, { backgroundColor: color }]} />
          ))}
        </View>
      </LiquidGlassProvider>

      <LiquidGlassView
        style={styles.panel}
        containerStyle={styles.panelInner}
        cornerRadius={28}
      >
        <Text style={styles.title}>Activity window</Text>
        <Text style={styles.subtitle}>glass over the bands behind it</Text>
      </LiquidGlassView>

      <Pressable style={styles.button} onPress={() => setOpen(true)}>
        <Text style={styles.buttonText}>open modal</Text>
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <View style={styles.modalRoot}>
          {/* The modal's own provider, wrapping the modal's own content. Only what is inside this
              subtree can ever appear through glass in this window. */}
          <LiquidGlassProvider providerId="modal" style={styles.sheet}>
            <View style={styles.sheetBackdrop}>
              {SHEET_BANDS.map((color, i) => (
                <View
                  key={i}
                  style={[styles.sheetBand, { backgroundColor: color }]}
                />
              ))}
            </View>
          </LiquidGlassProvider>

          {/* Works: same window as its provider. */}
          <LiquidGlassView
            style={styles.modalGlass}
            containerStyle={styles.modalGlassInner}
            providerId="modal"
            cornerRadius={22}
            metal={{ blurRadius: 18 }}
            onRendererChange={setPaired}
          >
            <Text style={styles.modalGlassTitle}>
              providerId=&quot;modal&quot;
            </Text>
            <Text style={styles.modalGlassText}>
              paired in-window · {paired ?? "…"}
            </Text>
          </LiquidGlassView>

          {/* Refused: the only provider with this id lives in the activity window. Renders with no
              backdrop and logs "…exists, but in a different window" once, under `ExpoLiquidGlass`. */}
          <LiquidGlassView
            style={styles.modalGlass}
            containerStyle={styles.modalGlassInner}
            providerId="default"
            cornerRadius={22}
            metal={{ blurRadius: 18 }}
            onRendererChange={setOrphan}
          >
            <Text style={styles.modalGlassTitle}>
              providerId=&quot;default&quot;
            </Text>
            <Text style={styles.modalGlassText}>
              provider is in the activity window — refused, no backdrop
            </Text>
            <Text style={styles.modalGlassNote}>
              still reports {orphan ?? "…"}: the tier is a device capability,
              not a statement about pairing
            </Text>
          </LiquidGlassView>

          <Pressable style={styles.close} onPress={() => setOpen(false)}>
            <Text style={styles.buttonText}>close</Text>
          </Pressable>
        </View>
      </Modal>
    </View>
  );
}

const BANDS = [
  "#ff5f6d",
  "#0d0d0d",
  "#ffc371",
  "#0d0d0d",
  "#47cf73",
  "#0d0d0d",
];
const SHEET_BANDS = ["#12c2e9", "#c471ed", "#f64f59", "#eaeaea"];

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0d0d0d" },
  backdrop: { flex: 1 },
  band: { flex: 1 },
  panel: { position: "absolute", left: 24, right: 24, top: 140, height: 140 },
  panelInner: { flex: 1, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 20, fontWeight: "700", color: "#ffffff" },
  subtitle: { marginTop: 6, fontSize: 12, color: "#ffffffcc" },
  button: {
    position: "absolute",
    alignSelf: "center",
    bottom: 80,
    backgroundColor: "#ffffff22",
    borderRadius: 12,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  buttonText: { color: "#fff", fontSize: 14, fontWeight: "600" },

  modalRoot: { flex: 1, justifyContent: "center", paddingHorizontal: 20 },
  sheet: {
    position: "absolute",
    left: 20,
    right: 20,
    top: 100,
    bottom: 100,
    borderRadius: 28,
    overflow: "hidden",
  },
  sheetBackdrop: { flex: 1 },
  sheetBand: { flex: 1 },
  modalGlass: { height: 120, marginVertical: 10 },
  modalGlassInner: { flex: 1, justifyContent: "center", paddingHorizontal: 18 },
  modalGlassTitle: { color: "#ffffff", fontSize: 15, fontWeight: "700" },
  modalGlassText: { color: "#ffffffdd", fontSize: 12, marginTop: 4 },
  modalGlassNote: {
    color: "#ffffff99",
    fontSize: 10,
    marginTop: 6,
    lineHeight: 14,
  },
  close: {
    alignSelf: "center",
    marginTop: 16,
    backgroundColor: "#00000088",
    borderRadius: 12,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
});
