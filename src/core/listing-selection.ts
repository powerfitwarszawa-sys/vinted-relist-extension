/**
 * Pure selection helpers shared by the popup and dashboard listing views.
 *
 * The selected IDs persist outside a filtered view. Bulk actions affect only
 * IDs currently visible in that view and never clear hidden selections.
 */

export interface SelectableListing {
  id: string;
}

export interface VisibleSelectionState {
  visibleCount: number;
  selectedVisibleCount: number;
  allVisibleSelected: boolean;
  someVisibleSelected: boolean;
}

export function getSelectedListings<T extends SelectableListing>(
  listings: readonly T[],
  selectedIds: ReadonlySet<string>,
): T[] {
  return listings.filter((listing) => selectedIds.has(listing.id));
}

export function setListingSelection(
  selectedIds: ReadonlySet<string>,
  listingId: string,
  selected: boolean,
): Set<string> {
  return setListingsSelection(selectedIds, [listingId], selected);
}

/**
 * Returns a new selection set. IDs outside the supplied IDs are preserved,
 * so selecting all filtered rows cannot discard hidden choices.
 */
export function setListingsSelection(
  selectedIds: ReadonlySet<string>,
  listingIds: Iterable<string>,
  selected: boolean,
): Set<string> {
  const next = new Set(selectedIds);

  for (const listingId of listingIds) {
    if (!listingId) continue;
    if (selected) {
      next.add(listingId);
    } else {
      next.delete(listingId);
    }
  }

  return next;
}

export function getVisibleSelectionState(
  visibleIds: Iterable<string>,
  selectedIds: ReadonlySet<string>,
): VisibleSelectionState {
  const visibleIdSet = new Set<string>();
  let selectedVisibleCount = 0;

  for (const listingId of visibleIds) {
    if (!listingId || visibleIdSet.has(listingId)) continue;
    visibleIdSet.add(listingId);
    if (selectedIds.has(listingId)) selectedVisibleCount += 1;
  }

  const visibleCount = visibleIdSet.size;
  return {
    visibleCount,
    selectedVisibleCount,
    allVisibleSelected: visibleCount > 0 && selectedVisibleCount === visibleCount,
    someVisibleSelected: selectedVisibleCount > 0,
  };
}
