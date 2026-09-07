import { BUTTON_FOLLOW_DERIVATIVE } from "../constants";

interface IButtonPressTransform {
  translateX: number;
  translateY: number;
  scaleX: number;
  scaleY: number;
}

/**
 * The reference's `InteractiveHighlight` geometry as one worklet: the grow-on-press, the
 * rubber-band follow toward the finger and the stretch along the drag axis, for a control of
 * `width` x `height` at press `progress` with the finger `offsetX`/`offsetY` from where it
 * landed.
 *
 * Shared between the button — which applies it as a `transform` — and `LiquidGlassGroup`'s
 * canvas, which needs the *same* inflated, carried rect to draw the merged silhouette from. The
 * two must agree to the pixel or the canvas pane and the button's own pane would part company
 * during the crossfade.
 *
 * - Follow: slope `BUTTON_FOLLOW_DERIVATIVE` near zero, saturating at one min-dimension of
 *   travel through a tanh.
 * - Stretch: on a wide control X takes full weight and Y is attenuated by `h/w`, so the pane
 *   spreads along the drag axis instead of ballooning.
 */
const buttonPressTransform = (
  width: number,
  height: number,
  growth: number,
  progress: number,
  offsetX: number,
  offsetY: number
): IButtonPressTransform => {
  "worklet";
  const w = Math.max(width, 1);
  const h = Math.max(height, 1);
  const minDim = Math.min(w, h);
  const maxDim = Math.max(w, h);
  const scale = 1 + (growth / h) * progress;

  const translateX =
    minDim * Math.tanh((BUTTON_FOLLOW_DERIVATIVE * offsetX) / minDim);
  const translateY =
    minDim * Math.tanh((BUTTON_FOLLOW_DERIVATIVE * offsetY) / minDim);

  const angle = Math.atan2(offsetY, offsetX);
  const maxDragScale = growth / h;
  const scaleX =
    scale +
    maxDragScale *
      Math.abs((Math.cos(angle) * offsetX) / maxDim) *
      Math.min(w / h, 1);
  const scaleY =
    scale +
    maxDragScale *
      Math.abs((Math.sin(angle) * offsetY) / maxDim) *
      Math.min(h / w, 1);

  return { translateX, translateY, scaleX, scaleY };
};

export { buttonPressTransform };
export type { IButtonPressTransform };
