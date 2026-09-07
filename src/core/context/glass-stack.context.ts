import { createContext, useContext } from "react";

/**
 * Carries the `providerId` a glass view should read when it renders inside a
 * `LiquidGlassStack` layer.
 *
 * Each layer wrap provides the id of the provider recording everything *below* that layer — never
 * a provider the layer sits inside — so a `LiquidGlassView` that consumes this value can never be
 * pointed at its own backdrop. `undefined` outside any stack; an explicit `providerId` prop always
 * wins over the context.
 */
const GlassStackProviderContext: React.Context<string | undefined> = createContext<
  string | undefined
>(undefined);

GlassStackProviderContext.displayName = "GlassStackProviderContext";

/**
 * The `providerId` supplied by the nearest enclosing `LiquidGlassStack` layer, or `undefined`
 * outside any stack.
 *
 * `LiquidGlassView` already consumes this on its own. Reach for the hook only when building a
 * component that must *forward* the id somewhere a context cannot follow — into a `Modal`, or into
 * an imperative API.
 */
function useGlassStackProviderId(): string | undefined {
  return useContext(GlassStackProviderContext);
}

export { GlassStackProviderContext, useGlassStackProviderId };
