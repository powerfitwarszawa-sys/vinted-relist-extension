import { log } from '../core/logger';
import { formatSellerStatusSummary, summarizeListingSourceStatuses } from '../core/listing-status';
import { hasCompletePhotoUpload, shouldReadNextPage } from '../core/relist-safety';
import type { FetchPhotoResponse, Listing, SellerListingStatus } from '../core/contracts';

type JsonRecord = Record<string, unknown>;

interface VintedPhoto {
  id?: number | string;
  orientation?: number;
  url?: string;
  full_size_url?: string;
  image_url?: string;
  original_url?: string;
  high_resolution?: { url?: string };
  thumbnails?: Array<{ url?: string }>;
}

interface VintedPrice {
  amount?: number | string;
  currency_code?: string;
}

interface VintedWardrobeItem extends JsonRecord {
  id?: number | string;
  title?: string;
  description?: string;
  price?: VintedPrice | number | string;
  currency?: string;
  currency_code?: string;
  photo?: VintedPhoto;
  photos?: VintedPhoto[];
  is_visible?: boolean | number | string;
  is_sold?: boolean | number | string;
  is_reserved?: boolean | number | string;
  is_draft?: boolean | number | string;
  status?: string;
  status_name?: string;
  state?: string;
}

interface VintedWardrobeResponse extends JsonRecord {
  items?: VintedWardrobeItem[];
  results?: VintedWardrobeItem[];
  drafts?: VintedWardrobeItem[];
  data?: {
    items?: VintedWardrobeItem[];
    results?: VintedWardrobeItem[];
    drafts?: VintedWardrobeItem[];
  };
  pagination?: {
    page?: number | string;
    per_page?: number | string;
    total_pages?: number | string;
    total_entries?: number | string;
  };
  meta?: {
    pagination?: {
      page?: number | string;
      per_page?: number | string;
      total_pages?: number | string;
      total_entries?: number | string;
    };
  };
}

interface VintedItemDetails extends JsonRecord {
  id?: number | string;
  title?: string;
  description?: string;
  price?: VintedPrice | number | string;
  currency?: string;
  photos?: VintedPhoto[];
  assigned_photos?: VintedPhoto[];
  is_draft?: boolean;
  brand_id?: number | string | null;
  brand?: string | { id?: number | string; title?: string } | null;
  brand_dto?: { id?: number | string; title?: string } | null;
  catalog_id?: number | string | null;
  color1_id?: number | string | null;
  color2_id?: number | string | null;
  color_ids?: Array<number | string>;
  size_id?: number | string | null;
  status_id?: number | string | null;
  condition_id?: number | string | null;
  package_size_id?: number | string | null;
  item_attributes?: JsonRecord[];
  is_unisex?: boolean | number;
  isbn?: string | null;
  manufacturer_labelling?: string | null;
  manufacturer?: string | null;
  measurement_length?: number | string | null;
  measurement_width?: number | string | null;
  shipment_prices?: JsonRecord;
  video_game_rating_id?: number | string | null;
}

interface ApiResponseEnvelope extends JsonRecord {
  item?: VintedItemDetails;
  draft?: VintedItemDetails;
  id?: number | string;
  upload_session_id?: string;
  user?: { id?: number | string };
}

interface DraftCreateResult {
  draftId: string;
  sourcePhotoCount: number;
  uploadedPhotoCount: number;
  uploadSessionId?: string;
  assignedPhotos: Array<{ id: number; orientation: number }>;
  completionDraft: JsonRecord;
}

type DraftPublishResult =
  | {
      ok: true;
      draftId: string;
      itemId: string;
      sourcePhotoCount: number;
      uploadedPhotoCount: number;
    }
  | {
      ok: false;
      draftId: string;
      sourcePhotoCount: number;
      uploadedPhotoCount: number;
      message: string;
    };

let csrfCache: { token: string | null; fetchedAt: number } = {
  token: null,
  fetchedAt: 0,
};

function asNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  if (value === true || value === 1 || value === '1') return true;
  if (value === false || value === 0 || value === '0') return false;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return undefined;
}

function getCookie(name: string): string | null {
  const prefix = `${name}=`;
  const match = document.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));
  return match ? decodeURIComponent(match.slice(prefix.length)) : null;
}

