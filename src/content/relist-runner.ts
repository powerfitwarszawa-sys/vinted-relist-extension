/**
 * Uczciwy flow odnowienia oferty przez normalne UI Vinted.
 *
 * Nie obchodzimy zabezpieczeń, nie ukrywamy duplikatów, nie oszukujemy algorytmu.
 * Flow:
 * 1. Poczekaj na załadowanie strony detail.
 * 2. Znajdź przycisk "Wystaw ponownie" / "Relist" / "Odśwież".
 * 3. Jeśli istnieje — kliknij go (normalna akcja Vinted).
 * 4. Jeśli nie istnieje — sprawdź czy jest "Edytuj ogłoszenie" (aukcja aktywna,
 *    relist przez edycję nie jest obsługiwany — zwróć informację).
 * 5. Potwierdź sukces/błąd z jasnym logowaniem.
 */

import type { Listing, RelistResult } from '../core/contracts';
import {
  ErrorCode,
  failureResult,
  isApiAccessOrRateLimitMessage,
  successResult,
} from '../core/errors';
import { log } from '../core/logger';
import { SELECTORS, dataTestIdSelector } from './selectors';
import { clickElement, sleep, waitForElement } from './dom-helpers';
import { createAndPublishDraftFromItemId, diagnoseVintedApi } from './vinted-api';

const RELIST_TEXT_KEYWORDS = [
  'wystaw ponownie', 'relist', 'relist-button', 'odśwież', 'renew',
  'odnow', 'wystaw',
];

const RELIST_CONFIRMATION_TIMEOUT_MS = 10000;
const RELIST_CONFIRMATION_POLL_MS = 500;

function extractListingIdFromPath(pathname: string): string | undefined {
  return pathname.match(/^\/items\/(\d+)/)?.[1];
}

function getCurrentListingId(): string | undefined {
  return extractListingIdFromPath(window.location.pathname);
}

async function waitForNewListingId(originalId: string): Promise<string | undefined> {
  const deadline = Date.now() + RELIST_CONFIRMATION_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const currentId = getCurrentListingId();
    if (currentId && currentId !== originalId) {
      return currentId;
    }
    await sleep(RELIST_CONFIRMATION_POLL_MS);
  }

  return undefined;
}

function findByText(keywords: string[]): HTMLElement | null {
  const candidates = Array.from(document.querySelectorAll<HTMLElement>(SELECTORS.RELIST_TEXT_TARGETS));
  for (const candidate of candidates) {
    const text = candidate.textContent?.toLowerCase() ?? '';
    const ariaLabel = candidate.getAttribute('aria-label')?.toLowerCase() ?? '';
    const combined = `${text} ${ariaLabel}`;
    if (keywords.some((kw) => combined.includes(kw.toLowerCase()))) {
      return candidate;
    }
  }
  return null;
}

function findByTestId(testIds: readonly string[]): HTMLElement | null {
  for (const id of testIds) {
    const el = document.querySelector<HTMLElement>(dataTestIdSelector(id));
    if (el) return el;
  }
  return null;
}

function findRelistButton(): HTMLElement | null {
  const bySelector = document.querySelector<HTMLElement>(SELECTORS.RELIST_BUTTON);
  if (bySelector) return bySelector;

  const byTestId = findByTestId(SELECTORS.RELIST_BUTTON_TEST_IDS);
  if (byTestId) return byTestId;

  return findByText(RELIST_TEXT_KEYWORDS);
}

function dumpAvailableActions(): string {
  const buttons = Array.from(document.querySelectorAll<HTMLElement>(SELECTORS.RELIST_TEXT_TARGETS));
  return buttons
    .map((btn) => {
      const text = (btn.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 50);
      const testId = btn.getAttribute('data-testid') ?? '';
      return testId ? `[${testId}]: "${text}"` : `"${text}"`;
    })
    .filter((s) => s.length > 5)
    .slice(0, 20)
    .join(' | ');
}

