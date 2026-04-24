"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MANAGED_GITIGNORE_END = exports.HOOKS_JSON_GITIGNORE_START = exports.HOOKS_JSON_GITIGNORE_ENTRY = exports.MANAGED_GITIGNORE_START = exports.MANAGED_GITIGNORE_ENTRIES = exports.MANAGED_TASK_SCRIPT_GITIGNORE_ENTRY = exports.MANAGED_SCRIPT_GITIGNORE_ENTRY = exports.MANAGED_RULE_GITIGNORE_ENTRY = exports.MANAGED_RULE_FILE_NAME = void 0;
exports.normalizeHooksConfig = normalizeHooksConfig;
exports.normalizeLineEndings = normalizeLineEndings;
exports.parseGitignoreState = parseGitignoreState;
exports.removeManagedGitignoreBlock = removeManagedGitignoreBlock;
exports.removeGitignoreBlock = removeGitignoreBlock;
exports.isObject = isObject;
exports.isCommandEntry = isCommandEntry;
exports.isTaskPreToolUseEntry = isTaskPreToolUseEntry;
exports.MANAGED_RULE_FILE_NAME = 'cursor-subagent-toggle.mdc';
exports.MANAGED_RULE_GITIGNORE_ENTRY = `.cursor/rules/${exports.MANAGED_RULE_FILE_NAME}`;
exports.MANAGED_SCRIPT_GITIGNORE_ENTRY = '.cursor/hooks/block-subagent.sh';
exports.MANAGED_TASK_SCRIPT_GITIGNORE_ENTRY = '.cursor/hooks/block-task-tool.sh';
exports.MANAGED_GITIGNORE_ENTRIES = [
    exports.MANAGED_SCRIPT_GITIGNORE_ENTRY,
    exports.MANAGED_TASK_SCRIPT_GITIGNORE_ENTRY,
    exports.MANAGED_RULE_GITIGNORE_ENTRY
];
exports.MANAGED_GITIGNORE_START = '# Cursor Subagent Toggle: managed generated files';
exports.HOOKS_JSON_GITIGNORE_ENTRY = '.cursor/hooks.json';
exports.HOOKS_JSON_GITIGNORE_START = '# Cursor Subagent Toggle: hooks config ignore';
exports.MANAGED_GITIGNORE_END = '# End Cursor Subagent Toggle';
function normalizeHooksConfig(input) {
    const base = isObject(input) ? { ...input } : {};
    const hooks = isObject(base.hooks) ? { ...base.hooks } : {};
    return {
        ...base,
        version: typeof base.version === 'number' ? base.version : 1,
        hooks
    };
}
function normalizeLineEndings(value) {
    return value.replace(/\r\n/g, '\n');
}
function parseGitignoreState(raw) {
    const lines = normalizeLineEndings(raw).split('\n').map((line) => line.trim());
    const hasManagedRuleEntry = lines.includes(exports.MANAGED_RULE_GITIGNORE_ENTRY);
    const hasManagedScriptEntry = lines.includes(exports.MANAGED_SCRIPT_GITIGNORE_ENTRY);
    const hasManagedTaskScriptEntry = lines.includes(exports.MANAGED_TASK_SCRIPT_GITIGNORE_ENTRY);
    const hasHooksJsonEntry = lines.includes(exports.HOOKS_JSON_GITIGNORE_ENTRY);
    return {
        hasManagedRuleEntry,
        hasManagedScriptEntry,
        hasManagedTaskScriptEntry,
        hasAllManagedEntries: hasManagedRuleEntry && hasManagedScriptEntry && hasManagedTaskScriptEntry,
        hasManagedBlock: lines.includes(exports.MANAGED_GITIGNORE_START) && lines.includes(exports.MANAGED_GITIGNORE_END),
        hasHooksJsonEntry,
        hasHooksJsonBlock: lines.includes(exports.HOOKS_JSON_GITIGNORE_START) && lines.includes(exports.MANAGED_GITIGNORE_END)
    };
}
function removeManagedGitignoreBlock(raw) {
    return removeGitignoreBlock(raw, exports.MANAGED_GITIGNORE_START);
}
function removeGitignoreBlock(raw, startMarker) {
    const normalized = normalizeLineEndings(raw);
    const lines = normalized.split('\n');
    const nextLines = [];
    let isInsideManagedBlock = false;
    let removed = false;
    for (const line of lines) {
        if (line.trim() === startMarker) {
            isInsideManagedBlock = true;
            removed = true;
            continue;
        }
        if (isInsideManagedBlock) {
            if (line.trim() === exports.MANAGED_GITIGNORE_END) {
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
function isObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function isCommandEntry(value) {
    return isObject(value) && typeof value.command === 'string';
}
function isTaskPreToolUseEntry(entry) {
    return entry.matcher === undefined || entry.matcher === 'Task';
}
function trimTrailingBlankLines(lines) {
    const next = [...lines];
    while (next.length > 0 && next[next.length - 1] === '') {
        next.pop();
    }
    return next.length > 0 ? [...next, ''] : [];
}
