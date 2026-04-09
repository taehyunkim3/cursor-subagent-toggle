'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const vscode = require('vscode');

const GLOBAL_COMMAND = 'bash hooks/block-subagent.sh';
const PROJECT_COMMAND = 'bash .cursor/hooks/block-subagent.sh';
const BLOCKER_SCRIPT = `#!/bin/bash

# Return a deny decision for Cursor's subagent hook.
echo '{"decision": "deny", "permission": "deny"}'

# Exit code 2 force-stops the subagent creation flow.
echo "Subagent creation is BLOCKED by Cursor Subagent Toggle." >&2
exit 2
`;

const STATUS_META = {
  enabled: { icon: '🟢', label: 'ON' },
  blocked: { icon: '🔴', label: 'OFF' },
  mixed: { icon: '🟡', label: 'MIXED' },
  unknown: { icon: '⚪', label: 'CHECK' },
  error: { icon: '🟠', label: 'ERROR' }
};

function activate(context) {
  const controller = new SubagentStatusController(context);
  context.subscriptions.push(controller);
  return controller.activate();
}

function deactivate() {}

class SubagentStatusController {
  constructor(context) {
    this.context = context;
    this.statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
    this.statusBar.name = 'Cursor Subagent Toggle';
    this.statusBar.command = 'cursorSubagentToggle.showActions';
    this.snapshot = null;
    this.globalWatchTargets = [];
    this.refreshTimer = undefined;
  }

  async activate() {
    this.context.subscriptions.push(this.statusBar);
    this.registerCommands();
    this.registerWorkspaceWatchers();
    this.registerGlobalWatchers();
    await this.refresh();
  }

  dispose() {
    this.clearScheduledRefresh();
    for (const target of this.globalWatchTargets) {
      fs.unwatchFile(target, this.handleGlobalWatchChange);
    }
    this.globalWatchTargets = [];
  }

  registerCommands() {
    const subscriptions = [
      vscode.commands.registerCommand('cursorSubagentToggle.showActions', () => this.showActions()),
      vscode.commands.registerCommand('cursorSubagentToggle.toggleGlobal', () => this.toggleGlobal()),
      vscode.commands.registerCommand('cursorSubagentToggle.toggleCurrentWorkspaceFolder', () => this.toggleCurrentWorkspaceFolder()),
      vscode.commands.registerCommand('cursorSubagentToggle.toggleWorkspaceFolder', () => this.toggleWorkspaceFolder()),
      vscode.commands.registerCommand('cursorSubagentToggle.refresh', () => this.refresh(true))
    ];

    this.context.subscriptions.push(...subscriptions);
  }