async function tryPublishApiDraftFallback(listing: Listing): Promise<RelistResult> {
  await log(
    `[relist-api] DOM relist button missing; trying API draft publish fallback for ${listing.id}`,
    'warn',
  );

  const diagnostic = await diagnoseVintedApi();
  if (!diagnostic.ok) {
    const msg = `DOM relist button missing and Vinted API session check failed: ${diagnostic.message}`;
    await log(`[relist-api] FAIL: ${msg}`, 'warn');
    return failureResult(
      isApiAccessOrRateLimitMessage(msg) ? ErrorCode.API_ACCESS_OR_RATE_LIMIT : ErrorCode.RELIST_ACTION_ERROR,
      msg,
    );
  }

  await log(`[relist-api] ${diagnostic.message}`, 'info');

  try {
    const result = await createAndPublishDraftFromItemId(listing.id);
    if (result.ok) {
      const msg =
        `API fallback published new listing ${result.itemId} from original ${listing.id} ` +
        `via draft ${result.draftId} using ${result.uploadedPhotoCount}/${result.sourcePhotoCount} reuploaded photo id(s). ` +
        `Original listing was not deleted.`;
      await log(`[relist-api] SUKCES: ${msg}`, 'info');
      return successResult(`Oferta ${listing.id} odnowiona jako ${result.itemId}`, result.itemId);
    }

    const msg =
      `API fallback created draft ${result.draftId} for ${listing.id}, but publish completion failed: ` +
      `${result.message}. Reuploaded photos: ${result.uploadedPhotoCount}/${result.sourcePhotoCount}. ` +
      `Draft remains available for manual review. Original listing was not deleted.`;
    await log(`[relist-api] MANUAL REVIEW: ${msg}`, 'warn');
    return failureResult(
      isApiAccessOrRateLimitMessage(msg) ? ErrorCode.API_ACCESS_OR_RATE_LIMIT : ErrorCode.API_DRAFT_ONLY,
      msg,
    );
  } catch (err) {
    const msg =
      `DOM relist button missing and API draft publish fallback failed for ${listing.id}: ` +
      `${String(err).slice(0, 260)}`;
    await log(`[relist-api] FAIL: ${msg}`, 'error');
    return failureResult(
      isApiAccessOrRateLimitMessage(msg) ? ErrorCode.API_ACCESS_OR_RATE_LIMIT : ErrorCode.RELIST_ACTION_ERROR,
      msg,
    );
  }
}