function getCsrfFromDom(): string | null {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]');
  if (meta?.content) return meta.content;

  const html = document.documentElement.innerHTML;
  const match =
    html.match(/CSRF_TOKEN["\\]+:["\\]+([0-9a-f-]{36})/i) ??
    html.match(/"csrfToken"\s*:\s*"([^"]+)"/i) ??
    html.match(/csrf-token["']?\s*content=["']([^"']+)/i);
  return match?.[1] ?? null;
}

async function getCsrfToken(): Promise<string | null> {
  if (Date.now() - csrfCache.fetchedAt < 30_000) {
    return csrfCache.token;
  }

  let token = getCsrfFromDom();
  if (!token) {
    try {
      const response = await fetch(`${location.origin}/`, { credentials: 'include' });
      const html = await response.text();
      token =
        html.match(/CSRF_TOKEN["\\]+:["\\]+([0-9a-f-]{36})/i)?.[1] ??
        html.match(/<meta name="csrf-token" content="([^"]+)"/i)?.[1] ??
        null;
    } catch (err) {
      await log(`[vinted-api] CSRF fallback fetch failed: ${String(err).slice(0, 120)}`, 'warn');
    }
  }

  csrfCache = { token, fetchedAt: Date.now() };
  return token;
}

function makeTempUuid(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16);
    const value = char === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const csrf = await getCsrfToken();
  const anonId = getCookie('anon_id');
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json, text/plain, */*');
  headers.set('X-Requested-With', 'XMLHttpRequest');
  headers.set('Locale', 'pl-PL');
  headers.set('Accept-Language', 'pl');
  if (!headers.has('Content-Type') && typeof init.body === 'string') {
    headers.set('Content-Type', 'application/json');
  }
  if (path.startsWith('/api/v2/item_upload/')) {
    headers.set('X-Enable-Multiple-Size-Groups', 'true');
  }
  if (csrf) headers.set('X-Csrf-Token', csrf);
  if (anonId) headers.set('X-Anon-Id', anonId);

  const response = await fetch(`${location.origin}${path}`, {
    credentials: 'include',
    ...init,
    headers,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`API ${response.status} ${path}: ${text.slice(0, 240)}`);
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    return (await response.json()) as T;
  }
  return (await response.text()) as T;
}

function normalizeItem(response: ApiResponseEnvelope): VintedItemDetails {
  return response.item ?? response.draft ?? (response as VintedItemDetails);
}

function getBrandId(item: VintedItemDetails): number | null {
  return (
    asNumber(item.brand_id) ??
    asNumber(typeof item.brand === 'object' ? item.brand?.id : null) ??
    asNumber(item.brand_dto?.id)
  );
}

function getBrandTitle(item: VintedItemDetails): string | null {
  return (
    asString(typeof item.brand === 'object' ? item.brand?.title : item.brand) ??
    asString(item.brand_dto?.title) ??
    null
  );
}

function getPriceAmount(item: Pick<VintedItemDetails, 'price'>): number {
  if (typeof item.price === 'object' && item.price !== null) {
    return asNumber(item.price.amount) ?? 0;
  }
  return asNumber(item.price) ?? 0;
}

function getCurrency(item: Pick<VintedItemDetails, 'price' | 'currency'>): string {
  if (typeof item.price === 'object' && item.price !== null) {
    return asString(item.price.currency_code) ?? 'PLN';
  }
  return asString(item.currency) ?? 'PLN';
}

function getWardrobeCurrency(item: VintedWardrobeItem): string {
  if (typeof item.price === 'object' && item.price !== null) {
    return asString(item.price.currency_code) ?? asString(item.currency_code) ?? asString(item.currency) ?? 'PLN';
  }
  return asString(item.currency_code) ?? asString(item.currency) ?? 'PLN';
}

function getWardrobeThumbnail(item: VintedWardrobeItem): string | undefined {
  const photos = [item.photo, ...(Array.isArray(item.photos) ? item.photos : [])];
  for (const photo of photos) {
    if (!photo) continue;
    const url = getPhotoUrl(photo);
    if (url) return url;
  }
  return undefined;
}

function getSellerListingStatus(
  item: VintedWardrobeItem,
  statusHint?: Exclude<SellerListingStatus, 'active' | 'unknown'>,
): SellerListingStatus {
  const state = [item.status, item.status_name, item.state]
    .map((value) => asString(value)?.toLowerCase())
    .filter((value): value is string => Boolean(value))
    .join(' ');

  if (asBoolean(item.is_sold) === true || state.includes('sold') || state.includes('sprzed')) return 'sold';
  if (asBoolean(item.is_draft) === true || state.includes('draft') || state.includes('robocz')) return 'draft';
  if (asBoolean(item.is_reserved) === true || state.includes('reserv') || state.includes('zarezer')) return 'reserved';
  // A visible item proves that Vinted ignored a requested non-public status.
  // This prevents a query hint from incorrectly relabelling the normal public page.
  if (state.includes('active') || state.includes('available') || asBoolean(item.is_visible) === true) return 'active';
  if (statusHint) return statusHint;
  if (
    asBoolean(item.is_visible) === false ||
    state.includes('hidden') ||
    state.includes('ukryt') ||
    state.includes('inactive')
  ) {
    return 'hidden';
  }
  return 'unknown';
}

function mapWardrobeItem(
  item: VintedWardrobeItem,
  statusHint?: Exclude<SellerListingStatus, 'active' | 'unknown'>,
): Listing | null {
  if (item.id === undefined || item.id === null) return null;
  const id = String(item.id);

  return {
    id,
    title: asString(item.title) ?? `Oferta ${id}`,
    price: getPriceAmount(item),
    currency: getWardrobeCurrency(item),
    url: `${location.origin}/items/${encodeURIComponent(id)}`,
    thumbnailUrl: getWardrobeThumbnail(item),
    description: asString(item.description),
    sourceStatus: getSellerListingStatus(item, statusHint),
    // Queue status always starts neutral; it must not reuse the Vinted source status.
    status: 'active',
  };
}

function getColorIds(item: VintedItemDetails): number[] {
  const ids = Array.isArray(item.color_ids) ? item.color_ids : [item.color1_id, item.color2_id];
  return ids.map(asNumber).filter((id): id is number => id !== null);
}

function getStatusId(item: VintedItemDetails): number {
  return asNumber(item.status_id) ?? asNumber(item.condition_id) ?? 2;
}

function getAssignedPhotos(item: VintedItemDetails): Array<{ id: number; orientation: number }> {
  const photos = Array.isArray(item.assigned_photos) ? item.assigned_photos : item.photos;
  return (Array.isArray(photos) ? photos : [])
    .map((photo) => {
      const id = asNumber(photo.id);
      if (id === null) return null;
      return { id, orientation: asNumber(photo.orientation) ?? 0 };
    })
    .filter((photo): photo is { id: number; orientation: number } => photo !== null);
}

function getPhotoUrl(photo: VintedPhoto): string | undefined {
  const thumbnailUrls = Array.isArray(photo.thumbnails)
    ? photo.thumbnails.map((thumbnail) => asString(thumbnail.url)).filter((url): url is string => Boolean(url))
    : [];

  return (
    asString(photo.full_size_url) ??
    asString(photo.original_url) ??
    asString(photo.high_resolution?.url) ??
    asString(photo.image_url) ??
    asString(photo.url) ??
    thumbnailUrls[thumbnailUrls.length - 1]
  );
}

function getPhotoUploadSources(item: VintedItemDetails): Array<{ url: string; orientation: number }> {
  const photos = Array.isArray(item.photos) ? item.photos : [];
  const seen = new Set<string>();
  const sources: Array<{ url: string; orientation: number }> = [];

  for (const photo of photos) {
    const url = getPhotoUrl(photo);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    sources.push({ url, orientation: asNumber(photo.orientation) ?? 0 });
  }

  return sources;
}

function getItemAttributes(item: VintedItemDetails, statusId: number): JsonRecord[] {
  const attributes = Array.isArray(item.item_attributes) ? [...item.item_attributes] : [];
  const hasCondition = attributes.some((attribute) => {
    const code = typeof attribute.code === 'string' ? attribute.code.toLowerCase() : '';
    return code === 'condition' || code === 'status' || code === 'item_condition';
  });

  if (!hasCondition) {
    attributes.push({ code: 'condition', ids: [statusId] });
  }

  return attributes;
}

function buildDraftPayload(
  item: VintedItemDetails,
  assignedPhotos = getAssignedPhotos(item),
  tempUuid = makeTempUuid(),
): JsonRecord {
  const statusId = getStatusId(item);
  const draft: JsonRecord = {
    assigned_photos: assignedPhotos,
    brand_id: getBrandId(item),
    brand: getBrandTitle(item),
    catalog_id: asNumber(item.catalog_id),
    color_ids: getColorIds(item),
    currency: getCurrency(item),
    description: asString(item.description) ?? asString(item.title) ?? 'Article',
    id: null,
    is_unisex: item.is_unisex === true || item.is_unisex === 1 ? 1 : 0,
    isbn: item.isbn ?? null,
    item_attributes: getItemAttributes(item, statusId),
    manufacturer_labelling: item.manufacturer_labelling ?? null,
    manufacturer: item.manufacturer ?? null,
    measurement_length: item.measurement_length ?? null,
    measurement_width: item.measurement_width ?? null,
    package_size_id: asNumber(item.package_size_id),
    price: getPriceAmount(item),
    shipment_prices: item.shipment_prices ?? { domestic: null, international: null },
    size_id: asNumber(item.size_id),
    status_id: statusId,
    temp_uuid: tempUuid,
    title: asString(item.title) ?? 'Article',
    video_game_rating_id: item.video_game_rating_id ?? null,
  };

  return {
    draft,
    feedback_id: null,
    parcel: null,
    upload_session_id: tempUuid,
  };
}

function getPublishedItemId(response: ApiResponseEnvelope): string | undefined {
  if (response.draft) return undefined;
  const item = response.item ?? (response as VintedItemDetails);
  if (item.is_draft) return undefined;
  const id = item.id ?? response.id;
  return id === undefined || id === null ? undefined : String(id);
}

function buildCompletionPayload(
  draft: DraftCreateResult,
  assignedPhotos: Array<{ id: number; orientation: number }>,
  useOriginalUploadSession = false,
): JsonRecord {
  const tempUuid = useOriginalUploadSession ? (draft.uploadSessionId ?? makeTempUuid()) : makeTempUuid();
  return {
    draft: {
      ...draft.completionDraft,
      id: asNumber(draft.draftId) ?? draft.draftId,
      assigned_photos: assignedPhotos,
      temp_uuid: tempUuid,
    },
    feedback_id: null,
    parcel: null,
    push_up: false,
    upload_session_id: tempUuid,
  };
}

function isPhotoValidationError(err: unknown): boolean {
  const message = String(err);
  return /"field"\s*:\s*"photos"|Nie udało się dodać zdjęcia|chargement de la photo|photos/i.test(message);
}

function describePhotoSource(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return 'invalid-url';
  }
}

function assertUsableImageBlob(blob: Blob, context: string): void {
  if (blob.size === 0) {
    throw new Error(`${context}: downloaded photo blob is empty`);
  }
  if (blob.type && !blob.type.toLowerCase().startsWith('image/')) {
    throw new Error(`${context}: downloaded content is not an image (${blob.type})`);
  }
}

async function blobFromDataUrl(dataUrl: string): Promise<Blob> {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  assertUsableImageBlob(blob, 'background photo fallback');
  return blob;
}

async function fetchPhotoBlob(sourceUrl: string, index: number, total: number): Promise<Blob> {
  const sourceHost = describePhotoSource(sourceUrl);
  try {
    const response = await fetch(sourceUrl, {
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
    if (!response.ok) {
      throw new Error(`download ${response.status}`);
    }

    const blob = await response.blob();
    assertUsableImageBlob(blob, `direct photo ${index + 1}/${total}`);
    await log(
      `[vinted-api] Downloaded photo ${index + 1}/${total} directly from ${sourceHost} (${blob.type || 'unknown'}, ${blob.size} bytes)`,
      'info',
    );
    return blob;
  } catch (directErr) {
    await log(
      `[vinted-api] Direct photo ${index + 1}/${total} download from ${sourceHost} failed: ` +
        `${String(directErr).slice(0, 140)}; trying background fetch`,
      'warn',
    );

    const fallback = (await chrome.runtime.sendMessage({
      type: 'FETCH_PHOTO',
      payload: { url: sourceUrl },
    })) as FetchPhotoResponse;

    if (!fallback.ok || !fallback.dataUrl) {
      throw new Error(
        `direct download failed (${String(directErr).slice(0, 120)}); ` +
          `background fetch failed (${fallback.error ?? 'no dataUrl returned'})`,
      );
    }

    const blob = await blobFromDataUrl(fallback.dataUrl);
    await log(
      `[vinted-api] Downloaded photo ${index + 1}/${total} via background from ${sourceHost} ` +
        `(${blob.type || fallback.contentType || 'unknown'}, ${blob.size} bytes)`,
      'info',
    );
    return blob;
  }
}

async function uploadPhotoBlob(
  blob: Blob,
  tempUuid: string,
  index: number,
  orientation: number,
): Promise<{ id: number; orientation: number }> {
  const csrf = await getCsrfToken();
  const anonId = getCookie('anon_id');
  const body = new FormData();
  const extension = blob.type.includes('png') ? 'png' : 'jpg';
  body.append('photo[type]', 'item');
  body.append('photo[temp_uuid]', tempUuid);
  body.append('photo[file]', blob, `photo${index + 1}.${extension}`);

  const headers = new Headers();
  headers.set('Accept', 'application/json, text/plain, */*');
  headers.set('X-Requested-With', 'XMLHttpRequest');
  headers.set('Locale', 'pl-PL');
  headers.set('Accept-Language', 'pl');
  if (csrf) headers.set('X-Csrf-Token', csrf);
  if (anonId) headers.set('X-Anon-Id', anonId);

  const response = await fetch(`${location.origin}/api/v2/photos`, {
    method: 'POST',
    credentials: 'include',
    body,
    headers,
  });
  const json = (await response.json().catch(() => ({}))) as ApiResponseEnvelope & {
    photo?: { id?: number | string };
  };

  if (!response.ok) {
    throw new Error(`photo upload ${response.status}: ${JSON.stringify(json).slice(0, 200)}`);
  }

  const id = asNumber(json.photo?.id) ?? asNumber(json.id);
  if (id === null) {
    throw new Error(`photo upload returned no id: ${JSON.stringify(json).slice(0, 200)}`);
  }

  return { id, orientation };
}

