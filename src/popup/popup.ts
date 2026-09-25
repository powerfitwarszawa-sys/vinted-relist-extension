import type {
  ExtensionMessage,
  Listing,
  LogEntry,
  QueueItemStatus,
  QueueStatus,
  ScanListingsResponse,
  StatsData,
} from '../core/contracts';
import {
  formatListingScanSummary,
  getListingSourceStatus,
  QUEUE_STATE_LABELS,
} from '../core/listing-status';
import {
  getSelectedListings as getSelectedListingItems,
  getVisibleSelectionState,
  setListingSelection,
  setListingsSelection,
} from '../core/listing-selection';
import { clearLogs, error, log } from '../core/logger';
import { formatRelistPreflightSummary, preflightRelistListings } from '../core/relist-preflight';
import { canStartNewRelist } from '../core/relist-safety';
import {
  createPopupBackupExportButton,
  createPopupBackupRow,
  createPopupEmptyState,
  createPopupListingRow,
  createPopupLogRow,
  createPopupQueueRow,
} from './popup-row-renderers';
import { getRequiredElement } from '../shared/dom-utils';
import { sendMessage } from '../shared/messaging';

type ActionResponse = {
  ok?: boolean;
  error?: string;
  listings?: Listing[];
  note?: string;
};

const els = {
  state: getRequiredElement('state', 'span'),
  total: getRequiredElement('total', 'span'),
  completed: getRequiredElement('completed', 'span'),
  failed: getRequiredElement('failed', 'span'),
  currentId: getRequiredElement('currentId', 'span'),
  lastError: getRequiredElement('lastError', 'span'),
  lastErrorRow: getRequiredElement('lastErrorRow', 'section'),
  logs: getRequiredElement('logs', 'div'),
  listings: getRequiredElement('listings', 'div'),
  selectAll: getRequiredElement('selectAll', 'input'),
  scanBtn: getRequiredElement('scanBtn', 'button'),
  relistBtn: getRequiredElement('relistBtn', 'button'),
  clearBtn: getRequiredElement('clearBtn', 'button'),
  pauseBtn: getRequiredElement('pauseBtn', 'button'),
  resumeBtn: getRequiredElement('resumeBtn', 'button'),
  optionsLink: getRequiredElement('optionsLink', 'a'),
  backupsLink: getRequiredElement('backupsLink', 'a'),
  dashboardLink: getRequiredElement('dashboardLink', 'a'),
  vintedPanelLink: getRequiredElement('vintedPanelLink', 'a'),
  progressFill: getRequiredElement('progressFill', 'div'),
  previewOverlay: getRequiredElement('previewOverlay', 'div'),
  previewThumb: getRequiredElement('previewThumb', 'img'),
  previewTitleInput: getRequiredElement('previewTitleInput', 'input'),
  previewPriceInput: getRequiredElement('previewPriceInput', 'input'),
  previewId: getRequiredElement('previewId', 'span'),
  previewDescInput: getRequiredElement('previewDescInput', 'textarea'),
  previewCancel: getRequiredElement('previewCancel', 'button'),
  previewRelist: getRequiredElement('previewRelist', 'button'),
  sortSelect: getRequiredElement('sortSelect', 'select'),
  bulkPriceInput: getRequiredElement('bulkPriceInput', 'input'),
  bulkPriceApply: getRequiredElement('bulkPriceApply', 'button'),
  bulkPriceWrap: getRequiredElement('bulkPriceWrap', 'span'),
  statsToday: getRequiredElement('statsToday', 'strong'),
  statsOk: getRequiredElement('statsOk', 'strong'),
  statsErr: getRequiredElement('statsErr', 'strong'),
  statsTotal: getRequiredElement('statsTotal', 'strong'),
  searchInput: getRequiredElement('searchInput', 'input'),
  sourceStatusFilter: getRequiredElement('sourceStatusFilter', 'select'),
  scanSummary: getRequiredElement('scanSummary', 'p'),
  clearLogsBtn: getRequiredElement('clearLogsBtn', 'button'),
};

let scannedListings: Listing[] = [];
let selectedListingIds = new Set<string>();
let lastQueueState: string | null = null;

function setText(element: HTMLElement, text: string): void {
  element.textContent = text;
}

function renderStats(stats: StatsData): void {
  setText(els.statsToday, String(stats.todayRelisted));
  setText(els.statsOk, String(stats.todaySuccess));
  setText(els.statsErr, String(stats.todayError));
  setText(els.statsTotal, String(stats.totalRelisted));
}