export async function executeRelist(listing: Listing): Promise<RelistResult> {
  await log(`[relist] START — listing ${listing.id}: "${listing.title}"`, 'info');
  await log(`[relist] URL: ${window.location.href}`, 'info');
  await log(`[relist] readyState: ${document.readyState}`, 'info');

  // ── Czekaj na załadowanie strony ─────────────────────────────────
  if (document.readyState !== 'complete') {
    await log('[relist] Czekam na complete...', 'debug');
    await new Promise<void>((resolve) => {
      const handler = () => { window.removeEventListener('load', handler); resolve(); };
      window.addEventListener('load', handler);
    });
  }

  // Sprawdź marker strony detail
  const detailMarker = document.querySelector(SELECTORS.LISTING_DETAIL_PAGE_MARKER);
  if (!detailMarker) {
    const msg = `Nie wykryto strony detail (brak markera)`;
    await log(`[relist] FAIL: ${msg}`, 'warn');
    return failureResult(ErrorCode.DETAIL_MARKER_MISSING, msg);
  }
  await log('[relist] Strona detail potwierdzona', 'info');

  // ── Krok 1: Szukaj przycisku relist ───────────────────────────────
  await log('[relist] Szukam przycisku "Wystaw ponownie"...', 'info');
  const relistButton = findRelistButton();

  if (relistButton) {
    const buttonText = (relistButton.textContent ?? '').replace(/\s+/g, ' ').trim();
    await log(`[relist] Przycisk znaleziony: "${buttonText}"`, 'info');

    try {
      clickElement(relistButton);
      await log(`[relist] Kliknięto przycisk relist`, 'info');

      // ── Krok 2: Potwierdzenie (jeśli jest) ────────────────────────
      if (SELECTORS.RELIST_CONFIRM_BUTTON) {
        try {
          const confirmBtn = await waitForElement(SELECTORS.RELIST_CONFIRM_BUTTON, 4000);
          clickElement(confirmBtn);
          await log('[relist] Potwierdzenie kliknięte', 'info');
        } catch {
          await log('[relist] Brak okna potwierdzenia (może nie być potrzebne)', 'debug');
        }
      }

      // ── Krok 3: Weryfikacja sukcesu ───────────────────────────────
      const newListingId = await waitForNewListingId(listing.id);
      if (newListingId) {
        await log(`[relist] SUKCES — confirmed new listing ID ${newListingId} for original ${listing.id}`, 'info');
        return successResult(`Oferta ${listing.id} odnowiona jako ${newListingId}`, newListingId);
      }

      const weakSignals: string[] = [];
      const relistStillExists = document.contains(relistButton);
      if (!relistStillExists) {
        weakSignals.push('button disappeared');
        await log('[relist] Weak signal only — relist button disappeared, but new listing ID was not confirmed', 'warn');
      }

      const newButtonText = (relistButton.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (newButtonText !== buttonText) {
        weakSignals.push(`button text changed from "${buttonText}" to "${newButtonText}"`);
        await log(
          `[relist] Weak signal only — button text changed: "${buttonText}" → "${newButtonText}", but new listing ID was not confirmed`,
          'warn',
        );
      }

      const toast = document.querySelector(SELECTORS.RELIST_SUCCESS_FEEDBACK);
      if (toast) {
        const toastText = (toast.textContent ?? '').replace(/\s+/g, ' ').trim();
        weakSignals.push(`toast: "${toastText}"`);
        await log(`[relist] Weak signal only — toast: "${toastText}", but new listing ID was not confirmed`, 'warn');
      }

      const currentId = getCurrentListingId();
      const weakSignalText = weakSignals.length > 0 ? ` Weak signals: ${weakSignals.join('; ')}.` : '';
      const msg =
        `Kliknięcie wykonane, ale nie potwierdzono nowego ID aukcji. ` +
        `Oryginalne ID: ${listing.id}, aktualne ID: ${currentId ?? 'unknown'}.${weakSignalText}`;
      await log(`[relist] FAIL: ${msg}`, 'warn');
      return failureResult(ErrorCode.RELIST_NOT_CONFIRMED, msg);
    } catch (err) {
      const msg = `Błąd podczas kliknięcia relist: ${String(err)}`;
      await log(`[relist] FAIL: ${msg}`, 'error');
      return failureResult(ErrorCode.RELIST_ACTION_ERROR, msg);
    }
  }

  // ── Brak przycisku relist — sprawdź czy aukcja jest aktywna ────────
  await log('[relist] Nie znaleziono przycisku "Wystaw ponownie"', 'warn');
  await log(`[relist] Dostępne akcje: ${dumpAvailableActions()}`, 'info');

  const apiFallbackResult = await tryPublishApiDraftFallback(listing);
  if (apiFallbackResult.success || apiFallbackResult.code === ErrorCode.API_DRAFT_ONLY) {
    return apiFallbackResult;
  }

  const editButton = findByTestId(SELECTORS.ITEM_EDIT_BUTTON_TEST_IDS);
  if (editButton) {
    const msg = `Aukcja ${listing.id} jest aktywna — brak przycisku "Wystaw ponownie". API draft publish fallback też nie zadziałał: ${apiFallbackResult.message}`;
    await log(`[relist] INFO: ${msg}`, 'info');
    return failureResult(ErrorCode.RELIST_BUTTON_MISSING, msg);
  }

  const msg = `Nie znaleziono żadnych akcji relist ani edycji na stronie oferty ${listing.id}. API draft publish fallback też nie zadziałał: ${apiFallbackResult.message}`;
  await log(`[relist] FAIL: ${msg}`, 'warn');
  return failureResult(ErrorCode.RELIST_BUTTON_MISSING, msg);
}