  registerWorkspaceWatchers() {
    const hookWatcher = vscode.workspace.createFileSystemWatcher('**/.cursor/hooks.json');
    const scriptWatcher = vscode.workspace.createFileSystemWatcher('**/.cursor/hooks/block-subagent.sh');

    const triggerRefresh = () => this.scheduleRefresh();
    hookWatcher.onDidCreate(triggerRefresh, this, this.context.subscriptions);
    hookWatcher.onDidChange(triggerRefresh, this, this.context.subscriptions);
    hookWatcher.onDidDelete(triggerRefresh, this, this.context.subscriptions);
    scriptWatcher.onDidCreate(triggerRefresh, this, this.context.subscriptions);
    scriptWatcher.onDidChange(triggerRefresh, this, this.context.subscriptions);
    scriptWatcher.onDidDelete(triggerRefresh, this, this.context.subscriptions);

    this.context.subscriptions.push(
      hookWatcher,
      scriptWatcher,
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.refresh()),
      vscode.window.onDidChangeActiveTextEditor(() => this.renderStatusBar())
    );
  }

  registerGlobalWatchers() {
    const targets = [getGlobalHooksJsonPath(), getGlobalScriptPath()];
    this.handleGlobalWatchChange = () => this.scheduleRefresh();

    for (const target of targets) {
      fs.watchFile(target, { interval: 1000 }, this.handleGlobalWatchChange);
    }

    this.globalWatchTargets = targets;
  }

  scheduleRefresh() {
    this.clearScheduledRefresh();
    this.refreshTimer = setTimeout(() => {
      this.refresh().catch((error) => this.showError(error));
    }, 200);
  }

  clearScheduledRefresh() {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = undefined;
    }
  }

  async refresh(notifyOnError = false) {
    try {
      this.snapshot = await buildSnapshot();
      this.renderStatusBar();
    } catch (error) {
      this.snapshot = buildErrorSnapshot(error);
      this.renderStatusBar();
      if (notifyOnError) {
        this.showError(error);
      }
    }
  }

  renderStatusBar() {
    const snapshot = this.snapshot || buildErrorSnapshot(new Error('Status is not ready yet.'));
    const activeWorkspaceState = getActiveWorkspaceState(snapshot.workspaceStates);
    const statusSource = activeWorkspaceState || snapshot.aggregate;
    const meta = STATUS_META[statusSource.status] || STATUS_META.unknown;

    if (activeWorkspaceState && snapshot.workspaceStates.length > 1) {
      this.statusBar.text = `${meta.icon} Subagent ${truncateLabel(activeWorkspaceState.folder.name)} ${meta.label}`;
    } else {
      this.statusBar.text = `${meta.icon} Subagent ${meta.label}`;
    }

    this.statusBar.tooltip = buildTooltip(snapshot, activeWorkspaceState);
    this.statusBar.show();
  }

  async showActions() {
    await this.refresh();

    const snapshot = this.snapshot;
    const picks = [];
    const global = snapshot.globalScope;
    picks.push({
      label: global.status === 'blocked' ? '🟢 Global: enable subagent everywhere' : '🔴 Global: disable subagent everywhere',
      detail: `${formatShortPath(global.hooksJsonPath)}`
    });

    const activeWorkspaceState = getActiveWorkspaceState(snapshot.workspaceStates);
    if (activeWorkspaceState) {
      const localMeta = STATUS_META[activeWorkspaceState.local.status] || STATUS_META.unknown;
      picks.push({
        label: activeWorkspaceState.local.status === 'blocked'
          ? `🟢 Folder: enable ${activeWorkspaceState.folder.name}`
          : `🔴 Folder: disable ${activeWorkspaceState.folder.name}`,
        detail: `${localMeta.icon} local ${localMeta.label} at ${formatShortPath(activeWorkspaceState.local.hooksJsonPath)}`
      });
    }

    if (snapshot.workspaceStates.length > 1) {
      picks.push({
        label: '📁 Folder: choose another workspace folder',
        detail: 'Toggle the blocker for one specific folder in this multi-root workspace.'
      });
    }

    picks.push({
      label: '🔄 Refresh status',
      detail: 'Re-scan global and workspace hook files.'
    });

    const choice = await vscode.window.showQuickPick(picks, {
      title: 'Cursor Subagent Toggle',
      placeHolder: 'Choose which scope to toggle.'
    });

    if (!choice) {
      return;
    }

    if (choice.label.startsWith('🟢 Global') || choice.label.startsWith('🔴 Global')) {
      await this.toggleGlobal();
      return;
    }

    if (choice.label.startsWith('🟢 Folder') || choice.label.startsWith('🔴 Folder')) {
      await this.toggleWorkspaceState(activeWorkspaceState);
      return;
    }

    if (choice.label.startsWith('📁')) {
      await this.toggleWorkspaceFolder();
      return;
    }

    await this.refresh(true);
  }

  async toggleGlobal() {
    const global = this.snapshot ? this.snapshot.globalScope : await inspectGlobalScope();
    await setManagedBlock(global, global.status !== 'blocked');
    await this.refresh(true);

    const nextGlobal = this.snapshot.globalScope;
    const meta = STATUS_META[nextGlobal.status] || STATUS_META.unknown;
    vscode.window.showInformationMessage(`Global subagent status: ${meta.icon} ${meta.label}`);
  }

  async toggleCurrentWorkspaceFolder() {
    await this.refresh();
    const activeWorkspaceState = getActiveWorkspaceState(this.snapshot.workspaceStates);

    if (!activeWorkspaceState) {
      vscode.window.showWarningMessage('No active workspace folder was found to toggle.');
      return;
    }

    await this.toggleWorkspaceState(activeWorkspaceState);
  }

  async toggleWorkspaceFolder() {
    await this.refresh();

    if (!this.snapshot.workspaceStates.length) {
      vscode.window.showWarningMessage('This window does not have any workspace folders.');
      return;
    }

    const picked = await pickWorkspaceState(this.snapshot.workspaceStates);
    if (!picked) {
      return;
    }

    await this.toggleWorkspaceState(picked);
  }

  async toggleWorkspaceState(workspaceState) {
    await setManagedBlock(workspaceState.local, workspaceState.local.status !== 'blocked');
    await this.refresh(true);

    const updatedState = this.snapshot.workspaceStates.find((item) => item.folder.uri.toString() === workspaceState.folder.uri.toString());
    if (!updatedState) {
      return;
    }

    const effectiveMeta = STATUS_META[updatedState.status] || STATUS_META.unknown;
    vscode.window.showInformationMessage(`${updatedState.folder.name}: ${effectiveMeta.icon} ${effectiveMeta.label}`);
  }

  showError(error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`Cursor Subagent Toggle: ${message}`);
  }
}

