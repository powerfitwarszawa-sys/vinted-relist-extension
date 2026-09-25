import type { LogEntry, LogLevel } from './contracts';

const LOG_KEY = 'vbr:logs';
const MAX_LOGS = 200;

let cache: LogEntry[] | null = null;

export async function getLogs(): Promise<LogEntry[]> {
  // Always re-read storage: the content script and the background/service
  // worker share the same log store, and a stale in-memory copy would hide
  // entries written by the other context for the whole lifetime of this one.
  const result = await chrome.storage.local.get(LOG_KEY);
  return (result[LOG_KEY] as LogEntry[] | undefined) ?? [];
}

export async function log(message: string, level: LogLevel = 'info'): Promise<void> {
  const entry: LogEntry = {
    timestamp: Date.now(),
    level,
    message,
  };

  console.log(`[${level.toUpperCase()}] ${message}`);

  // Merge with the freshest stored entries before writing so concurrent
  // writers (content script vs background) never wipe each other's lines.
  const stored = (await chrome.storage.local.get(LOG_KEY))[LOG_KEY] as LogEntry[] | undefined;
  const merged = [entry, ...(stored ?? [])].slice(0, MAX_LOGS);
  cache = merged;

  await chrome.storage.local.set({ [LOG_KEY]: merged });
}

export async function clearLogs(): Promise<void> {
  cache = [];
  await chrome.storage.local.set({ [LOG_KEY]: [] });
}

export async function debug(...parts: unknown[]): Promise<void> {
  return log(parts.map(String).join(' '), 'debug');
}

export async function info(...parts: unknown[]): Promise<void> {
  return log(parts.map(String).join(' '), 'info');
}

export async function warn(...parts: unknown[]): Promise<void> {
  return log(parts.map(String).join(' '), 'warn');
}

export async function error(...parts: unknown[]): Promise<void> {
  return log(parts.map(String).join(' '), 'error');
}