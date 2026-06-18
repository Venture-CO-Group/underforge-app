const {
  withMainActivity,
  withAndroidManifest,
} = require('@expo/config-plugins');

const HEALTH_PERMISSIONS = [
  'android.permission.health.READ_STEPS',
  'android.permission.health.READ_EXERCISE',
  'android.permission.health.READ_ACTIVE_CALORIES_BURNED',
  'android.permission.health.READ_TOTAL_CALORIES_BURNED',
  'android.permission.health.READ_BASAL_METABOLIC_RATE',
  'android.permission.health.READ_SLEEP',
  'android.permission.health.READ_HEART_RATE_VARIABILITY',
  'android.permission.health.READ_RESTING_HEART_RATE',
];

const HEALTH_PROVIDER_PACKAGE = 'com.google.android.apps.healthdata';

/**
 * Config plugin that wires up `react-native-health-connect`'s permission
 * delegate inside `MainActivity.onCreate`.
 *
 * Why this is needed:
 *   The library's `HealthConnectPermissionDelegate` registers an
 *   `ActivityResultLauncher` via `activity.registerForActivityResult(...)`,
 *   which Android requires to be called BEFORE the activity reaches
 *   STARTED state. The library does not ship code that does this from a
 *   ReactPackage; the host app is expected to call
 *   `HealthConnectPermissionDelegate.setPermissionDelegate(this)` from
 *   `MainActivity.onCreate`. Without that call, `requestPermission` crashes:
 *     kotlin.UninitializedPropertyAccessException:
 *       lateinit property requestPermission has not been initialized
 *
 * The library's own `app.plugin.js` only patches AndroidManifest.xml to
 * add the `androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE` intent
 * filter, so we must add the MainActivity wiring ourselves.
 *
 * We also re-assert the rationale intent-filter here as a safety net in
 * case the library's plugin runs before/after this one and gets shadowed.
 */

const IMPORT_LINE =
  'import dev.matinzd.healthconnect.permissions.HealthConnectPermissionDelegate';
const SETUP_LINE =
  '    HealthConnectPermissionDelegate.setPermissionDelegate(this)';

function patchMainActivityKotlin(contents) {
  let next = contents;

  if (!next.includes(IMPORT_LINE)) {
    next = next.replace(
      /(package [^\n]+\n)/,
      `$1\n${IMPORT_LINE}\n`,
    );
  }

  if (next.includes('HealthConnectPermissionDelegate.setPermissionDelegate(this)')) {
    return next;
  }

  // Insert immediately after the existing super.onCreate(...) call so the
  // launcher registers before any React lifecycle takes over.
  const superOnCreateRegex = /(super\.onCreate\([^\n)]*\))/;
  if (superOnCreateRegex.test(next)) {
    next = next.replace(superOnCreateRegex, `$1\n${SETUP_LINE}`);
  }
  return next;
}

const withHealthConnectPermissionDelegate = (config) => {
  config = withMainActivity(config, (config) => {
    if (config.modResults.language !== 'kt') {
      console.warn(
        'withHealthConnectPermissionDelegate: MainActivity is not Kotlin; skipping',
      );
      return config;
    }
    config.modResults.contents = patchMainActivityKotlin(
      config.modResults.contents,
    );
    return config;
  });

  // Defensive: ensure the rationale intent-filter, the health permissions
  // and the Health Connect provider package query are present even if the
  // library's plugin gets reordered, the user's `app.json` `permissions`
  // entries get stripped, or another plugin overwrites <queries>.
  config = withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;
    const application = manifest.application?.[0];
    const mainActivity = application?.activity?.find(
      (a) => a.$['android:name'] === '.MainActivity',
    );

    if (mainActivity) {
      const filters = mainActivity['intent-filter'] ?? [];
      const hasRationale = filters.some((f) =>
        (f.action ?? []).some(
          (a) => a.$?.['android:name'] === 'androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE',
        ),
      );
      if (!hasRationale) {
        filters.push({
          action: [
            {
              $: {
                'android:name': 'androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE',
              },
            },
          ],
        });
        mainActivity['intent-filter'] = filters;
      }
    }

    // Health Connect requires every record-type permission to be declared
    // as <uses-permission> at the manifest level. Without these, the
    // Health Connect Settings app does not list our package as a client
    // and no permission dialog will surface our app name.
    const usesPermissions = manifest['uses-permission'] ?? [];
    const existingNames = new Set(
      usesPermissions.map((p) => p.$?.['android:name']).filter(Boolean),
    );
    for (const name of HEALTH_PERMISSIONS) {
      if (existingNames.has(name)) continue;
      usesPermissions.push({ $: { 'android:name': name } });
    }
    manifest['uses-permission'] = usesPermissions;

    // Android 11+ package visibility: we must declare we can see the
    // Health Connect provider package, otherwise `getSdkStatus` returns
    // SDK_UNAVAILABLE on devices where Health Connect is installed as
    // a separate APK (Android 13 and below).
    const queries = manifest.queries ?? [{}];
    const firstQueries = queries[0] || {};
    const packages = firstQueries.package ?? [];
    const hasProvider = packages.some(
      (p) => p.$?.['android:name'] === HEALTH_PROVIDER_PACKAGE,
    );
    if (!hasProvider) {
      packages.push({ $: { 'android:name': HEALTH_PROVIDER_PACKAGE } });
      firstQueries.package = packages;
      queries[0] = firstQueries;
      manifest.queries = queries;
    }

    return config;
  });

  return config;
};

module.exports = withHealthConnectPermissionDelegate;
