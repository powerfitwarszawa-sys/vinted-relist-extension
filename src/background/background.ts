/**
 * Background service worker — MV3.
 *
 * Owns the QueueEngine, routes messages to content scripts, manages
 * badge/state lifecycle, and persists pre-relist backups.
 *
 * ── Content script lifecycle (MV3 critical) ──
 * When the extension is updated/reloaded, Chrome does NOT re-inject content
 * scripts into already-open tabs. The old content script's runtime channel
 * is severed, causing "Receiving end does not exist" errors.
 *
 * Mitigation:
 *   - onInstalled → reloads all open Vinted tabs so content scripts re-inject
 *   - SCAN_LISTINGS handler retries with tab reload if channel is dead
 *   - RELIST_ITEM handler already retries 5× internally
 */

import { evaluateAutoRelistGate, selectDueForAutoRelist } from '../core/auto-relist';
import type { ExtensionMessage, FetchPhotoResponse, Listing, RelistResult } from '../core/contracts';
import { ErrorCode, failureResult, successResult } from '../core/errors';
import { clearLogs, getLogs, log } from '../core/logger';
import { QueueEngine } from '../core/queue';
import { formatRelistPreflightSummary, preflightRelistListings } from '../core/relist-preflight';
import { getScanResult, markScanListingsRelisted, saveScanResult } from '../core/scan-cache';
import {
  clearBackups,
  getBackups,
  getSettings,
  getStats,
  markBackupResult,
  saveBackup,
  saveBackups,
  updateStats,
} from '../core/storage';

const queue = new QueueEngine();

/** Alarm that drives the Redrip-style scheduled (automatic) relist cycle. */
const AUTO_RELIST_ALARM_NAME = 'vbr-auto-relist';

const VINTED_TAB_URL_PATTERNS = [
  'https://*.vinted.com/*', 'https://*.vinted.pl/*', 'https://*.vinted.fr/*',
  'https://*.vinted.de/*', 'https://*.vinted.co.uk/*', 'https://*.vinted.nl/*',
  'https://*.vinted.be/*', 'https://*.vinted.es/*', 'https://*.vinted.it/*',
  'https://*.vinted.lt/*', 'https://*.vinted.lv/*', 'https://*.vinted.cz/*',
];

const DEFAULT_VINTED_PROFILE_URL = 'https://www.vinted.pl/member/107890191';

let lastTargetVintedTabId: number | undefined;

// ── Helpers ─────────────────────────────────────────────────────────

function isVintedUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    return /(^|\.)vinted\./.test(new URL(url).hostname.toLowerCase());
  } catch {
    return false;
  }
}

function extractListingId(url: string): string | undefined {
  try {
    const pathname = new URL(url, 'https://www.vinted.pl').pathname;
    return pathname.match(/^\/items\/(\d+)/)?.[1];
  } catch {
    return undefined;
  }
}

function isMessageChannelClosedError(message: string): boolean {
  return (
    message.includes('message channel closed') ||
    message.includes('A listener indicated an asynchronous response')
  );
}

async function getTabListingId(tabId: number): Promise<string | undefined> {
  try {
    const tab = await chrome.tabs.get(tabId);
    return tab.url ? extractListingId(tab.url) : undefined;
  } catch {
    return undefined;
  }
}

function waitForListingIdChange(tabId: number, originalId: string, timeoutMs = 12000): Promise<string | undefined> {
  return new Promise((resolve) => {
    let settled = false;
    let intervalId: number | undefined;
    let timeoutId: number | undefined;

    const cleanup = () => {
      chrome.tabs.onUpdated.removeListener(listener);
      if (intervalId !== undefined) clearInterval(intervalId);
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    };

    const finish = (newId: string | undefined) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(newId);
    };

    const checkUrl = (url: string | undefined) => {
      if (!url) return;
      const id = extractListingId(url);
      if (id && id !== originalId) finish(id);
    };

    function listener(
      updatedTabId: number,
      changeInfo: { status?: string; url?: string },
      tabInfo: chrome.tabs.Tab,
    ): void {
      if (updatedTabId !== tabId) return;
      checkUrl(changeInfo.url ?? tabInfo.url);
    }

    chrome.tabs.onUpdated.addListener(listener);

    intervalId = setInterval(async () => {
      const id = await getTabListingId(tabId);
      if (id && id !== originalId) finish(id);
    }, 500);

    timeoutId = setTimeout(() => finish(undefined), timeoutMs);

    getTabListingId(tabId)
      .then((id) => {
        if (id && id !== originalId) finish(id);
      })
      .catch(() => {});
  });
}

