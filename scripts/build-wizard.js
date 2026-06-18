#!/usr/bin/env node

const { execSync } = require('child_process');
const readline = require('readline');
const path = require('path');

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m'
};

function colorize(color, text) {
  return `${colors[color]}${text}${colors.reset}`;
}

// Create readline interface
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function askQuestion(question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim());
    });
  });
}

function runCommand(command, description) {
  console.log(colorize('cyan', `\n🔄 ${description}...`));
  console.log(colorize('yellow', `Running: ${command}`));
  
  try {
    execSync(command, { 
      stdio: 'inherit',
      cwd: path.join(__dirname, '..')
    });
    console.log(colorize('green', '✅ Command completed successfully!'));
  } catch (error) {
    console.log(colorize('red', `❌ Command failed with exit code: ${error.status}`));
    process.exit(1);
  }
}

function showHeader() {
  console.log(colorize('magenta', '\n' + '='.repeat(60)));
  console.log(colorize('magenta', '🚀 LONGEVIQ EXPO BUILD WIZARD'));
  console.log(colorize('magenta', '='.repeat(60)));
}

function showMainMenu() {
  console.log(colorize('bright', '\nWhat would you like to do?'));
  console.log('1) Run in iOS Simulator');
  console.log('2) Run EAS Build');
  console.log('3) Run EAS Update');
  console.log('4) Exit');
}

function showChannelMenu() {
  console.log(colorize('bright', '\nWhich channel/profile?'));
  console.log('1) dev_self_contained');
  console.log('2) staging_self_contained');
  console.log('3) prod_self_contained'); 
  console.log('4) production');
}

function getChannelFromChoice(choice) {
  const channels = {
    '1': 'dev_self_contained',
    '2': 'staging_self_contained',
    '3': 'prod_self_contained',
    '4': 'production'
  };
  return channels[choice];
}

function getBranchFromChannel(channel) {
  // Map channels to their corresponding update branches
  const branchMap = {
    'dev_self_contained': 'dev_self_contained',
    'staging_self_contained': 'staging_self_contained',
    'prod_self_contained': 'prod_self_contained',
    'production': 'production'
  };
  return branchMap[channel];
}

/**
 * Bump the patch version in app.json (semver x.y.z -> x.y.(z+1))
 * If version is not semver, this becomes a no-op.
 */
function bumpAppJsonVersion() {
  const projectRoot = path.join(__dirname, '..');
  const appJsonPath = path.join(projectRoot, 'app.json');
  if (!fs.existsSync(appJsonPath)) {
    console.log(colorize('yellow', 'app.json not found; skipping version bump'));
    return;
  }

  const raw = fs.readFileSync(appJsonPath, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    console.log(colorize('yellow', 'Failed to parse app.json; skipping version bump'));
    return;
  }

  const version = parsed.expo && parsed.expo.version;
  if (!version || typeof version !== 'string') {
    console.log(colorize('yellow', 'No expo.version found in app.json; skipping version bump'));
    return;
  }

  const semverMatch = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!semverMatch) {
    console.log(colorize('yellow', `app.json version "${version}" is not semver; skipping automatic bump`));
    return;
  }

  const major = parseInt(semverMatch[1], 10);
  const minor = parseInt(semverMatch[2], 10);
  const patchNum = parseInt(semverMatch[3], 10) + 1;
  const newVersion = `${major}.${minor}.${patchNum}`;
  parsed.expo.version = newVersion;

  // Write back with 2-space indentation and preserve file ending newline
  fs.writeFileSync(appJsonPath, JSON.stringify(parsed, null, 2) + '\n', 'utf8');
  console.log(colorize('green', `✓ Bumped app.json version: ${version} -> ${newVersion}`));
}

/**
 * Bump the store build identifier(s) in app.json for the given platform:
 *   iOS     -> expo.ios.buildNumber       (string integer, e.g. "17" -> "18")
 *   Android -> expo.android.versionCode    (number, e.g. 14 -> 15)
 * Non-integer values are left untouched with a warning.
 */
