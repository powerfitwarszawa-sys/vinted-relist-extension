/**
 * Dashboard — full management interface.
 *
 * All message responses are type-narrowed; no `any` casts.
 * All DOM construction uses safe helpers.
 */

import type {
  Listing,
  LogEntry,
  QueueItemStatus,
  QueueStatus,
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
import { PRODUCT_MODULES, type ProductModuleStatus } from '../core/product-modules';
import { formatRelistPreflightSummary, preflightRelistListings } from '../core/relist-preflight';
import { canStartNewRelist } from '../core/relist-safety';
import {
  createBackupRow,
  createDashboardLogRow,
  createQueueItemRow,
  createScanListingRow,
} from './dashboard-row-renderers';
import {
  createElement,
  getRequiredElement,
  span,
} from '../shared/dom-utils';
import { sendMessage } from '../shared/messaging';

// ── Constants ─────────────────────────────────────────────────────

const NON_INFORMATIVE_ERROR_MESSAGES = new Set(['error', 'x', 'undefined', 'null', '[object object]']);
const ERROR_DETAILS_FALLBACK =
  'No error details available. Open Stats -> Activity log and copy the latest WARN/ERROR entries.';

// ── State ───────────────────────────────────────────────────────────

interface DashState {
  scannedListings: Listing[];
  selectedIds: Set<string>;
  lastQueueState: string | null;
}

const state: DashState = {
  scannedListings: [],
  selectedIds: new Set<string>(),
  lastQueueState: null,
};

// ── DOM cache ───────────────────────────────────────────────────────

const els = {
  scanBtn: getRequiredElement('dashScanBtn', 'button'),
  relistBtn: getRequiredElement('dashRelistBtn', 'button'),
  clearBtn: getRequiredElement('dashClearBtn', 'button'),
  searchInput: getRequiredElement('dashSearchInput', 'input'),
  statusFilter: getRequiredElement('dashStatusFilter', 'select'),
  sortSelect: getRequiredElement('dashSortSelect', 'select'),
  selectAll: getRequiredElement('dashSelectAll', 'input'),
  exportBtn: getRequiredElement('dashExportBtn', 'button'),
  listings: getRequiredElement('dashListings', 'div'),
  scanSummary: getRequiredElement('dashScanSummary', 'div'),
  pauseBtn: getRequiredElement('dashPauseBtn', 'button'),
  resumeBtn: getRequiredElement('dashResumeBtn', 'button'),
  queueItems: getRequiredElement('dashQueueItems', 'div'),
  queueState: getRequiredElement('dashState', 'strong'),
  queueTotal: getRequiredElement('dashTotal', 'strong'),
  queueDone: getRequiredElement('dashDone', 'strong'),
  queueFailed: getRequiredElement('dashFailed', 'strong'),
  queueCurrent: getRequiredElement('dashCurrent', 'strong'),
  progressFill: getRequiredElement('dashProgressFill', 'div'),
  errorBanner: getRequiredElement('dashErrorBanner', 'div'),
  errorMessage: getRequiredElement('dashErrorMsg', 'span'),
  errorPanelBtn: getRequiredElement('dashErrorPanelBtn', 'button'),
  errorCloseBtn: getRequiredElement('dashErrorClose', 'button'),
  statsToday: getRequiredElement('dashStatsToday', 'span'),
  statsOk: getRequiredElement('dashStatsOk', 'span'),
  statsErr: getRequiredElement('dashStatsErr', 'span'),
  statsTotal: getRequiredElement('dashStatsTotal', 'span'),
  logs: getRequiredElement('dashLogs', 'div'),
  backupItems: getRequiredElement('dashBackupItems', 'div'),
  modules: getRequiredElement('dashModules', 'div'),
};

function getTabElement(name: string): HTMLElement {
  return getRequiredElement(`tab-${name}`, 'section');
}

// ── Message helpers ─────────────────────────────────────────────────

// All messaging goes through the typed sendMessage wrapper from shared/messaging,
// which resolves the response type from the MessageResponseMap in core/contracts.

// ── Tab switching ───────────────────────────────────────────────────

function switchTab(name: string): void {
  document.querySelectorAll('.dash-nav__btn').forEach((b) => b.classList.remove('dash-nav__btn--active'));
  document.querySelectorAll('.dash-tab').forEach((t) => t.classList.remove('dash-tab--active'));
  getTabElement(name).classList.add('dash-tab--active');
  document.querySelector(`.dash-nav__btn[data-tab="${name}"]`)?.classList.add('dash-nav__btn--active');

  // Lazy refresh
  if (name === 'stats') void refreshStats();
  if (name === 'backups') void renderBackups();
  if (name === 'modules') renderModules();
}

// ── Scan ────────────────────────────────────────────────────────────

async function handleScan(): Promise<void> {
  const btn = els.scanBtn;
  btn.textContent = 'Skanowanie...';
  btn.disabled = true;
  updateScanSummary('Skanowanie aktywnej strony Vinted...');

  try {
    const res = await sendMessage({ type: 'SCAN_LISTINGS' });

    if (res.ok && Array.isArray(res.listings)) {
      state.scannedListings = res.listings;
      state.selectedIds.clear();
      els.selectAll.checked = false;
      console.log(`[Dashboard] Scan returned ${res.listings.length} listing(s)`);
      try {
        updateScanSummary(
          res.scan ? formatListingScanSummary(res.scan) : (res.note ?? `Skanowanie zakończone: wczytano ${res.listings.length} ofert.`),
        );
        renderScanGrid();
      } catch (renderErr) {
        console.error('[Dashboard] renderScanGrid failed:', renderErr);
        showTip('Nie udało się wyświetlić ofert. Sprawdź konsolę (F12).');
      }
    } else {
      const message = typeof res.error === 'string' ? res.error : 'Skanowanie nie zwróciło danych. Otwórz profil Vinted i spróbuj ponownie.';
      console.warn('[Dashboard] Scan failed:', message);
      updateScanSummary(`Skanowanie nie powiodło się: ${message}`);
      showTip(message);
    }
  } catch (err) {
    console.error('[Dashboard] Scan crashed:', err);
    updateScanSummary(`Błąd skanowania: ${String(err).slice(0, 120)}`);
    showTip(`Błąd skanowania: ${String(err).slice(0, 80)}`);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Skanuj stronę';
    void refreshStatus();
  }
}

// ── Render scan grid ────────────────────────────────────────────────

function renderScanGrid(): void {
  const container = els.listings;
  container.innerHTML = '';
  const search = els.searchInput.value.toLowerCase();
  const statusFilter = els.statusFilter.value;
  const sortBy = els.sortSelect.value;

  let items = [...state.scannedListings];
  if (search) items = items.filter((l) => l.title.toLowerCase().includes(search));
  if (statusFilter !== 'all') {
    items = items.filter((listing) => getListingSourceStatus(listing) === statusFilter);
  }
  items.sort((a, b) => {
    if (sortBy === 'price-asc') return a.price - b.price;
    if (sortBy === 'price-desc') return b.price - a.price;
    if (sortBy === 'id') return a.id.localeCompare(b.id);
    return a.title.localeCompare(b.title);
  });

  if (!items.length) {
    container.appendChild(createElement({ text: 'Brak ofert pasujących do wyszukiwania lub filtra.', className: 'dash-empty' }));
    updateSelectAllState();
    return;
  }

  for (const listing of items) {
    container.appendChild(createScanListingRow(listing, {
      selected: state.selectedIds.has(listing.id),
      onSelectionChange: (selected) => {
        setSelected(listing.id, selected);
        updateSelectAllState();
        updateRelistBtn();
      },
    }));
  }
  updateSelectAllState();
  updateRelistBtn();
}

function setSelected(id: string, selected: boolean): void {
  state.selectedIds = setListingSelection(state.selectedIds, id, selected);
}

function getSelected(): Listing[] {
  return getSelectedListingItems(state.scannedListings, state.selectedIds);
}

function updateRelistBtn(): void {
  const count = getSelected().length;
  const btn = els.relistBtn;
  btn.textContent = count ? `Wykonaj (${count})` : 'Wykonaj';
  btn.disabled = count === 0;
}

function updateSelectAllState(): void {
  const selectAll = els.selectAll;
  const checkboxes = Array.from(document.querySelectorAll<HTMLInputElement>('.dash-checkbox'));
  const selection = getVisibleSelectionState(
    checkboxes.map((checkbox) => checkbox.dataset.id ?? ''),
    state.selectedIds,
  );
  selectAll.disabled = selection.visibleCount === 0;
  selectAll.checked = selection.allVisibleSelected;
  selectAll.indeterminate = selection.someVisibleSelected && !selection.allVisibleSelected;
}

function updateScanSummary(message: string): void {
  els.scanSummary.textContent = message;
}

// ── Queue tab ───────────────────────────────────────────────────────

function renderQueueView(items: QueueItemStatus[]): void {
  const container = els.queueItems;
  container.innerHTML = '';
  if (!items.length) {
    container.appendChild(createElement({ text: 'Kolejka jest pusta.', className: 'dash-empty' }));
    return;
  }

  for (const item of items) {
    container.appendChild(createQueueItemRow(item));
  }
}

// ── Stats tab ───────────────────────────────────────────────────────

async function refreshStats(): Promise<void> {
  const res = await sendMessage({ type: 'GET_STATS' });
  if (res.ok && res.stats) {
    els.statsToday.textContent = String(res.stats.todayRelisted);
    els.statsOk.textContent = String(res.stats.todaySuccess);
    els.statsErr.textContent = String(res.stats.todayError);
    els.statsTotal.textContent = String(res.stats.totalRelisted);
  }

  const logRes = await sendMessage({ type: 'GET_LOGS' });
  if (logRes.ok && logRes.logs) renderLogs(logRes.logs);
}

function renderLogs(logs: LogEntry[]): void {
  const container = els.logs;
  container.innerHTML = '';
  if (!logs.length) {
    container.appendChild(createElement({ text: 'Brak wpisów.', tag: 'em' }));
    return;
  }

  for (const entry of logs.slice(0, 40)) {
    container.appendChild(createDashboardLogRow(entry));
  }
}

// ── Modules tab ─────────────────────────────────────────────────────

function normalizeErrorMessage(value: string | undefined): string | undefined {
  const message = value?.replace(/\s+/g, ' ').trim();
  if (!message || NON_INFORMATIVE_ERROR_MESSAGES.has(message.toLowerCase())) return undefined;
  return message;
}

function getQueueItemError(status: QueueStatus): string | undefined {
  for (const item of status.items) {
    if (item.status === 'error') {
      const message = normalizeErrorMessage(item.lastError);
      if (message) return `Listing ${item.id}: ${message}`;
    }
  }
  return undefined;
}

function getRecentLogError(logs: LogEntry[] | undefined): string | undefined {
  const entry = logs?.find((log) => log.level === 'error' || log.level === 'warn');
  const message = normalizeErrorMessage(entry?.message);
  if (!entry || !message) return undefined;
  return `[${entry.level.toUpperCase()}] ${message}`;
}

function hasFailedState(status: QueueStatus): boolean {
  return status.state === 'error' || status.failed > 0 || status.items.some((item) => item.status === 'error');
}

async function getLogsSafely(): Promise<LogEntry[] | undefined> {
  try {
    const logRes = await sendMessage({ type: 'GET_LOGS' });
    return logRes.ok && logRes.logs ? logRes.logs : undefined;
  } catch {
    return undefined;
  }
}

function canOpenSellerPanel(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes('aktywna') || lower.includes('hidden');
}

function showDashboardError(message: string): void {
  els.errorMessage.textContent = message;
  els.errorBanner.style.display = 'block';
  const panelBtn = els.errorPanelBtn;
  panelBtn.style.display = canOpenSellerPanel(message) ? 'block' : 'none';
}

function hideDashboardError(): void {
  els.errorBanner.style.display = 'none';
  els.errorMessage.textContent = '';
  els.errorPanelBtn.style.display = 'none';
}

function moduleStatusLabel(status: ProductModuleStatus): string {
  if (status === 'active') return 'Active';
  if (status === 'partial') return 'Partial';
  if (status === 'blocked') return 'Blocked';
  return 'Planned';
}

function renderModules(): void {
  const container = els.modules;
  container.innerHTML = '';

  for (const moduleDef of PRODUCT_MODULES) {
    const missingItems = moduleDef.missing.slice(0, 3);
    const missingList = document.createElement('ul');
    for (const item of missingItems) {
      const li = document.createElement('li');
      li.textContent = item;
      missingList.appendChild(li);
    }

    const card = createElement({
      className: `dash-module-card dash-module-card--${moduleDef.status}`,
      children: [
        createElement({
          className: 'dash-module-card__header',
          children: [
            createElement({ tag: 'h3', text: moduleDef.name }),
            span(moduleStatusLabel(moduleDef.status), `dash-module-status dash-module-status--${moduleDef.status}`),
          ],
        }),
        createElement({ text: moduleDef.summary, className: 'dash-module-card__summary' }),
        createElement({
          className: 'dash-module-card__meta',
          children: [createElement({ tag: 'strong', text: 'Now: ' }), document.createTextNode(moduleDef.currentState)],
        }),
        createElement({
          className: 'dash-module-card__meta',
          children: [createElement({ tag: 'strong', text: 'Missing:' }), missingList],
        }),
        createElement({
          className: 'dash-module-card__next',
          children: [createElement({ tag: 'strong', text: 'Next: ' }), document.createTextNode(moduleDef.nextStep)],
        }),
      ],
    });
    container.appendChild(card);
  }
}

// ── Backups tab ─────────────────────────────────────────────────────

async function renderBackups(): Promise<void> {
  const container = els.backupItems;
  container.innerHTML = '';
  const res = await sendMessage({ type: 'GET_BACKUPS' });
  if (!res.ok || !res.backups?.length) {
    container.appendChild(createElement({ text: 'Brak zapisanych kopii.', className: 'dash-empty' }));
    return;
  }

  for (const b of res.backups) {
    container.appendChild(createBackupRow(b));
  }
}

// ── Tip toast ────────────────────────────────────────────────────────

function showTip(msg: string): void {
  const existing = document.querySelector('.dash-tip');
  if (existing) existing.remove();
  const tip = createElement({
    text: msg,
    className: 'dash-tip',
    attrs: {
      style: 'position:fixed;bottom:16px;left:16px;z-index:100;background:#fff;border:1px solid #bfdbfe;border-radius:10px;padding:10px 14px;color:#1d4ed8;max-width:300px;box-shadow:0 4px 12px rgba(0,0,0,0.1);font-size:12px;',
    },
  });
  document.body.appendChild(tip);
  setTimeout(() => tip.remove(), 5000);
}

// ── Status refresh ───────────────────────────────────────────────────

async function refreshStatus(): Promise<void> {
  const res = await sendMessage({ type: 'GET_STATUS' });
  if (!res.ok || !res.status) return;
  const s: QueueStatus = res.status;

  els.queueState.textContent = QUEUE_STATE_LABELS[s.state];
  const dot = document.querySelector<HTMLElement>('.dash-status-dot');
  if (dot) {
    dot.className = `dash-status-dot dash-color--${s.state === 'running' ? 'running' : s.state === 'paused' ? 'paused' : s.state === 'error' ? 'error' : 'idle'}`;
  }

  els.queueTotal.textContent = String(s.total);
  els.queueDone.textContent = String(s.completed);
  els.queueFailed.textContent = String(s.failed);
  els.queueCurrent.textContent = s.currentId || '-';
  els.pauseBtn.disabled = s.state !== 'running';
  els.resumeBtn.disabled = s.state === 'running' || s.state === 'idle' || s.total === 0;
  const pct = s.total > 0 ? ((s.completed + s.failed) / s.total * 100) : 0;
  els.progressFill.style.width = `${pct}%`;
  if (s.items?.length) renderQueueView(s.items);

  let errorMessage = normalizeErrorMessage(s.lastError) ?? getQueueItemError(s);
  if (!errorMessage && hasFailedState(s)) {
    const logs = await getLogsSafely();
    errorMessage = getRecentLogError(logs) ?? ERROR_DETAILS_FALLBACK;
  }

  if (errorMessage) {
    showDashboardError(errorMessage);
  } else {
    hideDashboardError();
  }

  if (state.lastQueueState === 'running' && s.state === 'idle' && s.total > 0 && 'Notification' in window) {
    try {
      // eslint-disable-next-line no-new
      new Notification('Vinted Relister', { body: `Done: ${s.completed} success, ${s.failed} error (${s.total} total)` });
    } catch {
      // Notification not available
    }
  }
  state.lastQueueState = s.state;
}

// ── Init ─────────────────────────────────────────────────────────────

function init(): void {
  // Tab navigation
  document.querySelectorAll<HTMLButtonElement>('.dash-nav__btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.dash-nav__btn').forEach((b) => b.classList.remove('dash-nav__btn--active'));
      btn.classList.add('dash-nav__btn--active');
      document.querySelectorAll('.dash-tab').forEach((t) => t.classList.remove('dash-tab--active'));
      const tabName = btn.dataset.tab;
      if (tabName) switchTab(tabName);
    });
  });

  // Scan
  els.scanBtn.addEventListener('click', handleScan);

  // Relist
  els.relistBtn.addEventListener('click', async () => {
    const listings = getSelected();
    if (!listings.length) return;
    const preflight = preflightRelistListings(listings);
    if (!preflight.accepted.length) {
      showDashboardError(`${formatRelistPreflightSummary(preflight)} ${preflight.issues[0]?.message ?? ''}`.trim());
      return;
    }

    const statusResponse = await sendMessage({ type: 'GET_STATUS' });
    if (!statusResponse.ok || !statusResponse.status) {
      showDashboardError(statusResponse.error ?? 'Nie udało się odczytać stanu kolejki.');
      return;
    }
    if (!canStartNewRelist(statusResponse.status)) {
      showDashboardError('Nie można rozpocząć nowego relistu: bieżąca kolejka nadal ma oczekujące zadania.');
      return;
    }

    const clearResponse = await sendMessage({ type: 'CLEAR_QUEUE' });
    if (!clearResponse.ok) {
      showDashboardError(clearResponse.error ?? 'Nie udało się wyczyścić poprzedniej kolejki.');
      return;
    }

    const addResponse = await sendMessage({ type: 'ADD_TO_QUEUE', payload: { listings: preflight.accepted } });
    if (!addResponse.ok) {
      showDashboardError(addResponse.error ?? 'Nie udało się dodać ofert do kolejki.');
      return;
    }

    const resumeResponse = await sendMessage({ type: 'RESUME_QUEUE' });
    if (!resumeResponse.ok) {
      showDashboardError(resumeResponse.error ?? 'Nie udało się uruchomić kolejki.');
      return;
    }

    showTip(`Dodano ${addResponse.added ?? preflight.accepted.length} ofert do kolejki. ${formatRelistPreflightSummary(preflight)}`);
    await refreshStatus();
    switchTab('queue');
  });

  // Clear queue
  els.clearBtn.addEventListener('click', async () => {
    await sendMessage({ type: 'CLEAR_QUEUE' });
    await refreshStatus();
  });

  // Search, status filter, and sort
  els.searchInput.addEventListener('input', () => renderScanGrid());
  els.statusFilter.addEventListener('change', () => renderScanGrid());
  els.sortSelect.addEventListener('change', () => renderScanGrid());

  // Select all
  els.selectAll.addEventListener('change', () => {
    const { checked } = els.selectAll;
    const checkboxes = Array.from(document.querySelectorAll<HTMLInputElement>('.dash-checkbox'));
    state.selectedIds = setListingsSelection(
      state.selectedIds,
      checkboxes.map((checkbox) => checkbox.dataset.id ?? ''),
      checked,
    );
    checkboxes.forEach((cb) => {
      cb.checked = checked;
      cb.closest('.dash-row')?.classList.toggle('dash-row--selected', checked);
    });
    updateSelectAllState();
    updateRelistBtn();
  });

  // Export backups
  els.exportBtn.addEventListener('click', async () => {
    const res = await sendMessage({ type: 'GET_BACKUPS' });
    if (res.ok && res.backups?.length) {
      const blob = new Blob([JSON.stringify(res.backups, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `vinted-backups-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    }
  });

  // Error banner
  els.errorCloseBtn.addEventListener('click', () => {
    els.errorBanner.style.display = 'none';
  });
  els.errorPanelBtn.addEventListener('click', () => {
    window.open('https://www.vinted.pl/member/107890191', '_blank');
    els.errorBanner.style.display = 'none';
  });

  // Pause/Resume
  els.pauseBtn.addEventListener('click', async () => {
    await sendMessage({ type: 'PAUSE_QUEUE' });
    await refreshStatus();
  });
  els.resumeBtn.addEventListener('click', async () => {
    await sendMessage({ type: 'RESUME_QUEUE' });
    await refreshStatus();
  });

  // Notification permission
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission().catch(() => {});
  }

  // Initial load
  void refreshStatus();
  void refreshStats();
  void renderBackups();
  renderModules();

  // Polling
  setInterval(() => { void refreshStatus(); }, 3000);
  setInterval(() => { void refreshStats(); }, 5000);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
