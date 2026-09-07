import { LiquidGlassProvider, LiquidGlassView } from "expo-liquid-glass-ui";
import { useVideoPlayer, VideoView, type SurfaceType } from "expo-video";
import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

const SOURCE = require("../video/sunny-beach.mp4");

/**
 * **D4.** Video behind glass, and the exact reason the surface type matters on Android.
 *
 * `SurfaceView` composites in the system compositor, out of this process, and reserves its space by
 * punching a transparent hole through the app's own window. Nothing a `Canvas` or `RenderNode` can
 * do will see it, and a provider that records its subtree records the hole, not the video. Only
 * `PixelCopy` sees it, at the cost of an async GPU readback per frame — not a trade this library
 * makes.
 *
 * `TextureView` renders into the view hierarchy — `TextureView.draw()` emits `drawTextureLayer`
 * into a hardware `RecordingCanvas` — so it is captured like any other view.
 *
 * Toggle between them here. On `surfaceView` the glass shows the page background instead of the
 * video, and the dev-mode `SurfaceView` warning appears in logcat.
 *
 * Uses `expo-video` rather than `react-native-video`: in `react-native-video@6.16.1`
 * `ExoPlayerView.updateSurfaceView` is an empty `// TODO`, so its `viewType` prop does nothing and
 * playback is always `SurfaceView`.
 */
export default function AndroidVideoDemo(): React.JSX.Element {
  const [surfaceType, setSurfaceType] = useState<SurfaceType>("textureView");

  const player = useVideoPlayer(SOURCE, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });

  return (
    <View style={styles.root}>
      <LiquidGlassProvider style={StyleSheet.absoluteFill}>
        <VideoView
          // The surface is chosen when the native view is created, so switching needs a remount.
          key={surfaceType}
          player={player}
          style={StyleSheet.absoluteFill}
          surfaceType={surfaceType}
          contentFit="cover"
          nativeControls={false}
        />
      </LiquidGlassProvider>

      <LiquidGlassView
        style={styles.panel}
        containerStyle={styles.panelInner}
        cornerRadius={32}
        metal={{ blurRadius: 12 }}
      >
        <Text style={styles.title}>Video behind glass</Text>
        <Text style={styles.subtitle}>{LABELS[surfaceType]}</Text>
      </LiquidGlassView>

      <Pressable
        style={styles.toggle}
        onPress={() =>
          setSurfaceType((v) =>
            v === "textureView" ? "surfaceView" : "textureView"
          )
        }
      >
        <Text style={styles.toggleText}>
          switch to{" "}
          {surfaceType === "textureView" ? "surfaceView" : "textureView"}
        </Text>
      </Pressable>
    </View>
  );
}

const LABELS: Record<SurfaceType, string> = {
  textureView: "TextureView — capturable",
  surfaceView: "SurfaceView — a hole in the backdrop",
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#123" },
  panel: { position: "absolute", left: 24, right: 24, top: 200, height: 200 },
  panelInner: { flex: 1, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 24, fontWeight: "700", color: "#ffffff" },
  subtitle: { marginTop: 6, fontSize: 13, color: "#ffffffcc" },
  toggle: {
    position: "absolute",
    left: 24,
    bottom: 60,
    backgroundColor: "#00000088",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  toggleText: { color: "#fff", fontSize: 13 },
});