function renderScanSummary(response: Pick<ScanListingsResponse, 'note' | 'scan'>): void {
  const summary = response.scan ? formatListingScanSummary(response.scan) : response.note;
  setText(els.scanSummary, summary ?? 'Skanowanie nie zwróciło podsumowania.');
  if (response.scan) {
    els.scanSummary.dataset.source = response.scan.source;
  } else {
    delete els.scanSummary.dataset.source;
  }
}

async function loadStats(): Promise<void> {
  try {
    const response = await sendMessage({ type: 'GET_STATS' });
    if (response?.ok && response.stats) {
      renderStats(response.stats);
    }
  } catch {
    // stats loading is best-effort
  }
}

function renderStatus(status: QueueStatus): void {
  setText(els.state, QUEUE_STATE_LABELS[status.state]);
  setText(els.total, String(status.total));
  setText(els.completed, String(status.completed));
  setText(els.failed, String(status.failed));
  setText(els.currentId, status.currentId ?? '—');

  els.state.className = `status-bar__value status-bar__value--${status.state}`;

  if (status.total > 0) {
    const progress = ((status.completed + status.failed) / status.total) * 100;
    els.progressFill.style.width = `${progress}%`;
  } else {
    els.progressFill.style.width = '0%';
  }

  const pauseBtn = els.pauseBtn;
  const resumeBtn = els.resumeBtn;
  pauseBtn.disabled = status.state !== 'running';
  resumeBtn.disabled = status.state === 'running' || status.state === 'idle' || status.total === 0;

  if (status.lastError) {
    setText(els.lastError, status.lastError);
    els.lastErrorRow.style.display = 'flex';
  } else {
    setText(els.lastError, '—');
    els.lastErrorRow.style.display = 'none';
  }

  if (status.items && status.items.length > 0) {
    renderQueueView(status.items);
  }

  // Notification on queue finish
  if (lastQueueState === 'running' && status.state === 'idle' && status.total > 0) {
    showFinishNotification(status);
  }
  lastQueueState = status.state;
}

function showFinishNotification(status: QueueStatus): void {
  const msg = `Kolejka zakończona: ${status.completed} sukces, ${status.failed} błąd (${status.total} łącznie)`;
  try {
    new Notification('Vinted Relister — gotowe', {
      body: msg,
      icon: 'icon128.png',
    });
  } catch {
    // Notification not available (no permission)
  }
  log(msg, 'info');
}

function renderQueueView(items: QueueItemStatus[]): void {
  els.listings.innerHTML = '';
  selectedListingIds.clear();
  els.selectAll.checked = false;
  els.selectAll.disabled = true;
  updateRelistButton();

  for (const item of items) {
    els.listings.appendChild(createPopupQueueRow(item));
  }
}

function renderLogs(logs: LogEntry[]): void {
  els.logs.innerHTML = '';

  if (logs.length === 0) {
    els.logs.appendChild(createPopupEmptyState('Brak zdarzeń.'));
    return;
  }

  for (const entry of logs.slice(0, 20)) {
    els.logs.appendChild(createPopupLogRow(entry));
  }
}

function renderListings(listings: Listing[]): void {
  scannedListings = listings;
  els.listings.innerHTML = '';

  const searchText = (els.searchInput?.value ?? '').toLowerCase().trim();
  const sortBy = els.sortSelect.value;
  const sourceStatusFilter = els.sourceStatusFilter.value;
  let filtered = listings;

  if (searchText) {
    filtered = listings.filter((l) => l.title.toLowerCase().includes(searchText));
  }
  if (sourceStatusFilter !== 'all') {
    filtered = filtered.filter((listing) => getListingSourceStatus(listing) === sourceStatusFilter);
  }

  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === 'price') return a.price - b.price;
    if (sortBy === 'id') return a.id.localeCompare(b.id);
    return a.title.localeCompare(b.title);
  });

  updateRelistButton();

  if (sorted.length === 0) {
    els.listings.appendChild(
      createPopupEmptyState('Brak aukcji dla wybranych kryteriów.', 'listings__empty'),
    );
    updateSelectAllState();
    return;
  }

  for (const listing of sorted) {
    els.listings.appendChild(createPopupListingRow(listing, {
      selected: selectedListingIds.has(listing.id),
      onSelectionChange: (selected) => {
        setListingSelected(listing.id, selected);
        updateSelectAllState();
        updateRelistButton();
      },
    }));
  }

  updateSelectAllState();
}

function getSelectedListings(): Listing[] {
  return getSelectedListingItems(scannedListings, selectedListingIds);
}

function setListingSelected(id: string, selected: boolean): void {
  selectedListingIds = setListingSelection(selectedListingIds, id, selected);
}

