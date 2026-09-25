# MVP_SCOPE.md

## In scope

### Version 0.1
- Chrome Extension MV3 scaffold.
- Content script injected into relevant Vinted pages.
- Listing scanner for the user's listing pages.
- Selection model for listings.
- Batch relist queue.
- Configurable delay between actions.
- Random jitter option.
- Pause/resume controls.
- Local log storage.
- Popup dashboard.
- Options page with safe-mode settings.

### Version 0.2
- Queue recovery after refresh/reopen.
- More robust selector abstraction.
- Better error codes and retry handling.
- Export logs to JSON.

## Out of scope
- Full CRM panel.
- AI assistant features.
- Message automation.
- Offer negotiation.
- Multi-account switching.
- Cross-device sync.
- Remote backend.
- Browser marketplace publishing.

## Definition of done for MVP
A task is done only when:
- the code is implemented,
- TypeScript types are valid,
- the module is wired into the extension flow,
- the UI action is testable manually,
- log output exists for success and failure,
- edge cases are documented,
- README or test checklist is updated if behavior changed.

## Constraints
- Prefer minimal permissions.
- Keep architecture modular.
- Avoid premature abstraction.
- Avoid hidden magic.
- Do not silently swallow DOM failures.
- Fail loudly with useful logs.
