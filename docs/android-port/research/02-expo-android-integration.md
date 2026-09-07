# Android Integration Reference — `expo-liquid-glass-view`

**Scope:** adding a native Android implementation to `/home/captainhandsome/projects/expo-liquid-glass-view` (Expo SDK 56, RN 0.85.3).
**Verification basis:** `expo/expo` branch `sdk-56` (via GitHub API), npm registry, `react-native@0.85.3` tarball, and a local SDK 54 install (`/home/captainhandsome/projects/mine-app/node_modules/expo-modules-core@3.0.29`, `expo-modules-autolinking@3.0.24`) used as ground truth for Kotlin/Gradle internals that are unchanged in 56 unless noted.

---

## 0. Current state of this repo (facts you need before planning)

| File | Fact |
|---|---|
| `/home/captainhandsome/projects/expo-liquid-glass-view/expo-module.config.json` | `{"platforms":["apple"],"apple":{"modules":["ExpoLiquidGlassModule"]}}` — no `android`, no `web`, no `name`, no `coreFeatures`. |
| `package.json` | `main: build/index.js`, `types: build/index.d.ts`. devDeps: `expo ~56.0.18`, `react-native 0.85.3`, **`expo-module-scripts ^4.1.9`** (stale — see §8). Has `open:android` script already pointing at `example/android`. |
| `.npmignore` | Already contains `/android/src/androidTest/`, `/android/src/test/`, `/android/build/` — matches the official SDK 56 template exactly. |
| `.gitignore` | `build/` (line 11) already ignores `android/build/`; `.gradle`, `.cxx`, `local.properties`, `.idea` also present. **`example/android/` is NOT ignored** (consistent with `example/ios/` being committed — 18 tracked files). |
| `src/utils/platform.utils.ts` | `Platform.OS === "ios" && ExpoLiquidGlassModule?.supportsNativeGlass === true` |
| `src/views/NativeLiquidGlassView.ts` | Calls `requireNativeViewOnce()` at **module top level** → eager `requireNativeView`. |
| `src/components/LiquidGlassView/LiquidGlassView.tsx` | **No platform branch at all** — always renders `NativeLiquidGlassView`. Children are wrapped in `<View pointerEvents="box-none" style={containerStyle}>`. |
| `src/components/LiquidGlassContainer/LiquidGlassContainer.tsx` | Branches: `Platform.OS !== "ios"` → plain `<View>`. |
| `example/package.json` | `"expo": { "autolinking": { "nativeModulesDir": ".." } }` — autolinks the parent repo (see §7). |
| `example/app.json` | `android.package = "expo.modules.liquidglass.example"`, `edgeToEdgeEnabled: true`, `newArchEnabled: true`. No `plugins` beyond `expo-font`. |
| `example/metro.config.js` | `extraNodeModules: { "expo-liquid-glass-view": <root>/src }` and blocks `<root>/build` — the example resolves the module from **`src/`**, not `build/`. |

**Two pre-existing bugs this work must fix:**

1. **Web is broken today.** `requireNativeViewManager` in the web build of expo-modules-core *throws at call time*, and this repo calls it at module scope:
   ```ts
   // packages/expo-modules-core/src/NativeViewManagerAdapter.tsx @ sdk-56
   export function requireNativeViewManager<P = any>(moduleName, viewName) {
     throw new UnavailabilityError('expo-modules-core', 'requireNativeViewManager');
   }
   ```
   So `import { LiquidGlassView } from "expo-liquid-glass-view"` on web crashes at import. README ("On Android and web the components render as plain views") is false for web.
2. **Android is broken today.** `LiquidGlassView` never branches on platform, so it renders an unregistered view manager. In SDK 56 `requireNativeViewManager` no longer checks `NativeModules.NativeUnimoduleProxy` — it goes straight to `componentRegistryGet` and only `console.warn`s ("Unable to get the view config…"), returning `{ uiViewClassName }`. It fails at *render*, not import.

---

## 1. `expo-module.config.json` for Android

### 1.1 Full schema (source of truth)

`packages/expo-modules-autolinking/src/types.ts` (main; identical shape in `sdk-56`):

