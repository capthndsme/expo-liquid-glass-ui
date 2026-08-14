/** Result of the Android HDR opt-in / status calls. See `setGlassHdrEnabled`. */
interface IGlassHdrStatus {
  /** Whether this display + platform can do mixed HDR/SDR UI at all (Android 14+, HDR panel). */
  supported: boolean;
  /** Whether the app's opt-in is currently on (independent of `supported`). */
  enabled: boolean;
  /**
   * The multiple of SDR white the glass highlight may reach right now. Exactly 1 while disabled
   * or unsupported; breathes with screen brightness while active (e.g. up to ~4.5 on dim OLED
   * panels, ~2 at full brightness).
   */
  headroom: number;
}

export type { IGlassHdrStatus };
