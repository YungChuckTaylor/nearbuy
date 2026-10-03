/**
 * NearBuyGoods Project Tracker — storage schema.
 *
 * One declarative schema drives every driver (Neon Postgres, Vercel KV,
 * local JSON file), so the relational shape and the serverless JSON shape
 * never drift apart:
 *
 *   • Neon Postgres  → one real table + indexes per entry (nb_trk_<name>)
 *   • Vercel KV      → one document holding arrays of the same rows
 *   • Local dev      → same document on disk (.data/tracker.json)
 *
 * Column types: text | int | bool | jsonb | timestamptz
 */

export const TABLES = {
  accounts: {
    pk: 'id',
    columns: {
      id: 'text', name: 'text', email: 'text', pass_hash: 'text', salt: 'text',
      role: 'text', kind: 'text', color: 'text', avatar: 'text',
      created: 'timestamptz', last_seen: 'timestamptz',
    },
    indexes: [['email'], ['kind']],
  },
  projects: {
    pk: 'id',
    columns: {
      id: 'text', name: 'text', key: 'text', description: 'text', accent: 'text',
      owner_id: 'text', source_doc: 'text', settings: 'jsonb',
      created: 'timestamptz', archived: 'bool',
    },
    indexes: [['owner_id']],
  },
  members: {
    pk: 'id',
    columns: { id: 'text', project_id: 'text', account_id: 'text', role: 'text', created: 'timestamptz' },
    indexes: [['project_id'], ['account_id']],
  },
  workspaces: {
    pk: 'id',
    columns: {
      id: 'text', project_id: 'text', name: 'text', purpose: 'text', kind: 'text',
      color: 'text', icon: 'text', position: 'int', wip_limit: 'int', kind_note: 'text',
      settings: 'jsonb', created: 'timestamptz', archived: 'bool',
    },
    indexes: [['project_id'], ['position']],
  },
  features: {
    pk: 'id',
    columns: {
      id: 'text', project_id: 'text', code: 'text', section: 'text', section_index: 'int',
      area: 'text', title: 'text', detail: 'text', status: 'text', priority: 'text',
      effort: 'text', owner_id: 'text', tags: 'jsonb', source_status: 'text',
      position: 'int', created: 'timestamptz', updated: 'timestamptz', completed_at: 'timestamptz',
    },
    indexes: [['project_id'], ['status'], ['section_index'], ['position'], ['updated']],
  },
  placements: {
    pk: 'id',
    columns: {
      id: 'text', project_id: 'text', workspace_id: 'text', feature_id: 'text',
      stage: 'text', position: 'int', added_by: 'text', added_at: 'timestamptz', meta: 'jsonb',
    },
    indexes: [['project_id'], ['workspace_id'], ['feature_id'], ['stage']],
  },
  comments: {
    pk: 'id',
    columns: { id: 'text', project_id: 'text', subject_type: 'text', subject_id: 'text', author_id: 'text', author_name: 'text', body: 'text', created: 'timestamptz' },
    indexes: [['project_id'], ['subject_id']],
  },
  activity: {
    pk: 'id',
    columns: { id: 'text', project_id: 'text', actor_id: 'text', actor_name: 'text', verb: 'text', subject_type: 'text', subject_id: 'text', subject_label: 'text', meta: 'jsonb', created: 'timestamptz' },
    indexes: [['project_id'], ['created']],
  },
  invites: {
    pk: 'id',
    columns: { id: 'text', token: 'text', project_id: 'text', email: 'text', role: 'text', created_by: 'text', created: 'timestamptz', expires: 'timestamptz', used_by: 'text', used_at: 'timestamptz' },
    indexes: [['token'], ['project_id']],
  },
};

/** Feature lifecycle used everywhere (board columns are per-workspace stages). */
export const FEATURE_STATUSES = ['backlog', 'planned', 'in_progress', 'review', 'shipped', 'parked'];
export const STATUS_LABEL = { backlog: 'Backlog', planned: 'Planned', in_progress: 'In progress', review: 'In review', shipped: 'Shipped', parked: 'Parked' };
export const PRIORITIES = ['critical', 'high', 'medium', 'low'];
export const EFFORTS = ['xs', 's', 'm', 'l', 'xl'];

/** Default board stages; a workspace can override them in settings.stages. */
export const DEFAULT_STAGES = [
  { id: 'backlog', label: 'Backlog', color: '#8b93a7' },
  { id: 'next', label: 'Up next', color: '#2fbcc7' },
  { id: 'doing', label: 'In progress', color: '#e87b29' },
  { id: 'review', label: 'Review', color: '#7c5cff' },
  { id: 'done', label: 'Done', color: '#0a7d5c' },
];

export const WORKSPACE_KINDS = ['board', 'list', 'roadmap'];

/** Workspaces every new project starts with (the demos the product promises). */
export const STARTER_WORKSPACES = [
  { name: 'MVP features', purpose: 'The smallest set that proves the core loop end-to-end.', kind: 'board', color: '#e87b29', icon: '🚀', wip_limit: 6 },
  { name: 'Next release', purpose: 'Committed for the release after MVP.', kind: 'board', color: '#2fbcc7', icon: '🧭' },
  { name: 'Ideas / icebox', purpose: 'Parked ideas — revisit at planning.', kind: 'list', color: '#7c5cff', icon: '🧊' },
];
