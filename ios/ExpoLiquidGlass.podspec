require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'ExpoLiquidGlass'
  s.version        = package['version']
  s.summary        = package['description']
  s.description    = package['description']
  s.license        = package['license']
  s.author         = package['author']
  s.homepage       = package['homepage']
  s.platforms      = {
    :ios => '15.1',
    :tvos => '15.1'
  }
  s.swift_version  = '5.4'
  s.source         = { git: 'https://github.com/rit3zh/expo-liquid-glass' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp,metal}"

  s.resource_bundles = {
    'ExpoLiquidGlassShaders' => ['Shaders/bundle-marker.txt']
  }

  s.script_phases = [
    {
      :name => 'Bundle compiled Metal shaders',
      :execution_position => :after_compile,
      :shell_path => '/bin/sh',
      :script => <<-SCRIPT.gsub(/^ {8}/, '')
        set -e

        BUNDLE="${TARGET_BUILD_DIR}/ExpoLiquidGlassShaders.bundle"

        if [ ! -d "$BUNDLE" ]; then
          echo "error: ExpoLiquidGlassShaders.bundle not found at $BUNDLE"
          exit 1
        fi

        # Xcode's implicit .metal compilation does not land in one predictable
        # place. In a normal build it appears in TARGET_BUILD_DIR; in an ARCHIVE
        # TARGET_BUILD_DIR points at .../UninstalledProducts/<platform> and the
        # library is emitted elsewhere (or not at all for a static pod target).
        # Assuming TARGET_BUILD_DIR meant every archive build failed with
        # "default.metallib not found" the first time anyone shipped this.
        for CANDIDATE in \
          "${TARGET_BUILD_DIR}/default.metallib" \
          "${BUILT_PRODUCTS_DIR}/default.metallib" \
          "${METAL_LIBRARY_OUTPUT_DIR}/default.metallib" \
          "${CONFIGURATION_BUILD_DIR}/default.metallib"; do
          if [ -n "$CANDIDATE" ] && [ -f "$CANDIDATE" ]; then
            cp "$CANDIDATE" "$BUNDLE/default.metallib"
            echo "note: bundled metallib from $CANDIDATE"
            exit 0
          fi
        done

        # Nothing implicit to copy — compile the shaders ourselves. Deterministic
        # across configurations, and the only path that works when Xcode skips
        # metal compilation for the pod target entirely.
        SHADER_ROOT="${PODS_TARGET_SRCROOT}"
        [ -d "$SHADER_ROOT" ] || SHADER_ROOT="${PODS_ROOT}"

        METAL_SOURCES=$(find "$SHADER_ROOT" -name '*.metal' 2>/dev/null || true)
        if [ -z "$METAL_SOURCES" ]; then
          echo "error: no .metal sources found under $SHADER_ROOT"
          exit 1
        fi

        WORK="${DERIVED_FILE_DIR}/expo-liquid-glass-metal"
        rm -rf "$WORK" && mkdir -p "$WORK"

        AIR_FILES=""
        for METAL in $METAL_SOURCES; do
          AIR="$WORK/$(basename "${METAL%.metal}").air"
          xcrun -sdk "${PLATFORM_NAME}" metal -c "$METAL" -o "$AIR"
          AIR_FILES="$AIR_FILES $AIR"
        done

        xcrun -sdk "${PLATFORM_NAME}" metallib $AIR_FILES -o "$BUNDLE/default.metallib"
        echo "note: compiled metallib from source ($METAL_SOURCES)"
      SCRIPT
    }
  ]
end
