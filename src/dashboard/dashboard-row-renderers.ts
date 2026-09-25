/**
 * DOM renderers for dashboard rows.
 *
 * They contain presentation only. Selection state and message handling remain
 * in dashboard.ts so the user-visible behaviour stays unchanged.
 */

import type { BackupEntry, Listing, LogEntry, QueueItemStatus } from '../core/contracts';
import {
  getListingSourceStatus,
  LISTING_STATUS_LABELS,
  SELLER_LISTING_STATUS_LABELS,
} from '../core/listing-status';
import {
  badge,
  checkbox,
  createElement,
  link,
  span,
} from '../shared/dom-utils';

export interface ScanListingRowOptions {
  selected: boolean;
  onSelectionChange: (selected: boolean) => void;
}

function renderThumbnail(listing: Pick<Listing, 'title' | 'thumbnailUrl'>): HTMLElement {
  if (!listing.thumbnailUrl) {
    return createElement({ className: 'dash-row__thumb dash-row__thumb--empty', text: 'No img' });
  }

  return createElement({
    className: 'dash-row__thumb',
    children: [
      createElement({
        tag: 'img',
        attrs: {
          src: listing.thumbnailUrl,
          alt: listing.title,
          loading: 'lazy',
        },
      }),
    ],
  });
}

function formatPrice(listing: Pick<Listing, 'price' | 'currency'>): string {
  const value = listing.price.toLocaleString('pl-PL', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
  return listing.currency ? value + ' ' + listing.currency : value;
}

export function createScanListingRow(
  listing: Listing,
  options: ScanListingRowOptions,
): HTMLElement {
  const selectionCheckbox = checkbox(listing.id, (selected) => {
    options.onSelectionChange(selected);
    selectionCheckbox.closest('.dash-row')?.classList.toggle('dash-row--selected', selected);
  });
  selectionCheckbox.checked = options.selected;
  selectionCheckbox.className = 'dash-checkbox';
  const sourceStatus = getListingSourceStatus(listing);

  return createElement({
    className: 'dash-row' + (options.selected ? ' dash-row--selected' : ''),
    children: [
      createElement({ tag: 'label', children: [selectionCheckbox] }),
      renderThumbnail(listing),
      createElement({
        className: 'dash-row__info',
        children: [
          span(listing.title, 'dash-row__title'),
          span('ID: ' + listing.id, 'dash-row__meta'),
        ],
      }),
      createElement({ text: formatPrice(listing), className: 'dash-row__price' }),
      createElement({
        className: 'dash-row__status',
        children: [badge(SELLER_LISTING_STATUS_LABELS[sourceStatus], sourceStatus)],
      }),
      link(listing.url, 'Otwórz', 'dash-row__link'),
    ],
  });
}

export function createQueueItemRow(item: QueueItemStatus): HTMLElement {
  const errorSuffix = item.lastError ? ' - ' + item.lastError.slice(0, 60) : '';
  const relistedSuffix = item.lastRelisted
    ? ' - ' + new Date(item.lastRelisted).toLocaleString('pl-PL')
    : '';

  return createElement({
    className: 'dash-row dash-row--' + item.status,
    children: [
      createElement({ tag: 'div' }),
      renderThumbnail(item),
      createElement({
        className: 'dash-row__info',
        children: [
          span(item.title, 'dash-row__title'),
          span('ID: ' + item.id + errorSuffix + relistedSuffix, 'dash-row__meta'),
        ],
      }),
      createElement({
        text: formatPrice(item),
        className: 'dash-row__price',
      }),
      createElement({
        className: 'dash-row__status',
        children: [badge(LISTING_STATUS_LABELS[item.status] ?? item.status, item.status)],
      }),
      link('https://www.vinted.pl/items/' + item.id, 'Otwórz', 'dash-row__link'),
    ],
  });
}

export function createBackupRow(backup: BackupEntry): HTMLElement {
  const dateText =
    backup.backedUpAt > 0
      ? new Date(backup.backedUpAt).toLocaleString('pl-PL')
      : 'brak daty';
  const resultSuffix = backup.relistResult
    ? ' - ' + (backup.relistResult === 'success' ? 'odnowiona' : 'błąd')
    : '';

  return createElement({
    className: 'dash-row',
    children: [
      createElement({ tag: 'div' }),
      renderThumbnail(backup),
      createElement({
        className: 'dash-row__info',
        children: [
          span(backup.title, 'dash-row__title'),
          span(`ID: ${backup.id} - ${formatPrice(backup)} - ${dateText}${resultSuffix}`, 'dash-row__meta'),
        ],
      }),
      createElement({
        text: formatPrice(backup),
        className: 'dash-row__price',
      }),
      createElement({
        className: 'dash-row__status',
        children: [
          badge(
            backup.relistResult === 'success' ? 'Odnowiona' : backup.relistResult === 'failed' ? 'Błąd' : 'Backup',
            backup.relistResult === 'success' ? 'success' : 'backup',
          ),
        ],
      }),
      link(backup.url, 'Otwórz', 'dash-row__link'),
    ],
  });
}

export function createDashboardLogRow(entry: LogEntry): HTMLElement {
  return createElement({
    className: 'dash-log-entry',
    children: [
      span(new Date(entry.timestamp).toLocaleTimeString(), 'dash-log-entry__time'),
      span(entry.level, 'dash-log-entry__level dash-log-entry__level--' + entry.level),
      span(entry.message),
    ],
  });
}
