import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { APP_VERSION } from '../constants/app';

type LogLevel = 'info' | 'warn' | 'error' | 'debug';

interface LogProperties {
  [key: string]: string | number | boolean | object | null | undefined;
}

// ============================================================================
// Logfire OTLP HTTP exporter
//
// We ship every log line to Logfire over plain HTTP/JSON (OpenTelemetry Logs
// protocol) so issues like "user has no push token" surface in our backend
// observability tool instead of dying in a device console nobody reads.
//
// Design constraints:
//  - Logger must NEVER crash the app (network, parse, malformed payload).
//  - Logger must NEVER block UI work (always async, fire-and-forget).
//  - We batch with a short flush interval to keep request volume sane.
//  - On `error` level we shrink the flush delay so critical events arrive fast.
// ============================================================================

const LOGFIRE_TOKEN = process.env.EXPO_PUBLIC_LOGFIRE_TOKEN;
const LOGFIRE_BASE_URL =
  process.env.EXPO_PUBLIC_LOGFIRE_BASE_URL || 'https://logfire-us.pydantic.dev';
const LOGFIRE_LOGS_ENDPOINT = `${LOGFIRE_BASE_URL.replace(/\/$/, '')}/v1/logs`;

const SEVERITY_NUMBER: Record<LogLevel, number> = {
  debug: 5,
  info: 9,
  warn: 13,
  error: 17,
};

const SEVERITY_TEXT: Record<LogLevel, string> = {
  debug: 'DEBUG',
  info: 'INFO',
  warn: 'WARN',
  error: 'ERROR',
};

interface OtlpAttribute {
  key: string;
  value: { stringValue: string };
}

interface OtlpLogRecord {
  timeUnixNano: string;
  severityNumber: number;
  severityText: string;
  body: { stringValue: string };
  attributes: OtlpAttribute[];
}

const FLUSH_INTERVAL_MS = 5_000;
const ERROR_FLUSH_DELAY_MS = 500;
const MAX_BATCH_SIZE = 100;
const QUEUE_SOFT_LIMIT = 50;
const QUEUE_HARD_LIMIT = 500;
const HTTP_TIMEOUT_MS = 10_000;

class LogfireExporter {
  private queue: OtlpLogRecord[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushing = false;
  private lastWarnAt = 0;

  enabled(): boolean {
    return !!LOGFIRE_TOKEN;
  }

  enqueue(level: LogLevel, message: string, attributes: Record<string, string>) {
    if (!this.enabled()) return;

    const otlpAttributes: OtlpAttribute[] = [];
    for (const [k, v] of Object.entries(attributes)) {
      if (v == null) continue;
      otlpAttributes.push({ key: k, value: { stringValue: v } });
    }

    this.queue.push({
      timeUnixNano: `${Date.now()}000000`,
      severityNumber: SEVERITY_NUMBER[level],
      severityText: SEVERITY_TEXT[level],
      body: { stringValue: message },
      attributes: otlpAttributes,
    });

    if (this.queue.length > QUEUE_HARD_LIMIT) {
      const drop = this.queue.length - QUEUE_HARD_LIMIT;
      this.queue.splice(0, drop);
      const now = Date.now();
      if (now - this.lastWarnAt > 30_000) {
        this.lastWarnAt = now;
        console.warn(`[GlowLogger] Logfire queue overflow, dropped ${drop} oldest records`);
      }
    }

    const delay =
      level === 'error' || this.queue.length >= QUEUE_SOFT_LIMIT
        ? ERROR_FLUSH_DELAY_MS
        : FLUSH_INTERVAL_MS;
    this.scheduleFlush(delay);
  }

  private scheduleFlush(delay: number) {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, delay);
  }

