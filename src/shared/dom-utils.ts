/**
 * Shared DOM utilities for safe, type-checked UI rendering.
 *
 * Provides type-safe helpers to replace innerHTML-based rendering
 * and eliminate `any` casts in message response handling.
 */

// ── Safe HTML escaping ──────────────────────────────────────────────

/** Escape a plain string so it can be safely placed in HTML text content. */
export function escapeHtml(s: string): string {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

/** Escape an attribute value safely. */
export function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Type-safe response guards ───────────────────────────────────────

/** Runtime type guard that checks an unknown response shape. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Narrow response to { ok: true, … } shape. */
export function isOkResponse<T extends Record<string, unknown>>(
  response: unknown,
): response is { ok: true } & T {
  return isRecord(response) && response.ok === true;
}

/** Narrow response to { ok: boolean, error?: string, … } shape. */
export interface ActionResponse {
  ok?: boolean;
  error?: string;
  [key: string]: unknown;
}

export function getActionError(response: unknown): string | undefined {
  if (!isRecord(response)) {
    return 'Action returned no response.';
  }
  if (response.ok === false) {
    return typeof response.error === 'string'
      ? response.error
      : 'Action failed without error details.';
  }
  return undefined;
}

/**
 * Returns a required DOM element and verifies its tag at runtime.
 *
 * UI modules keep precise element types without scattering unchecked casts.
 */
export function getRequiredElement<K extends keyof HTMLElementTagNameMap>(
  id: string,
  tagName: K,
): HTMLElementTagNameMap[K] {
  const element = document.getElementById(id);

  if (!element) {
    throw new Error(`Required element #${id} was not found.`);
  }

  if (element.tagName.toLowerCase() !== tagName) {
    throw new Error(
      `Required element #${id} must be a <${tagName}>; received <${element.tagName.toLowerCase()}>.`,
    );
  }

  return element as HTMLElementTagNameMap[K];
}

// ── Safe element construction ───────────────────────────────────────

/**
 * Create an element with properties and children in one expression.
 * Type-safe alternative to innerHTML assignment.
 *
 * @example
 *   div({ className: 'row', children: [span({ text: 'Hello' })] })
 */
export interface ElementSpec {
  tag?: string;
  className?: string;
  id?: string;
  text?: string;
  dataset?: Record<string, string>;
  children?: Array<HTMLElement | Text | null | false>;
  attrs?: Record<string, string | undefined>;
  events?: Record<string, (e: Event) => void>;
}

export function createElement(spec: ElementSpec): HTMLElement {
  const el = document.createElement(spec.tag ?? 'div');
  if (spec.className) el.className = spec.className;
  if (spec.id) el.id = spec.id;
  if (spec.text) el.textContent = spec.text;
  if (spec.dataset) {
    const keys = Object.keys(spec.dataset);
    for (let i = 0; i < keys.length; i++) {
      el.dataset[keys[i]] = spec.dataset[keys[i]];
    }
  }
  if (spec.attrs) {
    const keys = Object.keys(spec.attrs);
    for (let i = 0; i < keys.length; i++) {
      const v = spec.attrs[keys[i]];
      if (v !== undefined) el.setAttribute(keys[i], v);
    }
  }
  if (spec.events) {
    const keys = Object.keys(spec.events);
    for (let i = 0; i < keys.length; i++) {
      el.addEventListener(keys[i], spec.events[keys[i]]);
    }
  }
  if (spec.children) {
    for (const child of spec.children) {
      if (child) el.appendChild(child);
    }
  }
  return el;
}

/** Shortcut: create a <span> with text content. */
export function span(text: string, className?: string): HTMLSpanElement {
  const el = document.createElement('span');
  el.textContent = text;
  if (className) el.className = className;
  return el;
}

/** Shortcut: create a <div> with optional class and children. */
export function div(className: string, children?: Array<HTMLElement | Text | null | false>): HTMLDivElement {
  const el = document.createElement('div');
  el.className = className;
  if (children) {
    for (const child of children) {
      if (child) el.appendChild(child);
    }
  }
  return el;
}

/** Shortcut: create an <img> with src/alt/className. */
export function img(src: string, alt: string, className?: string): HTMLImageElement {
  const el = document.createElement('img');
  el.src = src;
  el.alt = alt;
  if (className) el.className = className;
  return el;
}

/** Shortcut: create a link element. */
export function link(href: string, text: string, className?: string): HTMLAnchorElement {
  const el = document.createElement('a');
  el.href = href;
  el.textContent = text;
  el.target = '_blank';
  if (className) el.className = className;
  return el;
}

/** Shortcut: create a checkbox input. */
export function checkbox(
  datasetId?: string,
  onChange?: (checked: boolean) => void,
): HTMLInputElement {
  const el = document.createElement('input');
  el.type = 'checkbox';
  if (datasetId) el.dataset.id = datasetId;
  if (onChange) {
    el.addEventListener('change', () => onChange(el.checked));
  }
  return el;
}

/** Shortcut: create a badge span with status class. */
export function badge(text: string, statusClass: string): HTMLSpanElement {
  return span(text, `status-badge status-badge--${statusClass}`);
}

/** Shortcut: create a status dot div. */
export function statusDot(state: string): HTMLSpanElement {
  const el = document.createElement('span');
  el.className = `dash-status-dot dash-color--${state}`;
  return el;
}
