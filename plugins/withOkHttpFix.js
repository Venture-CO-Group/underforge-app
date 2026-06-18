const { withAppBuildGradle } = require('@expo/config-plugins');

/**
 * Config plugin to fix OkHttp duplicate class issue
 * Forces all OkHttp dependencies to use a single version
 * 
 * This resolves conflicts between:
 * - okhttp:4.12.0 (from React Native)
 * - okhttp-jvm:5.1.0 (from OpenAI SDK)
 */
const withOkHttpFix = (config) => {
  return withAppBuildGradle(config, (config) => {
    const buildGradle = config.modResults.contents;
    
    // Check if the fix is already applied
    if (buildGradle.includes('okhttp3:okhttp')) {
      console.log('✓ OkHttp fix already present in build.gradle');
      return config;
    }
    
    // Add configurations block to exclude okhttp-jvm and force okhttp version
    const resolutionStrategy = `
// Fix OkHttp duplicate class issue (okhttp vs okhttp-jvm conflict)
configurations.all {
    resolutionStrategy {
        // Force all okhttp dependencies to use the same version
        force 'com.squareup.okhttp3:okhttp:4.12.0'
    }
    // Exclude okhttp-jvm which conflicts with okhttp
    exclude group: 'com.squareup.okhttp3', module: 'okhttp-jvm'
}
`;
    
    // Insert after android { block
    const androidBlockRegex = /android\s*\{/;
    if (androidBlockRegex.test(buildGradle)) {
      config.modResults.contents = buildGradle.replace(
        androidBlockRegex,
        `${resolutionStrategy}\nandroid {`
      );
      console.log('✓ Added OkHttp resolution strategy to build.gradle');
    } else {
      console.warn('Could not find android block in build.gradle');
    }
    
    return config;
  });
};

module.exports = withOkHttpFix;

