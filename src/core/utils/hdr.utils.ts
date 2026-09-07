import { ExpoLiquidGlassModule } from "../modules";
import type { IGlassHdrStatus } from "../interfaces";

const SDR_STATUS: IGlassHdrStatus = {
  supported: false,
  enabled: false,
  headroom: 1,
};

/**
 * Opts the current Android window in (or out) of HDR rendering for the glass border light.
 *
 * This is a **window-level** switch: `COLOR_MODE_HDR` moves the whole window to FP16 buffers
 * (roughly double the compositing bandwidth), which is why it is an explicit call and never
 * automatic. When active on an HDR panel (API 34+), the glass highlight rim may exceed SDR
 * white by the display's live HDR/SDR ratio; everything else — including the backdrop seen
 * through the glass — stays SDR. The request survives activity recreation: the module
 * re-applies it on every foreground.
 *
 * Resolves with the resulting {@link IGlassHdrStatus}. On iOS/web, or below Android 14, this is
 * a no-op that resolves `{ supported: false, enabled: false, headroom: 1 }`.
 */
async function setGlassHdrEnabled(enabled: boolean): Promise<IGlassHdrStatus> {
  const status = await ExpoLiquidGlassModule?.setHdrEnabled?.(enabled);
  return status ?? SDR_STATUS;
}

/**
 * The live HDR state: whether this display can do mixed HDR/SDR at all, whether the opt-in is
 * currently on, and the headroom the glass may use right now (1.0 while disabled or SDR — the
 * ratio breathes with screen brightness, so poll it if you display it).
 */
function getGlassHdrStatus(): IGlassHdrStatus {
  return ExpoLiquidGlassModule?.getHdrStatus?.() ?? SDR_STATUS;
}

export { setGlassHdrEnabled, getGlassHdrStatus };