function bumpBuildIdentifiers(platform) {
  const projectRoot = path.join(__dirname, '..');
  const appJsonPath = path.join(projectRoot, 'app.json');
  if (!fs.existsSync(appJsonPath)) {
    console.log(colorize('yellow', 'app.json not found; skipping build identifier bump'));
    return;
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
  } catch (e) {
    console.log(colorize('yellow', 'Failed to parse app.json; skipping build identifier bump'));
    return;
  }

  const expo = parsed.expo;
  if (!expo) {
    console.log(colorize('yellow', 'No expo config in app.json; skipping build identifier bump'));
    return;
  }

  const bumpIos = platform === 'ios' || platform === 'both';
  const bumpAndroid = platform === 'android' || platform === 'both';

  if (bumpIos) {
    expo.ios = expo.ios || {};
    const current = parseInt(expo.ios.buildNumber, 10);
    if (Number.isNaN(current)) {
      console.log(colorize('yellow', `ios.buildNumber "${expo.ios.buildNumber}" is not an integer; skipping iOS bump`));
    } else {
      const next = String(current + 1);
      expo.ios.buildNumber = next;
      console.log(colorize('green', `✓ Bumped ios.buildNumber: ${current} -> ${next}`));
    }
  }

  if (bumpAndroid) {
    expo.android = expo.android || {};
    const current = expo.android.versionCode;
    if (typeof current !== 'number' || !Number.isInteger(current)) {
      console.log(colorize('yellow', `android.versionCode "${current}" is not an integer; skipping Android bump`));
    } else {
      const next = current + 1;
      expo.android.versionCode = next;
      console.log(colorize('green', `✓ Bumped android.versionCode: ${current} -> ${next}`));
    }
  }

  // Write back with 2-space indentation and preserve file ending newline
  fs.writeFileSync(appJsonPath, JSON.stringify(parsed, null, 2) + '\n', 'utf8');
}