function updateSelectAllState(): void {
  const checkboxes = els.listings.querySelectorAll<HTMLInputElement>('input[type="checkbox"][data-id]');
  const selection = getVisibleSelectionState(
    Array.from(checkboxes, (checkbox) => checkbox.dataset.id ?? ''),
    selectedListingIds,
  );
  els.selectAll.checked = selection.allVisibleSelected;
  els.selectAll.indeterminate = selection.someVisibleSelected && !selection.allVisibleSelected;
  els.selectAll.disabled = checkboxes.length === 0;

  // Show bulk price input when 2+ selected
  els.bulkPriceWrap.style.display = selection.selectedVisibleCount >= 2 ? 'inline-flex' : 'none';
}

function updateRelistButton(): void {
  const selectedCount = getSelectedListings().length;
  const button = els.relistBtn;
  button.textContent = selectedCount > 0 ? `Wykonaj relist (${selectedCount})` : 'Wykonaj relist';
  button.disabled = selectedCount === 0;
}

async function reportPreflight(listings: Listing[]): Promise<Listing[]> {
  const result = preflightRelistListings(listings);
  for (const issue of result.issues) {
    await log(`[relist-preflight] ${issue.message}`, issue.severity === 'block' ? 'error' : 'warn');
  }

  const blocks = result.issues.filter((issue) => issue.severity === 'block');
  if (blocks.length > 0) {
    const message = `${formatRelistPreflightSummary(result)} ${blocks[0].message}`;
    setText(els.lastError, message);
    els.lastErrorRow.style.display = 'flex';
  }
  return result.accepted;
}

async function refresh(): Promise<void> {
  try {
    const [statusResponse, logsResponse] = await Promise.all([
      sendMessage({ type: 'GET_STATUS' }),
      sendMessage({ type: 'GET_LOGS' }),
    ]);

    if (statusResponse.ok && statusResponse.status) {
      renderStatus(statusResponse.status);
    }

    if (logsResponse.ok && Array.isArray(logsResponse.logs)) {
      renderLogs(logsResponse.logs);
    }
  } catch (err) {
    renderStatus({
      state: 'error',
      total: 0,
      completed: 0,
      failed: 0,
      lastError: String(err),
      items: [],
    });
    error('Popup refresh failed:', String(err));
  }
}

function getActionError(response: unknown): string | undefined {
  if (!response || typeof response !== 'object') {
    return 'Action returned no response.';
  }

  const actionResponse = response as ActionResponse;
  if (actionResponse.ok === false) {
    return actionResponse.error ?? 'Action failed without error details.';
  }

  return undefined;
}

async function logActionResult(message: ExtensionMessage, response: unknown): Promise<void> {
  const actionError = getActionError(response);
  if (actionError) {
    await error(`Popup action ${message.type} failed:`, actionError);
    return;
  }

  if (message.type === 'SCAN_LISTINGS') {
    const scanResponse = response as ActionResponse;
    const count = scanResponse.listings?.length ?? 0;
    await log(scanResponse.note ?? `Popup scan completed: ${count} listing(s) returned`, 'info');
  }
}

type PopupActionButtonId = 'clearBtn' | 'pauseBtn' | 'resumeBtn';

function wireButton(id: PopupActionButtonId, message: ExtensionMessage): void {
  const button = els[id];
  button.addEventListener('click', async () => {
    const originalText = button.textContent ?? '';
    button.disabled = true;
    button.textContent = `${originalText}...`;
    try {
      const response = await sendMessage(message);
      await logActionResult(message, response);
    } catch (err) {
      await error(`Popup action ${message.type} failed:`, String(err));
    } finally {
      await refresh();
      button.textContent = originalText;
      button.disabled = false;
    }
  });
}

// ── Sort ─────────────────────────────────────────────────────────────
els.sortSelect.addEventListener('change', () => {
  if (scannedListings.length > 0) {
    renderListings(scannedListings);
  }
});

els.sourceStatusFilter.addEventListener('change', () => {
  if (scannedListings.length > 0) {
    renderListings(scannedListings);
  }
});

// ── Search ─────────────────────────────────────────────────────────
let searchTimer: ReturnType<typeof setTimeout> | null = null;
els.searchInput.addEventListener('input', () => {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    if (scannedListings.length > 0) {
      renderListings(scannedListings);
    }
  }, 200);
});