async function buildSnapshot() {
  const globalScope = await inspectGlobalScope();
  const folders = vscode.workspace.workspaceFolders || [];
  const locals = await Promise.all(folders.map((folder) => inspectProjectScope(folder)));
  const workspaceStates = locals.map((local) => buildWorkspaceState(globalScope, local));

  return {
    globalScope,
    workspaceStates,
    aggregate: summarizeWorkspaceState(globalScope, workspaceStates)
  };
}

function buildErrorSnapshot(error) {
  const reason = error instanceof Error ? error.message : String(error);
  return {
    globalScope: {
      type: 'global',
      name: 'Global',
      status: 'error',
      reason,
      hooksJsonPath: getGlobalHooksJsonPath(),
      scriptPath: getGlobalScriptPath()
    },
    workspaceStates: [],
    aggregate: {
      status: 'error',
      reason
    }
  };
}

async function inspectGlobalScope() {
  return inspectScope({
    type: 'global',
    name: 'Global',
    baseDir: getGlobalCursorDir(),
    hooksJsonPath: getGlobalHooksJsonPath(),
    scriptPath: getGlobalScriptPath(),
    managedCommand: GLOBAL_COMMAND
  });
}

async function inspectProjectScope(folder) {
  const baseDir = folder.uri.fsPath;
  return inspectScope({
    type: 'project',
    name: folder.name,
    folder,
    baseDir,
    hooksJsonPath: path.join(baseDir, '.cursor', 'hooks.json'),
    scriptPath: path.join(baseDir, '.cursor', 'hooks', 'block-subagent.sh'),
    managedCommand: PROJECT_COMMAND
  });
}

async function inspectScope(scope) {
  const configState = await readJsonFile(scope.hooksJsonPath);
  const scriptState = await readScriptFile(scope.scriptPath);
  const base = {
    ...scope,
    configExists: configState.exists,
    scriptExists: scriptState.exists,
    scriptLooksLikeBlocker: scriptState.looksLikeBlocker
  };

  if (configState.error) {
    return {
      ...base,
      status: 'error',
      reason: `Invalid JSON in ${formatShortPath(scope.hooksJsonPath)}`
    };
  }

  const hooksRoot = configState.data && typeof configState.data === 'object' ? configState.data.hooks : undefined;
  const subagentHooks = hooksRoot ? hooksRoot.subagentStart : undefined;

  if (subagentHooks !== undefined && !Array.isArray(subagentHooks)) {
    return {
      ...base,
      status: 'error',
      reason: `subagentStart must be an array in ${formatShortPath(scope.hooksJsonPath)}`
    };
  }

  const hookEntries = Array.isArray(subagentHooks) ? subagentHooks : [];
  const commandEntries = hookEntries.map((entry, index) => ({
    index,
    command: entry && typeof entry === 'object' && typeof entry.command === 'string' ? entry.command : undefined
  }));

  const managedIndex = commandEntries.findIndex((entry) => entry.command === scope.managedCommand);
  const hasAnySubagentHooks = hookEntries.length > 0;
  const hasCustomCommands = commandEntries.some((entry) => entry.command && entry.command !== scope.managedCommand);
  const hasInvalidEntries = hookEntries.some((entry) => !entry || typeof entry !== 'object' || typeof entry.command !== 'string');

  if (managedIndex === 0) {
    if (!scriptState.exists) {
      return {
        ...base,
        status: 'error',
        reason: `Managed blocker is configured, but ${formatShortPath(scope.scriptPath)} is missing`
      };
    }

    if (!scriptState.looksLikeBlocker) {
      return {
        ...base,
        status: 'unknown',
        reason: `Managed blocker command exists, but ${formatShortPath(scope.scriptPath)} no longer matches the expected deny helper`
      };
    }

    return {
      ...base,
      status: 'blocked',
      reason: 'Managed blocker is active'
    };
  }

  if (managedIndex > 0) {
    return {
      ...base,
      status: 'unknown',
      reason: 'Managed blocker exists, but it is not the first subagentStart hook'
    };
  }

  if (hasInvalidEntries) {
    return {
      ...base,
      status: 'unknown',
      reason: 'subagentStart contains unsupported entries that cannot be evaluated safely'
    };
  }

  if (hasCustomCommands || hasAnySubagentHooks) {
    return {
      ...base,
      status: 'unknown',
      reason: 'Custom subagentStart hooks exist, so the final allow/deny result cannot be inferred safely'
    };
  }

  return {
    ...base,
    status: 'enabled',
    reason: 'No blocking hook is configured'
  };
}