async function confirmRelistAfterDisconnect(
  tabId: number,
  originalId: string,
  lastError: string,
): Promise<RelistResult> {
  await log(
    `Content script disconnected after click; waiting for confirmed new listing ID. ` +
      `Original ID=${originalId}. Error: ${lastError.slice(0, 120)}`,
    'warn',
  );

  const newId = await waitForListingIdChange(tabId, originalId);
  if (newId) {
    await log(`Relist confirmed after navigation: original ${originalId}, new ${newId}`, 'info');
    return successResult(`Oferta ${originalId} odnowiona jako ${newId}`, newId);
  }

  const currentId = await getTabListingId(tabId);
  return failureResult(
    ErrorCode.RELIST_NOT_CONFIRMED,
    `Content script disconnected, but new listing ID was not confirmed. ` +
      `Original ID: ${originalId}, current tab ID: ${currentId ?? 'unknown'}. Verify Vinted manually.`,
  );
}

async function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function rememberTargetTab(tab: chrome.tabs.Tab): chrome.tabs.Tab {
  lastTargetVintedTabId = tab.id;
  return tab;
}

function chooseBestVintedTab(tabs: chrome.tabs.Tab[]): chrome.tabs.Tab | undefined {
  return tabs
    .filter((tab) => tab.id !== undefined && isVintedUrl(tab.url))
    .sort((a, b) => {
      if (a.active !== b.active) return a.active ? -1 : 1;
      return (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0);
    })[0];
}

async function queryVintedTabs(windowId?: number): Promise<chrome.tabs.Tab[]> {
  const queryInfo: chrome.tabs.QueryInfo = { url: VINTED_TAB_URL_PATTERNS };
  if (windowId !== undefined) queryInfo.windowId = windowId;
  return chrome.tabs.query(queryInfo);
}

async function findRememberedVintedTab(): Promise<chrome.tabs.Tab | undefined> {
  if (lastTargetVintedTabId === undefined) return undefined;
  const tabs = await queryVintedTabs();
  return tabs.find((tab) => tab.id === lastTargetVintedTabId && isVintedUrl(tab.url));
}

function describeTab(tab: chrome.tabs.Tab): string {
  if (!tab.url) return `tab ${tab.id ?? 'unknown'}`;
  try {
    const url = new URL(tab.url);
    return `${url.hostname}${url.pathname}`;
  } catch {
    return tab.url;
  }
}

async function getTargetVintedTab(
  sender?: chrome.runtime.MessageSender,
  context = 'request',
): Promise<chrome.tabs.Tab | undefined> {
  const senderTab = sender?.tab;
  if (senderTab?.id !== undefined && isVintedUrl(senderTab.url)) return rememberTargetTab(senderTab);

  const activeTab = await getActiveTab();
  if (activeTab?.id !== undefined && isVintedUrl(activeTab.url)) return rememberTargetTab(activeTab);

  const rememberedTab = await findRememberedVintedTab();
  if (rememberedTab) return rememberTargetTab(rememberedTab);

  if (senderTab?.windowId !== undefined) {
    const sameWindowTab = chooseBestVintedTab(await queryVintedTabs(senderTab.windowId));
    if (sameWindowTab) {
      await log(`Active tab is not Vinted; using Vinted ${describeTab(sameWindowTab)} for ${context}`, 'info');
      return rememberTargetTab(sameWindowTab);
    }
  }

  const fallbackTab = chooseBestVintedTab(await queryVintedTabs());
  if (fallbackTab) {
    await log(`No active Vinted tab found; using recent Vinted ${describeTab(fallbackTab)} for ${context}`, 'info');
    return rememberTargetTab(fallbackTab);
  }

  return openDefaultVintedProfileTab(context);
}

// ── Badge management via event callback (replaces fragile method patching) ──

queue.onStateChange = (status): void => {
  const text = status.state !== 'idle' && status.total > 0 ? String(status.total) : '';
  chrome.action.setBadgeText({ text }).catch(() => {});
  chrome.action
    .setBadgeBackgroundColor({ color: status.state === 'error' ? '#b91c1c' : '#2563eb' })
    .catch(() => {});
};