// ── Bulk price ───────────────────────────────────────────────────────
els.bulkPriceApply.addEventListener('click', () => {
  const price = parseFloat(els.bulkPriceInput.value);
  if (isNaN(price) || price <= 0) return;

  const selected = getSelectedListings();
  for (const listing of selected) {
    listing.price = price;
  }

  // Re-render to show updated prices
  if (scannedListings.length > 0) {
    renderListings(scannedListings);
  }

  els.bulkPriceInput.value = '';
  log(`Cena ustawiona na ${price} dla ${selected.length} aukcji`, 'info');
});

// ── Scan ─────────────────────────────────────────────────────────────
els.scanBtn.addEventListener('click', async () => {
  const button = els.scanBtn;
  const originalText = button.textContent ?? '';
  button.disabled = true;
  button.textContent = 'Skanowanie…';

  try {
    const response = await sendMessage({ type: 'SCAN_LISTINGS' });

    await logActionResult({ type: 'SCAN_LISTINGS' }, response);

    if (response?.ok && Array.isArray(response.listings)) {
      selectedListingIds.clear();
      renderListings(response.listings);
      renderScanSummary(response);
    }
  } catch (err) {
    await error('Popup scan failed:', String(err));
  } finally {
    await refresh();
    button.textContent = originalText;
    button.disabled = false;
  }
});

wireButton('clearBtn', { type: 'CLEAR_QUEUE' });
wireButton('pauseBtn', { type: 'PAUSE_QUEUE' });
wireButton('resumeBtn', { type: 'RESUME_QUEUE' });

els.relistBtn.addEventListener('click', async () => {
  const button = els.relistBtn;
  const selected = getSelectedListings();
  if (selected.length === 0) {
    await log('Relist aborted: no listings selected', 'warn');
    return;
  }

  const listings = await reportPreflight(selected);
  if (listings.length === 0) return;

  if (listings.length === 1) {
    showListingPreview(listings[0]);
  } else {
    await startRelist(listings, button);
  }
});

async function startRelist(listings: Listing[], button: HTMLButtonElement): Promise<void> {
  button.disabled = true;

  try {
    const statusResponse = await sendMessage({ type: 'GET_STATUS' });
    if (!statusResponse.ok || !statusResponse.status) {
      await error('Relist failed to read queue status:', statusResponse.error ?? 'unknown error');
      return;
    }
    if (!canStartNewRelist(statusResponse.status)) {
      const message = 'Nie można rozpocząć nowego relistu: bieżąca kolejka nadal ma oczekujące zadania.';
      setText(els.lastError, message);
      els.lastErrorRow.style.display = 'flex';
      await log(message, 'warn');
      return;
    }

    button.textContent = 'Czyszczenie…';
    const clearResponse = await sendMessage({ type: 'CLEAR_QUEUE' });
    if (!clearResponse?.ok) {
      await error('Relist failed to clear queue:', clearResponse?.error ?? 'unknown error');
      return;
    }

    button.textContent = 'Dodawanie…';
    const addResponse = await sendMessage({ type: 'ADD_TO_QUEUE', payload: { listings } });

    if (!addResponse?.ok) {
      await error('Relist failed at queue:', addResponse?.error ?? 'unknown error');
      return;
    }

    await log(`Relist queued ${addResponse.added ?? listings.length} selected listing(s)`, 'info');

    button.textContent = 'Uruchamianie…';
    const resumeResponse = await sendMessage({ type: 'RESUME_QUEUE' });

    if (!resumeResponse?.ok) {
      await error('Relist failed to start:', resumeResponse?.error ?? 'unknown error');
    }
  } catch (err) {
    await error('Relist action failed:', String(err));
  } finally {
    await refresh();
    updateRelistButton();
    button.disabled = false;
  }
}

function showListingPreview(listing: Listing): void {
  els.previewThumb.src = listing.thumbnailUrl ?? '';
  els.previewThumb.style.display = listing.thumbnailUrl ? 'block' : 'none';
  els.previewTitleInput.value = listing.title;
  els.previewPriceInput.value = listing.currency ? `${listing.price} ${listing.currency}` : String(listing.price);
  els.previewId.textContent = `ID: ${listing.id}`;
  els.previewDescInput.value = listing.description ?? '';

  els.previewOverlay.style.display = 'flex';

  els.previewCancel.onclick = () => {
    els.previewOverlay.style.display = 'none';
  };

  els.previewRelist.onclick = async () => {
    els.previewOverlay.style.display = 'none';

    const editedListing: Listing = {
      ...listing,
      title: els.previewTitleInput.value || listing.title,
      description: els.previewDescInput.value || listing.description,
    };

    const button = els.relistBtn;
    await startRelist([editedListing], button);
  };
}

