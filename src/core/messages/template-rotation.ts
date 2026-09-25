/**
 * Pure template selection for rotation.
 *
 * Rules (project decision):
 *  - disabled templates are never selected,
 *  - the template used last in this conversation is excluded while any
 *    alternative exists (no immediate repeat),
 *  - if the last template is the only enabled one, it is selected again —
 *    a single-template pool must not deadlock,
 *  - randomness is injected (`random: () => number`) — no Math.random()
 *    inside the logic, so tests are deterministic,
 *  - the function never mutates `state` or `templates`; persisting the
 *    choice is a separate step performed by the caller.
 */

import type { MessageTemplate, TemplateRotationState, TemplateSelectionResult } from './contracts';

function isUsableTemplate(
  template: MessageTemplate | null | undefined,
): template is MessageTemplate {
  return (
    template !== undefined && template !== null && typeof template.body === 'string'
  );
}

export function selectNextTemplate(
  templates: readonly MessageTemplate[] | null | undefined,
  state: TemplateRotationState,
  random: () => number,
): TemplateSelectionResult {
  if (!templates || templates.length === 0) {
    return {
      ok: false,
      code: 'no-templates',
      reason: 'No templates exist yet. Create at least one message template.',
    };
  }

  const enabled = templates.filter(
    (template) => isUsableTemplate(template) && template.enabled,
  );
  if (enabled.length === 0) {
    return {
      ok: false,
      code: 'no-enabled-templates',
      reason: 'All templates are disabled. Enable at least one template.',
    };
  }

  const lastId = state.lastTemplateId;
  const candidates =
    lastId !== undefined && lastId !== ''
      ? enabled.filter((template) => template.id !== lastId)
      : enabled;
  // Single enabled template that was used last: allow the repeat instead of
  // deadlocking the conversation.
  const pool = candidates.length > 0 ? candidates : enabled;

  const raw = typeof random === 'function' ? random() : Number.NaN;
  const safeRaw = Number.isFinite(raw) ? raw : 0;
  const clamped = Math.min(Math.max(safeRaw, 0), 0.999999999);
  const index = Math.min(pool.length - 1, Math.floor(clamped * pool.length));
  // `pool` is non-empty (guards above) and `index` is clamped — element exists.
  const template = pool[index];

  return {
    ok: true,
    code: 'selected',
    reason:
      candidates.length < enabled.length
        ? `Selected avoiding last template (${lastId ?? 'n/a'}).`
        : 'Selected from enabled templates.',
    template,
  };
}
