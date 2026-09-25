/**
 * Content script entry point.
 *
 * This file is loaded as a classic manifest content script, so it must not use
 * static imports. Register the message bridge immediately, then lazily load the
 * ES module implementation.
 */

type ContentModule = {
  initializeContent: () => void;
  handleContentMessage: (message: unknown) => Promise<unknown>;
};

let contentModulePromise: Promise<ContentModule> | undefined;
let initialized = false;

function loadContentModule(): Promise<ContentModule> {
  if (!contentModulePromise) {
    contentModulePromise = import(
      chrome.runtime.getURL('dist/content/content-init.js')
    ) as Promise<ContentModule>;
  }
  return contentModulePromise;
}

async function ensureContentReady(): Promise<ContentModule> {
  const module = await loadContentModule();
  if (!initialized) {
    module.initializeContent();
    initialized = true;
  }
  return module;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  ensureContentReady()
    .then((module) => module.handleContentMessage(message))
    .then(sendResponse)
    .catch((err) => {
      const errorMsg = `Content script failed: ${String(err)}`;
      console.error('[Vinted Relister]', errorMsg);
      sendResponse({ ok: false, error: errorMsg });
    });
  return true; // Async response.
});

ensureContentReady().catch((err) => {
  console.error('[Vinted Relister] Content script failed to boot:', err);
});