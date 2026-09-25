export type ProductModuleStatus = 'active' | 'partial' | 'planned' | 'blocked';

export interface ProductModuleDefinition {
  id: 'relist' | 'messages' | 'offers' | 'visibility' | 'dashboard' | 'accounts';
  name: string;
  status: ProductModuleStatus;
  summary: string;
  currentState: string;
  missing: string[];
  nextStep: string;
}

export const PRODUCT_MODULES: readonly ProductModuleDefinition[] = [
  {
    id: 'relist',
    name: 'Relist',
    status: 'active',
    summary: 'Scan listings, select items, run controlled batch relist (manual or scheduled), and track per-item results.',
    currentState:
      'MVP implementation exists with scan, selection, queue, preview, backups, status, logs, safe delays, ' +
      'saved last-scan snapshot, and a scheduled automatic relist cycle driven by a background alarm.',
    missing: ['Real detail-page E2E confirmation', 'Consistent backup before every batch item'],
    nextStep: 'Confirm one real relist E2E and adjust only observed selector/runner issues.',
  },
  {
    id: 'messages',
    name: 'AI messages',
    status: 'planned',
    summary: 'Draft buyer replies using templates, tone settings, listing context, and language handling.',
    currentState: 'Not implemented. Core storage/logging/message patterns are available.',
    missing: ['Inbox scanner', 'Conversation model', 'Template storage', 'AI provider decision', 'Manual approval UI'],
    nextStep: 'Start with draft-only replies; do not auto-send before approval and logging exist.',
  },
  {
    id: 'offers',
    name: 'Offers / favoriters',
    status: 'planned',
    summary: 'Detect favoriters and prepare controlled personalized price offers with discount rules.',
    currentState: 'Not implemented. Queue/log foundations can be reused later.',
    missing: ['Favoriters scanner', 'Offer rule model', 'Frequency caps', 'Offer runner', 'Per-recipient logs'],
    nextStep: 'Build manual-review offer drafts before any sending automation.',
  },
  {
    id: 'visibility',
    name: 'Follow / visibility',
    status: 'planned',
    summary: 'Run paced follow/unfollow tasks for selected profiles with queue status and logs.',
    currentState: 'Not implemented. Content runner and queue patterns exist.',
    missing: ['Profile scanner', 'Follow selectors', 'Rate policy', 'Safety stop conditions', 'Profile selection UI'],
    nextStep: 'Add a controlled profile queue only after relist E2E is stable.',
  },
  {
    id: 'dashboard',
    name: 'Unified dashboard',
    status: 'partial',
    summary: 'One operator panel for listings, conversations, offers, task status, logs, and automation results.',
    currentState: 'Dashboard exists for listings, queue, stats, backups, logs, and now module status.',
    missing: ['Conversation view', 'Offers view', 'Visibility view', 'Unified task model across modules'],
    nextStep: 'Keep inactive modules visible as planned; do not expose fake actions.',
  },
  {
    id: 'accounts',
    name: 'Multi-account foundations',
    status: 'planned',
    summary: 'Prepare account-scoped storage, queue ownership, scheduled tasks, and tab/session context.',
    currentState: 'Single-account local MVP with active-tab routing and one persisted queue.',
    missing: ['Account context model', 'Namespaced storage', 'Per-account queues', 'Conflict rules for multiple accounts'],
    nextStep: 'Introduce account context only after the single-account relist flow is confirmed.',
  },
];
