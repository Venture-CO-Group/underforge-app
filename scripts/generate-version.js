#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * Script to generate version with commit hash and update .env file
 * This combines APP_VERSION from constants/app.ts with git commit hash
 */

function getAppVersion() {
  const appTsPath = path.join(__dirname, '..', 'constants', 'app.ts');
  try {
    const appTsContent = fs.readFileSync(appTsPath, 'utf8');
    const match = appTsContent.match(/export const APP_VERSION = ['"](.*)['"]/);
    if (match) {
      return match[1];
    }
  } catch (error) {
    console.warn('Could not read APP_VERSION from constants/app.ts:', error.message);
  }
  return null;
}

function getGitCommitHash() {
  try {
    // Get short commit hash (first 8 characters)
    const commitHash = execSync('git rev-parse --short HEAD', { 
      encoding: 'utf8',
      cwd: path.join(__dirname, '..')
    }).trim();
    return commitHash;
  } catch (error) {
    console.warn('Could not get git commit hash:', error.message);
    return null;
  }
}

function updateEnvFile(fullVersion) {
  const envPath = path.join(__dirname, '..', '.env');
  let envContent = '';
  
  // Read existing .env file if it exists
  try {
    envContent = fs.readFileSync(envPath, 'utf8');
  } catch (error) {
    // .env doesn't exist, we'll create it
    console.log('Creating new .env file');
  }
  
  // Remove any existing EXPO_PUBLIC_FULL_VERSION_WITH_COMMIT_HASH line
  const lines = envContent.split('\n').filter(line => 
    !line.startsWith('EXPO_PUBLIC_FULL_VERSION_WITH_COMMIT_HASH=')
  );
  
  // Add the new version line
  lines.push(`EXPO_PUBLIC_FULL_VERSION_WITH_COMMIT_HASH=${fullVersion}`);
  
  // Write back to .env file
  const newEnvContent = lines.filter(line => line.trim() !== '').join('\n') + '\n';
  fs.writeFileSync(envPath, newEnvContent, 'utf8');
  
  console.log(`Updated .env with EXPO_PUBLIC_FULL_VERSION_WITH_COMMIT_HASH=${fullVersion}`);
}

function main() {
  console.log('='.repeat(60));
  console.log('🚀 EAS BUILD VERSION GENERATION STARTED');
  console.log('='.repeat(60));
  console.log('Generating version with commit hash...');
  console.log(`Current working directory: ${process.cwd()}`);
  console.log(`Script running from: ${__dirname}`);
  
  const appVersion = getAppVersion();
  if (!appVersion) {
    console.error('❌ ERROR: Could not extract APP_VERSION from constants/app.ts');
    process.exit(1);
  }
  
  console.log(`✅ Found APP_VERSION: ${appVersion}`);
  
  const commitHash = getGitCommitHash();
  if (!commitHash) {
    console.warn('⚠️  WARNING: Could not get git commit hash, using APP_VERSION only');
    updateEnvFile(appVersion);
    console.log('='.repeat(60));
    console.log('🏁 VERSION GENERATION COMPLETE (no commit hash)');
    console.log('='.repeat(60));
    return;
  }
  
  console.log(`✅ Found commit hash: ${commitHash}`);
  
  const fullVersion = `${appVersion}-${commitHash}`;
  console.log(`✅ Generated full version: ${fullVersion}`);
  
  updateEnvFile(fullVersion);
  console.log('='.repeat(60));
  console.log('🏁 VERSION GENERATION COMPLETE!');
  console.log('='.repeat(60));
}

if (require.main === module) {
  main();
}

module.exports = { getAppVersion, getGitCommitHash, updateEnvFile };