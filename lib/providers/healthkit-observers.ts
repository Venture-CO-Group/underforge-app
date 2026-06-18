/**
 * HealthKit observer registration (iOS only) — currently DISABLED.
 *
 * The native `react-native-health` package exposes `setObserver` as a void
 * RCT_EXPORT_METHOD (no callback). On React Native 0.76+ with the bridgeless /
 * TurboModule runtime, the underlying `enableBackgroundDeliveryForType:` and
 * the `RCTEventEmitter` `addListener` paths can raise an NSException; the
 * TurboModule machinery's `convertNSExceptionToJSError` then crashes Hermes
 * with EXC_BAD_ACCESS while capturing the call-stack symbols.
 *
 * Until the upstream package adds proper bridgeless support
 * (https://github.com/agencyenterprise/react-native-health/issues/395), we
 * skip observer registration entirely. We still get fresh HealthKit data via:
 *   - the `expo-background-task` periodic wake-up (Android-style polling that
 *     also runs on iOS as a safety net)
 *   - the `AppState` foreground re-sync that fires whenever the user returns
 *     to the app
 *
 * Re-enable this module once the upstream fix lands or once we ship our own
 * native shim.
 */

export function registerHealthKitObservers(_userId: string): void {
  // Intentionally a no-op. See module header for context.
}

export function unregisterHealthKitObservers(): void {
  // Intentionally a no-op. See module header for context.
}
