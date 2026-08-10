package expo.modules.liquidglass.glass

import android.util.Log
import android.view.View
import expo.modules.liquidglass.LOG_TAG
import java.util.concurrent.CopyOnWriteArrayList

/**
 * Process-level map from `providerId` to the providers currently attached.
 *
 * This is the `expo-blur` `<BlurTargetView>` pattern. It exists so that pairing is **explicit**:
 * we never walk up the view hierarchy looking for a provider, which is what `expo-blur` did before
 * SDK 55 and is precisely why it broke inside `Modal` (expo/expo#44165).
 *
 * Touched only from the UI thread in practice, but held in a copy-on-write list so that iterating
 * consumers during a draw can never trip over a concurrent registration.
 */
internal object ProviderRegistry {
  private val providers = CopyOnWriteArrayList<BackdropSource>()

  fun register(provider: BackdropSource) {
    providers.addIfAbsent(provider)
  }

  fun unregister(provider: BackdropSource) {
    providers.remove(provider)
  }

  /**
   * Resolves [id] to a provider **in the same window as [consumer]**.
   *
   * The window check is not an optimisation — a `RenderNode` recorded in another window's tree is
   * positioned in that window's coordinate space, so drawing it here would be wrong even when it
   * does not fail outright. An RN `Modal` is a separate window and needs its own provider; this is
   * where that gets enforced rather than silently producing garbage.
   */
  fun find(id: String, consumer: View): BackdropSource? {
    val root = consumer.rootView
    var idMatchedInAnotherWindow = false

    for (provider in providers) {
      if (provider.providerId != id) continue
      if (provider.sourceView.rootView === root) return provider
      idMatchedInAnotherWindow = true
    }

    if (GlassDebug.enabled) {
      if (idMatchedInAnotherWindow) {
        Log.w(
          LOG_TAG,
          "A LiquidGlassProvider with providerId=\"$id\" exists, but in a different window. " +
            "A React Native <Modal> is its own window — put a <LiquidGlassProvider> inside it."
        )
      } else {
        Log.w(
          LOG_TAG,
          "No <LiquidGlassProvider providerId=\"$id\"> is mounted. Glass views need one as a " +
            "SIBLING, wrapping the content that should show through them."
        )
      }
    }
    return null
  }
}
