const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

/**
 * Config plugin to add use_modular_headers! to Podfile
 * This is required for EmbraceIO's KSCrash dependency
 */
const withModularHeaders = (config) => {
  return withDangerousMod(config, [
    'ios',
    async (config) => {
      const podfilePath = path.join(config.modRequest.platformProjectRoot, 'Podfile');
      
      if (!fs.existsSync(podfilePath)) {
        console.warn('Podfile not found, skipping modular headers modification');
        return config;
      }
      
      let podfileContent = fs.readFileSync(podfilePath, 'utf8');
      
      // Check if use_modular_headers! is already present
      if (podfileContent.includes('use_modular_headers!')) {
        console.log('✓ use_modular_headers! already present in Podfile');
        return config;
      }
      
      // Add use_modular_headers! after the platform line
      // Match both static versions and variable-based versions
      const platformRegex = /platform :ios,.*$/m;
      if (platformRegex.test(podfileContent)) {
        podfileContent = podfileContent.replace(
          platformRegex,
          (match) => `${match}\n\n# Enable modular headers for EmbraceIO compatibility\nuse_modular_headers!`
        );
        
        fs.writeFileSync(podfilePath, podfileContent, 'utf8');
        console.log('✓ Added use_modular_headers! to Podfile');
      } else {
        console.warn('Could not find platform declaration in Podfile');
      }
      
      return config;
    },
  ]);
};

module.exports = withModularHeaders;