const queueReady = queue
  .init(async (item) => {
    const result = await runRelistInTargetTab(item.listing);
    await updateStats(result.success);
    // Keep the saved scan and the most recent backup in sync: the next
    // automatic cycle must not re-pick the same item, and the backups view
    // should show what happened to each listing.
    await markBackupResult(item.listing.id, result.success, result.message);
    if (result.success) {
      await markScanListingsRelisted(
        result.newListingId ? [item.listing.id, result.newListingId] : [item.listing.id],
        Date.now(),
      );
    }
    return result;
  })
  .catch((err: unknown) => {
    log(`Queue initialization failed: ${String(err)}`, 'error');
  });

// ── Scheduled (automatic) relist cycle ─────────────────────────────

/**
 * Create or clear the periodic auto-relist alarm to match the current
 * settings. Safe to call on startup and whenever settings change.
 */
async function syncAutoRelistAlarm(): Promise<void> {
  const settings = await getSettings();

  if (!settings.autoRelistEnabled) {
    await chrome.alarms.clear(AUTO_RELIST_ALARM_NAME).catch(() => {});
    return;
  }

  const periodInMinutes = Math.max(1, Math.floor(settings.autoRelistIntervalMinutes) || 1);
  await chrome.alarms.create(AUTO_RELIST_ALARM_NAME, { periodInMinutes });
  await log(
    `[auto-relist] Alarm aktywny: cykl co ${periodInMinutes} min, max ${settings.autoRelistMaxPerCycle} oferty, ` +
      `min ${settings.autoRelistMinHoursSinceRelist} h od ostatniego podbicia`,
    'info',
  );
}

/**
 * One automatic cycle: pick due listings from the saved scan and run them
 * through the same queue + backup + preflight pipeline as a manual batch.
 * A cycle never interrupts a running or paused queue.
 */
async function runAutoRelistCycle(): Promise<void> {
  const settings = await getSettings();
  const scan = await getScanResult();
  const gate = evaluateAutoRelistGate(settings.autoRelistEnabled, queue.getStatus(), scan, {
    now: Date.now(),
  });

  if (!gate.allowed) {
    if (gate.reason) {
      await log(`[auto-relist] Cykl pominięty: ${gate.reason}`, 'info');
    }
    return;
  }

  if (!scan) return; // gate guarantees a scan, but keeps TS narrowing honest

  const due = selectDueForAutoRelist(scan.listings, {
    minHoursSinceRelist: settings.autoRelistMinHoursSinceRelist,
    maxPerCycle: settings.autoRelistMaxPerCycle,
    now: Date.now(),
  });

  if (due.length === 0) {
    await log('[auto-relist] Brak ofert kwalifikujących się do podbicia w tym cyklu', 'info');
    return;
  }

  const preflight = preflightRelistListings(due);
  for (const issue of preflight.issues) {
    await log(`[auto-relist][preflight] ${issue.message}`, issue.severity === 'block' ? 'error' : 'warn');
  }

  if (preflight.accepted.length === 0) {
    await log(`[auto-relist] Preflight odrzucił wszystkie ${due.length} oferty; cykl bezczynny`, 'error');
    return;
  }

  await saveBackups(preflight.accepted);
  const added = await queue.add(preflight.accepted);
  await log(
    `[auto-relist] Dodano ${added}/${preflight.accepted.length} ofert do kolejki; ` +
      `${formatRelistPreflightSummary(preflight)}`,
    'info',
  );

  if (added > 0 && queue.getStatus().state === 'idle') {
    await queue.resume();
  }
}

// ── Tab navigation ─────────────────────────────────────────────────

function navigateTab(tabId: number, url: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let resolved = false;

    const listener = (updatedTabId: number, changeInfo: { status?: string }) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete' && !resolved) {
        resolved = true;
        chrome.tabs.onUpdated.removeListener(listener);
        clearTimeout(timeout);
        resolve();
      }
    };

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        chrome.tabs.onUpdated.removeListener(listener);
        reject(new Error('Tab navigation timed out'));
      }
    }, 15000);

    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.update(tabId, { url }).catch((err: unknown) => {
      if (!resolved) {
        resolved = true;
        chrome.tabs.onUpdated.removeListener(listener);
        clearTimeout(timeout);
        reject(err);
      }
    });
  });
}