  async flush(): Promise<void> {
    if (this.flushing || !this.enabled() || this.queue.length === 0) return;
    this.flushing = true;
    try {
      while (this.queue.length > 0) {
        const batch = this.queue.splice(0, MAX_BATCH_SIZE);
        const ok = await this.send(batch);
        if (!ok) {
          // Network/server failure: stop draining to avoid CPU/network thrash.
          // We intentionally drop the failed batch so the queue cannot grow
          // without bound when the device is offline for long periods.
          break;
        }
      }
    } finally {
      this.flushing = false;
    }
  }

  private async send(records: OtlpLogRecord[]): Promise<boolean> {
    const payload = {
      resourceLogs: [
        {
          resource: {
            attributes: [
              { key: 'service.name', value: { stringValue: 'underforge-mobile' } },
              { key: 'service.version', value: { stringValue: APP_VERSION } },
              { key: 'telemetry.sdk.language', value: { stringValue: 'javascript' } },
              { key: 'telemetry.sdk.name', value: { stringValue: 'glow-logger' } },
              { key: 'platform', value: { stringValue: Platform.OS } },
              { key: 'platform.version', value: { stringValue: String(Platform.Version) } },
              { key: 'device.model', value: { stringValue: Device.modelName || 'unknown' } },
              { key: 'device.os.version', value: { stringValue: Device.osVersion || 'unknown' } },
              { key: 'device.is_physical', value: { stringValue: String(Device.isDevice) } },
            ],
          },
          scopeLogs: [
            {
              scope: { name: 'underforge.mobile.glowlogger' },
              logRecords: records,
            },
          ],
        },
      ],
    };

    const controller =
      typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeoutId = controller
      ? setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS)
      : null;