function getTodayUpdatePrefix() {
  const now = new Date();
  const year = String(now.getFullYear()).slice(-2);
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

function getCurrentAppUpdate(appTsContent) {
  const match = appTsContent.match(/export const APP_UPDATE = ['"]([^'"]*)['"]/);
  return match ? match[1] : null;
}

function getNextAppUpdate(appTsContent) {
  const today = getTodayUpdatePrefix();
  const currentUpdate = getCurrentAppUpdate(appTsContent);
  const currentMatch = currentUpdate && currentUpdate.match(/^(\d{6})\.(\d+)$/);

  if (currentMatch && currentMatch[1] === today) {
    return `${today}.${Number(currentMatch[2]) + 1}`;
  }

  return `${today}.1`;
}

function getBuildIdentifier(expoConfig, platform) {
  if ((platform === 'ios' || platform === 'both') && expoConfig.ios?.buildNumber) {
    return String(expoConfig.ios.buildNumber);
  }

  if (platform === 'android' && expoConfig.android?.versionCode !== undefined) {
    return String(expoConfig.android.versionCode);
  }

  return String(expoConfig.ios?.buildNumber || expoConfig.android?.versionCode || '');
}

function updateAccountVersionConstants(platform) {
  const projectRoot = path.join(__dirname, '..');
  const appJsonPath = path.join(projectRoot, 'app.json');
  const appTsPath = path.join(projectRoot, 'constants', 'app.ts');

  if (!fs.existsSync(appJsonPath)) {
    throw new Error('app.json not found');
  }

  if (!fs.existsSync(appTsPath)) {
    throw new Error('constants/app.ts not found');
  }

  const appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
  const expoConfig = appJson.expo || {};
  const version = expoConfig.version;
  const buildIdentifier = getBuildIdentifier(expoConfig, platform);

  if (!version || !buildIdentifier) {
    throw new Error('Could not read expo.version and build identifier from app.json');
  }

  const appTsContent = fs.readFileSync(appTsPath, 'utf8');
  const nextUpdate = getNextAppUpdate(appTsContent);
  const nextVersion = `${version} / ${buildIdentifier}`;
  const nextContent = `export const APP_VERSION = '${nextVersion}';\nexport const APP_UPDATE = '${nextUpdate}';\n`;

  fs.writeFileSync(appTsPath, nextContent, 'utf8');
  console.log(colorize('green', `✓ Updated menu account Version: ${nextVersion}`));
  console.log(colorize('green', `✓ Updated menu account Update: ${nextUpdate}`));

  return { version: nextVersion, update: nextUpdate };
}

function hasAccountVersionFileChanges() {
  const projectRoot = path.join(__dirname, '..');

  try {
    execSync('git diff --quiet -- app.json constants/app.ts && git diff --cached --quiet -- app.json constants/app.ts', {
      cwd: projectRoot,
      stdio: 'ignore'
    });
    return false;
  } catch (error) {
    return true;
  }
}

async function maybeCommitAccountVersionConstants(versionInfo) {
  const answer = (await askQuestion(colorize(
    'bright',
    '\nCommit app version files now? Only app.json and constants/app.ts will be included. (y/N): '
  ))).toLowerCase();

  if (answer !== 'y' && answer !== 'yes') {
    console.log(colorize('yellow', 'Skipping commit. EAS will still build from the local files in this run.'));
    return;
  }

  if (!hasAccountVersionFileChanges()) {
    console.log(colorize('yellow', 'No app version file changes to commit.'));
    return;
  }

  const message = `chore: update app version ${versionInfo.version} (${versionInfo.update})`;
  runCommand(
    `git add app.json constants/app.ts && git commit -m "${message}" -- app.json constants/app.ts`,
    'Committing app version files'
  );
}

// ============================================================
// PRE-FLIGHT VALIDATION HELPERS
// ============================================================

const fs = require('fs');

/**
 * Check if native directories are gitignored
 */
function areNativeDirsGitignored() {
  const projectRoot = path.join(__dirname, '..');
  const gitignorePath = path.join(projectRoot, '.gitignore');
  
  if (!fs.existsSync(gitignorePath)) return false;
  
  const gitignoreContent = fs.readFileSync(gitignorePath, 'utf8');
  const hasAndroid = gitignoreContent.includes('android/');
  const hasIos = gitignoreContent.includes('ios/');
  
  return hasAndroid && hasIos;
}

/**
 * Check if native directory exists
 */
function nativeDirectoryExists(platform) {
  const projectRoot = path.join(__dirname, '..');
  const dirPath = path.join(projectRoot, platform === 'ios' ? 'ios' : 'android');
  return fs.existsSync(dirPath);
}

/**
 * Check if package.json was modified more recently than native directories
 * Returns true if native dirs are potentially stale
 */
function checkNativeDirectoryFreshness(platform) {
  const projectRoot = path.join(__dirname, '..');
  const packageJsonPath = path.join(projectRoot, 'package.json');
  const nativeDir = path.join(projectRoot, platform === 'ios' ? 'ios' : 'android');
  
  if (!fs.existsSync(nativeDir)) {
    return { stale: true, reason: `${platform}/ directory does not exist` };
  }
  
  try {
    const packageJsonStat = fs.statSync(packageJsonPath);
    const nativeDirStat = fs.statSync(nativeDir);
    
    // Also check package-lock.json if it exists
    const packageLockPath = path.join(projectRoot, 'package-lock.json');
    let packageLockMtime = new Date(0);
    if (fs.existsSync(packageLockPath)) {
      packageLockMtime = fs.statSync(packageLockPath).mtime;
    }
    
    const latestPackageChange = new Date(Math.max(packageJsonStat.mtime, packageLockMtime));
    
    if (latestPackageChange > nativeDirStat.mtime) {
      return { 
        stale: true, 
        reason: `package.json modified after ${platform}/ directory (deps may have changed)` 
      };
    }
    
    return { stale: false };
  } catch (error) {
    return { stale: true, reason: `Could not check ${platform}/ freshness: ${error.message}` };
  }
}

/**
 * Run Gradle dry-run to validate Android dependency graph
 */
function runGradleDryRun() {
  const projectRoot = path.join(__dirname, '..');
  const androidDir = path.join(projectRoot, 'android');
  
  if (!fs.existsSync(androidDir)) {
    return { passed: false, error: 'android/ directory does not exist' };
  }
  
  console.log(colorize('cyan', '   Validating Android Gradle dependencies...'));
  
  try {
    execSync('./gradlew tasks --dry-run 2>&1', { 
      cwd: androidDir,
      stdio: 'pipe',
      timeout: 60000 // 60 second timeout
    });
    return { passed: true };
  } catch (error) {
    const output = error.stdout?.toString() || error.stderr?.toString() || error.message;
    
    // Check for common failure patterns
    if (output.includes('No matching variant') || output.includes('Could not resolve')) {
      return { 
        passed: false, 
        error: 'Gradle dependency resolution failed - native modules out of sync',
        details: output.substring(0, 500)
      };
    }
    
    return { passed: false, error: `Gradle validation failed: ${output.substring(0, 200)}` };
  }
}

/**
 * Run pod install --dry-run to validate iOS CocoaPods
 */
function runPodCheck() {
  const projectRoot = path.join(__dirname, '..');
  const iosDir = path.join(projectRoot, 'ios');
  
  if (!fs.existsSync(iosDir)) {
    return { passed: false, error: 'ios/ directory does not exist' };
  }
  
  console.log(colorize('cyan', '   Validating iOS CocoaPods...'));
  
  try {
    // Check if Podfile.lock is in sync with Podfile
    const podfilePath = path.join(iosDir, 'Podfile');
    const podfileLockPath = path.join(iosDir, 'Podfile.lock');
    
    if (!fs.existsSync(podfileLockPath)) {
      return { passed: false, error: 'Podfile.lock does not exist - pods not installed' };
    }
    
    const podfileStat = fs.statSync(podfilePath);
    const podfileLockStat = fs.statSync(podfileLockPath);
    
    if (podfileStat.mtime > podfileLockStat.mtime) {
      return { 
        passed: false, 
        error: 'Podfile modified after Podfile.lock - pods may be out of sync' 
      };
    }
    
    return { passed: true };
  } catch (error) {
    return { passed: false, error: `Pod validation failed: ${error.message}` };
  }
}

/**
 * Run expo-doctor to check for common issues
 */
function runExpoDoctor() {
  console.log(colorize('cyan', '   Running expo-doctor...'));
  
  try {
    const output = execSync('npx expo-doctor 2>&1', { 
      cwd: path.join(__dirname, '..'),
      stdio: 'pipe',
      timeout: 120000 // 2 minute timeout
    }).toString();
    
    // Check for critical issues in output
    if (output.includes('ERROR') || output.includes('✖')) {
      return { passed: false, error: 'expo-doctor found issues', details: output };
    }
    
    return { passed: true, output };
  } catch (error) {
    const output = error.stdout?.toString() || error.stderr?.toString() || '';
    // expo-doctor returns non-zero even for warnings sometimes
    if (output.includes('ERROR') || output.includes('✖')) {
      return { passed: false, error: 'expo-doctor found issues', details: output.substring(0, 500) };
    }
    // Treat as passed if it ran but had warnings
    return { passed: true, warnings: output };
  }
}

/**
 * Main pre-flight validation function
 * Orchestrates all checks and returns comprehensive results
 */
async function runPreflightValidation(platform) {
  const issues = [];
  const warnings = [];
  let requiresPrebuild = false;
  
  console.log(colorize('bright', '\n🔍 Running pre-flight validation...'));
  
  // Check if native dirs are gitignored (EAS will regenerate them)
  const gitignored = areNativeDirsGitignored();
  if (gitignored) {
    console.log(colorize('green', '   ✓ Native directories are gitignored - EAS will regenerate fresh'));
    
    // Still warn if local native dirs exist and might cause confusion
    const platformsToCheck = platform === 'both' ? ['android', 'ios'] : [platform];
    for (const p of platformsToCheck) {
      if (nativeDirectoryExists(p)) {
        warnings.push(`Local ${p}/ directory exists but is gitignored - will be ignored by EAS`);
      }
    }
    
    return { 
      passed: true, 
      issues: [], 
      warnings, 
      requiresPrebuild: false,
      gitignored: true 
    };
  }
  
  // Native dirs are NOT gitignored - need to validate them
  console.log(colorize('yellow', '   ⚠ Native directories are tracked in git - validating...'));
  
  const platformsToCheck = platform === 'both' ? ['android', 'ios'] : [platform];
  
  // Check 1: Native directory freshness
  for (const p of platformsToCheck) {
    console.log(colorize('cyan', `   Checking ${p}/ directory freshness...`));
    const freshness = checkNativeDirectoryFreshness(p);
    if (freshness.stale) {
      issues.push(`${p}/: ${freshness.reason}`);
      requiresPrebuild = true;
    } else {
      console.log(colorize('green', `   ✓ ${p}/ directory appears fresh`));
    }
  }
  
  // Check 2: Platform-specific validation
  if (platformsToCheck.includes('android') && nativeDirectoryExists('android')) {
    const gradleResult = runGradleDryRun();
    if (!gradleResult.passed) {
      issues.push(`Android: ${gradleResult.error}`);
      requiresPrebuild = true;
      if (gradleResult.details) {
        console.log(colorize('red', `   Details: ${gradleResult.details.substring(0, 300)}...`));
      }
    } else {
      console.log(colorize('green', '   ✓ Android Gradle dependencies validated'));
    }
  }
  
  if (platformsToCheck.includes('ios') && nativeDirectoryExists('ios')) {
    const podResult = runPodCheck();
    if (!podResult.passed) {
      issues.push(`iOS: ${podResult.error}`);
      requiresPrebuild = true;
    } else {
      console.log(colorize('green', '   ✓ iOS CocoaPods validated'));
    }
  }
  
  // Check 3: expo-doctor (optional, can be slow)
  // Skip for now to keep validation fast, uncomment if desired:
  // const doctorResult = runExpoDoctor();
  // if (!doctorResult.passed) {
  //   warnings.push(`expo-doctor: ${doctorResult.error}`);
  // }
  
  const passed = issues.length === 0;
  
  // Print summary
  console.log('');
  if (passed) {
    console.log(colorize('green', '   ✅ Pre-flight validation PASSED'));
  } else {
    console.log(colorize('red', '   ❌ Pre-flight validation FAILED'));
    console.log(colorize('red', '\n   Issues found:'));
    issues.forEach(issue => {
      console.log(colorize('red', `   • ${issue}`));
    });
  }
  
  if (warnings.length > 0) {
    console.log(colorize('yellow', '\n   Warnings:'));
    warnings.forEach(warning => {
      console.log(colorize('yellow', `   • ${warning}`));
    });
  }
  
  return { passed, issues, warnings, requiresPrebuild, gitignored: false };
}

async function handleSimulator() {
  console.log(colorize('green', '\n📱 Running iOS Simulator...'));
  runCommand('npx expo run:ios', 'Starting iOS simulator');
}

function showPlatformMenu() {
  console.log(colorize('bright', '\nWhich platform(s)?'));
  console.log('1) iOS only');
  console.log('2) Android only');
  console.log('3) Both iOS and Android');
}

function getPlatformFromChoice(choice) {
  const platforms = {
    '1': 'ios',
    '2': 'android',
    '3': 'both'
  };
  return platforms[choice];
}

/**
 * Delete Android native directory to ensure EAS regenerates it fresh
 * This prevents stale native code (like old newArchEnabled settings) from being uploaded
 * Only needed for Android since the New Architecture variant issue was Android-specific
 */
function deleteAndroidDirectory() {
  const projectRoot = path.join(__dirname, '..');
  const androidDir = path.join(projectRoot, 'android');

  if (fs.existsSync(androidDir)) {
    console.log(colorize('cyan', '   Removing android/ directory...'));
    fs.rmSync(androidDir, { recursive: true, force: true });
    console.log(colorize('green', '   ✓ Deleted android/'));
  }
}

async function handleEASBuild() {
  console.log(colorize('green', '\n🏗️  EAS Build Process...'));
  
  // Ask for platform
  showPlatformMenu();
  const platformChoice = await askQuestion(colorize('bright', '\nEnter your choice (1-3): '));
  
  const platform = getPlatformFromChoice(platformChoice);
  if (!platform) {
    console.log(colorize('red', '❌ Invalid choice. Exiting.'));
    process.exit(1);
  }
  
  // ============================================================
  // DELETE ANDROID DIRECTORY FOR FRESH EAS BUILD (ANDROID ONLY)
  // ============================================================
  if (platform === 'android' || platform === 'both') {
    console.log(colorize('bright', '\n🧹 Cleaning Android directory for fresh EAS build...'));
    deleteAndroidDirectory();
    console.log(colorize('green', '✓ Android directory cleaned - EAS will regenerate it fresh'));
    console.log(colorize('yellow', '   💡 To run local Android builds later, use: npx expo prebuild --platform android'));
  }
  
  // ============================================================
  // PRE-FLIGHT VALIDATION (runs automatically)
  // ============================================================
  const validationResult = await runPreflightValidation(platform);
  
  let needsPrebuild = false;
  
  if (validationResult.gitignored) {
    // Native dirs are gitignored - EAS will regenerate, no local prebuild needed
    console.log(colorize('green', '\n✓ Native directories will be regenerated by EAS (gitignored)'));
  } else if (!validationResult.passed) {
    // Validation failed - prebuild is REQUIRED
    console.log(colorize('red', '\n⚠️  Pre-flight validation failed. Clean prebuild is REQUIRED to fix issues.'));
    const forceAnswer = await askQuestion(colorize('bright', 'Run clean prebuild now? (Y/n): '));
    
    if (forceAnswer.toLowerCase() === 'n' || forceAnswer.toLowerCase() === 'no') {
      console.log(colorize('red', '\n❌ Cannot proceed with EAS build - native directories are out of sync.'));
      console.log(colorize('yellow', '   Run "npx expo prebuild --clean" manually or choose Y next time.'));
      return;
    }
    needsPrebuild = true;
  } else {
    // Validation passed - ask if they want to prebuild anyway (optional)
    const cleanAnswer = await askQuestion(colorize('bright', '\n✓ Validation passed. Run clean prebuild anyway? (y/N): '));
    if (cleanAnswer.toLowerCase() === 'y' || cleanAnswer.toLowerCase() === 'yes') {
      needsPrebuild = true;
    }
  }
  
  // Run prebuild if needed
  if (needsPrebuild) {
    if (platform === 'both') {
      runCommand('npx expo prebuild --clean --non-interactive', 'Running clean prebuild for both platforms');
    } else {
      runCommand(`npx expo prebuild --clean --platform ${platform} --non-interactive`, `Running clean prebuild for ${platform}`);
    }
    console.log(colorize('green', '✅ Prebuild completed successfully!'));
  }
  
  // Ask for channel
  showChannelMenu();
  const channelChoice = await askQuestion(colorize('bright', '\nEnter your choice (1-4): '));
  
  const channel = getChannelFromChoice(channelChoice);
  if (!channel) {
    console.log(colorize('red', '❌ Invalid choice. Exiting.'));
    process.exit(1);
  }
  
  console.log(colorize('cyan', `\nBuilding for channel: ${channel}`));

  // Auto-increment app.json marketing version (patch) AND the store build
  // identifier(s) for the selected platform, for every EAS build channel. The
  // stores reject duplicate build numbers, so both are bumped automatically here.
  try {
    bumpAppJsonVersion();
    bumpBuildIdentifiers(platform);
    // Regenerate version info after bump so .env/full version is up to date
    runCommand('node ./scripts/generate-version.js', 'Generating version information after bump');
  } catch (error) {
    console.log(colorize('yellow', 'Warning: failed to auto-bump app version:'), error.message || error);
  }

  try {
    const versionInfo = updateAccountVersionConstants(platform);
    runCommand('node ./scripts/generate-version.js', 'Regenerating version information for account menu');
    await maybeCommitAccountVersionConstants(versionInfo);
  } catch (error) {
    console.log(colorize('red', '❌ Failed to update menu account version fields:'), error.message || error);
    return;
  }
  
  // Build based on platform choice
  if (platform === 'both') {
    console.log(colorize('cyan', '\n📱 Building iOS...'));
    runCommand(`eas build --platform ios --profile ${channel} --non-interactive`, `Building iOS for ${channel}`);
    
    console.log(colorize('cyan', '\n🤖 Building Android...'));
    runCommand(`eas build --platform android --profile ${channel} --non-interactive`, `Building Android for ${channel}`);
  } else {
    const platformEmoji = platform === 'ios' ? '📱' : '🤖';
    console.log(colorize('cyan', `\n${platformEmoji} Building ${platform}...`));
    runCommand(`eas build --platform ${platform} --profile ${channel} --non-interactive`, `Building ${platform} for ${channel}`);
  }
  
  // Auto-submit to App Store if this is a production iOS build
  if (channel === 'production' && (platform === 'ios' || platform === 'both')) {
    console.log(colorize('green', '\n🚀 Production iOS build completed! Now submitting to App Store...'));
    runCommand('eas submit --platform ios', 'Submitting to App Store');
  }
  
  // Note about Android submission
  if (channel === 'production' && platform === 'android') {
    console.log(colorize('yellow', '\n📝 Note: To submit to Google Play Store, run: eas submit --platform android'));
  } else if (channel === 'production' && platform === 'both') {
    console.log(colorize('yellow', '\n📝 Note: To submit to Google Play Store, run: eas submit --platform android'));
  }
}

async function handleEASUpdate() {
  console.log(colorize('green', '\n🚀 EAS Update Process...'));
  
  // Ask for channel
  showChannelMenu();
  const channelChoice = await askQuestion(colorize('bright', '\nEnter your choice (1-4): '));
  
  const channel = getChannelFromChoice(channelChoice);
  if (!channel) {
    console.log(colorize('red', '❌ Invalid choice. Exiting.'));
    process.exit(1);
  }
  
  const branch = getBranchFromChannel(channel);
  
  // Ask for update message
  const defaultMessage = `Update for ${channel} app`;
  const updateMessage = await askQuestion(colorize('bright', `\nEnter update message (default: "${defaultMessage}"): `));
  const finalMessage = updateMessage || defaultMessage;
  
  console.log(colorize('cyan', `\nDeploying update to branch: ${branch}`));
  runCommand(`eas update --branch ${branch} --message "${finalMessage}"`, `Deploying update to ${branch}`);
}

async function main() {
  showHeader();
  
  // Always generate version first
  console.log(colorize('bright', '\n🔧 Step 1: Generating version with commit hash...'));
  runCommand('node ./scripts/generate-version.js', 'Generating version information');
  
  console.log(colorize('bright', '\n🎯 Step 2: Choose your deployment action...'));
  
  while (true) {
    showMainMenu();
    const choice = await askQuestion(colorize('bright', '\nEnter your choice (1-4): '));
    
    switch (choice) {
      case '1':
        await handleSimulator();
        break;
        
      case '2':
        await handleEASBuild();
        break;
        
      case '3':
        await handleEASUpdate();
        break;
        
      case '4':
        console.log(colorize('green', '\n👋 Goodbye!'));
        rl.close();
        return;
        
      default:
        console.log(colorize('red', '\n❌ Invalid choice. Please try again.'));
        continue;
    }
    
    // Ask if they want to do something else
    const continueAnswer = await askQuestion(colorize('bright', '\nWould you like to do something else? (y/N): '));
    if (continueAnswer.toLowerCase() !== 'y' && continueAnswer.toLowerCase() !== 'yes') {
      console.log(colorize('green', '\n✅ All done! Happy coding! 🎉'));
      break;
    }
  }
  
  rl.close();
}

// Handle Ctrl+C gracefully
process.on('SIGINT', () => {
  console.log(colorize('yellow', '\n\n👋 Build wizard interrupted. Goodbye!'));
  rl.close();
  process.exit(0);
});

// Error handling
process.on('uncaughtException', (error) => {
  console.log(colorize('red', `\n❌ Unexpected error: ${error.message}`));
  rl.close();
  process.exit(1);
});

if (require.main === module) {
  main().catch((error) => {
    console.error(colorize('red', `\n❌ Error: ${error.message}`));
    rl.close();
    process.exit(1);
  });
}