```ts
export type SupportedPlatform =
  | 'apple' | 'ios' | 'android' | 'web' | 'macos' | 'tvos' | 'devtools' | (string & {});

export interface RawExpoModuleConfig {
  platforms?: SupportedPlatform[];
  apple?: RawModuleConfigApple;
  ios?: RawModuleConfigApple;          // legacy alias for `apple`
  android?: RawAndroidConfig;
  coreFeatures?: string[];             // 'swiftui' | 'compose'
  devtools?: { ... };
}

export type RawAndroidConfig = {
  projects?: WithRequired<RawAndroidProjectConfig, 'name' | 'path'>[];
  gradlePlugins?: AndroidGradlePluginDescriptor[];
} & RawAndroidProjectConfig;

export type RawAndroidProjectConfig = {
  name?: string;                       // gradle project name; default = derived from package name
  path?: string;                       // default 'android'
  publication?: AndroidPublication;
  shouldUsePublicationScriptPath?: string;
  modules?: (string | RawAndroidModuleConfig)[];  // FQCN of Kotlin Module classes
  services?: string[];
  gradleAarProjects?: AndroidGradleAarProjectDescriptor[];
  gradlePath?: string;
};
```
A top-level `name` key also exists (added by expo/expo#39985). Real example — `packages/expo-ui/expo-module.config.json` @ main:
```json
{
  "name": "expo-ui",
  "platforms": ["apple", "android"],
  "coreFeatures": ["swiftui", "compose"],
  "apple": { "modules": ["ExpoUIModule"] },
  "android": { "modules": ["expo.modules.ui.ExpoUIModule"] }
}
```

The SDK 56 module template generates exactly (`packages/expo-module-template/expo-module.config.json`, EJS):
```json
{
  "platforms": ["apple", "android"],
  "apple":   { "modules": ["<ModuleName>"] },
  "android": { "modules": ["<package>.<ModuleName>"] }
}
```

### 1.2 Exact change for THIS repo

```json
{
  "platforms": ["apple", "android"],
  "apple":   { "modules": ["ExpoLiquidGlassModule"] },
  "android": { "modules": ["expo.modules.liquidglass.ExpoLiquidGlassModule"] }
}
```
- `android.modules` must be the **fully-qualified Kotlin class name**, not the JS `Name()`. The `Name("ExpoLiquidGlass")` inside the module definition stays the same on both platforms (it is what `requireNativeView("ExpoLiquidGlass", "LiquidGlassView")` resolves).
- Do **not** add `"web"` to `platforms` unless you also add a `registerWebModule` implementation — `supportsPlatform('web')` returns `true` unconditionally in autolinking, so listing it is a no-op for linking and only signals intent.
- Optional but recommended: add `"name": "expo-liquid-glass-view"`.

### 1.3 Does adding `"android"` affect the Apple config?

**No.** `ExpoModuleConfig.supportsPlatform()` (verified in `expo-modules-autolinking/src/ExpoModuleConfig.ts`):
```ts
} else if (platform === 'apple') {
  return supportedPlatforms.some(p => ['apple','ios','macos','tvos'].includes(p));
}
```
Apple resolution only looks for `apple|ios|macos|tvos`. The `apple` sub-object is read via `getAppleConfig()` independent of `android`. Adding `"android"` is purely additive.

**Also safe:** if `platforms` lists `android` but `android/build.gradle` does not yet exist, the module is silently skipped:
```ts
const androidProjects = revision.config?.androidProjects(defaultProjectName)
  ?.filter(project => !project.isDefault || isAndroidProject(path.join(revision.path, project.path)));
if (!androidProjects?.length) { ... return null; }   // isAndroidProject = build.gradle | build.gradle.kts exists
```
So you can land the config change and the Gradle file in separate commits without breaking iOS builds.

### 1.4 Derived Gradle project name

`convertPackageToProjectName()` in `src/platforms/android/android.ts`:
```ts
return packageName.replace(/^@/g, '').replace(/\W+/g, '-');
```
`expo-liquid-glass-view` → Gradle project **`:expo-liquid-glass-view`**. (Needed for §7 gradle task names.)

---

## 2. `android/build.gradle`

### 2.1 The canonical SDK 56 template (verbatim, EJS stripped)

Fetched from `expo/expo@sdk-56:packages/expo-module-template/android/build.gradle`:

```gradle
plugins {
  id 'com.android.library'
  id 'expo-module-gradle-plugin'
}

group = '<your.package>'
version = '0.1.0'

android {
  namespace "<your.package>"
  defaultConfig {
    versionCode 1
    versionName "0.1.0"
  }
  lintOptions {
    abortOnError false
  }
}
```

The Compose variant (only emitted when you pick Compose features) adds a `buildscript` block classpath'ing `org.jetbrains.kotlin.plugin.compose:...:${kotlinVersion}`, `apply plugin: 'org.jetbrains.kotlin.plugin.compose'`, `buildFeatures { compose true }`, and Compose deps. **We do not need any of this.**

### 2.2 `ExpoModulesCorePlugin.gradle` (legacy) vs `expo-module-gradle-plugin` (canonical)

**`expo-module-gradle-plugin` is canonical for SDK 54/55/56.** Every first-party Expo module uses it (verified locally in `node_modules/expo-{linear-gradient,blur,image,font,haptics,constants}/android/build.gradle`). The reference repo `expo-liquid-glass-native` uses the **legacy** `apply from: expoModulesCorePlugin` + `applyKotlinExpoModulesCorePlugin()` + `useCoreDependencies()` + `useExpoPublishing()` style, which is the SDK ≤53 create-expo-module output. It still works (the `ExpoModulesCorePlugin.gradle` file is still shipped in `expo-modules-core/android/`), but it is not what SDK 56 generates and it re-implements what the plugin does.

What the plugin actually does (`expo-modules-core/expo-module-gradle-plugin/src/main/kotlin/expo/modules/plugin/{ExpoModulesGradlePlugin,ProjectConfiguration}.kt`):

```kotlin
applyDefaultPlugins()        // com.android.library, kotlin-android, maven-publish
applyKotlin(kotlinVersion, kspVersion)   // sets rootProject.extra, adds kotlin-stdlib-jdk7
applyDefaultDependencies()   // compileOnly project(':expo-modules-core')  <-- NOT `implementation`
                             // + testImplementation / androidTestImplementation
applyDefaultAndroidSdkVersions()
applyPublishing(expoModuleExtension)     // release publication -> mavenLocal + <pkg>/local-maven-repo
```
```kotlin
internal fun Project.applyDefaultAndroidSdkVersions() {
  applySDKVersions(
    compileSdk = rootProject.extra.safeGet("compileSdkVersion") ?: 36,
    minSdk     = rootProject.extra.safeGet("minSdkVersion")     ?: 24,
    targetSdk  = rootProject.extra.safeGet("targetSdkVersion")  ?: 36)
  applyLinterOptions()
}
```

DSL extension it registers is `expoModule { ... }` (`ExpoModuleExtension.kt`), with:
- `canBePublished: Boolean` (default `true`) — set `false` to skip prebuilt-AAR publication.
- `safeExtGet(name, default)` — replacement for the hand-rolled `safeExtGet` closure.
- `getExpoDependency(name)`, `reactNativeDir`, `reactNativeVersion`, `reactNativeProperties`.

There is **no** `useDefaultAndroidSdkVersions()` toggle under the new plugin — SDK versions always come from the app's `rootProject.extra`. To override, just declare them in your own `android { }` block afterwards.

### 2.3 Version numbers Expo SDK 56 actually uses

Chain: `settings.gradle` → `expoAutolinking.useExpoVersionCatalog()` → reads **`react-native/gradle/libs.versions.toml`** into a catalog named `expoLibs` → `apply plugin: "expo-root-project"` (`ExpoRootProjectPlugin.kt`) writes them into `rootProject.extra`. Gradle properties `android.minSdkVersion` / `android.compileSdkVersion` / `android.targetSdkVersion` / `android.buildToolsVersion` / `android.kotlinVersion` override the catalog.

From `react-native@0.85.3/gradle/libs.versions.toml` (fetched from unpkg, verbatim):
```toml
minSdk = "24"
targetSdk = "36"
compileSdk = "36"
buildTools = "36.0.0"
ndkVersion = "27.1.12297006"
agp = "8.12.0"
kotlin = "2.1.20"
```
`expo-template-bare-minimum@56.0.33/android/gradle.properties` does **not** override any of these (verified verbatim), so the effective SDK 56 defaults are:

| | SDK 56 (RN 0.85.3) | (SDK 54 / RN 0.81.5, for contrast) |
|---|---|---|
| compileSdk | **36** | 36 |
| minSdk | **24** | 24 |
| targetSdk | **36** | 36 |
| buildTools | 36.0.0 | 36.0.0 |
| NDK | 27.1.12297006 | 27.1.12297006 |
| **AGP** | **8.12.0** | 8.11.0 |
| **Kotlin** | **2.1.20** | 2.1.20 |
| **Gradle wrapper** | **9.3.1** | 8.14.3 |

Gradle 9.3.1 confirmed from `expo-template-bare-minimum@56.0.33/android/gradle/wrapper/gradle-wrapper.properties`: `distributionUrl=https\://services.gradle.org/distributions/gradle-9.3.1-bin.zip`. This is a major jump from SDK 54's 8.14.3 — hand-written Gradle DSL that was fine on 8.x may warn or break on 9.x. The SDK 56 template still uses the deprecated `lintOptions { }` block, so AGP 8.12 accepts it.

**KSP:** `ExpoRootProjectPlugin` also sets `kspVersion` from the catalog or `KSPLookup.getValue(kotlinVersion)`; the legacy `ExpoModulesCorePlugin.gradle` has a hardcoded map defaulting to `2.0.21-1.0.28`. Another reason to prefer the new plugin — the legacy map doesn't know about Kotlin 2.1.20 and falls back.

**New in SDK 56:** a Kotlin compiler plugin replaces runtime reflection with build-time codegen for Expo Modules on Android (~40% faster cold start). Per Expo: *"Nothing for you to wire up, you just get it on upgrade."* It is applied automatically — **no `android/build.gradle` change required**. ([changelog](https://expo.dev/changelog/sdk-56))

### 2.4 Extra Maven dependencies without breaking autolinking

Just declare them normally:
```gradle
dependencies {
  implementation 'com.facebook.react:react-android'   // if you touch RN classes directly
  implementation 'androidx.core:core-ktx:1.13.1'
}
```
Resolution uses the **consuming app's** `allprojects { repositories { ... } }`. `expo-template-bare-minimum@56.0.33/android/build.gradle` provides:
```gradle
allprojects {
  repositories {
    google()
    mavenCentral()
    maven { url 'https://www.jitpack.io' }
  }
}
```
So **`google()`, `mavenCentral()` and JitPack all work with zero consumer config.** (Precedent: `expo-blur` ships `implementation 'com.github.Dimezis:BlurView:version-2.0.6'` — a JitPack coordinate — with no plugin.)

For any *other* repository, the mechanism is the `android.extraMavenRepos` gradle property, read by autolinking:
```ts
const ANDROID_EXTRA_BUILD_DEPS_KEY = 'android.extraMavenRepos';   // src/platforms/android/android.ts
// JSON.parse'd from the app's android/gradle.properties, surfaced as `extraDependencies` -> MavenRepo[]
```
Consumers set it via `expo-build-properties` (`android.extraMavenRepos`). A library **cannot** add a repository to the app itself without a config plugin. **Recommendation for this module: depend only on the Android platform + AndroidX, i.e. zero third-party Maven deps, so nothing is needed.**

### 2.5 Can a module raise its own minSdk above the app's?

You can *write* `minSdk 31` in your `android { defaultConfig { } }` (it overrides what the plugin set), but the app build then fails at manifest merge:

```
uses-sdk:minSdkVersion 24 cannot be smaller than version 31 declared in library
[:expo-liquid-glass-view] .../AndroidManifest.xml as the library might be using APIs not available in 24
```

That is standard AGP manifest-merger behavior, not Expo-specific. Every consumer would have to raise `android.minSdkVersion` in `gradle.properties` (or via `expo-build-properties`). **Don't do it.** Keep `minSdk` inherited (24) and gate at runtime:

```kotlin
@RequiresApi(Build.VERSION_CODES.S)   // 31
private fun applyRenderEffect() { … }

if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) applyRenderEffect() else applyFallback()
```
Relevant API floors for a glass renderer: `RenderEffect`/`RenderNode` blur = **API 31 (S)**; `RuntimeShader` (AGSL) = **API 33 (T)**; `View.setRenderEffect` = API 31. With minSdk 24 you need a fallback path for 24–30. (For prior art, `@uginy/react-native-liquid-glass` — already a dependency of `example/` — describes itself as *"AGSL GPU shaders on Android, native glass compositor on iOS"*.)

### 2.6 Proposed file for this repo

```gradle
// android/build.gradle
plugins {
  id 'com.android.library'
  id 'expo-module-gradle-plugin'
}

group = 'expo.modules.liquidglass'
version = '0.1.11'

android {
  namespace "expo.modules.liquidglass"
  defaultConfig {
    versionCode 1
    versionName "0.1.11"
  }
  lintOptions {
    abortOnError false
  }
}
```
Plus `android/src/main/AndroidManifest.xml` = `<manifest>\n</manifest>` (verbatim from the SDK 56 template) and `android/.gitignore` (see §8).

---

## 3. expo-modules-core Kotlin DSL

All signatures below verified against `expo-modules-core/android/src/main/java/expo/modules/kotlin/**` (3.0.29) and the `sdk-56` template snippets.

### 3.1 Module + View skeleton

```kotlin
package expo.modules.liquidglass

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.apifeatures.EitherType
import expo.modules.kotlin.types.Either

@OptIn(EitherType::class)
class ExpoLiquidGlassModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ExpoLiquidGlass")                       // must match NATIVE_MODULE_NAME

    Constant("supportsNativeGlass") { false }     // Kotlin analogue of Swift `Constant(_:_:)`

    View(LiquidGlassView::class) {
      Name("LiquidGlassView")                     // <-- REQUIRED: this repo uses named views
      Events("onRendererChange")

      Prop("variant")      { view: LiquidGlassView, v: GlassVariant?  -> view.variant  = v ?: GlassVariant.regular }
      Prop("renderer")     { view: LiquidGlassView, v: GlassBackend?  -> view.backend  = v ?: GlassBackend.auto }
      Prop("cornerStyle")  { view: LiquidGlassView, v: GlassCornerStyle? -> view.cornerStyle = v ?: GlassCornerStyle.continuous }
      Prop("cornerRadius") { view: LiquidGlassView, v: Either<Double, GlassCornerRadii>? -> view.cornerRadii = CornerRadii.from(v) }
      Prop("tint")         { view: LiquidGlassView, c: Color?         -> view.tint = c }
      Prop("interactive")  { view: LiquidGlassView, b: Boolean?       -> view.isInteractive = b ?: false }
      Prop("metal")        { view: LiquidGlassView, o: GlassMetalOptions? -> view.metal = o ?: GlassMetalOptions() }

      OnViewDidUpdateProps { view: LiquidGlassView -> view.commitProps() }
      OnViewDestroys       { view: LiquidGlassView -> view.release() }
    }

    View(LiquidGlassContainerView::class) {
      Name("LiquidGlassContainerView")
      Prop("spacing") { view: LiquidGlassContainerView, v: Double? -> view.spacing = v }
    }
  }
}
```

> **Critical:** this repo's JS calls `requireNativeView("ExpoLiquidGlass", "LiquidGlassView")` and `…"LiquidGlassContainerView"`. The registered RN component name is built as `ViewManagerAdapter_${moduleName}_${viewName}` (`SimpleViewManagerWrapper.getName()` / `ViewManagerWrapperDelegate.name = delegateName ?: "${moduleHolder.name}_${definition.name}"`). If you omit `Name(...)` inside the `View {}` block, the component registers as `ViewManagerAdapter_ExpoLiquidGlass` and JS will not find it. The Swift side gets away with it because Swift infers view names differently; **on Android you must call `Name()` inside each `View {}` block.**

Other module-level DSL (`ModuleDefinitionBuilder.kt` / `ObjectDefinitionBuilder.kt`):
- `Constant(name) { value }` and `Property(name) { value }`. `Constants(vararg Pair)` / `Constants { map }` exist but are **`@Deprecated("Use \`Constant\` or \`Property\` instead")`**.
- `Function(name) { … }` (sync), `AsyncFunction(name) { … }` (up to 8 args, optional trailing `Promise`), `Events(vararg String)`, `OnCreate {}`, `OnDestroy {}`.

### 3.2 Union-of-strings prop → Kotlin `Enumerable` enum

`EnumTypeConverter.kt` — two modes, chosen by the primary constructor:

```kotlin
// Mode A: no constructor params -> matched against the ENUM CONSTANT NAME (exact, case-sensitive)
enum class GlassVariant : Enumerable { regular, clear }

// Mode B: exactly one constructor param (String or Int) -> matched against THAT param's value
enum class GlassRenderer(val value: String) : Enumerable {
  AUTO("auto"), NATIVE("native"), METAL("metal")
}
```
> Mode B is the safe choice when JS values aren't valid Kotlin identifiers or you want idiomatic `UPPER_CASE` names. Mode A is what the Swift side effectively does (`case regular` ↔ `"regular"`).

Failure mode: `EnumNoSuchValueException`. Also, `EnumTypeConverter.init` logs an error if the enum doesn't implement `Enumerable` — it does not throw, but the converter won't be selected properly. Always implement `Enumerable`.

For this repo the three enums map 1:1 to `ios/Enums/GlassVariant.swift`:
`GlassVariant{regular,clear}`, `GlassBackend{auto,native,metal}`, `GlassCornerStyle{continuous,circular}`.

### 3.3 Nested object props → `Record` + `@Field`

```kotlin
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

class GlassRefractionCurve : Record {
  @Field var power: Double = 1.0
  @Field var bias:  Double = 0.0
}

class GlassRefractionOptions : Record {
  @Field var amount: Double? = null
  @Field var width:  Double? = null
  @Field var height: Double? = null
  @Field var depth:  Double? = null
  @Field var curve:  GlassRefractionCurve? = null     // nested Record — recursive, works
}

class GlassMetalOptions : Record {
  @Field var blurRadius: Double? = null
  @Field var captureQuality: Double? = null
  @Field var opacity: Double? = null
  @Field var frost: Double? = null
  @Field var saturation: Double? = null
  @Field var noise: Double? = null
  @Field var light: Double? = null
  @Field var refraction: GlassRefractionOptions? = null
  @Field var dispersion: GlassDispersionOptions? = null
  @Field var highlight:  GlassHighlightOptions?  = null
  @Field var border:     GlassBorderOptions?     = null
}
```

Verified semantics from `records/RecordTypeConverter.kt`:
- Reflects over `memberProperties` and keeps only those annotated `@Field`. **Must be `var` with a backing field** — the converter does `property.javaField!!.set(instance, casted)`. `val` or computed properties are unusable.
- JS key = `@Field(key = "…")` if non-blank, else the Kotlin property name.
- `if (!jsMap.hasKey(jsKey)) { if (isRequired) throw FieldRequiredException; return@forEach }` — **omitted keys leave the initializer value untouched.** Combined with `ObjectConstructorFactory` (`allocators/ObjectConstructorFactory.kt`), which prefers a no-arg constructor before falling back to `UnsafeAllocator`, **Kotlin default field initializers DO run** as long as your Record has a no-arg constructor (i.e. all constructor params optional, or none). This mirrors the Swift `Record` + `@Field` default-value behaviour exactly.
- Nested Records: `converterProvider.obtainTypeConverter(property.returnType)` recurses — arbitrary depth. Your `GlassMetalOptions → GlassRefractionOptions → GlassRefractionCurve` chain is fine.
- `@Required` marks a field mandatory; `@BindUsing`-annotated validators are supported (`Validators.kt`).
- Errors surface as `RecordCastException` / `FieldCastException(propertyName, returnType, recordType, cause)` — reasonably readable in Logcat.

**Deep-object prop diffing:** SDK 56's `NativeViewManagerAdapter.native.tsx` deliberately leaves `diff` unset on the generated view-config attributes:
> *"`diff` is intentionally left unset so React Native falls back to its `deepDiffer` default, which does structural comparison for object/array props."*

So a freshly-allocated but structurally identical `metal` object literal will **not** re-trigger the prop setter. Good for perf; means you can't use prop identity as a change signal.

### 3.4 `number | object` union (`cornerRadius`)

**Option A — `Either<Double, GlassCornerRadii>` (recommended; matches iOS 1:1).** Supported as a Prop type; `TypeConverterProvider.handelEither()` dispatches to `EitherTypeConverter` / `EitherOfThree` / `EitherOfFour`. API on Android (`types/Either.kt`):

```kotlin
@OptIn(EitherType::class)   // @RequiresOptIn(level = WARNING) — warning only, not an error
Prop("cornerRadius") { view: LiquidGlassView, value: Either<Double, GlassCornerRadii>? ->
  view.cornerRadii = when {
    value == null                      -> CornerRadii.uniform(0f)
    value.`is`(Double::class)          -> CornerRadii.uniform(value.get(Double::class).toFloat())
    value.`is`(GlassCornerRadii::class)-> CornerRadii.of(value.get(GlassCornerRadii::class))
    else                               -> CornerRadii.uniform(0f)
  }
}
```
Notes: `is(KClass)` / `get(KClass)` are `@JvmName`-disambiguated overloads; `first()` / `second()` also exist. Conversion is lazy and memoized (`UnconvertedValue` → `ConvertedValue` | `IncompatibleValue`); `is()` swallows the conversion `Throwable` and caches `IncompatibleValue`, so probing is cheap and safe in either order. Backticks around `` `is` `` are required (Kotlin keyword).

**Option B — normalize in JS.** In `LiquidGlassView.tsx`, expand `cornerRadius` into `{topLeft,topRight,bottomRight,bottomLeft}` before handing it to the native view. Pro: avoids the experimental `Either` API, identical behavior on all platforms, one code path. Con: requires changing the iOS Swift `Prop("cornerRadius")` signature too (or supporting both), i.e. touching working iOS code.

**Option C — two props** (`cornerRadius: Double?` + `cornerRadii: Record?`). Cleanest natively but changes the public TS API.

**Recommendation:** Option A. `Either` is stable in practice (used by first-party modules), the opt-in is warning-level, and iOS/Android stay symmetric with zero iOS churn.

### 3.5 `ColorValue` / color props

**Kotlin type: `android.graphics.Color`** (the API-26 value class, not an `Int`). `types/ColorTypeConverter.kt` is `@RequiresApi(Build.VERSION_CODES.O)` — fine at minSdk 24 because the converter is only instantiated when you declare a `Color` prop, but you should still guard/verify; using `Int` avoids the question entirely.

Accepted JS forms (exhaustive, from `convertFromDynamic` / `convertFromAny`):

| JS value | Handled? | How |
|---|---|---|
| `ReadableType.Number` (e.g. output of `processColor()`) | ✅ | `Color.valueOf(int)` |
| `"#RRGGBB"` / `"#AARRGGBB"` / `"#RGB"` | ✅ | `androidx.core.graphics.toColorInt` (= `Color.parseColor`) |
| CSS named colors (`"red"`, `"transparent"`, …) | ✅ | built-in 148-entry `namedColors` table (CSS3/SVG + `transparent`) |
| `[r,g,b]` / `[r,g,b,a]` array of 0–1 doubles | ✅ | `Color.valueOf(f,f,f,f)` |
| **`"rgba(0,0,0,0.5)"` / `"rgb(...)"` / `"hsl(...)"`** | ❌ | `toColorInt` throws `IllegalArgumentException` → `PropSetException` logged, prop dropped |
| **`"#RRGGBBAA"` (CSS-4 order, valid in RN)** | ⚠️ **silently wrong** | `Color.parseColor` treats 8-digit hex as **`#AARRGGBB`** — channels get permuted |
| **`PlatformColor(...)` / `DynamicColorIOS(...)`** (objects) | ❌ | `ReadableType.Map` → `UnexpectedException("Unknown argument type: Map")` |

Crucially, colors are **not** pre-processed by RN: SDK 56's view-config generator attaches only `process: processPropValue`, whose sole job is unwrapping `SharedObject`s to their registry ids — everything else passes through unchanged. And the Android `CoreModule.getViewConfig` emits `validAttributes[prop] = true` with no `processColor`.

**Recommendations for `tint`:**
1. Declare it as `Int?` in Kotlin and normalize in JS: `tint={processColor(tint)}`. This makes every RN color form work (RN's `processColor` handles `rgba()`, `hsl()`, `#RRGGBBAA`, named colors, and `PlatformColor` on Android) and sidesteps the API-26 converter. **Preferred.**
2. Or keep `Color?` and document the restriction to hex/named/int. If you do, at minimum reject/convert `#RRGGBBAA` in JS.

Free-form objects: `MapTypeConverter.kt` gives you `Map<String, Any?>`; `ReadableArgumentsTypeConverter.kt` gives `ReadableArguments`. Prefer `Record` — it's typed and validated.

### 3.6 Firing `onRendererChange`

```kotlin
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView

class LiquidGlassView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val onRendererChange by EventDispatcher()          // Map<String, Any> payload
  // or: private val onRendererChange by EventDispatcher<RendererChangeRecord>()

  private fun reportRenderer(name: String) {
    onRendererChange(mapOf("renderer" to name))
  }
}
```

Mechanics (`viewevent/ViewEventDelegate.kt`, `viewevent/ViewEvent.kt`):
- **The event name is the Kotlin property name** (`property.name`), so `onRendererChange` must match the string in `Events("onRendererChange")` exactly. Mismatch → `⚠️ Event X wasn't exported from …` warning and a silently dropped event (validated once, then cached).
- The delegate holds a `WeakReference` to the view; reading it after the view is deallocated throws `IllegalStateException`.
- Payload conversion: `Map`/`Record` → `WritableMap` verbatim; anything else is wrapped as `{ payload: <value> }`. `Unit`/`null` → `null` body.
- Optional coalescing: `EventDispatcher<T>(coalescingKey = { e -> shortKey })` — useful for high-frequency events; not needed here.
- JS shape is unchanged: the handler receives `{ nativeEvent: { renderer: "metal" } }`, matching `INativeLiquidGlassViewProps` and the existing `handleRendererChange` unwrap in `LiquidGlassView.tsx`. Registration goes through `getExportedCustomDirectEventTypeConstants()` → `{ normalizeEventName(name): { registrationName: name } }`, which is surfaced to JS as `directEventTypes` in the view config.

### 3.7 Prop ordering, batching, and the coalescing hook

Verified in `views/ViewManagerWrapperDelegate.kt` + `views/{Simple,Group}ViewManagerWrapper.kt`:

```kotlin
fun updateProperties(view: View, propsMap: ReadableMap): List<String> {
  val iterator = propsMap.keySetIterator()
  while (iterator.hasNextKey()) {
    val key = iterator.nextKey()
    expoProps[key]?.let { it.set(propsMap.getDynamic(key), view, appContext) }  // try/catch per prop
  }
  return handledProps
}
override fun onAfterUpdateTransaction(view: View) {
  super.onAfterUpdateTransaction(view)
  viewWrapperDelegate.onViewDidUpdateProps(view)
}
```

- **Order is the key-iteration order of the props map for that commit** — i.e. driven by the JS props object / RN's diff, **not** by the order you declare `Prop(...)` in the DSL. Never write a setter that depends on another prop having been set already.
- **Setter failures are isolated**: each prop is wrapped in try/catch; a bad value logs `❌ Cannot set the '<name>' prop on the '<view>'` and reports to LogBox, then the remaining props still apply. A partially-configured view is a real possibility — defend in `OnViewDidUpdateProps`.
- Props not claimed by your `Prop(...)` map are forwarded to RN's own `ViewManager.updateProperties` via `FilteredReadableMap`, so RN style props still work.
- **`OnViewDidUpdateProps { view -> }` is the coalescing hook.** It fires exactly once per mount transaction, after every prop in that commit has been applied (`onAfterUpdateTransaction`). This is the Android analogue of a `setNeedsAppearanceUpdate()` + `CATransaction` flush. Use it to do a single shader/render-node rebuild instead of one per prop setter — mirroring how `ios/Views/LiquidGlassView.swift` uses `setNeedsAppearanceUpdate()` + `hasPendingAppearanceUpdate`.
- Errors thrown inside `OnViewDidUpdateProps` are caught and wrapped as `OnViewDidUpdatePropsException`.
- Every `View(...)` block additionally auto-registers RN CSS props: `ModuleDefinitionBuilder.kt:100` calls `viewDefinitionBuilder.UseCSSProps()` (`views/decorators/CSSProps.kt`), giving you `backgroundColor`, `borderRadius` (+ per-corner/logical variants), `borderWidth`, `borderColor`, `borderStyle`, `boxShadow` etc. for free via `BackgroundStyleApplicator`. **Note the collision risk:** a JS `style={{ borderRadius }}` will clip through RN's applicator independently of your `cornerRadius` prop.
- `AsyncFunction("…") { view: LiquidGlassView, … -> }` inside a `View {}` block registers a **view function**, exposed on the component's ref (assigned onto the component prototype from `nativeModule.ViewPrototypes[…]` — see `NativeViewManagerAdapter.native.tsx`). Not needed today.
- `OnViewDestroys { view -> }` fires from `onDropViewInstance`; use it to release `RenderNode`s / bitmaps / `Choreographer` callbacks.

**Props vs. first draw:** props for a commit and the layout for that commit are applied within the same mount transaction on the UI thread and complete before the frame is drawn — so all initial props are set before the first draw. However, the *relative* ordering of `updateProps` vs `updateLayout` instructions inside a single Fabric transaction is not something I verified from source (**UNVERIFIED**). Practical rule: **do not read `view.width`/`view.height` inside a `Prop` setter or in `OnViewDidUpdateProps`.** Recompute size-dependent state in `onSizeChanged`/`onLayout` and mark a dirty flag from `OnViewDidUpdateProps` — exactly the `shapeIsValid`/`cachedShapeSize` pattern the Swift implementation already uses in `layoutSubviews`.

---

## 4. Children and layout

### 4.1 What `ExpoView` is

`views/ExpoView.kt` (verbatim, abridged):
```kotlin
abstract class ExpoView(context: Context, val appContext: AppContext) : LinearLayout(context) {
  var stateWrapper: StateWrapper? = null
  val shadowNodeProxy: ShadowNodeProxy = ShadowNodeProxy(this)

  open val shouldUseAndroidLayout: Boolean = false

  @UiThread fun measureAndLayout() { measure(EXACTLY(width), EXACTLY(height)); layout(left, top, right, bottom) }
  override fun requestLayout() { super.requestLayout(); if (shouldUseAndroidLayout) post { measureAndLayout() } }

  open fun clipToPaddingBox(canvas: Canvas) { if (!clipToPadding) return; BackgroundStyleApplicator.clipToPaddingBox(this, canvas) }
  override fun dispatchDraw(canvas: Canvas) { clipToPaddingBox(canvas); super.dispatchDraw(canvas) }
}
```

`ExpoView` **is a `ViewGroup`** (`LinearLayout`). `ViewManagerDefinition.getViewManagerType()` returns `GROUP` whenever `ViewGroup::class.java.isAssignableFrom(viewType)`, so any `ExpoView` subclass is automatically backed by `GroupViewManagerWrapper : ViewGroupManager<ViewGroup>`.

### 4.2 Do children get correct measure/layout automatically?

**Yes, for free — as long as React children remain direct children of the `ExpoView`.** `GroupViewManagerWrapper` does not override `needsCustomLayoutForChildren()`, so React's mounting layer applies Yoga-computed absolute frames to each child itself. `LinearLayout`'s own measure/layout is effectively bypassed. This is a meaningful difference from iOS, where the Swift class must implement `mountChildComponentView`/`unmountChildComponentView` (as `ios/Views/LiquidGlassView.swift:334` and `LiquidGlassContainerView.swift` do).

**If you re-parent children** (e.g. into an internal content container, the way iOS routes them into `contentContainer` / `UIVisualEffectView.contentView`), you must keep RN's view-hierarchy accounting consistent by overriding the group hooks — that's what the `GroupView` DSL is for (`views/ViewGroupDefinitionBuilder.kt`):

```kotlin
View(LiquidGlassView::class) {
  GroupView<LiquidGlassView> {
    AddChildView      { parent, child: View, index -> parent.contentHost.addView(child, index) }
    GetChildCount     { parent -> parent.contentHost.childCount }
    GetChildViewAt    { parent, index -> parent.contentHost.getChildAt(index) }
    RemoveChildViewAt { parent, index -> parent.contentHost.removeViewAt(index) }
    RemoveChildView   { parent, child: View -> parent.contentHost.removeView(child) }
  }
}
```
These map to `GroupViewManagerWrapper.{addView,getChildCount,getChildAt,removeViewAt,removeView}`.

**Recommendation: do NOT re-parent on Android.** Draw the glass in `onDraw`/`dispatchDraw` (or as a background `RenderNode`/`RenderEffect` on the view itself) *before* `super.dispatchDraw(canvas)`, and clip with a `ViewOutlineProvider` / `Path`. Children then keep RN-provided layout with zero native plumbing, and the whole `GroupView` block is unnecessary.

For reference, the flawed approach in `expo-liquid-glass-native`: it adds a `ComposeView` as child 0 in `init { addView(composeView, 0) }` and then fights RN's ordering with `override fun onViewAdded(child) { if (child != composeView) bringChildToFront(child) }` — plus a `PopupWindow` + `ReactSurface` overlay host. That's exactly the pattern to avoid.

### 4.3 How this differs from `containerStyle` on iOS

`containerStyle` is currently a **pure-JS** concern: `LiquidGlassView.tsx` strips it from `nativeProps` and wraps children in `<View pointerEvents="box-none" style={containerStyle}>`. That wrapper is a normal RN view. On iOS it happens to be re-parented by `mountChildComponentView` into `contentContainer`. **On Android it needs no native support whatsoever** — it becomes a direct child of the `ExpoView` and is laid out by Yoga. `containerStyle` therefore works on Android with zero Kotlin code.

### 4.4 `shouldUseAndroidLayout`

Only set this to `true` if your native content calls `requestLayout()` internally and needs Android to re-measure (typical for Compose/`ComposeView`/`WebView` hosts). The doc comment warns content may render outside Yoga's bounds. **A Canvas/RenderNode glass renderer does not need it — leave it `false`.**

### 4.5 Architecture: RN 0.85 / SDK 56

**New Architecture only. Old (Paper) architecture is not supported and cannot be re-enabled.**
- Expo SDK 54 was the last SDK supporting the Old Architecture; SDK 55+ runs entirely on the New Architecture.
- React Native 0.82 removed the option to disable it; `newArchEnabled: false` is ignored.
- SDK 56 = RN 0.85 + React 19.2, Hermes v1 default.

Practical consequences:
- `example/app.json`'s `"newArchEnabled": true` is now a no-op but harmless.
- No `ReactNativeFeatureFlags`/interop-layer branching needed. Do not write any `if (isBridgeless)` code — contrast with `expo-liquid-glass-native`'s commit `674b38d1 "fix: use legacy overlay host when app runtime is not bridgeless"`.
- Do **not** use `UIManagerModule` / `NativeViewHierarchyManager` (the reference repo's `ExpoLiquidGlassNativeModule.kt` `captureViewAtPosition` does — that's legacy-arch API).
- `stateWrapper` on `ExpoView` is the Fabric shadow-state channel if you ever need native-driven intrinsic sizing.

---

## 5. TypeScript platform branching

### 5.1 What resolves what

**Metro** resolves platform extensions from `resolver.platforms` in this order for a given specifier `./Foo`: `Foo.<platform>.<ext>` → `Foo.native.<ext>` (native platforms only) → `Foo.<ext>`. Applies equally to `src/` (dev, via the example's `extraNodeModules`) and `build/` (published, via `main`).

**`expo-module build` is `tsc --build`**, not Babel (verified: `packages/expo-module-scripts/bin/expo-module-build` shells out to `expo-module-tsc` with `--build`). Consequences:
- `src/Foo.android.ts` → `build/Foo.android.js` + `build/Foo.android.d.ts`. File names are preserved, so Metro's platform resolution works on the published output. ✅
- **TypeScript itself does not understand platform extensions.** `expo-module-scripts/tsconfig.base.json` (fetched verbatim) sets `moduleResolution: "bundler"`, `verbatimModuleSyntax: true`, `isolatedModules: true`, `customConditions: ["expo-source"]` — but **no `moduleSuffixes`**. So `import X from './Foo'` type-resolves to `./Foo.ts` only.
- Therefore: **every platform-split module needs a base `.ts`/`.tsx` file** (which doubles as the default/native implementation) plus `.web.*` (and optionally `.ios.*`/`.android.*`) overrides. All variants are compiled because `tsconfig.json` has `include: ["./src"]`, but only the base one is used for type resolution — so keep the variants' public signatures identical or TS won't catch drift.

This is exactly the pattern the reference repo uses: `src/ExpoLiquidGlassNativeView.tsx` (base, native) + `src/ExpoLiquidGlassNativeView.web.tsx`, and `ExpoLiquidGlassNativeModule.ts` + `.web.ts`. It's also what the SDK 56 template's `snippets/View/{view.tsx.ejs,view.web.tsx.ejs}` generate.

### 5.2 What `requireNativeView` / `requireNativeModule` do when native is absent

Verified against `sdk-56`:

| Call | Web | Native, module missing |
|---|---|---|
| `requireNativeViewManager` (`= requireNativeView` from `expo`) | **Throws `UnavailabilityError` immediately** (`NativeViewManagerAdapter.tsx`) | Does **not** throw. `globalThis.expo.getViewConfig()` returns `null` → `console.warn("Unable to get the view config for …")` → returns a component with only `{ uiViewClassName }`. Fails at render. |
| `requireNativeModule(name)` | Returns `{}` under SSR (`typeof window === 'undefined'`), else throws `Cannot find native module '<name>'` | Throws `Cannot find native module '<name>'` |
| `requireOptionalNativeModule(name)` | Returns `null` (unless in a DOM-component webview) | Returns `null`, catching and `console.warn`ing any error |

`requireNativeView` in `expo` is literally `requireNativeViewManager` re-exported (`packages/expo/src/Expo.ts` @ sdk-56: `requireNativeViewManager as requireNativeView`).

**Consequence:** `src/views/*.ts` must not be evaluated on web. The existing `requireNativeViewOnce` memo-cache does not help — the throw happens inside it.

### 5.3 Concrete restructure for this repo

Minimal, surgical, keeps the existing barrel structure:

```
src/utils/
  platform.utils.ts        # base = native default
  platform.utils.web.ts    # web override
src/views/
  NativeLiquidGlassView.ts            # base: requireNativeViewOnce(...)
  NativeLiquidGlassView.web.ts        # web: export a plain RN View shim
  NativeLiquidGlassContainerView.ts
  NativeLiquidGlassContainerView.web.ts
```

**`src/utils/platform.utils.ts`** — the one-line change that unblocks Android:
```ts
import { Platform } from "react-native";
import { ExpoLiquidGlassModule } from "../modules";

// `supportsNativeGlass` is now reported by BOTH native platforms via Constant(...)
const supportsNativeGlass: boolean =
  (Platform.OS === "ios" || Platform.OS === "android") &&
  ExpoLiquidGlassModule?.supportsNativeGlass === true;
```
`ExpoLiquidGlassModule` already uses `requireOptionalNativeModule`, which is `null`-safe on web — so `platform.utils.web.ts` is optional, but adding one that hard-codes `false` avoids evaluating the module lookup at all.

**`src/views/NativeLiquidGlassView.web.ts`**:
```ts
import { View } from "react-native";
import type { ComponentType } from "react";
import type { INativeLiquidGlassViewProps } from "../interfaces";

const NativeLiquidGlassView = View as unknown as ComponentType<INativeLiquidGlassViewProps>;
export { NativeLiquidGlassView };
```

**`src/components/LiquidGlassView/LiquidGlassView.tsx`** — add the guard `LiquidGlassContainer` already has, but now driven by a capability flag rather than `Platform.OS`, so Android participates:
```tsx
if (!supportsNativeGlass) {
  return <View style={style}><View pointerEvents="box-none" style={containerStyle}>{children}</View></View>;
}
```
This gives you the graceful degradation the README already promises (old Android without RenderEffect → plain view) using the same `Constant("supportsNativeGlass")` mechanism iOS uses for `< iOS 26`. On Android, return `Build.VERSION.SDK_INT >= Build.VERSION_CODES.S` (or 33 if you go AGSL).

**Do not** use `.android.ts`/`.ios.ts` splits for the view modules — a single native base file plus a `.web` override is enough, and it keeps `NATIVE_MODULE_NAME`/`NATIVE_VIEW_NAMES` shared. `.web` is the only split that is strictly required (because of the throw).

**Update `src/constants/glass.constants.ts`**: `MIN_IOS_VERSION_FOR_NATIVE_GLASS = 26` should be joined by an Android equivalent (`MIN_ANDROID_SDK_FOR_NATIVE_GLASS = 31` or `33`).

---

## 6. Do we need a config plugin?

### 6.1 Answer: **No.** Not if the implementation is plain Kotlin + Canvas/RenderNode/RenderEffect.

What autolinking does for you with **zero** consumer configuration, given only `android/build.gradle` + `expo-module.config.json` with an `android.modules` entry:

1. **Project inclusion.** `expoAutolinking.useExpoModules()` in the app's `settings.gradle` (generated by `expo prebuild`) runs `expo-modules-autolinking resolve --platform android --json`, which discovers your package and `include`s `:expo-liquid-glass-view` pointing at `<pkg>/android`. Verified in `expo-modules-autolinking/scripts/android/autolinking_implementation.gradle` and `android/expo-gradle-plugin/expo-autolinking-settings-plugin/`.
2. **Package registration.** `generatePackageList` writes `build/generated/expo/src/main/java/expo/modules/ExpoModulesPackageList.java`, listing your `android.modules` FQCNs — no `MainApplication` edit.
3. **Gradle plugin availability.** `expo-module-gradle-plugin` is `includeBuild`-ed by `expo-autolinking-settings-plugin`, so `id 'expo-module-gradle-plugin'` just resolves.
4. **Versions.** `apply plugin: "expo-root-project"` seeds `compileSdkVersion/minSdkVersion/targetSdkVersion/ndkVersion/kotlinVersion/kspVersion/buildToolsVersion` into `rootProject.extra` from RN's version catalog; the module plugin consumes them.
5. **Dependencies.** `compileOnly project(':expo-modules-core')`, `kotlin-stdlib-jdk7`, test deps — all injected.
6. **Repositories.** `google()`, `mavenCentral()`, JitPack are already in the generated app `build.gradle`.
7. **New in 56:** the Expo Modules Kotlin compiler plugin is applied automatically.

### 6.2 What `expo-liquid-glass-native`'s `app.plugin.js` actually does (and why we don't need it)

`/home/captainhandsome/projects/expo-liquid-glass-native/app.plugin.js`:
- `withGradleProperties`: appends `--enable-native-access=ALL-UNNAMED` to `org.gradle.jvmargs` (a Java 24 workaround; commit `bba02659`).
- `withDangerousMod('android')`: string-rewrites the consumer's `settings.gradle` to inject `pluginManagement { plugins { id("org.jetbrains.kotlin.plugin.compose") version "2.1.20" } } }`, rewrites `app/build.gradle` to convert `apply plugin:` → `plugins { }`, inject the Compose plugin, add four `androidx.compose.*:1.9.5` deps, and append a `kotlin { jvmToolchain(17); compilerOptions { freeCompilerArgs.addAll("-Xcontext-parameters", "-Xskip-metadata-version-check") } }` block.

This is regex surgery on generated files, is wiped by every `expo prebuild --clean`, hard-codes a Kotlin version that will conflict with the app's, and — most importantly — **is entirely unnecessary since SDK 54.** The supported mechanism is the `coreFeatures` field:

```json
{ "coreFeatures": ["compose"] }
```
Autolinking aggregates these and passes a `coreFeatures` Gradle property; `expo-modules-core/android/build.gradle` reads it:
```gradle
def coreFeatures = project.findProperty("coreFeatures") ?: []
ext.shouldIncludeCompose = coreFeatures.contains("compose")
...
if (shouldIncludeCompose) { apply plugin: 'org.jetbrains.kotlin.plugin.compose' }
buildFeatures { compose shouldIncludeCompose }
sourceSets.main.java.srcDirs += shouldIncludeCompose ? 'src/compose' : 'src/withoutCompose'
```
(Field introduced in expo/expo#34015; live example: `packages/expo-ui/expo-module.config.json`.)

**Bottom line:** with a no-Compose implementation we add **no** `app.plugin.js`, **no** `@expo/config-plugins` dependency, and **no** `"app.plugin.js"` key in `package.json`. If a Compose path is ever wanted, the correct move is `"coreFeatures": ["compose"]` + the template's Compose `buildscript`/`buildFeatures` block in `android/build.gradle` — never a dangerous-mod plugin.

**Edge case that *would* need a plugin:** adding a non-standard Maven repository, editing `AndroidManifest.xml` permissions, or setting `expo-build-properties`-style flags. None apply.

---

## 7. Build / test loop

### 7.1 One-time setup

`example/` has no `android/` directory. It does have `android.package` set and already autolinks the parent via `"expo": { "autolinking": { "nativeModulesDir": ".." } }`.

> **How `nativeModulesDir: ".."` works** (`expo-modules-autolinking/src/dependencies/scanning.ts`): if the search path itself contains a `package.json`, autolinking treats that directory as a single module rather than scanning its children —
> ```ts
> // "This is a special case created by create-expo-module's `nativeModulesDir: ../`"
> ```
> So the repo root is linked directly. No symlink, no `npm link` needed.

```bash
cd /home/captainhandsome/projects/expo-liquid-glass-view/example
npm install                      # or bun install — a lockfile-free node_modules is required first
npx expo prebuild --platform android      # generates example/android/
npx expo run:android                      # builds + installs + starts Metro
```
Prerequisites: Android SDK 36 + build-tools 36.0.0, NDK 27.1.12297006 (only if a dep needs C++ — expo-modules-core does), JDK 17 (RN 0.85/AGP 8.12 baseline; newer JDKs may need `org.gradle.jvmargs` tweaks — the reference repo's Java-24 `--enable-native-access=ALL-UNNAMED` hack is evidence of this), `ANDROID_HOME` set.

**Sanity check that autolinking sees the module before building:**
```bash
cd example && npx expo-modules-autolinking resolve --platform android --json | jq '.modules[].packageName'
# expect "expo-liquid-glass-view" in the list
```
Or after prebuild: `cd example/android && ./gradlew projects | grep liquid` → should show `Project ':expo-liquid-glass-view'`.

**`.gitignore`:** `example/android/` is currently NOT ignored, and `example/ios/` is tracked (18 files). Decide deliberately: either commit `example/android/` for parity, or add `/example/android/` to `.gitignore` and treat prebuild as reproducible. Note `.gitignore:11 build/` already covers `example/android/build`, `example/android/app/build`, and `android/build`.

### 7.2 Fastest iteration loop for Kotlin changes

Metro is irrelevant to Kotlin. The loop is:

```bash
# fastest — recompile only the library, then reinstall the app
cd example/android
./gradlew :expo-liquid-glass-view:assembleDebug        # ~seconds after warm cache; catches compile errors
./gradlew :app:installDebug && adb shell am start -n expo.modules.liquidglass.example/.MainActivity
```
Or, in one step (does the same but also re-runs prebuild checks):
```bash
cd example && npx expo run:android --no-bundler        # keeps an existing Metro running
```
Tips:
- Keep Metro alive in a separate terminal (`npx expo start`) and always pass `--no-bundler`.
- `org.gradle.parallel=true` and the Gradle daemon are already on in the template's `gradle.properties`.
- **Open `example/android` in Android Studio** (`npm run open:android` — the script already exists, though it uses macOS `open -a`; on Linux use `studio example/android`). Gradle sync picks up `:expo-liquid-glass-view` as a first-class module with full Kotlin IntelliSense against `expo-modules-core`. This is by far the best editing experience and gives you the debugger + Layout Inspector.
- Kotlin edits **cannot** be hot-reloaded. Android Studio's "Apply Changes" works for method bodies only, and is unreliable across the RN mount layer — prefer a full reinstall.
- `./gradlew :expo-liquid-glass-view:compileDebugKotlin` is the cheapest "does it compile" check.

### 7.3 Logcat

Set a single log tag in Kotlin (`private const val TAG = "ExpoLiquidGlass"`), then:

```bash
# module logs + expo-modules-core errors + crashes
adb logcat -v color -s ExpoLiquidGlass:V ExpoModulesCore:V ReactNativeJS:V AndroidRuntime:E

# or capture everything from just the example app's PID
adb logcat --pid=$(adb shell pidof -s expo.modules.liquidglass.example)

# clear first for a clean run
adb logcat -c && adb logcat --pid=$(adb shell pidof -s expo.modules.liquidglass.example) -v time
```
Signals to grep for, straight from the core source:
- `❌ Cannot set the '<prop>' prop on the '<view>'` → a `Prop` converter rejected a value (bad color string, bad enum case, bad Record field).
- `❌ Error occurred when invoking 'onViewDidUpdateProps' on '<View>'`
- `⚠️ Event <name> wasn't exported from <Module>` → `Events(...)` / `EventDispatcher` property-name mismatch.
- `Unable to get the view config for <viewName> from module <moduleName>` (JS `console.warn`, surfaces as `ReactNativeJS`) → the view isn't registered; usually a missing `Name()` inside the `View {}` block or a missing `android.modules` entry.
- `[ExpoRootProject] Using the following versions:` at configure time — prints the resolved compileSdk/minSdk/kotlin, useful for verifying §2.3.

`expo-modules-core` errors are also reported to LogBox (`appContext.errorManager?.reportExceptionToLogBox`), so they show up as redbox/yellowbox in dev.

### 7.4 Blocker: the example app won't run on Android as-is

`example/screens/LiquidGlassDemo.tsx` imports `GlassButton` and `MatchedText`, and `example/components/ui/swift/matched-text/swiftui+text.tsx` imports:
```ts
import { Text as SwiftText, Host } from "@expo/ui/swift-ui";
import { ... } from "@expo/ui/swift-ui/modifiers";
```
`@expo/ui/swift-ui` is the SwiftUI entry point; its `Host` calls `requireNativeView('ExpoUI', …)` at module scope. On Android those SwiftUI views are not registered, so these screens will warn and fail to render. The plan must add an Android demo screen (or platform-gate `MatchedText`/`GlassButton` behind `Platform.select` / `.android.tsx` variants) before `expo run:android` produces anything useful. Other example deps (`react-native-video`, `react-native-reanimated 4.3.1`, `react-native-worklets`, `react-native-gesture-handler`, `react-native-keyboard-controller`, `@uginy/react-native-liquid-glass`) all ship Android.

---

## 8. Publishing

### 8.1 What actually needs to change

**`.npmignore`: nothing.** This repo's file already contains exactly the three Android entries from the official SDK 56 template (`expo/expo@sdk-56:packages/expo-module-template/$.npmignore`, verbatim):
```
/babel.config.js
/android/src/androidTest/
/android/src/test/
/android/build/
/example/
```

**Add `android/.gitignore`** — this is the template's real mechanism for keeping `.gradle/`, `local.properties`, `.cxx/`, `*.iml`, `captures/` etc. out of both git and the tarball. `npm-packlist` honours nested `.gitignore`/`.npmignore` per directory. I verified this empirically:

```
# .npmignore: (only /*.tgz)   android/.gitignore: ".gradle/\nbuild/"
$ npm pack --dry-run --json
android/build.gradle
android/src/A.kt
index.js
package.json          # android/build/** and android/.gradle/** correctly excluded
```
Copy `expo/expo@sdk-56:packages/expo-module-template/android/.gitignore` verbatim (it's the gitignore.io java/maven/gradle/android/intellij/androidstudio bundle; the load-bearing lines are `.gradle/`, `build/`, `**/build/`, `local.properties`, `.externalNativeBuild`, `*.iml`, `captures/`, `obj/`).

**`package.json`:** no structural change is required for Android. Two things worth doing anyway:
- `"expo-module-scripts": "^4.1.9"` is **stale**. It is now SDK-aligned: `latest = 56.0.3` (`jest-expo ~56.0.4`, `@react-native/jest-preset 0.85.3`, `eslint-config-universe ^15.2.0`). Bump to `~56.0.3` so `expo-module build/lint/test` matches SDK 56. (Note SDK 56's own template has moved off `expo-module-scripts` to self-contained `internal/module_scripts/*.js`; migrating is optional.)
- `"open:android": "open -a \"Android Studio\" example/android"` is macOS-only; harmless.

### 8.2 The `expo-liquid-glass-native` "exclude android build artifacts" commit

Commit `ea650e73` ("fix: exclude android build artifacts from npm package", 2026-04-07, bumped 1.3.11 → 1.3.12). It replaced the template's minimal `.npmignore` with 39 lines. What it added:

```
/node_modules/  /.npm/
__mocks__/  __tests__/  /babel.config.js  /example/  /assets/
/android/.gradle/  /android/build/  /android/bin/  /android/.classpath
/android/.project  /android/.settings/  /android/*.iml  /android/local.properties
/android/**/.cxx/
/ios/build/
**/.DS_Store  **/.gradle/  **/build/  **/bin/  **/.classpath
**/.project  **/.settings/  **/*.iml
/android/src/androidTest/  /android/src/test/
```
and **removed** `/.*/` (the template's "exclude top-level hidden dirs").

**Why:** Gradle build output under `android/` (`.gradle/`, `build/`, `.cxx/`, `*.iml`, `local.properties`) was being published. `android/build/` alone can be tens of MB of intermediates; `local.properties` leaks the publisher's absolute SDK path.

**Two hazards worth learning from, not copying:**

1. **`**/build/` is dangerously broad** — it matches the root `build/` directory, which is this package's entire compiled JS output (`main: build/index.js`). It only survived by accident: npm-packlist force-includes the directory tree containing `main`. I verified both halves:
   ```
   # main:"index.js",  .npmignore:"**/dist/"     -> dist/ EXCLUDED entirely
   # main:"dist/index.js", .npmignore:"**/dist/" -> dist/index.js, dist/other.js, dist/nested/deep.js ALL INCLUDED
   ```
   And confirmed on the registry: `expo-liquid-glass-native@1.3.13` ships `android/ (170 kB)`, `build/ (37.8 kB)`, `ios/`, `src/`. So it works — via a behavior you should not rely on. **Do not add `**/build/` to this repo's `.npmignore`.**
2. Removing `/.*/` means top-level dotfolders (`.expo/`, `.idea/`, `.vscode/`, `.gradle/`) are no longer blanket-excluded. Keep this repo's `/.*/` line.

**Net recommendation for this repo:** leave `.npmignore` as-is, add `android/.gitignore`, and verify with `npm pack --dry-run` before the first Android release. A published tarball should contain `android/build.gradle`, `android/src/main/AndroidManifest.xml`, `android/src/main/java/**/*.kt`, `expo-module.config.json`, `build/**`, `ios/**`, `package.json`, `README.md` — and nothing under `android/build/` or `android/.gradle/`.

**Consumer-side note:** an Expo module is published as **source**, not as an AAR. Consumers compile `android/src/main/java/**` from `node_modules` as a Gradle subproject on every clean build. Keep the source small and dependency-free.

---

## 9. Summary of decisions this research supports

| Question | Answer |
|---|---|
| Add android to `expo-module.config.json`? | Yes: `"platforms": ["apple","android"]` + `"android": { "modules": ["expo.modules.liquidglass.ExpoLiquidGlassModule"] }`. No effect on apple. |
| Gradle style? | `plugins { id 'com.android.library'; id 'expo-module-gradle-plugin' }` — not the legacy `ExpoModulesCorePlugin.gradle`. |
| SDK/tool versions? | compileSdk 36, minSdk 24, targetSdk 36, Kotlin 2.1.20, AGP 8.12.0, Gradle 9.3.1. Inherited automatically. |
| Raise minSdk to 31? | No — manifest merger would break every consumer. Gate at runtime with `Build.VERSION.SDK_INT`. |
| Extra Maven deps? | Work out of the box for google/mavenCentral/jitpack. Prefer zero third-party deps. |
| `cornerRadius` union? | `Either<Double, GlassCornerRadii>` + `@OptIn(EitherType::class)` — matches iOS exactly. |
| `tint` color? | Declare `Int?` and send `processColor(tint)` from JS. The `Color` converter rejects `rgba()`/`PlatformColor` and mis-parses `#RRGGBBAA`. |
| `metal` nested record? | Direct `Record`/`@Field` translation of `ios/Records/GlassMetalOptions.swift`. Defaults survive; nested Records recurse. |
| Coalescing hook? | `OnViewDidUpdateProps { view -> }` — fires once per commit after all props. Prop order is JS-map order, not DSL order. |
| Children? | Free — `ExpoView` is a `ViewGroup`, RN lays out children. Draw glass in `dispatchDraw` before `super`. `containerStyle` needs zero native work. |
| Config plugin? | **No.** Autolinking covers everything; `coreFeatures` covers Compose if ever needed. |
| Old architecture? | Doesn't exist in SDK 56. Don't write compat branches. |
| Publishing? | `.npmignore` already correct; add `android/.gitignore`; bump `expo-module-scripts` to `~56.0.3`. |

### Flagged as UNVERIFIED
- Exact intra-transaction ordering of Fabric's `updateProps` vs `updateLayout` mount instructions (safe workaround given in §3.7).
- JDK version required by SDK 56 (stated as 17 from RN 0.85/AGP 8.12 baselines; not confirmed from an Expo doc).
- Whether `@expo/ui/swift-ui`'s `Host` fails hard or degrades on Android (inferred from `requireNativeView('ExpoUI', 'HostView')` + Android not registering SwiftUI views; not run).
- Whether Gradle 9.3.1 emits new deprecation warnings for the template's `lintOptions { }` block (AGP 8.12 still accepts it; SDK 56 template still ships it).

### Key source URLs
- https://docs.expo.dev/modules/module-api/ · https://docs.expo.dev/modules/module-config/ · https://docs.expo.dev/modules/native-view-tutorial/ · https://docs.expo.dev/modules/autolinking/ · https://docs.expo.dev/guides/new-architecture/
- https://expo.dev/changelog/sdk-56 · https://expo.dev/blog/upgrading-to-sdk-56 · https://expo.dev/changelog/sdk-55
- https://github.com/expo/expo/tree/sdk-56/packages/expo-module-template (`android/build.gradle`, `android/.gitignore`, `expo-module.config.json`, `$.npmignore`, `snippets/View/*`)
- https://github.com/expo/expo/blob/main/packages/expo-modules-autolinking/src/types.ts · `src/ExpoModuleConfig.ts` · `src/platforms/android/android.ts` · `src/dependencies/scanning.ts` · `scripts/android/autolinking_implementation.gradle`
- https://github.com/expo/expo/tree/main/packages/expo-modules-core/expo-module-gradle-plugin (`ExpoModulesGradlePlugin.kt`, `ProjectConfiguration.kt`, `ExpoModuleExtension.kt`)
- https://github.com/expo/expo/tree/main/packages/expo-modules-core/android/src/main/java/expo/modules/kotlin (`views/`, `types/`, `records/`, `viewevent/`, `allocators/`, `modules/`)
- https://github.com/expo/expo/pull/34015 (`coreFeatures`) · https://github.com/expo/expo/blob/main/packages/expo-ui/expo-module.config.json
- https://unpkg.com/react-native@0.85.3/gradle/libs.versions.toml · https://unpkg.com/expo-template-bare-minimum@56.0.33/android/{build.gradle,gradle.properties,gradle/wrapper/gradle-wrapper.properties}
- https://github.com/reactwg/react-native-new-architecture/discussions/290 · https://reactnative.dev/blog/2025/10/08/react-native-0.82