    try {
      const response = await fetch(LOGFIRE_LOGS_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${LOGFIRE_TOKEN}`,
        },
        body: JSON.stringify(payload),
        signal: controller?.signal,
      });
      if (!response.ok) {
        const text = await response.text().catch(() => '<no body>');
        console.warn(
          `[GlowLogger] Logfire export ${response.status}: ${text.slice(0, 200)}`
        );
        return false;
      }
      return true;
    } catch (error) {
      console.warn(
        '[GlowLogger] Logfire export error',
        error instanceof Error ? error.message : String(error)
      );
      return false;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }
}

const logfireExporter = new LogfireExporter();

// ============================================================================
// PII policy for Logfire
//
// Logfire must NEVER receive the user's display name or email — in any form,
// including embedded inside messages or stringified JSON values. Identify
// users in Logfire exclusively via `local_user_id` (Supabase UUID).
//
// This policy does NOT affect:
//   - Console output (kept verbose for operational debugging on-device)
//   - Push notification content (personalized via `${username}` in backend
//     templates — that substitution is intentional and stays)
//   - Supabase auth payloads (signUp / signIn / reset still use email)
//   - Chat substitution at render time (UI still shows the user's name)
//
// Scrubbing is centralized here so existing `glowLogger.*({ email, ... })`
// call sites continue to work without per-site refactors.
// ============================================================================

const LOGFIRE_PII_KEYS = new Set([
  'user_display_name',
  'display_name',
  'displayName',
  'userDisplayName',
  'user_name',
  'userName',
  'name',
  'firstName',
  'first_name',
  'lastName',
  'last_name',
  'email',
  'user_email',
  'userEmail',
  'pendingSignupEmail',
  'pending_signup_email',
]);

const EMAIL_REGEX = /\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function redactName(input: string, name: string | null): string {
  let out = input;
  if (name && name.length >= 2) {
    const re = new RegExp(escapeRegExp(name), 'gi');
    out = out.replace(re, '[REDACTED_NAME]');
  }
  return out.replace(EMAIL_REGEX, '[REDACTED_EMAIL]');
}

function isPlaceholderName(name: string): boolean {
  if (!name) return true;
  const lowered = name.toLowerCase();
  return (
    lowered === 'unknown_user' ||
    lowered === 'unknown' ||
    lowered === 'onboarding_in_progress'
  );
}

function buildLogfireAttributes(
  stringifiedProperties: { [key: string]: string },
  userDisplayName: string,
  localUserId: string,
  timestamp: string
): { [key: string]: string } {
  const nameForRedaction = isPlaceholderName(userDisplayName) ? null : userDisplayName;
  const sanitized: { [key: string]: string } = {};
  for (const [key, value] of Object.entries(stringifiedProperties)) {
    if (LOGFIRE_PII_KEYS.has(key)) continue;
    sanitized[key] = redactName(value, nameForRedaction);
  }
  sanitized.local_user_id = localUserId;
  sanitized.timestamp = timestamp;
  sanitized.app_version = APP_VERSION;
  return sanitized;
}

export class GlowLogger {
  private userDisplayName: string;
  private localUserId: string;

  constructor(userDisplayName: string = '', localUserId: string = '') {
    this.userDisplayName = userDisplayName || 'unknown_user';
    this.localUserId = localUserId || 'unknown_user_id';
  }

  setUserIdentifier(userDisplayName: string, localUserId: string = ''): void {
    this.userDisplayName = userDisplayName || 'unknown_user';
    this.localUserId = localUserId || 'unknown_user_id';
  }

  log(
    message: string,
    level: LogLevel = 'info',
    properties: LogProperties = {}
  ): void {
    try {
      const timestamp = new Date().toISOString();

      const stringifiedProperties: { [key: string]: string } = {};
      for (const [key, value] of Object.entries(properties)) {
        if (value === null || value === undefined) continue;
        if (typeof value === 'object') {
          try {
            stringifiedProperties[key] = JSON.stringify(value);
          } catch {
            stringifiedProperties[key] = '[unserializable]';
          }
        } else {
          stringifiedProperties[key] = String(value);
        }
      }

      // Console keeps the full, un-redacted view for local debugging.
      const enhancedProperties = {
        ...stringifiedProperties,
        user_display_name: this.userDisplayName,
        local_user_id: this.localUserId,
        timestamp,
        app_version: APP_VERSION,
      };

      const logMethod =
        level === 'error'
          ? console.error
          : level === 'warn'
            ? console.warn
            : level === 'debug'
              ? console.debug
              : console.log;

      logMethod(`[${timestamp}] [${level.toUpperCase()}] ${message}`, enhancedProperties);

      // Logfire receives a redacted copy: identity keys stripped, display name
      // and email-shaped substrings replaced inside message and string values.
      const nameForRedaction = isPlaceholderName(this.userDisplayName)
        ? null
        : this.userDisplayName;
      const logfireMessage = redactName(message, nameForRedaction);
      const logfireAttributes = buildLogfireAttributes(
        stringifiedProperties,
        this.userDisplayName,
        this.localUserId,
        timestamp
      );

      logfireExporter.enqueue(level, logfireMessage, logfireAttributes);
    } catch (error) {
      const timestamp = new Date().toISOString();
      console.error(
        `[${timestamp}] [ERROR] GlowLogger: Enhanced logging failed, falling back to console:`,
        error
      );
      console.log(`[${timestamp}] [${level.toUpperCase()}] ${message}`, properties);
    }
  }

  info(message: string, properties: LogProperties = {}): void {
    this.log(message, 'info', properties);
  }

  warn(message: string, properties: LogProperties = {}): void {
    this.log(message, 'warn', properties);
  }

  error(message: string, properties: LogProperties = {}): void {
    this.log(message, 'error', properties);
  }

  debug(message: string, properties: LogProperties = {}): void {
    this.log(message, 'debug', properties);
  }

  /**
   * Force-flush the Logfire queue. Useful around app suspension, sign-out, or
   * any other transition where dropping buffered logs would lose context for
   * a critical event.
   */
  async flush(): Promise<void> {
    await logfireExporter.flush();
  }

  getUserDisplayName(): string {
    return this.userDisplayName;
  }

  getLocalUserId(): string {
    return this.localUserId;
  }
}

export const glowLogger = new GlowLogger();
