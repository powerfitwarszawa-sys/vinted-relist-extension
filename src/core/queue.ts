/**
 * Queue engine for batch relisting.
 *
 * Uses chrome.alarms to wake the MV3 service worker between steps.
 * State is persisted to storage after every mutation so the queue can
 * continue after a SW restart. Each alarm executes exactly one step.
 *
 * Error policy: on a normal failure, mark item as 'error' and continue to the
 * next item. API 401/403/429 failures pause the queue to protect the rest of
 * the batch until the user explicitly resumes it.
 *
 * State machine:
 *   idle → running → (pause) → paused → (resume) → running
 *   running → (all done) → idle
 *   Per item: queued → running → success | error
 *   success/error are terminal and never re-processed.
 *   paused items resume as queued on next runStep.
 */

import type { Listing, PersistedQueue, QueueItem, QueueItemStatus, QueueState, QueueStatus, RelistResult } from './contracts';
import { ErrorCode, failureResult, isApiAccessOrRateLimitFailure } from './errors';
import { getQueueState, getSettings, setQueueState } from './storage';
import { log } from './logger';

export type QueueExecutor = (item: QueueItem) => Promise<RelistResult>;

const ALARM_NAME = 'vbr-queue-step';

export class QueueEngine {
  private items: QueueItem[] = [];
  private currentIndex = 0;
  private state: QueueState = 'idle';
  private lastError?: string;
  private executor?: QueueExecutor;
  private isProcessing = false;

  /** Optional callback fired after every state mutation (add, pause, resume, clear, item done). */
  onStateChange?: (status: QueueStatus) => void;

  async init(executor: QueueExecutor): Promise<void> {
    this.executor = executor;
    const saved = await this.loadPersisted();
    this.items = saved.items;
    this.currentIndex = saved.currentIndex;
    this.state = saved.state;
    this.lastError = saved.lastError;

    // A persisted running item may already have caused an external side effect.
    // Never retry it automatically: mark the outcome as uncertain and require a
    // user check before the remaining queue can continue.
    let interruptedAction = false;
    for (const item of this.items) {
      if (item.listing.status === 'running') {
        interruptedAction = true;
        item.listing.status = 'error';
        item.attempts++;
        item.lastError =
          'Service worker restarted during relist; result is unknown. Check Vinted before retrying this listing.';
        this.lastError = item.lastError;
        await log(
          `Item ${item.listing.id} was interrupted by a service worker restart — marked as uncertain error to prevent a duplicate relist`,
          'error',
        );
      }
    }
    if (interruptedAction) {
      this.state = 'paused';
    }

    await log(
      `Queue restored: ${this.items.length} item(s), state=${this.state}, index=${this.currentIndex}`,
      'info',
    );
    await this.persist();

    // If Chrome restarted the worker between completed steps, keep the batch
    // running. Alarms normally persist, but recreate a missing one defensively.
    if (this.state === 'running') {
      await this.ensureAlarmScheduled();
    }
  }

  async add(listings: Listing[]): Promise<number> {
    const terminalBatchFinished =
      this.state === 'idle' &&
      this.currentIndex >= this.items.length &&
      this.items.every(
        (item) => item.listing.status === 'success' || item.listing.status === 'error',
      );
    if (terminalBatchFinished) {
      this.items = [];
      this.currentIndex = 0;
      this.lastError = undefined;
    }

    const existingIds = new Set(this.items.map((item) => item.listing.id));
    let added = 0;

    for (const listing of listings) {
      if (!existingIds.has(listing.id)) {
        this.items.push({ listing: { ...listing, status: 'queued' }, attempts: 0 });
        existingIds.add(listing.id);
        added++;
      }
    }

    if (added > 0) {
      await log(`Added ${added} listing(s) to queue`, 'info');
      await this.persist();
    }

    return added;
  }

  async pause(): Promise<void> {
    if (this.state !== 'running') {
      return;
    }
    await this.clearAlarm();
    this.state = 'paused';

    // Mark current running item as paused
    const current = this.items[this.currentIndex];
    if (current && current.listing.status === 'running') {
      current.listing.status = 'paused';
    }

    await log('Queue paused', 'info');
    await this.persist();
  }

  async resume(): Promise<void> {
    if (this.state === 'running') {
      return;
    }
    if (this.currentIndex >= this.items.length) {
      this.state = 'idle';
      await log('Queue resume skipped: no pending items', 'info');
      await this.persist();
      return;
    }

    // Reset paused items back to queued so they can be re-processed
    for (const item of this.items) {
      if (item.listing.status === 'paused') {
        item.listing.status = 'queued';
      }
    }

    this.state = 'running';
    await log('Queue resumed', 'info');
    await this.persist();
    await this.scheduleNext();
  }

  async clear(): Promise<void> {
    await this.clearAlarm();
    this.items = [];
    this.currentIndex = 0;
    this.state = 'idle';
    this.lastError = undefined;
    this.isProcessing = false;
    await log('Queue cleared', 'info');
    await this.persist();
  }

  getStatus(): QueueStatus {
    const completed = this.items.filter((item) => item.listing.status === 'success').length;
    const failed = this.items.filter((item) => item.listing.status === 'error').length;
    const current = this.items[this.currentIndex];

    const items: QueueItemStatus[] = this.items.map((item) => ({
      id: item.listing.id,
      title: item.listing.title,
      price: item.listing.price,
      currency: item.listing.currency,
      thumbnailUrl: item.listing.thumbnailUrl,
      sourceStatus: item.listing.sourceStatus,
      status: item.listing.status,
      lastError: item.lastError,
      lastRelisted: item.listing.lastRelisted,
    }));

    return {
      state: this.state,
      total: this.items.length,
      completed,
      failed,
      currentId: current?.listing.id,
      lastError: this.lastError,
      items,
    };
  }

