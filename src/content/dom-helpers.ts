/**
 * Small DOM utilities for the content layer.
 *
 * Keep these pure and defensive; do not import selectors here.
 */

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function waitForElement(
  selector: string,
  timeoutMs: number,
  root: ParentNode = document,
): Promise<HTMLElement> {
  return new Promise((resolve, reject) => {
    const existing = root.querySelector<HTMLElement>(selector);
    if (existing) {
      resolve(existing);
      return;
    }

    const observer = new MutationObserver(() => {
      const element = root.querySelector<HTMLElement>(selector);
      if (element) {
        clearTimeout(timer);
        observer.disconnect();
        resolve(element);
      }
    });

    const timer = setTimeout(() => {
      observer.disconnect();
      reject(new Error(`Element "${selector}" not found within ${timeoutMs}ms`));
    }, timeoutMs);

    observer.observe(document.body, { childList: true, subtree: true });
  });
}

/**
 * Click an element in a way that triggers React/Vue event handlers.
 * Scrolls into view first, then dispatches a full pointer + mouse event
 * sequence ending with a native click().
 */
export function clickElement(element: HTMLElement): void {
  try {
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch {
    // scrollIntoView can throw if element is detached; ignore
  }

  const rect = element.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;

  const commonOpts: MouseEventInit = {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX: x,
    clientY: y,
  };

  try {
    element.dispatchEvent(new PointerEvent('pointerdown', commonOpts));
  } catch {
    // PointerEvent not available in all contexts
  }

  try {
    element.dispatchEvent(new MouseEvent('mousedown', commonOpts));
  } catch {
    // ignore
  }

  try {
    element.dispatchEvent(new PointerEvent('pointerup', commonOpts));
  } catch {
    // ignore
  }

  try {
    element.dispatchEvent(new MouseEvent('mouseup', commonOpts));
  } catch {
    // ignore
  }

  element.click();
}

/**
 * Wait for an element to appear, then click it.
 * Convenience wrapper for waitForElement + clickElement.
 */
export async function waitAndClick(
  selector: string,
  timeoutMs: number,
  root: ParentNode = document,
): Promise<HTMLElement> {
  const el = await waitForElement(selector, timeoutMs, root);
  clickElement(el);
  return el;
}