function waitForTabComplete(tabId: number, timeoutMs = 20000): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let resolved = false;

    const listener = (updatedTabId: number, changeInfo: { status?: string }) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete' && !resolved) {
        resolved = true;
        chrome.tabs.onUpdated.removeListener(listener);
        clearTimeout(timeout);
        resolve();
      }
    };

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        chrome.tabs.onUpdated.removeListener(listener);
        reject(new Error('Vinted profile tab load timed out'));
      }
    }, timeoutMs);

    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function openDefaultVintedProfileTab(context: string): Promise<chrome.tabs.Tab | undefined> {
  try {
    const tab = await chrome.tabs.create({ url: DEFAULT_VINTED_PROFILE_URL, active: false });
    if (!tab.id) return undefined;

    await log(`No Vinted tab found; opened profile ${DEFAULT_VINTED_PROFILE_URL} for ${context}`, 'info');

    if (tab.status !== 'complete') await waitForTabComplete(tab.id);

    await new Promise((resolve) => setTimeout(resolve, 1500));
    return rememberTargetTab({ ...tab, url: tab.url ?? DEFAULT_VINTED_PROFILE_URL });
  } catch (err) {
    await log(`Failed to open default Vinted profile for ${context}: ${String(err)}`, 'error');
    return undefined;
  }
}

// ── Queue executor ─────────────────────────────────────────────────

async function runRelistInTargetTab(listing: Listing): Promise<RelistResult> {
  const settings = await getSettings();
  const tab = await getTargetVintedTab(undefined, 'relist');
  if (!tab?.id) return failureResult(ErrorCode.NO_ACTIVE_TAB, 'No Vinted tab found for relist');
  if (!isVintedUrl(tab.url)) return failureResult(ErrorCode.NOT_VINTED_TAB, 'Target tab is not a Vinted page');

  const expectedId = extractListingId(listing.url) ?? listing.id;
  const currentId = tab.url ? extractListingId(tab.url) : undefined;
  if (!expectedId || currentId !== expectedId) {
    const expectedPath = new URL(listing.url, 'https://www.vinted.pl').pathname;
    await log(`Navigating target Vinted tab to listing detail ${expectedPath}`, 'info');
    await navigateTab(tab.id, listing.url);
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }

  if (settings.draftMode) {
    await log(`Draft mode — page opened for manual review (${listing.id})`, 'info');
    return failureResult(
      ErrorCode.RELIST_NOT_CONFIRMED,
      `Draft mode — item ${listing.id} opened for manual review; no relist was executed.`,
    );
  }

  const RELIST_MESSAGE = { type: 'RELIST_ITEM' as const, payload: { listing } };
  let lastError = '';

  for (let attempt = 0; attempt < 5; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      await log(`Retrying RELIST_ITEM (attempt ${attempt + 1})`, 'debug');
    }

    try {
      const response = (await chrome.tabs.sendMessage(tab.id, RELIST_MESSAGE)) as {
        ok: boolean;
        result?: RelistResult;
        error?: string;
      };

      if (response?.ok && response.result) return response.result;

      lastError = response?.result?.message ?? response?.error ?? 'Content script did not return a result';

      if (response?.result && !response.result.success) {
        await log(`Relist failed in content script (${response.result.code}): ${response.result.message}`, 'warn');
        return response.result;
      }

      if (isMessageChannelClosedError(lastError)) {
        return confirmRelistAfterDisconnect(tab.id, expectedId, lastError);
      }
    } catch (err) {
      lastError = String(err);

      if (lastError.includes('Receiving end does not exist')) continue;

      if (isMessageChannelClosedError(lastError)) {
        return confirmRelistAfterDisconnect(tab.id, expectedId, lastError);
      }
    }
  }

  return failureResult(ErrorCode.TAB_COMMUNICATION_ERROR, `Failed after 5 attempts: ${lastError}`);
}

// ── Message forwarding ─────────────────────────────────────────────

async function forwardToTargetVintedTab(
  message: ExtensionMessage,
  sender?: chrome.runtime.MessageSender,
): Promise<unknown> {
  const tab = await getTargetVintedTab(sender, 'scan');
  if (!tab?.id) throw new Error('No Vinted tab found. Open your Vinted profile/listings page and try again.');
  if (!isVintedUrl(tab.url))
    throw new Error('Target tab is not a Vinted page. Open the Vinted page you want to scan first.');
  return chrome.tabs.sendMessage(tab.id, message);
}

/** Check if a runtime error is the "receiving end does not exist" MV3 lifecycle error. */
function isDeadContentScriptError(err: unknown): boolean {
  return String(err).includes('Receiving end does not exist');
}

/**
 * Reload a tab and wait for its content script to be ready.
 * Used to recover from the MV3 update scenario where content scripts
 * in existing tabs become unresponsive after an extension reload.
 */