async function uploadItemPhotos(
  item: VintedItemDetails,
  itemId: string,
  tempUuid: string,
): Promise<Array<{ id: number; orientation: number }>> {
  let sources = getPhotoUploadSources(item);
  if (sources.length === 0) {
    try {
      await log(`[vinted-api] No photo URLs in item_upload details; trying /api/v2/items/${itemId}`, 'warn');
      const publicItemResponse = await apiFetch<ApiResponseEnvelope>(`/api/v2/items/${encodeURIComponent(itemId)}`);
      sources = getPhotoUploadSources(normalizeItem(publicItemResponse));
    } catch (err) {
      await log(`[vinted-api] /api/v2/items/${itemId} photo URL fallback failed: ${String(err).slice(0, 160)}`, 'warn');
    }
  }

  if (sources.length === 0) {
    await log('[vinted-api] No source photo URLs available; falling back to existing photo ids', 'warn');
    return [];
  }

  await log(`[vinted-api] Reuploading ${sources.length} photo(s) for new draft session`, 'info');
  const uploaded: Array<{ id: number; orientation: number }> = [];

  for (let index = 0; index < sources.length; index++) {
    const source = sources[index];
    try {
      const blob = await fetchPhotoBlob(source.url, index, sources.length);
      const photo = await uploadPhotoBlob(blob, tempUuid, index, source.orientation);
      uploaded.push(photo);
      await log(`[vinted-api] Uploaded photo ${index + 1}/${sources.length} as id ${photo.id}`, 'info');
      await wait(300);
    } catch (err) {
      await log(`[vinted-api] Photo ${index + 1}/${sources.length} reupload failed: ${String(err).slice(0, 180)}`, 'warn');
    }
  }

  return uploaded;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getDraftAssignedPhotos(
  draftId: string,
  fallbackPhotos: Array<{ id: number; orientation: number }>,
): Promise<Array<{ id: number; orientation: number }>> {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await wait(2500);

    try {
      const response = await apiFetch<ApiResponseEnvelope>(
        `/api/v2/item_upload/items/${encodeURIComponent(draftId)}`,
      );
      const draft = normalizeItem(response);
      const photos = getAssignedPhotos(draft);
      if (photos.length > 0) {
        await log(
          `[vinted-api] Draft ${draftId} server photos confirmed: ${photos.map((photo) => photo.id).join(',')}`,
          'info',
        );
        return photos;
      }
      await log(`[vinted-api] Draft ${draftId} photo check ${attempt + 1}/3 returned no photos`, 'warn');
    } catch (err) {
      await log(
        `[vinted-api] Draft ${draftId} photo check ${attempt + 1}/3 failed: ${String(err).slice(0, 160)}`,
        'warn',
      );
    }
  }

  await log(`[vinted-api] Using source photo ids for draft ${draftId} completion fallback`, 'warn');
  return fallbackPhotos;
}

