/**
 * Read-only Vinted conversation client (T3.2).
 *
 * Hard constraints:
 *  - only `ReadOnlyHttpMethod = "GET"` exists; there is NO method
 *    parameter anywhere — a write method cannot be expressed in a call,
 *  - no import of the general-purpose API client (src/content/vinted-api.ts)
 *    which is capable of writes,
 *  - no retries, no auth/session mutation, credentials ride the page
 *    session (`credentials: 'include'`),
 *  - failures come back as data (`ok:false` + code), so callers fail
 *    closed without throwing through unrelated layers.
 *
 * Endpoint shapes (`/api/v2/conversations`, `cursor`/`limit` params) are
 * the expected read-only contract and must be confirmed against the live
 * page during the manual E2E phase — nothing here is written to Vinted.
 */

export type ReadOnlyHttpMethod = 'GET';

export type ReadOnlyFailureCode =
  | 'session-expired'
  | 'rate-limited'
  | 'captcha'
  | 'http-error'
  | 'network-error';

export type ReadOnlyResponse =
  | { ok: true; status: number; data: unknown }
  | { ok: false; status: number; error: string; code: ReadOnlyFailureCode };

export interface ListConversationsInput {
  cursor?: string;
  perPage?: number;
}

export interface ReadOnlyConversationClient {
  listConversations(input: ListConversationsInput): Promise<ReadOnlyResponse>;
  getConversation(id: string): Promise<ReadOnlyResponse>;
}

export interface ReadOnlyClientOptions {
  /** Defaults to Vinted's read-only conversations endpoints. */
  apiBaseUrl?: string;
  /** Injectable fetch for tests; defaults to the global one. */
  fetchImpl?: typeof fetch;
}

const DEFAULT_API_BASE_URL = 'https://www.vinted.pl/api/v2';
const READ_METHOD: ReadOnlyHttpMethod = 'GET';

function failureForStatus(status: number, bodyText: string): ReadOnlyFailureCode {
  if (/datadome|captcha/i.test(bodyText)) {
    return 'captcha';
  }
  if (status === 401 || status === 403) {
    return 'session-expired';
  }
  if (status === 429) {
    return 'rate-limited';
  }
  return 'http-error';
}

export function createReadOnlyConversationClient(
  options: ReadOnlyClientOptions = {},
): ReadOnlyConversationClient {
  const baseUrl = (options.apiBaseUrl ?? DEFAULT_API_BASE_URL).replace(/\/+$/, '');
  const fetchImpl = options.fetchImpl;

  /**
   * The single transport in this module. Method is a constant `GET` —
   * there is no parameter through which a write could be issued.
   */
  async function get(url: string): Promise<ReadOnlyResponse> {
    let response: Response;
    try {
      const doFetch: typeof fetch =
        fetchImpl ??
        ((input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
          globalThis.fetch(input, init));
      response = await doFetch(url, {
        method: READ_METHOD,
        credentials: 'include',
      });
    } catch (error) {
      return {
        ok: false,
        status: 0,
        error: error instanceof Error ? error.message : String(error),
        code: 'network-error',
      };
    }

    if (!response.ok) {
      let bodyText = '';
      try {
        bodyText = await response.text();
      } catch {
        bodyText = '';
      }
      return {
        ok: false,
        status: response.status,
        error: `Read-only request failed with status ${String(response.status)}.`,
        code: failureForStatus(response.status, bodyText),
      };
    }

    try {
      const data: unknown = await response.json();
      return { ok: true, status: response.status, data };
    } catch {
      return {
        ok: false,
        status: response.status,
        error: 'Response body is not valid JSON.',
        code: 'http-error',
      };
    }
  }

  return {
    async listConversations(input: ListConversationsInput): Promise<ReadOnlyResponse> {
      const query = new URLSearchParams();
      if (input.perPage !== undefined) {
        query.set('limit', String(input.perPage));
      }
      if (input.cursor !== undefined && input.cursor !== '') {
        query.set('cursor', input.cursor);
      }
      const suffix = query.toString();
      return get(`${baseUrl}/conversations${suffix === '' ? '' : `?${suffix}`}`);
    },

    async getConversation(id: string): Promise<ReadOnlyResponse> {
      return get(`${baseUrl}/conversations/${encodeURIComponent(id)}`);
    },
  };
}