async function reloadTabAndWaitForContentScript(tabId: number): Promise<boolean> {
  try {
    await chrome.tabs.reload(tabId);
    // Wait for the page to finish loading + content script init
    await new Promise((resolve) => setTimeout(resolve, 3000));
    return true;
  } catch {
    return false;
  }
}

/**
 * Reload all open Vinted tabs so content scripts re-inject after update.
 */
async function reloadAllVintedTabs(): Promise<void> {
  const tabs = await queryVintedTabs();
  const urls = tabs.map((t) => `${t.id}: ${t.url ?? '?'}`).join(', ');
  await log(`Reloading ${tabs.length} Vinted tab(s) for content script re-injection: [${urls}]`, 'info');
  for (const tab of tabs) {
    if (tab.id) {
      try {
        await chrome.tabs.reload(tab.id);
      } catch {
        // tab may have been closed since query
      }
    }
  }
}

// ── Message handler ────────────────────────────────────────────────

function isAllowedPhotoFetchUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    return (
      parsed.protocol === 'https:' &&
      (host === 'vinted.net' ||
        host.endsWith('.vinted.net') ||
        host === 'vinted-cdn.com' ||
        host.endsWith('.vinted-cdn.com'))
    );
  } catch {
    return false;
  }
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 32768) {
    const chunk = bytes.subarray(offset, offset + 32768);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

async function fetchPhotoAsDataUrl(url: string): Promise<FetchPhotoResponse> {
  if (!isAllowedPhotoFetchUrl(url)) {
    let host = 'invalid-url';
    try {
      host = new URL(url).hostname;
    } catch {
      // keep invalid-url
    }
    return { ok: false, error: `Photo host is not allowed for background fetch: ${host}` };
  }

  try {
    const response = await fetch(url, {
      credentials: 'omit',
      redirect: 'follow',
    });

    const contentType = response.headers.get('content-type') ?? 'image/jpeg';
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      return { ok: false, error: `Photo fetch ${response.status}: ${text.slice(0, 160)}` };
    }
    if (!contentType.toLowerCase().startsWith('image/')) {
      return { ok: false, error: `Photo fetch returned non-image content-type: ${contentType}` };
    }

    const buffer = await response.arrayBuffer();
    if (buffer.byteLength === 0) {
      return { ok: false, error: 'Photo fetch returned an empty body' };
    }

    return {
      ok: true,
      contentType,
      byteLength: buffer.byteLength,
      dataUrl: `data:${contentType};base64,${arrayBufferToBase64(buffer)}`,
    };
  } catch (err) {
    return { ok: false, error: `Photo background fetch failed: ${String(err).slice(0, 180)}` };
  }
}

