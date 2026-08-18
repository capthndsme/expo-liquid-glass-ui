package expo.modules.liquidglass.glass

import android.view.View
import android.view.ViewGroup
import expo.modules.liquidglass.LiquidGlassView

/**
 * The check that keeps a mis-wired backdrop from taking the process down.
 *
 * Sampling a provider is not a read — it is a `RenderNode` reference. `recordBackdrop` puts the
 * provider's node *inside* the glass view's own node, while the provider's recording already
 * contains the node of every view in its subtree. Two edges, opposite directions:
 *
 * ```
 * provider.node  ->  glass.node     for every glass view in the provider's subtree
 * glass.node     ->  provider.node  for every provider that glass view samples
 * ```
 *
 * Close a loop between them and `hwui` has a cyclic render tree. Nothing in the framework checks
 * for that: `RenderNode::prepareTreeImpl` walks children depth-first and recurses until the
 * RenderThread's stack hits its guard page — `SIGSEGV`, `SEGV_ACCERR`, a tombstone whose backtrace
 * is 256 identical frames. It is not recoverable and it is not reported as anything to do with
 * glass.
 *
 * The loop is easy to build by accident. A provider around a screen and a glass view *inside* that
 * screen sharing the default id is enough, and that pairing happens silently — the view resolves an
 * id, not a relationship. So this runs on every resolve, in every build, and a view that would form
 * a loop draws as a plain scrim with one line in logcat instead.
 *
 * Cheap because it is bounded twice: [MAX_DEPTH] on the chain, and a visited set so a diamond is
 * walked once. It runs once per attach — [LiquidGlassView.resolveProviders] latches the verdict.
 *
 * Stacked glass is unaffected: `LiquidGlassStack` puts each layer's glass as a **sibling** of the
 * provider it reads, never a descendant, so no edge ever points back.
 */
internal object BackdropGraph {

  /**
   * How many provider hops one glass view's backdrop may traverse.
   *
   * Every hop is a real nesting level in the render tree, and the depth a *correct* topology needs
   * is small: `LiquidGlassStack` spends one hop per layer boundary, so 8 is roughly twice the
   * deepest stack anyone has reason to build. The cap is not a tuning knob — it is the backstop for
   * loops this walk cannot see, which is why it is deliberately far above real use. A chain that
   * reaches it is a mistake whatever its shape.
   */
  const val MAX_DEPTH = 8

  enum class Kind {
    /** The view sits inside a provider it samples — the one-hop loop, and the common mistake. */
    INSIDE_ITS_OWN_PROVIDER,

    /** A longer loop: two or more providers whose subtrees sample each other. */
    LOOP,

    /** No loop found, but the chain is deeper than [MAX_DEPTH]. */
    TOO_DEEP,
  }

  class Fault(val kind: Kind, val providerId: String)

  /**
   * @param view the view about to record
   * @param sources what it resolved, in the order it would composite them
   * @return null when the graph is safe to record
   */
  fun inspect(view: LiquidGlassView, sources: List<BackdropSource>): Fault? {
    if (sources.isEmpty()) return null
    val path = ArrayList<LiquidGlassView>(MAX_DEPTH + 1)
    path.add(view)
    return walk(sources, path, HashSet(), 0)
  }

  /**
   * Depth-first over glass-view -> provider -> glass-view edges.
   *
   * [path] is the current chain, root first; a node already on it closes a loop. [settled] is every
   * node whose own subgraph came back clean — reaching one again cannot reveal a loop the first
   * visit missed, so it is skipped, which is what keeps a wide tree linear.
   */
  private fun walk(
    sources: List<BackdropSource>,
    path: MutableList<LiquidGlassView>,
    settled: MutableSet<LiquidGlassView>,
    depth: Int,
  ): Fault? {
    if (depth >= MAX_DEPTH) {
      return Fault(Kind.TOO_DEEP, sources.first().providerId)
    }
    val reachable = ArrayList<LiquidGlassView>()
    for (source in sources) {
      reachable.clear()
      collectGlass(source.sourceView, reachable)
      for (next in reachable) {
        if (path.contains(next)) {
          // Closing on the root at the first hop is the "glass inside its own provider" case, and
          // it gets its own message because the fix is a different one.
          val kind =
            if (depth == 0 && next === path[0]) Kind.INSIDE_ITS_OWN_PROVIDER else Kind.LOOP
          return Fault(kind, source.providerId)
        }
        if (!settled.add(next)) continue
        val onward = next.peekSampledSources()
        if (onward.isEmpty()) continue
        path.add(next)
        walk(onward, path, settled, depth + 1)?.let { return it }
        path.removeAt(path.size - 1)
      }
    }
    return null
  }

  /**
   * Every glass view in [root]'s subtree — all of them, not just the topmost.
   *
   * The walk does not stop at a glass view or at a nested provider: both keep drawing their
   * children into the same recording, so anything below them is still reachable from [root]'s node
   * and can still close a loop.
   */
  private fun collectGlass(root: View, out: MutableList<LiquidGlassView>) {
    if (root is LiquidGlassView) out.add(root)
    if (root !is ViewGroup) return
    for (i in 0 until root.childCount) collectGlass(root.getChildAt(i), out)
  }

  fun describe(fault: Fault): String = when (fault.kind) {
    Kind.INSIDE_ITS_OWN_PROVIDER ->
      "A <LiquidGlassView> is INSIDE the <LiquidGlassProvider providerId=\"${fault.providerId}\"> " +
        "it samples. That is a cycle in the render tree and it crashes the RenderThread, so this " +
        "view is drawing as a plain scrim instead. Make it a SIBLING of the provider — or, if it " +
        "never meant to pair with that provider at all, give one of them an id of its own. A " +
        "provider wrapped around a whole screen shares the default id with every glass view on it."

    Kind.LOOP ->
      "A <LiquidGlassProvider providerId=\"${fault.providerId}\"> is part of a loop: providers " +
        "whose subtrees sample each other. That is a cycle in the render tree and it crashes the " +
        "RenderThread, so this view is drawing as a plain scrim instead. Backdrops have to flow " +
        "one way — pick which layer is underneath and let only the other one sample it."

    Kind.TOO_DEEP ->
      "A <LiquidGlassView> reading <LiquidGlassProvider providerId=\"${fault.providerId}\"> is " +
        "more than $MAX_DEPTH providers deep. Each level is real nesting in the render tree, so " +
        "this view is drawing as a plain scrim instead. Stacked glass needs one level per layer " +
        "boundary; if you are not stacking that many, something is sampling in a loop."
  }
}
