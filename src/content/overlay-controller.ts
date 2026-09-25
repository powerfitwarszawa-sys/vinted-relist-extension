import type { Listing } from '../core/contracts';

const OVERLAY_ID = 'vbr-overlay-root';

function createOverlayStyles(): HTMLStyleElement {
  const id = 'vbr-overlay-styles';
  let style = document.getElementById(id) as HTMLStyleElement | null;
  if (style) return style;

  style = document.createElement('style');
  style.id = id;
  style.textContent = `
    #${OVERLAY_ID} {
      position: fixed;
      bottom: 16px;
      right: 16px;
      z-index: 2147483647;
      background: #ffffff;
      border: 1px solid #d1d5db;
      border-radius: 8px;
      padding: 12px 16px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 13px;
      color: #1f2937;
      min-width: 200px;
      max-width: 320px;
    }
    #${OVERLAY_ID} .vbr-overlay__header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
      font-weight: 600;
      font-size: 14px;
    }
    #${OVERLAY_ID} .vbr-overlay__header span {
      color: #111827;
    }
    #${OVERLAY_ID} .vbr-overlay__count {
      font-size: 11px;
      color: #6b7280;
      font-weight: 400;
      margin-left: 8px;
    }
    #${OVERLAY_ID} .vbr-overlay__actions {
      display: flex;
      gap: 8px;
    }
    #${OVERLAY_ID} button {
      padding: 6px 12px;
      border: 1px solid #d1d5db;
      border-radius: 6px;
      background: #ffffff;
      cursor: pointer;
      font-size: 12px;
      font-weight: 500;
      color: #374151;
    }
    #${OVERLAY_ID} button:hover {
      background: #f3f4f6;
    }
    #${OVERLAY_ID} .vbr-overlay__btn--primary {
      background: #111827;
      color: #ffffff;
      border-color: #111827;
    }
    #${OVERLAY_ID} .vbr-overlay__btn--primary:hover {
      background: #374151;
    }
    #${OVERLAY_ID} .vbr-overlay__btn--hide {
      border: none;
      background: transparent;
      color: #9ca3af;
      padding: 2px 6px;
      font-size: 11px;
    }
    #${OVERLAY_ID} .vbr-overlay__btn--hide:hover {
      color: #6b7280;
      background: #f3f4f6;
    }
  `;
  document.head.appendChild(style);
  return style;
}

function createOverlayElement(): HTMLElement {
  const root = document.createElement('div');
  root.id = OVERLAY_ID;
  root.innerHTML = `
    <div class="vbr-overlay__header">
      <span>Vinted Relister</span>
      <button class="vbr-overlay__btn--hide" type="button">✕</button>
    </div>
    <div class="vbr-overlay__actions">
      <button id="vbr-scan-btn" type="button" class="vbr-overlay__btn--primary">Scan</button>
    </div>
  `;

  root.querySelector<HTMLButtonElement>('#vbr-scan-btn')!.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'SCAN_LISTINGS' }).catch(() => {
      // Scan will be retried by the popup/background path.
    });
  });

  root.querySelector<HTMLButtonElement>('.vbr-overlay__btn--hide')!.addEventListener('click', () => {
    hideOverlay();
  });

  return root;
}

export function updateOverlayCount(count: number): void {
  const overlay = document.getElementById(OVERLAY_ID);
  if (!overlay) return;

  let countEl = overlay.querySelector<HTMLElement>('.vbr-overlay__count');
  if (!countEl) {
    countEl = document.createElement('span');
    countEl.className = 'vbr-overlay__count';
    overlay.querySelector('.vbr-overlay__header')?.appendChild(countEl);
  }

  countEl.textContent = count > 0 ? `${count} listings` : '';
}

/** Show the overlay, creating it only once per page lifetime. */
export function mountOverlay(): HTMLElement {
  createOverlayStyles();
  let overlay = document.getElementById(OVERLAY_ID);
  if (!overlay) {
    overlay = createOverlayElement();
    document.body.appendChild(overlay);
  } else {
    overlay.style.display = 'block';
  }
  return overlay;
}

/** Hide the overlay without removing it, so it can be shown again safely. */
export function hideOverlay(): void {
  const overlay = document.getElementById(OVERLAY_ID);
  if (overlay) {
    overlay.style.display = 'none';
  }
}

/** Remove the overlay and its styles from the DOM. */
export function unmountOverlay(): void {
  const overlay = document.getElementById(OVERLAY_ID);
  if (overlay) {
    overlay.remove();
  }
  const styles = document.getElementById('vbr-overlay-styles');
  if (styles) {
    styles.remove();
  }
}