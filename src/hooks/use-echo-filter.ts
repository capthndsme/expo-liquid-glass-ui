import { useCallback, useMemo, useRef } from "react";

/** How many un-echoed emits to remember before the oldest are forgotten. */
const ECHO_CAPACITY = 64;

interface IEchoFilter<T> {
  /** Record a value this control just reported through its change callback. */
  emitted: (value: T) => void;
  /**
   * Whether an incoming controlled `value` is merely one of our own reports coming back —
   * in which case the control is already there (or past it) and must not re-target. Every
   * report up to and including the matched one is forgotten; later ones stay pending for
   * their own echoes.
   */
  isEcho: (value: T) => boolean;
}

/**
 * Tells a controlled control's own echoes apart from a real external change.
 *
 * A dragged control reports many values a second through `runOnJS`. The parent stores each
 * one and renders it back as `value`, and the control's effect must then decide: is this the
 * app moving me, or my own report returning? Comparing against *the last* value reported is not
 * enough — passive effects run after paint, so the effect of an earlier render can fire after
 * several newer reports have gone out. The slider had exactly this: the effect for `0.47` ran
 * once `0.66` had been reported, decided `0.47` was external and sprang the thumb back to it,
 * and the drag looked like it kept bouncing to old positions.
 *
 * So the filter remembers every report that has not been echoed yet. An incoming value found
 * in that list is an echo (echoes arrive in the order they were reported, so everything up to
 * the match is done too); a value not in the list is the app's, and the control animates to it.
 */
function useEchoFilter<T>(): IEchoFilter<T> {
  const pending = useRef<T[]>([]);

  const emitted = useCallback((value: T): void => {
    const list = pending.current;
    list.push(value);
    if (list.length > ECHO_CAPACITY)
      list.splice(0, list.length - ECHO_CAPACITY);
  }, []);

  const isEcho = useCallback((value: T): boolean => {
    const list = pending.current;
    const index = list.indexOf(value);
    if (index < 0) return false;
    list.splice(0, index + 1);
    return true;
  }, []);

  return useMemo(() => ({ emitted, isEcho }), [emitted, isEcho]);
}

export { useEchoFilter };
export type { IEchoFilter };
