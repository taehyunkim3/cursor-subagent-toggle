import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

const GLOBAL_COMMAND = 'bash hooks/block-subagent.sh';
const PROJECT_COMMAND = 'bash .cursor/hooks/block-subagent.sh';
const APPLY_RECOMMENDED_LABEL = 'Apply Recommended Config';
const BLOCKER_SCRIPT = `#!/bin/bash

# Return a deny decision for Cursor's subagent hook.
echo '{"decision": "deny", "permission": "deny"}'

# Exit code 2 force-stops the subagent creation flow.
echo "Subagent creation is BLOCKED by Cursor Subagent Toggle." >&2
exit 2
`;

type StatusKind = 'enabled' | 'blocked' | 'mixed' | 'unknown' | 'error';

type ScopeType = 'global' | 'project';

interface StatusMeta {
  icon: string;
  label: string;
}

interface AggregateState {
  status: StatusKind;
  reason: string;
}

interface JsonFileResult {
  exists: boolean;
  data?: unknown;
  error?: Error;
}

interface ScriptFileResult {
  exists: boolean;
  looksLikeBlocker: boolean;
}

interface HooksCommandEntry {
  command: string;
  [key: string]: unknown;
}

interface HooksConfig {
  version: number;
  hooks: Record<string, unknown> & {
    subagentStart?: HooksCommandEntry[];
  };
  [key: string]: unknown;
}

interface ScopeDescriptor {
  type: ScopeType;
  name: string;
  baseDir: string;
  hooksJsonPath: string;
  scriptPath: string;
  managedCommand: string;
  folder?: vscode.WorkspaceFolder;
}

interface ScopeState extends ScopeDescriptor {
  configExists: boolean;
  scriptExists: boolean;
  scriptLooksLikeBlocker: boolean;
  status: StatusKind;
  reason: string;
}

interface WorkspaceState {
  folder: vscode.WorkspaceFolder;
  local: ScopeState;
  global: ScopeState;
  status: StatusKind;
  reason: string;
}

interface Snapshot {
  globalScope: ScopeState;
  workspaceStates: WorkspaceState[];
  aggregate: AggregateState;
}

interface ScopeActionItem extends vscode.QuickPickItem {
  action:
    | 'toggleGlobal'
    | 'toggleCurrentWorkspace'
    | 'toggleWorkspaceFolder'
    | 'applyRecommendedGlobal'
    | 'applyRecommendedCurrentWorkspace'
    | 'applyRecommendedWorkspaceFolder'
    | 'refresh';
}

const STATUS_META: Record<StatusKind, StatusMeta> = {
  enabled: { icon: '🟢', label: 'ON' },
  blocked: { icon: '🔴', label: 'OFF' },
  mixed: { icon: '🟡', label: 'MIXED' },
  unknown: { icon: '⚪', label: 'CHECK' },
  error: { icon: '🟠', label: 'ERROR' }
};

export function activate(context: vscode.ExtensionContext): Thenable<void> {
  const controller = new SubagentStatusController(context);
  context.subscriptions.push(controller);
  return controller.activate();
}

export function deactivate(): void {}