  async onAlarm(): Promise<void> {
    await log('Queue alarm fired', 'info');

    // Guard against re-entry: only one step at a time
    if (this.isProcessing) {
      await log('Alarm fired but a step is already processing — skipping', 'warn');
      return;
    }

    // Reload state from storage every time (SW may have restarted)
    const saved = await this.loadPersisted();
    this.items = saved.items;
    this.currentIndex = saved.currentIndex;
    this.state = saved.state;
    this.lastError = saved.lastError;

    if (this.state !== 'running') {
      await log('Queue alarm fired but state is not running; clearing alarm', 'info');
      await this.clearAlarm();
      return;
    }

    await this.runStep();
  }

  private async loadPersisted(): Promise<PersistedQueue> {
    return getQueueState();
  }

  private async persist(): Promise<void> {
    await setQueueState({
      items: this.items,
      currentIndex: this.currentIndex,
      state: this.state,
      lastError: this.lastError,
    });
    this.emitStateChange();
  }

  /** Notify subscribers of current queue status after any state mutation. */
  private emitStateChange(): void {
    this.onStateChange?.(this.getStatus());
  }

  private async clearAlarm(): Promise<void> {
    try {
      await chrome.alarms.clear(ALARM_NAME);
    } catch {
      // ignore
    }
  }

  private async ensureAlarmScheduled(): Promise<void> {
    try {
      const existing = await chrome.alarms.get(ALARM_NAME);
      if (existing) {
        return;
      }
    } catch {
      // If the lookup is unavailable, scheduling is still the safe fallback.
    }

    await this.scheduleNext();
  }

  private async scheduleNext(): Promise<void> {
    if (this.state !== 'running') {
      return;
    }

    // Skip items already in terminal state (success/error)
    while (this.currentIndex < this.items.length) {
      const item = this.items[this.currentIndex];
      if (item.listing.status === 'success' || item.listing.status === 'error') {
        this.currentIndex++;
        continue;
      }
      break;
    }

    if (this.currentIndex >= this.items.length) {
      this.state = 'idle';
      const total = this.items.length;
      const ok = this.items.filter((i) => i.listing.status === 'success').length;
      const err = this.items.filter((i) => i.listing.status === 'error').length;
      await log(`Queue finished — ${ok}/${total} succeeded, ${err} failed`, 'info');
      await this.persist();
      return;
    }

    const settings = await getSettings();
    const jitter = Math.floor(Math.random() * (settings.jitterMaxMs + 1));
    const delay = settings.delayBaseMs + jitter;
    const delayInMinutes = Math.max(0.01, delay / 60000);

    await log(`Scheduling next item in ${delay}ms (base ${settings.delayBaseMs}ms + jitter ${jitter}ms)`, 'debug');

    try {
      await chrome.alarms.create(ALARM_NAME, { delayInMinutes });
    } catch (err) {
      await log(`Failed to schedule alarm: ${String(err)}`, 'error');
      this.state = 'error';
      this.lastError = String(err);
      await this.persist();
    }
  }

  private async runStep(): Promise<void> {
    if (this.state !== 'running') {
      return;
    }

    // Re-entry guard
    if (this.isProcessing) {
      await log('runStep called while already processing — skipping', 'warn');
      return;
    }

    const item = this.items[this.currentIndex];
    if (!item || !this.executor) {
      await this.pause();
      return;
    }

    // Terminal state guard: never re-process success/error items
    if (item.listing.status === 'success' || item.listing.status === 'error') {
      await log(`Item ${item.listing.id} is in terminal state (${item.listing.status}) — skipping`, 'warn');
      this.currentIndex++;
      await this.persist();
      await this.scheduleNext();
      return;
    }

    this.isProcessing = true;

    try {
      await log(`Processing item ${this.currentIndex + 1}/${this.items.length}: ${item.listing.id} "${item.listing.title}"`, 'info');

    item.listing.status = 'running';
    await this.persist();

    let result: RelistResult;
    try {
      result = await this.executor(item);
    } catch (err) {
      result = failureResult(ErrorCode.EXECUTOR_EXCEPTION, String(err));
    }

    if (result.success) {
      item.listing.status = 'success';
      item.listing.lastRelisted = Date.now();
      await log(`✓ Item ${item.listing.id} succeeded: ${result.message}`, 'info');
    } else {
      item.attempts++;
      item.lastError = result.message;
      item.listing.status = 'error';
      this.lastError = result.message;
      await log(`✗ Item ${item.listing.id} failed: ${result.message}`, 'error');
      await log(`Error details — code: ${result.code}, message: ${result.message}, attempts: ${item.attempts}`, 'debug');

      if (isApiAccessOrRateLimitFailure(result)) {
        this.currentIndex++;
        this.state = 'paused';
        await log(
          `Queue paused after API access/rate-limit response for item ${item.listing.id}. ` +
            `Resolve the Vinted session or wait before clicking Resume.`,
          'error',
        );
        await this.persist();
        return;
      }
    }

      this.currentIndex++;
      await this.persist();
    } finally {
      this.isProcessing = false;
    }

    await this.scheduleNext();
  }
}
