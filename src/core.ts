export const MANAGED_RULE_FILE_NAME = 'cursor-subagent-toggle.mdc';
export const MANAGED_RULE_GITIGNORE_ENTRY = `.cursor/rules/${MANAGED_RULE_FILE_NAME}`;
export const MANAGED_SCRIPT_GITIGNORE_ENTRY = '.cursor/hooks/block-subagent.sh';
export const MANAGED_TASK_SCRIPT_GITIGNORE_ENTRY = '.cursor/hooks/block-task-tool.sh';
export const MANAGED_GITIGNORE_ENTRIES = [
  MANAGED_SCRIPT_GITIGNORE_ENTRY,
  MANAGED_TASK_SCRIPT_GITIGNORE_ENTRY,
  MANAGED_RULE_GITIGNORE_ENTRY
];
export const MANAGED_GITIGNORE_START = '# Cursor Subagent Toggle: managed generated files';
export const HOOKS_JSON_GITIGNORE_ENTRY = '.cursor/hooks.json';
export const HOOKS_JSON_GITIGNORE_START = '# Cursor Subagent Toggle: hooks config ignore';
export const MANAGED_GITIGNORE_END = '# End Cursor Subagent Toggle';

export interface GitignoreFileResult {
  exists: boolean;
  hasManagedRuleEntry: boolean;
  hasManagedScriptEntry: boolean;
  hasManagedTaskScriptEntry: boolean;
  hasAllManagedEntries: boolean;
  hasManagedBlock: boolean;
  hasHooksJsonEntry: boolean;
  hasHooksJsonBlock: boolean;
}

export interface HooksCommandEntry {
  command: string;
  [key: string]: unknown;
}

export interface HooksConfig {
  version: number;
  hooks: Record<string, unknown> & {
    preToolUse?: HooksCommandEntry[];
    subagentStart?: HooksCommandEntry[];
  };
  [key: string]: unknown;
}

export function normalizeHooksConfig(input: unknown): HooksConfig {
  const base = isObject(input) ? { ...input } : {};
  const hooks = isObject(base.hooks) ? { ...base.hooks } : {};

  return {
    ...base,
    version: typeof base.version === 'number' ? base.version : 1,
    hooks
  } as HooksConfig;
}

export function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n/g, '\n');
}

export function parseGitignoreState(raw: string): Omit<GitignoreFileResult, 'exists'> {
  const lines = normalizeLineEndings(raw).split('\n').map((line) => line.trim());
  const hasManagedRuleEntry = lines.includes(MANAGED_RULE_GITIGNORE_ENTRY);
  const hasManagedScriptEntry = lines.includes(MANAGED_SCRIPT_GITIGNORE_ENTRY);
  const hasManagedTaskScriptEntry = lines.includes(MANAGED_TASK_SCRIPT_GITIGNORE_ENTRY);
  const hasHooksJsonEntry = lines.includes(HOOKS_JSON_GITIGNORE_ENTRY);

  return {
    hasManagedRuleEntry,
    hasManagedScriptEntry,
    hasManagedTaskScriptEntry,
    hasAllManagedEntries: hasManagedRuleEntry && hasManagedScriptEntry && hasManagedTaskScriptEntry,
    hasManagedBlock: lines.includes(MANAGED_GITIGNORE_START) && lines.includes(MANAGED_GITIGNORE_END),
    hasHooksJsonEntry,
    hasHooksJsonBlock: lines.includes(HOOKS_JSON_GITIGNORE_START) && lines.includes(MANAGED_GITIGNORE_END)
  };
}

export function removeManagedGitignoreBlock(raw: string): string {
  return removeGitignoreBlock(raw, MANAGED_GITIGNORE_START);
}

export function removeGitignoreBlock(raw: string, startMarker: string): string {
  const normalized = normalizeLineEndings(raw);
  const lines = normalized.split('\n');
  const nextLines: string[] = [];
  let isInsideManagedBlock = false;
  let removed = false;

  for (const line of lines) {
    if (line.trim() === startMarker) {
      isInsideManagedBlock = true;
      removed = true;
      continue;
    }

    if (isInsideManagedBlock) {
      if (line.trim() === MANAGED_GITIGNORE_END) {
        isInsideManagedBlock = false;
      }
      continue;
    }

    nextLines.push(line);
  }

  if (!removed) {
    return raw;
  }

  return trimTrailingBlankLines(nextLines).join('\n').replace(/\n{3,}/g, '\n\n');
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isCommandEntry(value: unknown): value is HooksCommandEntry {
  return isObject(value) && typeof value.command === 'string';
}

export function isTaskPreToolUseEntry(entry: HooksCommandEntry): boolean {
  return entry.matcher === undefined || entry.matcher === 'Task';
}

function trimTrailingBlankLines(lines: string[]): string[] {
  const next = [...lines];
  while (next.length > 0 && next[next.length - 1] === '') {
    next.pop();
  }

  return next.length > 0 ? [...next, ''] : [];
}