class SubagentStatusController implements vscode.Disposable {
  private readonly context: vscode.ExtensionContext;
  private readonly statusBar: vscode.StatusBarItem;
  private snapshot: Snapshot | null = null;
  private globalWatchTargets: string[] = [];
  private refreshTimer: NodeJS.Timeout | undefined;
  private handleGlobalWatchChange?: () => void;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
    this.statusBar.name = 'Cursor Subagent Toggle';
    this.statusBar.command = 'cursorSubagentToggle.showActions';
  }

  async activate(): Promise<void> {
    this.context.subscriptions.push(this.statusBar);
    this.registerCommands();
    this.registerWorkspaceWatchers();
    this.registerGlobalWatchers();
    await this.refresh();
  }

  dispose(): void {
    this.clearScheduledRefresh();

    if (this.handleGlobalWatchChange) {
      for (const target of this.globalWatchTargets) {
        fs.unwatchFile(target, this.handleGlobalWatchChange);
      }
    }

    this.globalWatchTargets = [];
  }

  private registerCommands(): void {
    const subscriptions = [
      vscode.commands.registerCommand('cursorSubagentToggle.showActions', () => this.showActions()),
      vscode.commands.registerCommand('cursorSubagentToggle.toggleGlobal', () => this.toggleGlobal()),
      vscode.commands.registerCommand('cursorSubagentToggle.toggleCurrentWorkspaceFolder', () => this.toggleCurrentWorkspaceFolder()),
      vscode.commands.registerCommand('cursorSubagentToggle.toggleWorkspaceFolder', () => this.toggleWorkspaceFolder()),
      vscode.commands.registerCommand('cursorSubagentToggle.applyRecommendedGlobal', () => this.applyRecommendedGlobal()),
      vscode.commands.registerCommand('cursorSubagentToggle.applyRecommendedCurrentWorkspaceFolder', () => this.applyRecommendedCurrentWorkspaceFolder()),
      vscode.commands.registerCommand('cursorSubagentToggle.applyRecommendedWorkspaceFolder', () => this.applyRecommendedWorkspaceFolder()),
      vscode.commands.registerCommand('cursorSubagentToggle.refresh', () => this.refresh(true))
    ];

    this.context.subscriptions.push(...subscriptions);
  }

  private registerWorkspaceWatchers(): void {
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
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        void this.refresh();
      }),
      vscode.window.onDidChangeActiveTextEditor(() => this.renderStatusBar())
    );
  }

  private registerGlobalWatchers(): void {
    const targets = [getGlobalHooksJsonPath(), getGlobalScriptPath()];
    this.handleGlobalWatchChange = () => this.scheduleRefresh();

    for (const target of targets) {
      fs.watchFile(target, { interval: 1000 }, this.handleGlobalWatchChange);
    }

    this.globalWatchTargets = targets;
  }

  private scheduleRefresh(): void {
    this.clearScheduledRefresh();
    this.refreshTimer = setTimeout(() => {
      void this.refresh().catch((error: unknown) => this.showError(error));
    }, 200);
  }

  private clearScheduledRefresh(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = undefined;
    }
  }

  private async refresh(notifyOnError = false): Promise<void> {
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

  private renderStatusBar(): void {
    const snapshot = this.snapshot ?? buildErrorSnapshot(new Error('Status is not ready yet.'));
    const activeWorkspaceState = getActiveWorkspaceState(snapshot.workspaceStates);
    const statusSource = activeWorkspaceState ?? snapshot.aggregate;
    const meta = STATUS_META[statusSource.status] ?? STATUS_META.unknown;

    if (activeWorkspaceState && snapshot.workspaceStates.length > 1) {
      this.statusBar.text = `${meta.icon} Subagent ${truncateLabel(activeWorkspaceState.folder.name)} ${meta.label}`;
    } else {
      this.statusBar.text = `${meta.icon} Subagent ${meta.label}`;
    }

    this.statusBar.tooltip = buildTooltip(snapshot, activeWorkspaceState);
    this.statusBar.show();
  }

  private async showActions(): Promise<void> {
    await this.refresh();

    const snapshot = this.snapshot;
    if (!snapshot) {
      return;
    }

    const picks: ScopeActionItem[] = [];
    const global = snapshot.globalScope;
    picks.push({
      label: global.status === 'blocked' ? '🟢 Global: enable subagent everywhere' : '🔴 Global: disable subagent everywhere',
      detail: formatShortPath(global.hooksJsonPath),
      action: 'toggleGlobal'
    });

    if (global.status === 'unknown') {
      picks.push({
        label: '✨ Global: apply recommended config',
        detail: 'Replace only hooks.subagentStart with the extension-managed blocker.',
        action: 'applyRecommendedGlobal'
      });
    }

    const activeWorkspaceState = getActiveWorkspaceState(snapshot.workspaceStates);
    if (activeWorkspaceState) {
      const localMeta = STATUS_META[activeWorkspaceState.local.status] ?? STATUS_META.unknown;
      picks.push({
        label: activeWorkspaceState.local.status === 'blocked'
          ? `🟢 Folder: enable ${activeWorkspaceState.folder.name}`
          : `🔴 Folder: disable ${activeWorkspaceState.folder.name}`,
        detail: `${localMeta.icon} local ${localMeta.label} at ${formatShortPath(activeWorkspaceState.local.hooksJsonPath)}`,
        action: 'toggleCurrentWorkspace'
      });

      if (activeWorkspaceState.local.status === 'unknown') {
        picks.push({
          label: `✨ Folder: apply recommended config for ${activeWorkspaceState.folder.name}`,
          detail: 'Replace only hooks.subagentStart with the extension-managed blocker.',
          action: 'applyRecommendedCurrentWorkspace'
        });
      }
    }

    if (snapshot.workspaceStates.length > 1) {
      picks.push({
        label: '📁 Folder: choose another workspace folder',
        detail: 'Toggle the blocker for one specific folder in this multi-root workspace.',
        action: 'toggleWorkspaceFolder'
      });

      if (snapshot.workspaceStates.some((state) => state.local.status === 'unknown')) {
        picks.push({
          label: '✨ Folder: choose another workspace folder for recommended config',
          detail: 'Replace only hooks.subagentStart in one folder with the extension-managed blocker.',
          action: 'applyRecommendedWorkspaceFolder'
        });
      }
    }

    picks.push({
      label: '🔄 Refresh status',
      detail: 'Re-scan global and workspace hook files.',
      action: 'refresh'
    });

    const choice = await vscode.window.showQuickPick(picks, {
      title: 'Cursor Subagent Toggle',
      placeHolder: 'Choose which scope to toggle or normalize.'
    });

    if (!choice) {
      return;
    }

    switch (choice.action) {
      case 'toggleGlobal':
        await this.toggleGlobal();
        break;
      case 'toggleCurrentWorkspace':
        await this.toggleCurrentWorkspaceFolder();
        break;
      case 'toggleWorkspaceFolder':
        await this.toggleWorkspaceFolder();
        break;
      case 'applyRecommendedGlobal':
        await this.applyRecommendedGlobal();
        break;
      case 'applyRecommendedCurrentWorkspace':
        await this.applyRecommendedCurrentWorkspaceFolder();
        break;
      case 'applyRecommendedWorkspaceFolder':
        await this.applyRecommendedWorkspaceFolder();
        break;
      case 'refresh':
        await this.refresh(true);
        break;
    }
  }

  private async toggleGlobal(): Promise<void> {
    const global = this.snapshot?.globalScope ?? await inspectGlobalScope();

    if (global.status === 'unknown') {
      const confirmed = await confirmRecommendedOverwrite(global);
      if (!confirmed) {
        return;
      }

      await applyRecommendedBlock(global);
    } else {
      await setManagedBlock(global, global.status !== 'blocked');
    }

    await this.refresh(true);

    const nextGlobal = this.snapshot?.globalScope;
    if (!nextGlobal) {
      return;
    }

    const meta = STATUS_META[nextGlobal.status] ?? STATUS_META.unknown;
    vscode.window.showInformationMessage(`Global subagent status: ${meta.icon} ${meta.label}`);
  }

  private async toggleCurrentWorkspaceFolder(): Promise<void> {
    await this.refresh();
    const activeWorkspaceState = getActiveWorkspaceState(this.snapshot?.workspaceStates ?? []);

    if (!activeWorkspaceState) {
      vscode.window.showWarningMessage('No active workspace folder was found to toggle.');
      return;
    }

    await this.toggleWorkspaceState(activeWorkspaceState);
  }

  private async toggleWorkspaceFolder(): Promise<void> {
    await this.refresh();
    const workspaceStates = this.snapshot?.workspaceStates ?? [];

    if (!workspaceStates.length) {
      vscode.window.showWarningMessage('This window does not have any workspace folders.');
      return;
    }

    const picked = await pickWorkspaceState(workspaceStates);
    if (!picked) {
      return;
    }

    await this.toggleWorkspaceState(picked);
  }

  private async toggleWorkspaceState(workspaceState: WorkspaceState): Promise<void> {
    if (workspaceState.local.status === 'unknown') {
      const confirmed = await confirmRecommendedOverwrite(workspaceState.local);
      if (!confirmed) {
        return;
      }

      await applyRecommendedBlock(workspaceState.local);
    } else {
      await setManagedBlock(workspaceState.local, workspaceState.local.status !== 'blocked');
    }

    await this.refresh(true);

    const updatedState = this.snapshot?.workspaceStates.find((item) => item.folder.uri.toString() === workspaceState.folder.uri.toString());
    if (!updatedState) {
      return;
    }

    const effectiveMeta = STATUS_META[updatedState.status] ?? STATUS_META.unknown;
    vscode.window.showInformationMessage(`${updatedState.folder.name}: ${effectiveMeta.icon} ${effectiveMeta.label}`);
  }

  private async applyRecommendedGlobal(): Promise<void> {
    const global = this.snapshot?.globalScope ?? await inspectGlobalScope();
    await applyRecommendedBlock(global);
    await this.refresh(true);
    vscode.window.showInformationMessage('Global subagentStart was replaced with the recommended blocker config.');
  }

  private async applyRecommendedCurrentWorkspaceFolder(): Promise<void> {
    await this.refresh();
    const activeWorkspaceState = getActiveWorkspaceState(this.snapshot?.workspaceStates ?? []);

    if (!activeWorkspaceState) {
      vscode.window.showWarningMessage('No active workspace folder was found to normalize.');
      return;
    }

    await applyRecommendedBlock(activeWorkspaceState.local);
    await this.refresh(true);
    vscode.window.showInformationMessage(`${activeWorkspaceState.folder.name}: subagentStart was replaced with the recommended blocker config.`);
  }

  private async applyRecommendedWorkspaceFolder(): Promise<void> {
    await this.refresh();
    const workspaceStates = this.snapshot?.workspaceStates ?? [];

    if (!workspaceStates.length) {
      vscode.window.showWarningMessage('This window does not have any workspace folders.');
      return;
    }

    const picked = await pickWorkspaceState(workspaceStates);
    if (!picked) {
      return;
    }

    await applyRecommendedBlock(picked.local);
    await this.refresh(true);
    vscode.window.showInformationMessage(`${picked.folder.name}: subagentStart was replaced with the recommended blocker config.`);
  }

  private showError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`Cursor Subagent Toggle: ${message}`);
  }
}