els.selectAll.addEventListener('change', () => {
  const checkboxes = els.listings.querySelectorAll<HTMLInputElement>('input[type="checkbox"][data-id]');
  const visibleIds = Array.from(checkboxes, (checkbox) => checkbox.dataset.id ?? '');
  selectedListingIds = setListingsSelection(selectedListingIds, visibleIds, els.selectAll.checked);
  Array.from(checkboxes).forEach((checkbox) => {
    checkbox.checked = els.selectAll.checked;
  });
  updateSelectAllState();
  updateRelistButton();
});

els.optionsLink.addEventListener('click', (event) => {
  event.preventDefault();
  chrome.runtime.openOptionsPage();
});

els.backupsLink.addEventListener('click', async (event) => {
  event.preventDefault();
  await showBackups();
});

els.dashboardLink.addEventListener('click', (event) => {
  event.preventDefault();
  chrome.tabs.create({ url: chrome.runtime.getURL('dist/dashboard/dashboard.html') });
});

els.vintedPanelLink.addEventListener('click', (event) => {
  event.preventDefault();
  chrome.tabs.create({ url: 'https://www.vinted.pl/member/107890191' });
});

async function showBackups(): Promise<void> {
  try {
    const response = await sendMessage({ type: 'GET_BACKUPS' });

    if (!response?.ok || !Array.isArray(response.backups)) {
      await log('Nie udało się pobrać kopii zapasowych', 'error');
      return;
    }

    const backups = response.backups;

    if (backups.length === 0) {
      await log('Brak kopii zapasowych', 'info');
      els.listings.innerHTML = '';
      els.listings.appendChild(createPopupEmptyState('Brak kopii zapasowych.', 'listings__empty'));
      return;
    }

    els.listings.innerHTML = '';
    selectedListingIds.clear();
    els.selectAll.checked = false;
    els.selectAll.disabled = true;
    updateRelistButton();

    const exportBtn = createPopupBackupExportButton('Eksportuj JSON', () => {
      const blob = new Blob([JSON.stringify(backups, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `vinted-backups-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      log('Backupy wyeksportowane do pliku JSON', 'info');
    });
    const exportCsvBtn = createPopupBackupExportButton('Eksportuj CSV', () => {
      const escapeCell = (value: unknown): string => {
        const text = String(value ?? '');
        return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
      };
      const header = ['id', 'title', 'price', 'currency', 'sourceStatus', 'backedUpAt', 'relistResult', 'relistNote', 'url'];
      const rows = backups.map((entry) =>
        [
          escapeCell(entry.id),
          escapeCell(entry.title),
          escapeCell(entry.price),
          escapeCell(entry.currency),
          escapeCell(entry.sourceStatus ?? ''),
          escapeCell(entry.backedUpAt > 0 ? new Date(entry.backedUpAt).toISOString() : ''),
          escapeCell(entry.relistResult ?? ''),
          escapeCell(entry.relistNote ?? ''),
          escapeCell(entry.url),
        ].join(','),
      );
      const blob = new Blob(['\uFEFF' + [header.join(','), ...rows].join('\n')], {
        type: 'text/csv;charset=utf-8',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `vinted-backups-${Date.now()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      log('Backupy wyeksportowane do pliku CSV', 'info');
    });
    els.listings.appendChild(exportBtn);
    els.listings.appendChild(exportCsvBtn);

    for (const backup of backups) {
      els.listings.appendChild(createPopupBackupRow(backup, () => {
        window.open(backup.url, '_blank');
      }));
    }

    await log(`Znaleziono ${backups.length} kopii zapasowych`, 'info');
  } catch (err) {
    await error('Błąd podczas pobierania kopii zapasowych:', String(err));
  }
}

// ── Permission for notification ──────────────────────────────────────
if ('Notification' in window && Notification.permission === 'default') {
  Notification.requestPermission().catch(() => {});
}

// ── Init ─────────────────────────────────────────────────────────────
loadStats().catch(() => {});

els.clearLogsBtn.addEventListener('click', async () => {
  await clearLogs();
  await refresh();
});

refresh().catch((err) => error('Popup init failed:', String(err)));

let refreshInterval: ReturnType<typeof setInterval> | null = null;

function startAutoRefresh(): void {
  if (refreshInterval) return;
  refreshInterval = setInterval(() => {
    refresh().catch(() => {});
  }, 2000);
}

function stopAutoRefresh(): void {
  if (refreshInterval) {
    clearInterval(refreshInterval);
    refreshInterval = null;
  }
}

startAutoRefresh();

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stopAutoRefresh();
  } else {
    refresh().catch(() => {});
    startAutoRefresh();
  }
});
