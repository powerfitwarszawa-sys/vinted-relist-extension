/**
 * Presentation-only row renderers for the popup.
 *
 * Popup state and actions remain in popup.ts. This module only creates DOM
 * nodes and forwards user interactions through supplied callbacks.
 */

import type { BackupEntry, Listing, LogEntry, QueueItemStatus } from '../core/contracts';
import {
  getListingSourceStatus,
  LISTING_STATUS_LABELS,
  SELLER_LISTING_STATUS_LABELS,
} from '../core/listing-status';

export interface PopupListingRowOptions {
  selected: boolean;
  onSelectionChange: (selected: boolean) => void;
}

function createThumbnail(
  title: string,
  thumbnailUrl: string | undefined,
  placeholderText: string,
): HTMLDivElement {
  const thumbCell = document.createElement('div');
  if (thumbnailUrl) {
    const image = document.createElement('img');
    image.className = 'listing-row__thumb';
    image.src = thumbnailUrl;
    image.alt = title;
    thumbCell.appendChild(image);
  } else {
    const placeholder = document.createElement('div');
    placeholder.className = 'listing-row__thumb-placeholder';
    placeholder.textContent = placeholderText;
    thumbCell.appendChild(placeholder);
  }
  return thumbCell;
}

function formatPrice(listing: Pick<Listing, 'price' | 'currency'>): string {
  if (!listing.currency) return String(listing.price);
  return listing.price.toLocaleString('pl-PL', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }) + ' ' + listing.currency;
}

export function createPopupListingRow(
  listing: Listing,
  options: PopupListingRowOptions,
): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'listing-row';
  row.dataset.id = listing.id;

  const checkboxCell = document.createElement('div');
  checkboxCell.className = 'listing-row__checkbox';
  const selectionCheckbox = document.createElement('input');
  selectionCheckbox.type = 'checkbox';
  selectionCheckbox.dataset.id = listing.id;
  selectionCheckbox.checked = options.selected;
  selectionCheckbox.addEventListener('change', (event) => {
    event.stopPropagation();
    options.onSelectionChange(selectionCheckbox.checked);
  });
  checkboxCell.appendChild(selectionCheckbox);

  const infoCell = document.createElement('div');
  infoCell.className = 'listing-row__info';
  const title = document.createElement('span');
  title.className = 'listing-row__title';
  title.textContent = listing.title;
  const metaLine = document.createElement('span');
  metaLine.className = 'listing-row__meta';
  const openLink = document.createElement('a');
  openLink.href = listing.url;
  openLink.target = '_blank';
  openLink.textContent = 'Otwórz';
  openLink.style.cssText = 'color:#2563eb;text-decoration:none;font-size:10px;margin-left:6px;cursor:pointer;';
  metaLine.textContent = 'ID: ' + listing.id + ' · ';
  metaLine.appendChild(openLink);
  infoCell.append(title, metaLine);

  const priceCell = document.createElement('div');
  priceCell.className = 'listing-row__price';
  priceCell.textContent = formatPrice(listing);

  const statusCell = document.createElement('div');
  statusCell.className = 'listing-row__status';
  const statusBadge = document.createElement('span');
  const sourceStatus = getListingSourceStatus(listing);
  statusBadge.className = 'status-badge status-badge--' + sourceStatus;
  statusBadge.textContent = SELLER_LISTING_STATUS_LABELS[sourceStatus];
  statusCell.appendChild(statusBadge);

  row.append(
    checkboxCell,
    createThumbnail(listing.title, listing.thumbnailUrl, 'NO IMG'),
    infoCell,
    priceCell,
    statusCell,
  );

  row.addEventListener('click', (event) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLAnchorElement) return;
    selectionCheckbox.checked = !selectionCheckbox.checked;
    options.onSelectionChange(selectionCheckbox.checked);
  });

  return row;
}