async function buildSnapshot(): Promise<Snapshot> {
  const globalScope = await inspectGlobalScope();
  const folders = vscode.workspace.workspaceFolders ?? [];
  const locals = await Promise.all(folders.map((folder) => inspectProjectScope(folder)));
  const workspaceStates = locals.map((local) => buildWorkspaceState(globalScope, local));

  return {
    globalScope,
    workspaceStates,
    aggregate: summarizeWorkspaceState(globalScope, workspaceStates)
  };
}

function buildErrorSnapshot(error: unknown): Snapshot {
  const reason = error instanceof Error ? error.message : String(error);
  return {
    globalScope: {
      type: 'global',
      name: 'Global',
      baseDir: getGlobalCursorDir(),
      hooksJsonPath: getGlobalHooksJsonPath(),
      scriptPath: getGlobalScriptPath(),
      managedCommand: GLOBAL_COMMAND,
      configExists: false,
      scriptExists: false,
      scriptLooksLikeBlocker: false,
      status: 'error',
      reason
    },
    workspaceStates: [],
    aggregate: {
      status: 'error',
      reason
    }
  };
}

async function inspectGlobalScope(): Promise<ScopeState> {
  return inspectScope({
    type: 'global',
    name: 'Global',
    baseDir: getGlobalCursorDir(),
    hooksJsonPath: getGlobalHooksJsonPath(),
    scriptPath: getGlobalScriptPath(),
    managedCommand: GLOBAL_COMMAND
  });
}

