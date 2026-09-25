import { getSettings, setSettings } from '../core/storage';
import { error } from '../core/logger';
import { sendMessage } from '../shared/messaging';
import type { ScanResponse } from '../core/contracts';
import { getRequiredElement } from '../shared/dom-utils';

const enabledEl = getRequiredElement('enabled', 'input');
const draftModeEl = getRequiredElement('draftMode', 'input');
const delayBaseMsEl = getRequiredElement('delayBaseMs', 'input');
const jitterMaxMsEl = getRequiredElement('jitterMaxMs', 'input');
const maxConcurrentEl = getRequiredElement('maxConcurrent', 'input');
const autoRelistEnabledEl = getRequiredElement('autoRelistEnabled', 'input');
const autoRelistIntervalMinutesEl = getRequiredElement('autoRelistIntervalMinutes', 'input');
const autoRelistMaxPerCycleEl = getRequiredElement('autoRelistMaxPerCycle', 'input');
const autoRelistMinHoursSinceRelistEl = getRequiredElement('autoRelistMinHoursSinceRelist', 'input');
const applyApiDelayBtn = getRequiredElement('applyApiDelayBtn', 'button');
const formEl = getRequiredElement('optionsForm', 'form');
const statusEl = getRequiredElement('status', 'div');
const scanInfoEl = getRequiredElement('scanInfo', 'p');

const API_RECOMMENDED_DELAY_MS = 180_000;
const API_RECOMMENDED_JITTER_MS = 60_000;

async function loadSettings(): Promise<void> {
  const settings = await getSettings();
  enabledEl.checked = settings.enabled;
  draftModeEl.checked = settings.draftMode;
  delayBaseMsEl.value = String(settings.delayBaseMs);
  jitterMaxMsEl.value = String(settings.jitterMaxMs);
  maxConcurrentEl.value = String(settings.maxConcurrent);
  autoRelistEnabledEl.checked = settings.autoRelistEnabled;
  autoRelistIntervalMinutesEl.value = String(settings.autoRelistIntervalMinutes);
  autoRelistMaxPerCycleEl.value = String(settings.autoRelistMaxPerCycle);
  autoRelistMinHoursSinceRelistEl.value = String(settings.autoRelistMinHoursSinceRelist);
}

function formatScanInfo(scan: ScanResponse['scan']): void {
  if (!scan || scan.listings.length === 0) {
    scanInfoEl.textContent =
      'Brak zapisanego skanu — otwórz popup rozszerzenia i kliknij „Skanuj garderobę”, aby przygotować dane do auto-relistu.';
    scanInfoEl.className = 'scan-info scan-info--warn';
    return;
  }

  const scanned = new Date(scan.scannedAt);
  const ageHours = (Date.now() - scan.scannedAt) / (60 * 60 * 1000);
  const ageText =
    ageHours < 1
      ? 'przed chwilą'
      : ageHours < 24
        ? `${Math.round(ageHours)} h temu`
        : `${(ageHours / 24).toFixed(1)} dni temu`;

  const activeCount = scan.listings.filter(
    (listing) => listing.sourceStatus === undefined || listing.sourceStatus === 'active',
  ).length;

  const stale = ageHours > 7 * 24;
  scanInfoEl.textContent =
    `Ostatni skan: ${scanned.toLocaleString('pl-PL')} (${ageText}) · ` +
    `${scan.listings.length} pozycji, ${activeCount} aktywnych. ` +
    (stale ? 'Skan ma ponad 7 dni — auto-relist wstrzyma cykle do czasu ponownego skanu.' : '');
  scanInfoEl.className = stale ? 'scan-info scan-info--warn' : 'scan-info scan-info--ok';
}

function loadScanInfo(): void {
  sendMessage({ type: 'GET_SCAN' })
    .then((response) => {
      if (response.ok) {
        formatScanInfo(response.scan);
      } else {
        scanInfoEl.textContent = 'Nie udało się odczytać zapisanego skanu.';
        scanInfoEl.className = 'scan-info scan-info--warn';
      }
    })
    .catch((err) => {
      scanInfoEl.textContent = `Nie udało się odczytać zapisanego skanu: ${String(err).slice(0, 120)}`;
      scanInfoEl.className = 'scan-info scan-info--warn';
    });
}

function clampOrDefault(value: string, min: number, max: number, fallback: number): number {
  const parsed = Number(value);
  if (Number.isNaN(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function showStatus(text: string, isError = false): void {
  statusEl.textContent = text;
  statusEl.className = isError ? 'status status--error' : 'status status--success';
}

formEl.addEventListener('submit', async (event) => {
  event.preventDefault();

  const delayBaseMs = Number(delayBaseMsEl.value);
  const jitterMaxMs = Number(jitterMaxMsEl.value);
  const maxConcurrent = Number(maxConcurrentEl.value);

  if (Number.isNaN(delayBaseMs) || Number.isNaN(jitterMaxMs) || Number.isNaN(maxConcurrent)) {
    showStatus('Wartości opóźnienia muszą być liczbami.', true);
    return;
  }

  if (delayBaseMs < 500) {
    showStatus('Podstawowy odstęp musi wynosić co najmniej 500 ms.', true);
    return;
  }

  try {
    await setSettings({
      enabled: enabledEl.checked,
      draftMode: draftModeEl.checked,
      delayBaseMs,
      jitterMaxMs,
      maxConcurrent: Math.max(1, Math.min(5, maxConcurrent)),
      autoRelistEnabled: autoRelistEnabledEl.checked,
      autoRelistIntervalMinutes: Math.floor(
        clampOrDefault(autoRelistIntervalMinutesEl.value, 1, 10_080, 60),
      ),
      autoRelistMaxPerCycle: Math.floor(
        clampOrDefault(autoRelistMaxPerCycleEl.value, 1, 200, 5),
      ),
      autoRelistMinHoursSinceRelist: Math.floor(
        clampOrDefault(autoRelistMinHoursSinceRelistEl.value, 0, 720, 24),
      ),
    });
    const apiGuidance = delayBaseMs < API_RECOMMENDED_DELAY_MS
      ? ' Uwaga: dla awaryjnej ścieżki API zalecane są co najmniej 3 minuty.'
      : '';
    const autoGuidance = autoRelistEnabledEl.checked
      ? ' Automatyczne podbijanie włączone — pierwszy cykl wykona się wg ustawionego interwału.'
      : '';
    showStatus(`Ustawienia zapisane.${apiGuidance}${autoGuidance}`);
  } catch (err) {
    showStatus(`Nie udało się zapisać ustawień: ${String(err)}`, true);
    error('Options save failed:', String(err));
  }
});

applyApiDelayBtn.addEventListener('click', () => {
  delayBaseMsEl.value = String(API_RECOMMENDED_DELAY_MS);
  jitterMaxMsEl.value = String(API_RECOMMENDED_JITTER_MS);
  showStatus('Wstawiono zalecenie API: 3 minuty + losowo do 1 minuty. Kliknij „Zapisz ustawienia”.');
});

loadSettings().then(loadScanInfo).catch((err) => {
  showStatus(`Nie udało się wczytać ustawień: ${String(err)}`, true);
  error('Options load failed:', String(err));
});