export function createPopupQueueRow(item: QueueItemStatus): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'listing-row listing-row--' + item.status;

  const statusCell = document.createElement('div');
  statusCell.className = 'listing-row__checkbox';

  const infoCell = document.createElement('div');
  infoCell.className = 'listing-row__info';
  const title = document.createElement('span');
  title.className = 'listing-row__title';
  title.textContent = item.title;
  const meta = document.createElement('span');
  meta.className = 'listing-row__meta';
  meta.textContent = 'ID: ' + item.id + (item.lastError ? ' · ' + item.lastError.slice(0, 50) : '');
  const dateLine = document.createElement('span');
  dateLine.className = 'listing-row__meta--date';
  if (item.status === 'success' && item.lastRelisted) {
    dateLine.textContent = 'Odnowiono: ' + new Date(item.lastRelisted).toLocaleString('pl-PL');
  }
  infoCell.append(title, meta, dateLine);

  const priceCell = document.createElement('div');
  priceCell.className = 'listing-row__price';
  priceCell.textContent = item.currency ? String(item.price) + ' ' + item.currency : String(item.price);

  const badgeCell = document.createElement('div');
  badgeCell.className = 'listing-row__status';
  const statusBadge = document.createElement('span');
  statusBadge.className = 'status-badge status-badge--' + item.status;
  statusBadge.textContent = LISTING_STATUS_LABELS[item.status] ?? item.status;
  badgeCell.appendChild(statusBadge);

  row.append(
    statusCell,
    createThumbnail(item.title, item.thumbnailUrl, '—'),
    infoCell,
    priceCell,
    badgeCell,
  );
  return row;
}

export function createPopupLogRow(entry: LogEntry): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'log-entry log-entry--' + entry.level;
  const time = document.createElement('span');
  time.className = 'log-entry__time';
  time.textContent = new Date(entry.timestamp).toLocaleTimeString();
  const level = document.createElement('span');
  level.className = 'log-entry__level log-entry__level--' + entry.level;
  level.textContent = entry.level;
  const message = document.createElement('span');
  message.className = 'log-entry__message';
  message.textContent = entry.message;
  row.append(time, level, message);
  return row;
}

export function createPopupBackupRow(
  backup: BackupEntry,
  onOpen: () => void,
): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'listing-row';

  const infoCell = document.createElement('div');
  infoCell.className = 'listing-row__info';
  const title = document.createElement('span');
  title.className = 'listing-row__title';
  title.textContent = backup.title;
  const meta = document.createElement('span');
  meta.className = 'listing-row__meta';
  const dateText =
    backup.backedUpAt > 0
      ? new Date(backup.backedUpAt).toLocaleString('pl-PL')
      : 'brak daty';
  meta.textContent = `ID: ${backup.id} · ${backup.price} ${backup.currency} · ${dateText}`;
  infoCell.append(title, meta);

  const statusCell = document.createElement('div');
  statusCell.className = 'listing-row__status';
  const sourceStatus = getListingSourceStatus(backup);
  const statusBadge = document.createElement('span');
  statusBadge.className = 'status-badge status-badge--' + sourceStatus;
  statusBadge.textContent = SELLER_LISTING_STATUS_LABELS[sourceStatus];
  statusCell.appendChild(statusBadge);

  const resultBadge = document.createElement('span');
  if (backup.relistResult) {
    resultBadge.className =
      'status-badge status-badge--' + (backup.relistResult === 'success' ? 'success' : 'error');
    resultBadge.textContent =
      backup.relistResult === 'success' ? 'Odnowiona' : 'Błąd';
    resultBadge.title = backup.relistNote ?? '';
  }
  statusCell.appendChild(resultBadge);

  const openButton = document.createElement('button');
  openButton.className = 'toolbar__btn';
  openButton.textContent = 'Otwórz';
  openButton.addEventListener('click', onOpen);

  row.append(
    createThumbnail(backup.title, backup.thumbnailUrl, '—'),
    infoCell,
    statusCell,
    openButton,
  );
  return row;
}

export function createPopupEmptyState(message: string, className?: string): HTMLElement {
  const empty = document.createElement('em');
  if (className) empty.className = className;
  empty.textContent = message;
  return empty;
}

export function createPopupBackupExportButton(
  label: string,
  onExport: () => void,
): HTMLButtonElement {
  const exportButton = document.createElement('button');
  exportButton.className = 'toolbar__btn';
  exportButton.textContent = label;
  exportButton.style.cssText = 'margin:4px 14px;flex:none;width:auto;';
  exportButton.addEventListener('click', onExport);
  return exportButton;
}