async function inspectProjectScope(folder: vscode.WorkspaceFolder): Promise<ScopeState> {
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

async function inspectScope(scope: ScopeDescriptor): Promise<ScopeState> {
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

  const hooksConfig = configState.data;
  const hooksRoot = isObject(hooksConfig) && isObject(hooksConfig.hooks) ? hooksConfig.hooks : undefined;
  const subagentHooks = hooksRoot?.subagentStart;

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
    command: isCommandEntry(entry) ? entry.command : undefined
  }));

  const managedIndex = commandEntries.findIndex((entry) => entry.command === scope.managedCommand);
  const hasAnySubagentHooks = hookEntries.length > 0;
  const hasCustomCommands = commandEntries.some((entry) => entry.command && entry.command !== scope.managedCommand);
  const hasInvalidEntries = hookEntries.some((entry) => !isCommandEntry(entry));

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

function buildWorkspaceState(globalScope: ScopeState, localScope: ScopeState): WorkspaceState {
  const folder = localScope.folder as vscode.WorkspaceFolder;
  const blockers: string[] = [];
  const uncertainScopes: string[] = [];
  const brokenScopes: string[] = [];

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

function summarizeWorkspaceState(globalScope: ScopeState, workspaceStates: WorkspaceState[]): AggregateState {
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

async function setManagedBlock(scope: ScopeState, shouldBlock: boolean): Promise<void> {
  const data = await loadEditableHooksConfig(scope.hooksJsonPath);
  const existing = Array.isArray(data.hooks.subagentStart) ? [...data.hooks.subagentStart] : [];
  const withoutManaged = existing.filter((entry) => entry.command !== scope.managedCommand);

  if (shouldBlock) {
    withoutManaged.unshift({ command: scope.managedCommand });
    await ensureManagedScript(scope.scriptPath);
  }

  await writeSubagentStart(scope.hooksJsonPath, data, withoutManaged.length > 0 ? withoutManaged : undefined);
}

async function applyRecommendedBlock(scope: ScopeState): Promise<void> {
  const data = await loadEditableHooksConfig(scope.hooksJsonPath);
  await ensureManagedScript(scope.scriptPath);
  await writeSubagentStart(scope.hooksJsonPath, data, [{ command: scope.managedCommand }]);
}

async function loadEditableHooksConfig(hooksJsonPath: string): Promise<HooksConfig> {
  const configState = await readJsonFile(hooksJsonPath);
  if (configState.error) {
    throw new Error(`Fix invalid JSON first: ${formatShortPath(hooksJsonPath)}`);
  }

  if (isObject(configState.data) && configState.data.hooks !== undefined) {
    if (!isObject(configState.data.hooks)) {
      throw new Error(`Fix invalid hooks object first: ${formatShortPath(hooksJsonPath)}`);
    }

    if (configState.data.hooks.subagentStart !== undefined && !Array.isArray(configState.data.hooks.subagentStart)) {
      throw new Error(`Fix invalid subagentStart first: ${formatShortPath(hooksJsonPath)}`);
    }
  }

  return normalizeHooksConfig(configState.data);
}

async function writeSubagentStart(hooksJsonPath: string, config: HooksConfig, subagentStart: HooksCommandEntry[] | undefined): Promise<void> {
  if (subagentStart && subagentStart.length > 0) {
    config.hooks.subagentStart = subagentStart;
  } else {
    delete config.hooks.subagentStart;
  }

  await fsp.mkdir(path.dirname(hooksJsonPath), { recursive: true });
  await fsp.writeFile(hooksJsonPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

function normalizeHooksConfig(input: unknown): HooksConfig {
  const base = isObject(input) ? { ...input } : {};
  const hooks = isObject(base.hooks) ? { ...base.hooks } : {};

  return {
    ...base,
    version: typeof base.version === 'number' ? base.version : 1,
    hooks
  };
}

async function ensureManagedScript(scriptPath: string): Promise<void> {
  await fsp.mkdir(path.dirname(scriptPath), { recursive: true });
  await fsp.writeFile(scriptPath, BLOCKER_SCRIPT, 'utf8');
  await fsp.chmod(scriptPath, 0o755);
}

async function readJsonFile(filePath: string): Promise<JsonFileResult> {
  try {
    const raw = await fsp.readFile(filePath, 'utf8');
    return {
      exists: true,
      data: JSON.parse(raw)
    };
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === 'ENOENT') {
      return {
        exists: false
      };
    }

    if (error instanceof SyntaxError) {
      return {
        exists: true,
        error
      };
    }

    throw error;
  }
}

async function readScriptFile(filePath: string): Promise<ScriptFileResult> {
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
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === 'ENOENT') {
      return {
        exists: false,
        looksLikeBlocker: false
      };
    }

    throw error;
  }
}

async function confirmRecommendedOverwrite(scope: ScopeState): Promise<boolean> {
  const response = await vscode.window.showWarningMessage(
    `Custom subagentStart hooks were detected in ${formatShortPath(scope.hooksJsonPath)}. Replace only hooks.subagentStart with the extension's recommended blocker config?`,
    APPLY_RECOMMENDED_LABEL
  );

  return response === APPLY_RECOMMENDED_LABEL;
}

function getActiveWorkspaceState(workspaceStates: WorkspaceState[]): WorkspaceState | undefined {
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

async function pickWorkspaceState(workspaceStates: WorkspaceState[]): Promise<WorkspaceState | undefined> {
  const picks = workspaceStates.map((state) => {
    const effectiveMeta = STATUS_META[state.status] ?? STATUS_META.unknown;
    const localMeta = STATUS_META[state.local.status] ?? STATUS_META.unknown;
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

  return choice?.state;
}

function buildTooltip(snapshot: Snapshot, activeWorkspaceState: WorkspaceState | undefined): vscode.MarkdownString {
  const lines: string[] = [];
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

function formatStatusLine(status: StatusKind): string {
  const meta = STATUS_META[status] ?? STATUS_META.unknown;
  return `${meta.icon} ${meta.label}`;
}

function truncateLabel(label: string): string {
  return label.length > 18 ? `${label.slice(0, 15)}...` : label;
}

function formatShortPath(targetPath: string): string {
  const home = os.homedir();
  if (targetPath.startsWith(home)) {
    return `~${targetPath.slice(home.length)}`;
  }

  return targetPath;
}

function getGlobalCursorDir(): string {
  return path.join(os.homedir(), '.cursor');
}

function getGlobalHooksJsonPath(): string {
  return path.join(getGlobalCursorDir(), 'hooks.json');
}

function getGlobalScriptPath(): string {
  return path.join(getGlobalCursorDir(), 'hooks', 'block-subagent.sh');
}

function isObject(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCommandEntry(value: unknown): value is HooksCommandEntry {
  return isObject(value) && typeof value.command === 'string';
}
