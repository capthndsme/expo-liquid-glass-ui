package expo.modules.liquidglass

import android.content.Context
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView

/**
 * Passthrough. On iOS this view lets UIKit merge nearby glass surfaces into one material, which
 * is a compositor side effect with no coordination code to port — reproducing it means one surface
 * owning every child's SDF under a smooth-min union, which is a rewrite rather than a port.
 *
 * So `spacing` is accepted and ignored, and children lay out exactly as they would in a plain
 * `View`. This matches what the JS component already does on every non-iOS platform.
 */
class LiquidGlassContainerView(context: Context, appContext: AppContext) :
  ExpoView(context, appContext)