async function publishCreatedDraft(
  originalItemId: string,
  draft: DraftCreateResult,
): Promise<{ itemId: string }> {
  const assignedPhotos = await getDraftAssignedPhotos(draft.draftId, draft.assignedPhotos);
  if (assignedPhotos.length === 0) {
    throw new Error('Cannot publish draft because no assigned photo ids are available.');
  }

  let completionResponse: ApiResponseEnvelope | undefined;
  let lastError: unknown;

  for (const useOriginalUploadSession of [false, true]) {
    try {
      const mode = useOriginalUploadSession ? 'original upload session' : 'fresh upload session';
      const payload = buildCompletionPayload(draft, assignedPhotos, useOriginalUploadSession);
      await log(
        `[vinted-api] Publishing draft ${draft.draftId} via completion (${mode}); original ${originalItemId} will not be deleted`,
        'info',
      );

      completionResponse = await apiFetch<ApiResponseEnvelope>(
        `/api/v2/item_upload/drafts/${encodeURIComponent(draft.draftId)}/completion`,
        {
          method: 'POST',
          body: JSON.stringify(payload),
        },
      );
      break;
    } catch (err) {
      lastError = err;
      if (!isPhotoValidationError(err) || useOriginalUploadSession) {
        throw err;
      }
      await log('[vinted-api] Completion rejected photos with fresh session; retrying with original upload session', 'warn');
      await wait(2500);
    }
  }

  if (!completionResponse) {
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  const itemId = getPublishedItemId(completionResponse);
  if (!itemId) {
    throw new Error(
      `Completion response did not include a published item id: ${JSON.stringify(completionResponse).slice(0, 240)}`,
    );
  }
  if (itemId === originalItemId) {
    throw new Error(`Completion returned the original item id ${itemId}, so no new listing was confirmed.`);
  }

  return { itemId };
}

export async function diagnoseVintedApi(): Promise<{ userId?: string; ok: boolean; message: string }> {
  try {
    const response = await apiFetch<ApiResponseEnvelope>('/api/v2/users/current');
    const userId = response.user?.id ? String(response.user.id) : undefined;
    return {
      ok: Boolean(userId),
      userId,
      message: userId ? `Vinted API session OK (user ${userId})` : 'Vinted API responded without user id',
    };
  } catch (err) {
    return { ok: false, message: String(err) };
  }
}

const WARDROBE_PAGE_SIZE = 96;
const MAX_WARDROBE_PAGES = 50;
const PRIVATE_WARDROBE_STATUS_QUERIES: ReadonlyArray<{
  apiStatus: string;
  sourceStatus: Exclude<SellerListingStatus, 'active' | 'unknown'>;
}> = [
  { apiStatus: 'hidden', sourceStatus: 'hidden' },
  { apiStatus: 'sold', sourceStatus: 'sold' },
  { apiStatus: 'reserved', sourceStatus: 'reserved' },
  { apiStatus: 'draft', sourceStatus: 'draft' },
];

interface WardrobePage {
  items: VintedWardrobeItem[];
  pageSize: number;
  totalPages: number | null;
}

function getWardrobeItems(response: VintedWardrobeResponse): VintedWardrobeItem[] {
  const candidates = [
    response.items,
    response.results,
    response.drafts,
    response.data?.items,
    response.data?.results,
    response.data?.drafts,
  ];
  return candidates.find((items): items is VintedWardrobeItem[] => Array.isArray(items)) ?? [];
}

function getWardrobePage(response: VintedWardrobeResponse): WardrobePage {
  const items = getWardrobeItems(response);
  const pagination = response.pagination ?? response.meta?.pagination;
  const pageSize = asNumber(pagination?.per_page) ?? items.length;
  const totalEntries = asNumber(pagination?.total_entries);
  const totalPages =
    asNumber(pagination?.total_pages) ??
    (totalEntries !== null && pageSize > 0 ? Math.ceil(totalEntries / pageSize) : null);
  return { items, pageSize, totalPages };
}

function shouldReadNextWardrobePage(page: number, result: WardrobePage): boolean {
  return shouldReadNextPage(page, result.totalPages, result.items.length, result.pageSize);
}

function sameIds(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

async function fetchWardrobePage(
  userId: string,
  page: number,
  apiStatus?: string,
): Promise<WardrobePage> {
  const query = new URLSearchParams({
    page: String(page),
    per_page: String(WARDROBE_PAGE_SIZE),
    order: 'newest_first',
  });
  if (apiStatus) query.set('status', apiStatus);

  const response = await apiFetch<VintedWardrobeResponse>(
    `/api/v2/wardrobe/${encodeURIComponent(userId)}/items?${query.toString()}`,
  );
  return getWardrobePage(response);
}

/**
 * Read the signed-in seller wardrobe through Vinted's existing browser
 * session. The default endpoint response is the public wardrobe. We also ask
 * Vinted for each private seller status and include a page only when its IDs
 * differ from the public result. This avoids treating a server-ignored filter
 * as a real status response.
 *
 * This is read-only. It never changes an item or navigates the tab.
 */
export async function scanWardrobeListings(): Promise<Listing[]> {
  const currentUser = await apiFetch<ApiResponseEnvelope>('/api/v2/users/current');
  const userId = currentUser.user?.id;
  if (userId === undefined || userId === null) {
    throw new Error('Vinted API did not return the signed-in user id for wardrobe scan.');
  }

  const listingsById = new Map<string, Listing>();
  const appendItems = (
    items: VintedWardrobeItem[],
    statusHint?: Exclude<SellerListingStatus, 'active' | 'unknown'>,
  ): number => {
    let added = 0;
    for (const item of items) {
      const listing = mapWardrobeItem(item, statusHint);
      if (!listing || listingsById.has(listing.id)) continue;
      listingsById.set(listing.id, listing);
      added++;
    }
    return added;
  };

  let page = 1;
  let publicFirstPageIds: string[] = [];
  while (page <= MAX_WARDROBE_PAGES) {
    const result = await fetchWardrobePage(String(userId), page);
    if (page === 1) {
      publicFirstPageIds = result.items
        .map((item) => (item.id === undefined || item.id === null ? null : String(item.id)))
        .filter((id): id is string => id !== null);
    }
    const added = appendItems(result.items);
    await log(
      `[vinted-api] Public wardrobe page ${page}: received ${result.items.length} item(s), added ${added}`,
      'info',
    );

    if (!shouldReadNextWardrobePage(page, result)) break;
    page++;
  }

  if (page > MAX_WARDROBE_PAGES) {
    await log(`[vinted-api] Public wardrobe scan reached the ${MAX_WARDROBE_PAGES}-page safety limit`, 'warn');
  }

  for (const query of PRIVATE_WARDROBE_STATUS_QUERIES) {
    try {
      const firstPage = await fetchWardrobePage(String(userId), 1, query.apiStatus);
      const firstPageIds = firstPage.items
        .map((item) => (item.id === undefined || item.id === null ? null : String(item.id)))
        .filter((id): id is string => id !== null);

      if (firstPage.items.length === 0) {
        await log(`[vinted-api] Status query "${query.apiStatus}" returned 0 item(s)`, 'info');
        continue;
      }
      if (publicFirstPageIds.length > 0 && sameIds(firstPageIds, publicFirstPageIds)) {
        await log(
          `[vinted-api] Status query "${query.apiStatus}" returned the same public first page; filter appears ignored, skipping it`,
          'warn',
        );
        continue;
      }

      const firstAdded = appendItems(firstPage.items, query.sourceStatus);
      await log(
        `[vinted-api] Status query "${query.apiStatus}" page 1: received ${firstPage.items.length} item(s), added ${firstAdded}`,
        'info',
      );

      page = 2;
      let result = firstPage;
      while (page <= MAX_WARDROBE_PAGES && shouldReadNextWardrobePage(page - 1, result)) {
        result = await fetchWardrobePage(String(userId), page, query.apiStatus);
        const added = appendItems(result.items, query.sourceStatus);
        await log(
          `[vinted-api] Status query "${query.apiStatus}" page ${page}: received ${result.items.length} item(s), added ${added}`,
          'info',
        );
        page++;
      }

      if (page > MAX_WARDROBE_PAGES && shouldReadNextWardrobePage(page - 1, result)) {
        await log(
          `[vinted-api] Status query "${query.apiStatus}" reached the ${MAX_WARDROBE_PAGES}-page safety limit`,
          'warn',
        );
      }
    } catch (err) {
      await log(
        `[vinted-api] Status query "${query.apiStatus}" unavailable: ${String(err).slice(0, 180)}`,
        'warn',
      );
    }
  }

  const listings = Array.from(listingsById.values());
  await log(
    `[vinted-api] Wardrobe scan completed: ${listings.length} unique item(s) ` +
      `(${formatSellerStatusSummary(summarizeListingSourceStatuses(listings))})`,
    'info',
  );

  return listings;
}

export async function createDraftFromItemId(itemId: string): Promise<DraftCreateResult> {
  await log(`[vinted-api] Fetching item details for ${itemId}`, 'info');
  const itemResponse = await apiFetch<ApiResponseEnvelope>(`/api/v2/item_upload/items/${encodeURIComponent(itemId)}`);
  const item = normalizeItem(itemResponse);
  const assignedPhotos = getAssignedPhotos(item);
  const sourcePhotoCount = assignedPhotos.length;

  if (!item.id && !item.title) {
    throw new Error('Item details response did not contain usable item data.');
  }
  if (sourcePhotoCount === 0) {
    throw new Error('Item details response contains no reusable photo ids.');
  }

  const uploadSessionId = makeTempUuid();
  const uploadedPhotos = await uploadItemPhotos(item, itemId, uploadSessionId);
  if (!hasCompletePhotoUpload(sourcePhotoCount, uploadedPhotos.length)) {
    throw new Error(
      `Photo integrity check failed: reuploaded ${uploadedPhotos.length}/${sourcePhotoCount}. ` +
        'Draft publication stopped to avoid an incomplete listing.',
    );
  }
  const assignedPhotosForDraft = uploadedPhotos;

  const payload = buildDraftPayload(item, assignedPhotosForDraft, uploadSessionId);
  const completionDraft = payload.draft as JsonRecord;
  await log(
    `[vinted-api] Creating API draft copy for ${itemId} with ${assignedPhotosForDraft.length} assigned photo id(s)`,
    'info',
  );
  const draftResponse = await apiFetch<ApiResponseEnvelope>('/api/v2/item_upload/drafts', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  const draftId = draftResponse.draft?.id ?? draftResponse.id;

  if (!draftId) {
    throw new Error(`Draft create response did not include draft id: ${JSON.stringify(draftResponse).slice(0, 240)}`);
  }

  return {
    draftId: String(draftId),
    sourcePhotoCount,
    uploadedPhotoCount: uploadedPhotos.length,
    uploadSessionId: asString(draftResponse.upload_session_id) ?? asString(payload.upload_session_id),
    assignedPhotos: assignedPhotosForDraft,
    completionDraft,
  };
}

export async function createAndPublishDraftFromItemId(itemId: string): Promise<DraftPublishResult> {
  const draft = await createDraftFromItemId(itemId);

  try {
    const published = await publishCreatedDraft(itemId, draft);
    return {
      ok: true,
      draftId: draft.draftId,
      itemId: published.itemId,
      sourcePhotoCount: draft.sourcePhotoCount,
      uploadedPhotoCount: draft.uploadedPhotoCount,
    };
  } catch (err) {
    return {
      ok: false,
      draftId: draft.draftId,
      sourcePhotoCount: draft.sourcePhotoCount,
      uploadedPhotoCount: draft.uploadedPhotoCount,
      message: String(err).slice(0, 300),
    };
  }
}
