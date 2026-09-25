/**
 * Pure message-template renderer.
 *
 * Rules:
 *  - only the five supported variables are substituted,
 *  - substitution is single-pass: text inserted as a value is never
 *    re-scanned for placeholders (no recursive injection),
 *  - replacement uses a callback (never a replacement string), so `$&`,
 *    `$1`, `` $` `` etc. inside values stay literal,
 *  - an unknown placeholder (`{{anythingElse}}`) is an explicit error:
 *    `ok: false`, the placeholder left untouched, and the name reported,
 *  - a supported variable that was not provided keeps its placeholder text
 *    unchanged (optional/unused variable) and is reported separately,
 *  - zero side effects: no DOM, no storage, no network, no clock reads.
 */

import type { MessageTemplate, MessageTemplateVariableName, MessageTemplateVariables, RenderedMessage } from './contracts';

const SUPPORTED_VARIABLES: ReadonlySet<string> = new Set<MessageTemplateVariableName>([
  'username',
  'itemTitle',
  'itemPrice',
  'currency',
  'conversationId',
]);

/** Matches `{{ name }}` with optional inner whitespace. */
const PLACEHOLDER_PATTERN = /\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g;

export function renderMessageTemplate(
  template: MessageTemplate,
  variables: MessageTemplateVariables,
): RenderedMessage {
  const unknownVariables: string[] = [];
  const missingVariables: string[] = [];

  const body = template.body.replace(PLACEHOLDER_PATTERN, (match, rawName: string) => {
    if (!SUPPORTED_VARIABLES.has(rawName)) {
      if (!unknownVariables.includes(rawName)) {
        unknownVariables.push(rawName);
      }
      return match; // leave the unknown placeholder as-is
    }

    const value = variables[rawName as MessageTemplateVariableName];
    if (value === undefined || value === null) {
      // Optional and unused: keep the placeholder text, report it.
      if (!missingVariables.includes(rawName)) {
        missingVariables.push(rawName);
      }
      return match;
    }
    return String(value);
  });

  if (unknownVariables.length > 0) {
    return {
      ok: false,
      body,
      unknownVariables,
      missingVariables,
      error: `Unknown template variable(s): ${unknownVariables.map((name) => `{{${name}}}`).join(', ')}. ` +
        `Supported: ${Array.from(SUPPORTED_VARIABLES).map((name) => `{{${name}}}`).join(', ')}.`,
    };
  }

  return { ok: true, body, unknownVariables: [], missingVariables };
}
