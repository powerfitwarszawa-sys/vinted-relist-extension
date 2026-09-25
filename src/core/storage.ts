import type { AppSettings, BackupEntry, Listing, PersistedQueue, StatsData } from './contracts';

const SETTINGS_KEY = 'vbr:settings';
const QUEUE_KEY = 'vbr:queue';
const BACKUP_KEY = 'vbr:backups';
const STATS_KEY = 'vbr:stats';

const DEFAULT_SETTINGS: AppSettings = {
  enabled: true,
  delayBaseMs: 3000,
  jitterMaxMs: 2000,
  maxConcurrent: 1,
  draftMode: false,
  autoRelistEnabled: false,
  autoRelistIntervalMinutes: 60,
  autoRelistMaxPerCycle: 5,
  autoRelistMinHoursSinceRelist: 24,
};

const DEFAULT_QUEUE: PersistedQueue = {
  items: [],
  currentIndex: 0,
  state: 'idle',
};

const DEFAULT_STATS: StatsData = {
  todayRelisted: 0,
  todaySuccess: 0,
  todayError: 0,
  totalRelisted: 0,
};

export async function getSettings(): Promise<AppSettings> {
  const result = await chrome.storage.local.get(SETTINGS_KEY);
  const stored = (result[SETTINGS_KEY] ?? {}) as Partial<AppSettings>;
  return {
    enabled: stored.enabled ?? DEFAULT_SETTINGS.enabled,
    delayBaseMs: stored.delayBaseMs ?? DEFAULT_SETTINGS.delayBaseMs,
    jitterMaxMs: stored.jitterMaxMs ?? DEFAULT_SETTINGS.jitterMaxMs,
    maxConcurrent: stored.maxConcurrent ?? DEFAULT_SETTINGS.maxConcurrent,
    draftMode: stored.draftMode ?? DEFAULT_SETTINGS.draftMode,
    autoRelistEnabled: stored.autoRelistEnabled ?? DEFAULT_SETTINGS.autoRelistEnabled,
    autoRelistIntervalMinutes:
      stored.autoRelistIntervalMinutes ?? DEFAULT_SETTINGS.autoRelistIntervalMinutes,
    autoRelistMaxPerCycle:
      stored.autoRelistMaxPerCycle ?? DEFAULT_SETTINGS.autoRelistMaxPerCycle,
    autoRelistMinHoursSinceRelist:
      stored.autoRelistMinHoursSinceRelist ?? DEFAULT_SETTINGS.autoRelistMinHoursSinceRelist,
  };
}

export async function setSettings(settings: Partial<AppSettings>): Promise<void> {
  const current = await getSettings();
  await chrome.storage.local.set({
    [SETTINGS_KEY]: { ...current, ...settings },
  });
}

export async function getQueueState(): Promise<PersistedQueue> {
  const result = await chrome.storage.local.get(QUEUE_KEY);
  const stored = (result[QUEUE_KEY] ?? {}) as Partial<PersistedQueue>;
  return {
    items: Array.isArray(stored.items) ? stored.items : [],
    currentIndex: stored.currentIndex ?? 0,
    state: stored.state ?? 'idle',
    lastError: stored.lastError,
  };
}

export async function setQueueState(queue: PersistedQueue): Promise<void> {
  await chrome.storage.local.set({ [QUEUE_KEY]: queue });
}

export async function saveBackup(listing: Listing): Promise<void> {
  await saveBackups([listing]);
}

export async function saveBackups(listings: Listing[]): Promise<void> {
  if (listings.length === 0) {
    return;
  }

  const result = await chrome.storage.local.get(BACKUP_KEY);
  const backups = (result[BACKUP_KEY] as BackupEntry[] | undefined) ?? [];
  const now = Date.now();
  const normalized = listings.map((listing) => ({
    ...listing,
    status: 'active' as const,
    backedUpAt: now,
  }));
  await chrome.storage.local.set({ [BACKUP_KEY]: [...backups, ...normalized] });
}

export async function getBackups(): Promise<BackupEntry[]> {
  const result = await chrome.storage.local.get(BACKUP_KEY);
  const stored = (result[BACKUP_KEY] as BackupEntry[] | undefined) ?? [];
  return stored.map((entry) => ({
    ...entry,
    // Pre-v0.3.0 backups have no timestamp; normalize to a safe default.
    backedUpAt: entry.backedUpAt ?? 0,
  }));
}

/**
 * Record the relist outcome on the most recent backup entry for an id.
 * Older entries for the same id are left untouched so history stays intact.
 */
export async function markBackupResult(
  id: string,
  success: boolean,
  note: string,
): Promise<void> {
  const backups = await getBackups();
  for (let index = backups.length - 1; index >= 0; index--) {
    const entry = backups[index];
    if (entry.id === id) {
      backups[index] = {
        ...entry,
        relistResult: success ? 'success' : 'failed',
        relistNote: note.slice(0, 160),
      };
      break;
    }
  }
  await chrome.storage.local.set({ [BACKUP_KEY]: backups });
}

export async function clearBackups(): Promise<void> {
  await chrome.storage.local.set({ [BACKUP_KEY]: [] });
}

export async function getStats(): Promise<StatsData> {
  const result = await chrome.storage.local.get(STATS_KEY);
  const stored = (result[STATS_KEY] ?? {}) as Partial<StatsData>;

  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const storedDate = stored.lastDate;

  // Reset daily counters if the date changed
  const stats: StatsData = {
    todayRelisted: storedDate === today ? (stored.todayRelisted ?? 0) : 0,
    todaySuccess: storedDate === today ? (stored.todaySuccess ?? 0) : 0,
    todayError: storedDate === today ? (stored.todayError ?? 0) : 0,
    totalRelisted: stored.totalRelisted ?? 0,
    lastDate: today,
  };

  // Persist the fresh date if it wasn't set yet
  if (storedDate !== today) {
    await chrome.storage.local.set({ [STATS_KEY]: stats });
  }

  return stats;
}

export async function updateStats(success: boolean): Promise<StatsData> {
  const stats = await getStats();
  if (success) {
    stats.todayRelisted++;
    stats.totalRelisted++;
    stats.todaySuccess++;
  } else {
    stats.todayError++;
  }
  await chrome.storage.local.set({ [STATS_KEY]: stats });
  return stats;
}