function buildWorkspaceState(globalScope, localScope) {
  const folder = localScope.folder;
  const blockers = [];
  const uncertainScopes = [];
  const brokenScopes = [];

  if (globalScope.status === 'blocked') {
    blockers.push('global');
  } else if (globalScope.status === 'error') {
    brokenScopes.push('global');
  } else if (globalScope.status === 'unknown') {
    uncertainScopes.push('global');
  }

  if (localScope.status === 'blocked') {
    blockers.push('folder');
  } else if (localScope.status === 'error') {
    brokenScopes.push('folder');
  } else if (localScope.status === 'unknown') {
    uncertainScopes.push('folder');
  }

  if (blockers.length > 0) {
    return {
      folder,
      local: localScope,
      global: globalScope,
      status: 'blocked',
      reason: blockers.length === 2 ? 'Blocked by global and folder scopes' : `Blocked by ${blockers[0]} scope`
    };
  }

  if (brokenScopes.length > 0) {
    return {
      folder,
      local: localScope,
      global: globalScope,
      status: 'error',
      reason: `Cannot confirm final state because ${brokenScopes.join(' and ')} scope is misconfigured`
    };
  }

  if (uncertainScopes.length > 0) {
    return {
      folder,
      local: localScope,
      global: globalScope,
      status: 'unknown',
      reason: `Cannot confirm final state because ${uncertainScopes.join(' and ')} scope has custom or ambiguous hooks`
    };
  }

  return {
    folder,
    local: localScope,
    global: globalScope,
    status: 'enabled',
    reason: 'Subagent is allowed in this folder'
  };
}

function summarizeWorkspaceState(globalScope, workspaceStates) {
  if (!workspaceStates.length) {
    return {
      status: globalScope.status,
      reason: globalScope.reason
    };
  }

  const statuses = workspaceStates.map((state) => state.status);
  const unique = new Set(statuses);

  if (unique.size === 1) {
    return {
      status: statuses[0],
      reason: workspaceStates[0].reason
    };
  }

  if (unique.size === 2 && unique.has('enabled') && unique.has('blocked')) {
    return {
      status: 'mixed',
      reason: 'Different workspace folders resolve to different final states'
    };
  }

  if (unique.has('error')) {
    return {
      status: 'error',
      reason: 'At least one workspace folder is misconfigured'
    };
  }

  return {
    status: 'unknown',
    reason: 'Workspace folders do not resolve to a single clear result'
  };
}

async function setManagedBlock(scope, shouldBlock) {
  const configState = await readJsonFile(scope.hooksJsonPath);
  if (configState.error) {
    throw new Error(`Fix invalid JSON first: ${formatShortPath(scope.hooksJsonPath)}`);
  }

  if (configState.data && typeof configState.data === 'object' && configState.data.hooks !== undefined) {
    if (!configState.data.hooks || typeof configState.data.hooks !== 'object' || Array.isArray(configState.data.hooks)) {
      throw new Error(`Fix invalid hooks object first: ${formatShortPath(scope.hooksJsonPath)}`);
    }

    if (configState.data.hooks.subagentStart !== undefined && !Array.isArray(configState.data.hooks.subagentStart)) {
      throw new Error(`Fix invalid subagentStart first: ${formatShortPath(scope.hooksJsonPath)}`);
    }
  }

  const data = normalizeHooksConfig(configState.data);
  const existing = Array.isArray(data.hooks.subagentStart) ? [...data.hooks.subagentStart] : [];
  const withoutManaged = existing.filter((entry) => !(entry && typeof entry === 'object' && entry.command === scope.managedCommand));

  if (shouldBlock) {
    withoutManaged.unshift({ command: scope.managedCommand });
    await ensureManagedScript(scope.scriptPath);
  }

  if (withoutManaged.length > 0) {
    data.hooks.subagentStart = withoutManaged;
  } else {
    delete data.hooks.subagentStart;
  }

  await fsp.mkdir(path.dirname(scope.hooksJsonPath), { recursive: true });
  await fsp.writeFile(scope.hooksJsonPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function normalizeHooksConfig(input) {
  const base = input && typeof input === 'object' && !Array.isArray(input) ? { ...input } : {};
  const hooks = base.hooks && typeof base.hooks === 'object' && !Array.isArray(base.hooks) ? { ...base.hooks } : {};

  return {
    ...base,
    version: typeof base.version === 'number' ? base.version : 1,
    hooks
  };
}

async function ensureManagedScript(scriptPath) {
  await fsp.mkdir(path.dirname(scriptPath), { recursive: true });
  await fsp.writeFile(scriptPath, BLOCKER_SCRIPT, 'utf8');
  await fsp.chmod(scriptPath, 0o755);
}

async function readJsonFile(filePath) {
  try {
    const raw = await fsp.readFile(filePath, 'utf8');
    return {
      exists: true,
      data: JSON.parse(raw)
    };
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return {
        exists: false,
        data: undefined
      };
    }

    if (error instanceof SyntaxError) {
      return {
        exists: true,
        data: undefined,
        error
      };
    }

    throw error;
  }
}

async function readScriptFile(filePath) {
  try {
    const raw = await fsp.readFile(filePath, 'utf8');
    const normalized = raw.replace(/\r\n/g, '\n');
    return {
      exists: true,
      looksLikeBlocker: normalized.includes('"decision": "deny"')
        && normalized.includes('"permission": "deny"')
        && normalized.includes('exit 2')
    };
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return {
        exists: false,
        looksLikeBlocker: false
      };
    }

    throw error;
  }
}

