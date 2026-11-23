const { withProjectBuildGradle } = require("@expo/config-plugins");

const MARKER = "// PetCare CMake object path limit";
const GRADLE_BLOCK = `${MARKER}
subprojects { subproject ->
  if (subproject.name in ["app", "react-native-reanimated"]) {
    ["com.android.application", "com.android.library"].each { pluginId ->
      subproject.plugins.withId(pluginId) {
        subproject.android.defaultConfig.externalNativeBuild.cmake.arguments += "-DCMAKE_OBJECT_PATH_MAX=260"
      }
    }
  }
}`;

module.exports = function withCmakeObjectPathLimit(config) {
  return withProjectBuildGradle(config, (modConfig) => {
    if (modConfig.modResults.language !== "groovy") {
      throw new Error("PetCare's CMake path-length plugin requires a Groovy Android build.gradle.");
    }

    if (!modConfig.modResults.contents.includes(MARKER)) {
      modConfig.modResults.contents = `${modConfig.modResults.contents.trimEnd()}\n\n${GRADLE_BLOCK}\n`;
    }

    return modConfig;
  });
};
