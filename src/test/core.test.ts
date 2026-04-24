import { describe, expect, it } from 'vitest';
import {
  HOOKS_JSON_GITIGNORE_START,
  MANAGED_GITIGNORE_END,
  MANAGED_GITIGNORE_START,
  isCommandEntry,
  isTaskPreToolUseEntry,
  normalizeHooksConfig,
  parseGitignoreState,
  removeGitignoreBlock,
  removeManagedGitignoreBlock
} from '../core';

describe('normalizeHooksConfig', () => {
  it('creates a default hooks config when input is missing', () => {
    expect(normalizeHooksConfig(undefined)).toEqual({
      version: 1,
      hooks: {}
    });
  });

  it('preserves existing config fields and valid hooks object', () => {
    expect(normalizeHooksConfig({ version: 2, hooks: { sessionStart: [] }, custom: true })).toEqual({
      version: 2,
      hooks: { sessionStart: [] },
      custom: true
    });
  });

  it('replaces invalid hooks with an empty object', () => {
    expect(normalizeHooksConfig({ version: 1, hooks: [] })).toEqual({
      version: 1,
      hooks: {}
    });
  });
});

describe('gitignore helpers', () => {
  it('detects managed generated files and hooks.json entries', () => {
    const state = parseGitignoreState(`
${MANAGED_GITIGNORE_START}
.cursor/hooks/block-subagent.sh
.cursor/hooks/block-task-tool.sh
.cursor/rules/cursor-subagent-toggle.mdc
${MANAGED_GITIGNORE_END}
${HOOKS_JSON_GITIGNORE_START}
.cursor/hooks.json
${MANAGED_GITIGNORE_END}
`);

    expect(state).toMatchObject({
      hasAllManagedEntries: true,
      hasManagedBlock: true,
      hasHooksJsonEntry: true,
      hasHooksJsonBlock: true
    });
  });

  it('removes only the requested managed block', () => {
    const raw = `dist\n\n${MANAGED_GITIGNORE_START}\n.cursor/hooks/block-subagent.sh\n${MANAGED_GITIGNORE_END}\n\n.keep\n`;

    expect(removeManagedGitignoreBlock(raw)).toBe('dist\n\n.keep\n');
  });

  it('leaves user-defined ignore entries outside marker blocks intact', () => {
    const raw = `.cursor/hooks/block-subagent.sh\n${HOOKS_JSON_GITIGNORE_START}\n.cursor/hooks.json\n${MANAGED_GITIGNORE_END}\n`;

    expect(removeGitignoreBlock(raw, HOOKS_JSON_GITIGNORE_START)).toBe('.cursor/hooks/block-subagent.sh\n');
  });
});

describe('hook entry helpers', () => {
  it('recognizes command hook entries', () => {
    expect(isCommandEntry({ command: 'bash hook.sh' })).toBe(true);
    expect(isCommandEntry({ matcher: 'Task' })).toBe(false);
  });

  it('treats missing matcher as Task-relevant because Cursor may apply it broadly', () => {
    expect(isTaskPreToolUseEntry({ command: 'bash hook.sh' })).toBe(true);
    expect(isTaskPreToolUseEntry({ command: 'bash hook.sh', matcher: 'Task' })).toBe(true);
    expect(isTaskPreToolUseEntry({ command: 'bash hook.sh', matcher: 'Read' })).toBe(false);
  });
});