function getActiveWorkspaceState(workspaceStates) {
  if (!workspaceStates.length) {
    return undefined;
  }

  if (workspaceStates.length === 1) {
    return workspaceStates[0];
  }

  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return undefined;
  }

  const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
  if (!folder) {
    return undefined;
  }

  return workspaceStates.find((state) => state.folder.uri.toString() === folder.uri.toString());
}

async function pickWorkspaceState(workspaceStates) {
  const picks = workspaceStates.map((state) => {
    const effectiveMeta = STATUS_META[state.status] || STATUS_META.unknown;
    const localMeta = STATUS_META[state.local.status] || STATUS_META.unknown;
    return {
      label: `${effectiveMeta.icon} ${state.folder.name}`,
      description: `effective ${effectiveMeta.label} / local ${localMeta.label}`,
      detail: state.reason,
      state
    };
  });

  const choice = await vscode.window.showQuickPick(picks, {
    title: 'Choose a workspace folder',
    placeHolder: 'Toggle the blocker in one workspace folder.'
  });

  return choice ? choice.state : undefined;
}

function buildTooltip(snapshot, activeWorkspaceState) {
  const lines = [];
  lines.push('**Cursor Subagent Toggle**');
  lines.push('');
  lines.push(`Global: ${formatStatusLine(snapshot.globalScope.status)} ${snapshot.globalScope.reason}`);
  lines.push(`Path: \`${formatShortPath(snapshot.globalScope.hooksJsonPath)}\``);

  if (!snapshot.workspaceStates.length) {
    lines.push('');
    lines.push('Workspace: no folders are open in this window.');
    return new vscode.MarkdownString(lines.join('\n'));
  }

  lines.push('');
  lines.push('Workspace folders:');

  for (const state of snapshot.workspaceStates) {
    const prefix = activeWorkspaceState && activeWorkspaceState.folder.uri.toString() === state.folder.uri.toString() ? 'current' : 'folder';
    lines.push(`- ${prefix} \`${state.folder.name}\`: ${formatStatusLine(state.status)} ${state.reason}`);
    lines.push(`  local ${formatStatusLine(state.local.status)} / global ${formatStatusLine(state.global.status)}`);
    lines.push(`  path \`${formatShortPath(state.local.hooksJsonPath)}\``);
  }

  lines.push('');
  lines.push('Only the managed blocker helper is treated as a definite OFF state. Custom subagentStart hooks are shown as CHECK.');
  return new vscode.MarkdownString(lines.join('\n'));
}

function formatStatusLine(status) {
  const meta = STATUS_META[status] || STATUS_META.unknown;
  return `${meta.icon} ${meta.label}`;
}

function truncateLabel(label) {
  return label.length > 18 ? `${label.slice(0, 15)}...` : label;
}

function formatShortPath(targetPath) {
  const home = os.homedir();
  if (targetPath.startsWith(home)) {
    return `~${targetPath.slice(home.length)}`;
  }

  return targetPath;
}

function getGlobalCursorDir() {
  return path.join(os.homedir(), '.cursor');
}

function getGlobalHooksJsonPath() {
  return path.join(getGlobalCursorDir(), 'hooks.json');
}

function getGlobalScriptPath() {
  return path.join(getGlobalCursorDir(), 'hooks', 'block-subagent.sh');
}

module.exports = {
  activate,
  deactivate
};