async function handleMessage(
  message: ExtensionMessage,
  sender?: chrome.runtime.MessageSender,
): Promise<unknown> {
  await queueReady;

  switch (message.type) {
    case 'FETCH_PHOTO':
      return fetchPhotoAsDataUrl(message.payload.url);

    case 'SCAN_LISTINGS': {
      await log('Scan requested; forwarding to target Vinted tab content script', 'info');

      const tab = await getTargetVintedTab(sender, 'scan');
      if (!tab?.id) {
        return { ok: false, error: 'No Vinted tab found. Open your Vinted profile page and try again.' };
      }
      if (!isVintedUrl(tab.url)) {
        return { ok: false, error: 'Target tab is not a Vinted page.' };
      }

      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const response = (await chrome.tabs.sendMessage(tab.id, message)) as {
            ok?: boolean;
            error?: string;
            listings?: Listing[];
            scan?: { source: 'wardrobe-api' | 'visible-dom-fallback' };
          };
          if (response?.ok) {
            await log(`Scan completed with ${response.listings?.length ?? 0} listing(s) returned`, 'info');
            if (response.listings && response.listings.length > 0) {
              await saveScanResult(response.listings, response.scan?.source ?? 'wardrobe-api');
              await log(
                `Scan saved locally at ${new Date().toLocaleString('pl-PL')} ` +
                  `for the automatic relist cycle (${response.listings.length} listing(s))`,
                'info',
              );
            }
          } else {
            await log(`Scan failed: ${response?.error ?? 'content script returned no result'}`, 'warn');
          }
          return response;
        } catch (err) {
          const isDead = isDeadContentScriptError(err);
          if (isDead && attempt < 2) {
            await log(`Content script not responding (attempt ${attempt + 1}); reloading tab and retrying...`, 'warn');
            await reloadTabAndWaitForContentScript(tab.id);
            continue;
          }
          const errorMessage = `Scan failed before reaching content script: ${String(err)}`;
          await log(errorMessage, 'error');
          return { ok: false, error: errorMessage };
        }
      }
      return { ok: false, error: 'Scan failed after 3 attempts.' };
    }

    case 'ADD_TO_QUEUE': {
      const preflight = preflightRelistListings(message.payload.listings);
      for (const issue of preflight.issues) {
        await log(`[relist-preflight] ${issue.message}`, issue.severity === 'block' ? 'error' : 'warn');
      }

      if (preflight.accepted.length === 0) {
        const preflightMessage = `${formatRelistPreflightSummary(preflight)} Brak aukcji gotowych do dodania.`;
        await log(`[relist-preflight] ${preflightMessage}`, 'error');
        return { ok: false, error: preflightMessage, preflight };
      }

      await saveBackups(preflight.accepted);
      await log(`Pre-relist backup saved for ${preflight.accepted.length} listing(s)`, 'info');
      const added = await queue.add(preflight.accepted);
      await log(`[relist-preflight] ${formatRelistPreflightSummary(preflight)}`, 'info');
      return { ok: true, added, status: queue.getStatus(), preflight };
    }

    case 'CLEAR_QUEUE':
      await queue.clear();
      return { ok: true, status: queue.getStatus() };

    case 'PAUSE_QUEUE':
      await queue.pause();
      return { ok: true, status: queue.getStatus() };

    case 'RESUME_QUEUE':
      await queue.resume();
      return { ok: true, status: queue.getStatus() };

    case 'QUEUE_RELIST':
      await log(`Legacy relist request received for ${message.payload.ids.length} id(s); starting queue`, 'info');
      await queue.resume();
      return { ok: true, status: queue.getStatus() };

    case 'GET_STATUS':
      return { ok: true, status: queue.getStatus() };

    case 'GET_LOGS':
      return { ok: true, logs: await getLogs() };

    case 'CLEAR_LOGS':
      await clearLogs();
      return { ok: true };

    case 'SAVE_BACKUP':
      await saveBackup(message.payload.listing);
      await log(`Backup saved for listing ${message.payload.listing.id}`, 'info');
      return { ok: true };

    case 'GET_BACKUPS':
      return { ok: true, backups: await getBackups() };

    case 'CLEAR_BACKUPS':
      await clearBackups();
      return { ok: true };

    case 'GET_SETTINGS':
      return { ok: true, settings: await getSettings() };

    case 'SET_SETTINGS':
      return { ok: false, error: 'Settings messages are handled directly by the options page.' };

    case 'GET_STATS':
      return { ok: true, stats: await getStats() };

    case 'UPDATE_STATS':
      return { ok: true, stats: await updateStats(message.payload.success) };

    case 'GET_SCAN':
      return { ok: true, scan: await getScanResult() };

    default:
      return { ok: false, code: ErrorCode.UNKNOWN_MESSAGE_TYPE, error: 'Unknown message type' };
  }
}

// ── Lifecycle hooks ────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  log('Extension installed/updated — reloading Vinted tabs for content script re-injection', 'info');
  // Reload open Vinted tabs so content scripts re-inject (MV3 requirement)
  reloadAllVintedTabs().catch(() => {});
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'vbr-queue-step') {
    queueReady
      .then(() => queue.onAlarm())
      .catch((err: unknown) => log(`Queue alarm handler failed: ${String(err)}`, 'error'));
  } else if (alarm.name === AUTO_RELIST_ALARM_NAME) {
    queueReady
      .then(() => runAutoRelistCycle())
      .catch((err: unknown) => log(`Auto-relist cycle failed: ${String(err)}`, 'error'));
  }
});

// Create/clear the auto-relist alarm to match stored settings at startup, and
// re-sync whenever the options page saves new settings (it writes storage
// directly instead of sending a message). The guard keeps the module loadable
// in Node-based test mocks that do not stub chrome.storage.onChanged.
void queueReady.then(() => syncAutoRelistAlarm());

if (chrome.storage.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes['vbr:settings']) {
      syncAutoRelistAlarm().catch((err: unknown) =>
        log(`Auto-relist settings change handling failed: ${String(err)}`, 'error'),
      );
    }
  });
}

chrome.runtime.onMessage.addListener((message: ExtensionMessage, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch((err: unknown) => sendResponse({ ok: false, error: String(err) }));
  return true; // Keep channel open for async response.
});
