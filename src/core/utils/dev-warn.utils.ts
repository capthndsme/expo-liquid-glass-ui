const warned: Set<string> = new Set<string>();

/**
 * `console.warn`s [message] at most once per [key] for the life of the JS context, and only in
 * dev — the JS mirror of the native `GlassDebug.warnOnce`.
 *
 * The conditions these describe are per-render, so an ungated warning would repeat on every
 * re-render and bury itself.
 */
function devWarnOnce(key: string, message: string): void {
  if (!__DEV__) return;
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`expo-liquid-glass-ui: ${message}`);
}

export { devWarnOnce };
