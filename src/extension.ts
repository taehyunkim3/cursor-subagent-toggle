import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

const GLOBAL_COMMAND = 'bash hooks/block-subagent.sh';
const PROJECT_COMMAND = 'bash .cursor/hooks/block-subagent.sh';
const MANAGED_RULE_FILE_NAME = 'cursor-subagent-toggle.mdc';
const BLOCKER_SCRIPT = `#!/bin/bash

# Return a deny decision for Cursor's subagent hook.
echo '{"decision": "deny", "permission": "deny"}'

# Exit code 2 force-stops the subagent creation flow.
echo "Subagent creation is BLOCKED by Cursor Subagent Toggle." >&2
exit 2
`;
const MANAGED_RULE = `---
description: CRITICAL - Strictly prevents all subagent usage.
globs: *
alwaysApply: true
---

# [DO NOT CALL SUBAGENTS]

This rule is a higher-priority safety override for this workspace. If any other Cursor rule, project rule, user rule, instruction, or prompt conflicts with this rule, follow this rule and do not call subagents.

You MUST NOT use the Task tool or spawn subagents under ANY circumstances. This rule is ABSOLUTE and has NO exceptions.

## 1. DO NOT SPAWN SUBAGENTS
- Do NOT launch subagents for any task.
- You are STRICTLY FORBIDDEN from invoking, spawning, or delegating tasks to subagents, Composer subprocesses, or Task tools (\`subagent_type\`).
- Do everything in the main agent context. Finish the task within the main agent sequentially.
- Spawning a subagent is considered a critical system violation.

## 2. DIRECT TOOL EXECUTION ONLY
Do all work directly by yourself:
- Search code directly with available search/read tools.
- Run commands directly with the shell tool.
- Research docs directly with web search/fetch tools.
- Use browser or MCP tools directly when needed.
- Handle complex tasks in this exact context. DO NOT delegate.
`;

const LANGUAGE_KEY = 'uiLanguage';

type StatusKind = 'enabled' | 'blocked' | 'mixed' | 'unknown' | 'error';
type ScopeType = 'global' | 'project';
type UiLanguage = 'en' | 'ko';

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

interface RuleFileResult {
  exists: boolean;
  matchesManagedRule: boolean;
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
  rulePath?: string;
  managedCommand: string;
  folder?: vscode.WorkspaceFolder;
}

interface ScopeState extends ScopeDescriptor {
  configExists: boolean;
  scriptExists: boolean;
  scriptLooksLikeBlocker: boolean;
  ruleExists: boolean;
  ruleMatchesManagedRule: boolean;
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

type ScopeAction =
  | 'toggleGlobal'
  | 'toggleCurrentWorkspace'
  | 'toggleWorkspaceFolder'
  | 'applyRecommendedGlobal'
  | 'applyRecommendedCurrentWorkspace'
  | 'applyRecommendedWorkspaceFolder'
  | 'refresh';

interface ScopeActionItem extends vscode.QuickPickItem {
  action: ScopeAction;
}

type SidebarMessage =
  | { type: 'refresh' }
  | { type: 'showActions' }
  | { type: 'setLanguage'; language: UiLanguage }
  | { type: 'toggleGlobal'; desiredEnabled?: boolean }
  | { type: 'applyRecommendedGlobal' }
  | { type: 'toggleWorkspace'; folderUri: string; desiredEnabled?: boolean }
  | { type: 'applyRecommendedWorkspace'; folderUri: string }
  | { type: 'restoreWorkspaceRule'; folderUri: string };

const STATUS_META: Record<StatusKind, StatusMeta> = {
  enabled: { icon: '🟢', label: 'ON' },
  blocked: { icon: '🔴', label: 'OFF' },
  mixed: { icon: '🟡', label: 'MIXED' },
  unknown: { icon: '⚪', label: 'CHECK' },
  error: { icon: '🟠', label: 'ERROR' }
};

const STRINGS: Record<UiLanguage, Record<string, string>> = {
  en: {
    appTitle: 'Subagent Control',
    language: 'Language',
    languageEnglish: 'English',
    languageKorean: 'Korean',
    currentWindow: 'Current Window',
    currentWindowStatus: 'Current status',
    globalTitle: 'Global',
    workspaceTitle: 'Workspace Folders',
    noWorkspaceFolders: 'No workspace folders are open in this window.',
    openControls: 'Open more actions',
    refresh: 'Refresh',
    blockerToggleGlobal: 'Global subagent enabled',
    blockerToggleLocal: 'Local subagent enabled',
    effectiveStatus: 'Effective status',
    localStatus: 'Local status',
    globalStatus: 'Global status',
    path: 'Path',
    reason: 'Reason',
    statusEnabled: 'Enabled',
    statusBlocked: 'Blocked',
    statusMixed: 'Mixed',
    statusUnknown: 'Check',
    statusError: 'Error',
    configExists: 'hooks.json',
    scriptExists: 'blocker script',
    ruleExists: 'project rule',
    ruleManaged: 'rule content',
    ruleManagedValue: 'Managed',
    ruleMissingValue: 'Missing',
    ruleModifiedValue: 'Modified - protected',
    yes: 'Present',
    no: 'Missing',
    customDetected: 'Custom subagentStart hooks were detected.',
    recommended: 'Apply Recommended Config',
    recommendedHelp: 'This replaces only hooks.subagentStart and recreates the extension-managed guard files.',
    ruleWarningTitle: 'Managed project rule needs attention.',
    ruleWarningHelp: 'The hook can still block subagents, but the project rule is missing or was edited. Existing user rules are not touched.',
    restoreRule: 'Restore Project Rule',
    restoreRuleDone: '{name}: managed project rule was restored.',
    unknownSwitchHelp: 'Custom hooks exist, so this switch may not reflect the final behavior.',
    blockedSwitchHelp: 'Switch off to block subagent creation in this scope.',
    enabledSwitchHelp: 'Switch on to allow subagent creation in this scope.',
    overriddenByGlobal: 'Global blocker is ON, so final status remains blocked in this folder.',
    globalNotification: 'Global subagent status',
    recommendedGlobalDone: 'Global subagentStart was replaced with the recommended blocker config.',
    recommendedWorkspaceDone: '{name}: subagentStart was replaced with the recommended blocker config.',
    unknownConfirm: 'Custom subagentStart hooks were detected in {path}. Replace only hooks.subagentStart with the recommended blocker config?',
    activeFolderMissing: 'No active workspace folder was found to toggle.',
    noFolders: 'This window does not have any workspace folders.',
    chooseFolder: 'Choose a workspace folder',
    chooseFolderPlaceholder: 'Toggle the blocker in one workspace folder.',
    chooseAction: 'Choose which scope to toggle or normalize.',
    chooseItemAction: 'Choose an action.',
    globalEnable: 'Enable subagent globally',
    globalDisable: 'Disable subagent globally',
    folderEnable: 'Enable subagent in {name}',
    folderDisable: 'Disable subagent in {name}',
    folderChoose: 'Choose another workspace folder',
    folderChooseRecommended: 'Choose another workspace folder for recommended config',
    applyRecommendedFor: 'Apply recommended config for {name}',
    openSidebarHint: 'Use the sidebar switches for the fastest control flow.'
  },
  ko: {
    appTitle: 'Subagent 제어',
    language: '언어',
    languageEnglish: 'English',
    languageKorean: '한국어',
    currentWindow: '현재 창',
    currentWindowStatus: '현재 상태',
    globalTitle: '전역',
    workspaceTitle: '워크스페이스 폴더',
    noWorkspaceFolders: '이 창에는 열린 workspace folder가 없습니다.',
    openControls: '추가 액션 열기',
    refresh: '새로고침',
    blockerToggleGlobal: '전역 subagent 활성화',
    blockerToggleLocal: '로컬 subagent 활성화',
    effectiveStatus: '최종 상태',
    localStatus: '로컬 상태',
    globalStatus: '전역 상태',
    path: '경로',
    reason: '사유',
    statusEnabled: '활성',
    statusBlocked: '비활성',
    statusMixed: '혼합',
    statusUnknown: '확인 필요',
    statusError: '오류',
    configExists: 'hooks.json',
    scriptExists: '차단 스크립트',
    ruleExists: 'project rule',
    ruleManaged: 'rule 내용',
    ruleManagedValue: '관리됨',
    ruleMissingValue: '없음',
    ruleModifiedValue: '수정됨 - 보호',
    yes: '있음',
    no: '없음',
    customDetected: '커스텀 subagentStart hook이 감지되었습니다.',
    recommended: '권장 설정 적용',
    recommendedHelp: 'hooks.subagentStart만 교체하고 extension이 관리하는 guard 파일을 다시 생성합니다.',
    ruleWarningTitle: '관리 project rule 확인이 필요합니다.',
    ruleWarningHelp: 'hook은 subagent를 계속 차단할 수 있지만, project rule이 없거나 수정되었습니다. 기존 사용자 rule은 건드리지 않습니다.',
    restoreRule: 'Project Rule 복구',
    restoreRuleDone: '{name}: 관리 project rule을 복구했습니다.',
    unknownSwitchHelp: '커스텀 hook이 있어 이 스위치가 최종 동작을 정확히 반영하지 않을 수 있습니다.',
    blockedSwitchHelp: '스위치를 끄면 이 범위에서 subagent 생성이 차단됩니다.',
    enabledSwitchHelp: '스위치를 켜면 이 범위에서 subagent 생성이 허용됩니다.',
    overriddenByGlobal: '전역 차단이 켜져 있어서 이 폴더의 최종 상태는 비활성으로 유지됩니다.',
    globalNotification: '전역 subagent 상태',
    recommendedGlobalDone: '전역 subagentStart를 권장 blocker 설정으로 교체했습니다.',
    recommendedWorkspaceDone: '{name}: subagentStart를 권장 blocker 설정으로 교체했습니다.',
    unknownConfirm: '{path} 에 커스텀 subagentStart hook이 있습니다. hooks.subagentStart만 권장 blocker 설정으로 교체할까요?',
    activeFolderMissing: '토글할 활성 workspace folder를 찾지 못했습니다.',
    noFolders: '이 창에는 workspace folder가 없습니다.',
    chooseFolder: 'workspace folder 선택',
    chooseFolderPlaceholder: '하나의 workspace folder에서 blocker를 토글합니다.',
    chooseAction: '토글하거나 정규화할 범위를 선택하세요.',
    chooseItemAction: '실행할 액션을 선택하세요.',
    globalEnable: '전역에서 subagent 활성화',
    globalDisable: '전역에서 subagent 비활성화',
    folderEnable: '{name} 에서 subagent 활성화',
    folderDisable: '{name} 에서 subagent 비활성화',
    folderChoose: '다른 workspace folder 선택',
    folderChooseRecommended: '권장 설정을 적용할 workspace folder 선택',
    applyRecommendedFor: '{name} 에 권장 설정 적용',
    openSidebarHint: '가장 빠른 조작은 사이드바의 스위치를 사용하면 됩니다.'
  }
};

export function activate(context: vscode.ExtensionContext): Thenable<void> {
  const controller = new SubagentController(context);
  context.subscriptions.push(controller);
  return controller.activate();
}

export function deactivate(): void {}

class SubagentController implements vscode.Disposable {
  private readonly context: vscode.ExtensionContext;
  private readonly statusBar: vscode.StatusBarItem;
  private readonly sidebarProvider: SidebarWebviewProvider;
  private snapshot: Snapshot | null = null;
  private globalWatchTargets: string[] = [];
  private refreshTimer: NodeJS.Timeout | undefined;
  private handleGlobalWatchChange?: () => void;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
    this.statusBar.name = 'Cursor Subagent Toggle';
    this.statusBar.command = 'cursorSubagentToggle.showActions';
    this.sidebarProvider = new SidebarWebviewProvider(context, this);
  }

  async activate(): Promise<void> {
    this.context.subscriptions.push(
      this.statusBar,
      vscode.window.registerWebviewViewProvider('cursorSubagentToggle.sidebar', this.sidebarProvider, {
        webviewOptions: {
          retainContextWhenHidden: true
        }
      })
    );
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
  }

  private registerCommands(): void {
    this.context.subscriptions.push(
      vscode.commands.registerCommand('cursorSubagentToggle.showActions', () => this.showActions()),
      vscode.commands.registerCommand('cursorSubagentToggle.toggleGlobal', () => this.toggleGlobal()),
      vscode.commands.registerCommand('cursorSubagentToggle.toggleCurrentWorkspaceFolder', () => this.toggleCurrentWorkspaceFolder()),
      vscode.commands.registerCommand('cursorSubagentToggle.toggleWorkspaceFolder', () => this.toggleWorkspaceFolder()),
      vscode.commands.registerCommand('cursorSubagentToggle.applyRecommendedGlobal', () => this.applyRecommendedGlobal()),
      vscode.commands.registerCommand('cursorSubagentToggle.applyRecommendedCurrentWorkspaceFolder', () => this.applyRecommendedCurrentWorkspaceFolder()),
      vscode.commands.registerCommand('cursorSubagentToggle.applyRecommendedWorkspaceFolder', () => this.applyRecommendedWorkspaceFolder()),
      vscode.commands.registerCommand('cursorSubagentToggle.refresh', () => this.refresh(true))
    );
  }

  private registerWorkspaceWatchers(): void {
    const hookWatcher = vscode.workspace.createFileSystemWatcher('**/.cursor/hooks.json');
    const scriptWatcher = vscode.workspace.createFileSystemWatcher('**/.cursor/hooks/block-subagent.sh');
    const ruleWatcher = vscode.workspace.createFileSystemWatcher(`**/.cursor/rules/${MANAGED_RULE_FILE_NAME}`);

    const triggerRefresh = () => this.scheduleRefresh();
    hookWatcher.onDidCreate(triggerRefresh, this, this.context.subscriptions);
    hookWatcher.onDidChange(triggerRefresh, this, this.context.subscriptions);
    hookWatcher.onDidDelete(triggerRefresh, this, this.context.subscriptions);
    scriptWatcher.onDidCreate(triggerRefresh, this, this.context.subscriptions);
    scriptWatcher.onDidChange(triggerRefresh, this, this.context.subscriptions);
    scriptWatcher.onDidDelete(triggerRefresh, this, this.context.subscriptions);
    ruleWatcher.onDidCreate(triggerRefresh, this, this.context.subscriptions);
    ruleWatcher.onDidChange(triggerRefresh, this, this.context.subscriptions);
    ruleWatcher.onDidDelete(triggerRefresh, this, this.context.subscriptions);

    this.context.subscriptions.push(
      hookWatcher,
      scriptWatcher,
      ruleWatcher,
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        void this.refresh();
      }),
      vscode.window.onDidChangeActiveTextEditor(() => this.renderStatusBar())
    );
  }

  private registerGlobalWatchers(): void {
    this.handleGlobalWatchChange = () => this.scheduleRefresh();
    this.globalWatchTargets = [getGlobalHooksJsonPath(), getGlobalScriptPath()];

    for (const target of this.globalWatchTargets) {
      fs.watchFile(target, { interval: 1000 }, this.handleGlobalWatchChange);
    }
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

  async refresh(notifyOnError = false): Promise<void> {
    try {
      this.snapshot = await buildSnapshot();
      this.renderStatusBar();
      this.sidebarProvider.update(this.snapshot, this.getLanguage());
    } catch (error) {
      this.snapshot = buildErrorSnapshot(error);
      this.renderStatusBar();
      this.sidebarProvider.update(this.snapshot, this.getLanguage());
      if (notifyOnError) {
        this.showError(error);
      }
    }
  }

  getSnapshot(): Snapshot {
    return this.snapshot ?? buildErrorSnapshot(new Error('Status is not ready yet.'));
  }

  getLanguage(): UiLanguage {
    const stored = this.context.globalState.get<UiLanguage>(LANGUAGE_KEY);
    if (stored === 'en' || stored === 'ko') {
      return stored;
    }

    return vscode.env.language.toLowerCase().startsWith('ko') ? 'ko' : 'en';
  }

  async setLanguage(language: UiLanguage): Promise<void> {
    await this.context.globalState.update(LANGUAGE_KEY, language);
    this.renderStatusBar();
    this.sidebarProvider.update(this.getSnapshot(), language);
  }

  async handleSidebarMessage(message: SidebarMessage): Promise<void> {
    switch (message.type) {
      case 'refresh':
        await this.refresh(true);
        break;
      case 'showActions':
        await this.showActions();
        break;
      case 'setLanguage':
        await this.setLanguage(message.language);
        break;
      case 'toggleGlobal':
        if (typeof message.desiredEnabled === 'boolean') {
          await this.setGlobalEnabled(message.desiredEnabled);
        } else {
          await this.toggleGlobal();
        }
        break;
      case 'applyRecommendedGlobal':
        await this.applyRecommendedGlobal();
        break;
      case 'toggleWorkspace': {
        const workspaceState = this.findWorkspaceState(message.folderUri);
        if (workspaceState) {
          if (typeof message.desiredEnabled === 'boolean') {
            await this.setWorkspaceEnabled(workspaceState, message.desiredEnabled);
          } else {
            await this.toggleWorkspaceState(workspaceState);
          }
        }
        break;
      }
      case 'applyRecommendedWorkspace': {
        const workspaceState = this.findWorkspaceState(message.folderUri);
        if (workspaceState) {
          await this.applyRecommendedScope(workspaceState.local);
        }
        break;
      }
      case 'restoreWorkspaceRule': {
        const workspaceState = this.findWorkspaceState(message.folderUri);
        if (workspaceState) {
          await this.restoreWorkspaceRule(workspaceState);
        }
        break;
      }
    }
  }

  private renderStatusBar(): void {
    const snapshot = this.getSnapshot();
    const language = this.getLanguage();
    const activeWorkspaceState = getActiveWorkspaceState(snapshot.workspaceStates);
    const statusSource = activeWorkspaceState ?? snapshot.aggregate;
    const meta = STATUS_META[statusSource.status] ?? STATUS_META.unknown;
    const title = language === 'ko' ? 'Subagent' : 'Subagent';

    if (activeWorkspaceState && snapshot.workspaceStates.length > 1) {
      this.statusBar.text = `${meta.icon} ${title} ${truncateLabel(activeWorkspaceState.folder.name)} ${meta.label}`;
    } else {
      this.statusBar.text = `${meta.icon} ${title} ${meta.label}`;
    }

    this.statusBar.tooltip = buildTooltip(snapshot, activeWorkspaceState, language);
    this.statusBar.show();
  }

  private async showActions(): Promise<void> {
    await this.refresh();

    const language = this.getLanguage();
    const strings = STRINGS[language];
    const snapshot = this.getSnapshot();
    const picks: ScopeActionItem[] = [];
    const global = snapshot.globalScope;
    picks.push({
      label: global.status === 'blocked' ? `🟢 ${strings.globalEnable}` : `🔴 ${strings.globalDisable}`,
      detail: formatShortPath(global.hooksJsonPath),
      action: 'toggleGlobal'
    });

    if (global.status === 'unknown') {
      picks.push({
        label: `✨ ${strings.recommended}`,
        detail: strings.recommendedHelp,
        action: 'applyRecommendedGlobal'
      });
    }

    const activeWorkspaceState = getActiveWorkspaceState(snapshot.workspaceStates);
    if (activeWorkspaceState) {
      picks.push({
        label: activeWorkspaceState.local.status === 'blocked'
          ? `🟢 ${interpolate(strings.folderEnable, { name: activeWorkspaceState.folder.name })}`
          : `🔴 ${interpolate(strings.folderDisable, { name: activeWorkspaceState.folder.name })}`,
        detail: `${activeWorkspaceState.reason}`,
        action: 'toggleCurrentWorkspace'
      });

      if (activeWorkspaceState.local.status === 'unknown') {
        picks.push({
          label: `✨ ${interpolate(strings.applyRecommendedFor, { name: activeWorkspaceState.folder.name })}`,
          detail: strings.recommendedHelp,
          action: 'applyRecommendedCurrentWorkspace'
        });
      }
    }

    if (snapshot.workspaceStates.length > 1) {
      picks.push({
        label: `📁 ${strings.folderChoose}`,
        detail: strings.chooseFolderPlaceholder,
        action: 'toggleWorkspaceFolder'
      });

      if (snapshot.workspaceStates.some((state) => state.local.status === 'unknown')) {
        picks.push({
          label: `✨ ${strings.folderChooseRecommended}`,
          detail: strings.recommendedHelp,
          action: 'applyRecommendedWorkspaceFolder'
        });
      }
    }

    picks.push({
      label: `🔄 ${strings.refresh}`,
      detail: strings.openSidebarHint,
      action: 'refresh'
    });

    const choice = await vscode.window.showQuickPick(picks, {
      title: strings.appTitle,
      placeHolder: strings.chooseAction
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
    const global = this.getSnapshot().globalScope;
    let shouldBlock: boolean;

    if (global.status === 'unknown') {
      const confirmed = await confirmRecommendedOverwrite(global, this.getLanguage());
      if (!confirmed) {
        return;
      }
      await applyRecommendedBlock(global);
      shouldBlock = true;
    } else {
      shouldBlock = global.status !== 'blocked';
      await setManagedBlock(global, shouldBlock);
    }

    await this.syncWorkspaceRulesForGlobalBlock(shouldBlock);
    await this.refresh(true);

    const strings = STRINGS[this.getLanguage()];
    const nextGlobal = this.getSnapshot().globalScope;
    const meta = STATUS_META[nextGlobal.status] ?? STATUS_META.unknown;
    vscode.window.showInformationMessage(`${strings.globalNotification}: ${meta.icon} ${meta.label}`);
  }

  private async setGlobalEnabled(desiredEnabled: boolean): Promise<void> {
    const global = this.getSnapshot().globalScope;
    let shouldBlock: boolean;

    if (global.status === 'unknown') {
      if (desiredEnabled) {
        await setManagedBlock(global, false);
        shouldBlock = false;
      } else {
        const confirmed = await confirmRecommendedOverwrite(global, this.getLanguage());
        if (!confirmed) {
          await this.refresh();
          return;
        }
        await applyRecommendedBlock(global);
        shouldBlock = true;
      }
    } else {
      shouldBlock = !desiredEnabled;
      await setManagedBlock(global, shouldBlock);
    }

    await this.syncWorkspaceRulesForGlobalBlock(shouldBlock);
    await this.refresh(true);
  }

  private async toggleCurrentWorkspaceFolder(): Promise<void> {
    await this.refresh();
    const activeWorkspaceState = getActiveWorkspaceState(this.getSnapshot().workspaceStates);

    if (!activeWorkspaceState) {
      vscode.window.showWarningMessage(STRINGS[this.getLanguage()].activeFolderMissing);
      return;
    }

    await this.toggleWorkspaceState(activeWorkspaceState);
  }

  private async toggleWorkspaceFolder(): Promise<void> {
    await this.refresh();
    const workspaceStates = this.getSnapshot().workspaceStates;

    if (!workspaceStates.length) {
      vscode.window.showWarningMessage(STRINGS[this.getLanguage()].noFolders);
      return;
    }

    const picked = await pickWorkspaceState(workspaceStates, this.getLanguage());
    if (!picked) {
      return;
    }

    await this.toggleWorkspaceState(picked);
  }

  private async toggleWorkspaceState(workspaceState: WorkspaceState): Promise<void> {
    if (workspaceState.local.status === 'unknown') {
      const confirmed = await confirmRecommendedOverwrite(workspaceState.local, this.getLanguage());
      if (!confirmed) {
        return;
      }
      await applyRecommendedBlock(workspaceState.local);
    } else {
      await setManagedBlock(workspaceState.local, workspaceState.local.status !== 'blocked');
    }

    await this.restoreGlobalRuleIfNeeded(workspaceState.local);
    await this.refresh(true);

    const updatedState = this.findWorkspaceState(workspaceState.folder.uri.toString());
    if (!updatedState) {
      return;
    }

    const meta = STATUS_META[updatedState.status] ?? STATUS_META.unknown;
    vscode.window.showInformationMessage(`${updatedState.folder.name}: ${meta.icon} ${meta.label}`);
  }

  private async setWorkspaceEnabled(workspaceState: WorkspaceState, desiredEnabled: boolean): Promise<void> {
    if (workspaceState.local.status === 'unknown') {
      if (desiredEnabled) {
        await setManagedBlock(workspaceState.local, false);
      } else {
        const confirmed = await confirmRecommendedOverwrite(workspaceState.local, this.getLanguage());
        if (!confirmed) {
          await this.refresh();
          return;
        }
        await applyRecommendedBlock(workspaceState.local);
      }
    } else {
      await setManagedBlock(workspaceState.local, !desiredEnabled);
    }

    await this.restoreGlobalRuleIfNeeded(workspaceState.local);
    await this.refresh(true);
  }

  private async applyRecommendedGlobal(): Promise<void> {
    await this.applyRecommendedScope(this.getSnapshot().globalScope);
  }

  private async applyRecommendedCurrentWorkspaceFolder(): Promise<void> {
    await this.refresh();
    const activeWorkspaceState = getActiveWorkspaceState(this.getSnapshot().workspaceStates);

    if (!activeWorkspaceState) {
      vscode.window.showWarningMessage(STRINGS[this.getLanguage()].activeFolderMissing);
      return;
    }

    await this.applyRecommendedScope(activeWorkspaceState.local);
  }

  private async applyRecommendedWorkspaceFolder(): Promise<void> {
    await this.refresh();
    const workspaceStates = this.getSnapshot().workspaceStates;

    if (!workspaceStates.length) {
      vscode.window.showWarningMessage(STRINGS[this.getLanguage()].noFolders);
      return;
    }

    const picked = await pickWorkspaceState(workspaceStates, this.getLanguage());
    if (!picked) {
      return;
    }

    await this.applyRecommendedScope(picked.local);
  }

  private async applyRecommendedScope(scope: ScopeState): Promise<void> {
    await applyRecommendedBlock(scope);
    if (scope.type === 'global') {
      await this.syncWorkspaceRulesForGlobalBlock(true);
    }
    await this.refresh(true);

    const strings = STRINGS[this.getLanguage()];
    if (scope.type === 'global') {
      vscode.window.showInformationMessage(strings.recommendedGlobalDone);
      return;
    }

    vscode.window.showInformationMessage(interpolate(strings.recommendedWorkspaceDone, { name: scope.name }));
  }

  private async restoreWorkspaceRule(workspaceState: WorkspaceState): Promise<void> {
    await ensureManagedRule(workspaceState.local.rulePath);
    await this.refresh(true);
    vscode.window.showInformationMessage(interpolate(STRINGS[this.getLanguage()].restoreRuleDone, { name: workspaceState.folder.name }));
  }

  private async restoreGlobalRuleIfNeeded(scope: ScopeState): Promise<void> {
    if (this.getSnapshot().globalScope.status === 'blocked') {
      await ensureManagedRule(scope.rulePath);
    }
  }

  private async syncWorkspaceRulesForGlobalBlock(shouldBlock: boolean): Promise<void> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    const scopes = await Promise.all(folders.map((folder) => inspectProjectScope(folder)));

    if (shouldBlock) {
      await Promise.all(scopes.map((scope) => ensureManagedRule(scope.rulePath)));
      return;
    }

    await Promise.all(
      scopes
        .filter((scope) => scope.status !== 'blocked')
        .map((scope) => deleteManagedRule(scope.rulePath))
    );
  }

  private findWorkspaceState(folderUri: string): WorkspaceState | undefined {
    return this.getSnapshot().workspaceStates.find((state) => state.folder.uri.toString() === folderUri);
  }

  private showError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`Cursor Subagent Toggle: ${message}`);
  }
}

class SidebarWebviewProvider implements vscode.WebviewViewProvider {
  private readonly context: vscode.ExtensionContext;
  private readonly controller: SubagentController;
  private view?: vscode.WebviewView;

  constructor(context: vscode.ExtensionContext, controller: SubagentController) {
    this.context = context;
    this.controller = controller;
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void | Thenable<void> {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true
    };

    webviewView.webview.onDidReceiveMessage((message: SidebarMessage) => {
      void this.controller.handleSidebarMessage(message);
    });

    this.update(this.controller.getSnapshot(), this.controller.getLanguage());
  }

  update(snapshot: Snapshot, language: UiLanguage): void {
    if (!this.view) {
      return;
    }

    this.view.webview.html = renderSidebarHtml(this.view.webview, snapshot, language);
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
      ruleExists: false,
      ruleMatchesManagedRule: false,
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
  return inspectScope({
    type: 'project',
    name: folder.name,
    folder,
    baseDir: folder.uri.fsPath,
    hooksJsonPath: path.join(folder.uri.fsPath, '.cursor', 'hooks.json'),
    scriptPath: path.join(folder.uri.fsPath, '.cursor', 'hooks', 'block-subagent.sh'),
    rulePath: getProjectRulePath(folder.uri.fsPath),
    managedCommand: PROJECT_COMMAND
  });
}

async function inspectScope(scope: ScopeDescriptor): Promise<ScopeState> {
  const configState = await readJsonFile(scope.hooksJsonPath);
  const scriptState = await readScriptFile(scope.scriptPath);
  const ruleState = await readRuleFile(scope.rulePath);
  const base: Omit<ScopeState, 'status' | 'reason'> = {
    ...scope,
    configExists: configState.exists,
    scriptExists: scriptState.exists,
    scriptLooksLikeBlocker: scriptState.looksLikeBlocker,
    ruleExists: ruleState.exists,
    ruleMatchesManagedRule: ruleState.matchesManagedRule
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
  const ruleIssue = scope.rulePath && !ruleState.exists
    ? 'the managed project rule is missing'
    : scope.rulePath && ruleState.exists && !ruleState.matchesManagedRule
      ? 'the managed project rule was edited and is protected'
      : undefined;

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
      reason: ruleIssue ? `Managed blocker is active, but ${ruleIssue}` : 'Managed blocker is active'
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
      folder: localScope.folder as vscode.WorkspaceFolder,
      local: localScope,
      global: globalScope,
      status: 'blocked',
      reason: blockers.length === 2 ? 'Blocked by global and folder scopes' : `Blocked by ${blockers[0]} scope`
    };
  }

  if (brokenScopes.length > 0) {
    return {
      folder: localScope.folder as vscode.WorkspaceFolder,
      local: localScope,
      global: globalScope,
      status: 'error',
      reason: `Cannot confirm final state because ${brokenScopes.join(' and ')} scope is misconfigured`
    };
  }

  if (uncertainScopes.length > 0) {
    return {
      folder: localScope.folder as vscode.WorkspaceFolder,
      local: localScope,
      global: globalScope,
      status: 'unknown',
      reason: `Cannot confirm final state because ${uncertainScopes.join(' and ')} scope has custom or ambiguous hooks`
    };
  }

  return {
    folder: localScope.folder as vscode.WorkspaceFolder,
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
    await ensureManagedRule(scope.rulePath);
  } else {
    await deleteManagedRule(scope.rulePath);
  }

  await writeSubagentStart(scope.hooksJsonPath, data, withoutManaged.length > 0 ? withoutManaged : undefined);
}

async function applyRecommendedBlock(scope: ScopeState): Promise<void> {
  const data = await loadEditableHooksConfig(scope.hooksJsonPath);
  await ensureManagedScript(scope.scriptPath);
  await ensureManagedRule(scope.rulePath);
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

async function ensureManagedRule(rulePath: string | undefined): Promise<void> {
  if (!rulePath) {
    return;
  }

  await fsp.mkdir(path.dirname(rulePath), { recursive: true });
  await fsp.writeFile(rulePath, MANAGED_RULE, 'utf8');
}

async function deleteManagedRule(rulePath: string | undefined): Promise<void> {
  if (!rulePath) {
    return;
  }

  const ruleState = await readRuleFile(rulePath);
  if (!ruleState.exists || !ruleState.matchesManagedRule) {
    return;
  }

  await fsp.unlink(rulePath);
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
      return { exists: false };
    }

    if (error instanceof SyntaxError) {
      return { exists: true, error };
    }

    throw error;
  }
}

async function readRuleFile(filePath: string | undefined): Promise<RuleFileResult> {
  if (!filePath) {
    return {
      exists: false,
      matchesManagedRule: false
    };
  }

  try {
    const raw = await fsp.readFile(filePath, 'utf8');
    return {
      exists: true,
      matchesManagedRule: normalizeLineEndings(raw) === normalizeLineEndings(MANAGED_RULE)
    };
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === 'ENOENT') {
      return {
        exists: false,
        matchesManagedRule: false
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

async function confirmRecommendedOverwrite(scope: ScopeState, language: UiLanguage): Promise<boolean> {
  const strings = STRINGS[language];
  const response = await vscode.window.showWarningMessage(
    interpolate(strings.unknownConfirm, { path: formatShortPath(scope.hooksJsonPath) }),
    strings.recommended
  );

  return response === strings.recommended;
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

async function pickWorkspaceState(workspaceStates: WorkspaceState[], language: UiLanguage): Promise<WorkspaceState | undefined> {
  const strings = STRINGS[language];
  const picks = workspaceStates.map((state) => {
    const effectiveMeta = STATUS_META[state.status] ?? STATUS_META.unknown;
    const localMeta = STATUS_META[state.local.status] ?? STATUS_META.unknown;
    return {
      label: `${effectiveMeta.icon} ${state.folder.name}`,
      description: `${strings.effectiveStatus} ${effectiveMeta.label} / ${strings.localStatus} ${localMeta.label}`,
      detail: state.reason,
      state
    };
  });

  const choice = await vscode.window.showQuickPick(picks, {
    title: strings.chooseFolder,
    placeHolder: strings.chooseFolderPlaceholder
  });

  return choice?.state;
}

function buildTooltip(snapshot: Snapshot, activeWorkspaceState: WorkspaceState | undefined, language: UiLanguage): vscode.MarkdownString {
  const strings = STRINGS[language];
  const lines: string[] = [];
  lines.push(`**${strings.appTitle}**`);
  lines.push('');
  lines.push(`${strings.globalTitle}: ${formatStatusLine(snapshot.globalScope.status, language)} ${snapshot.globalScope.reason}`);
  lines.push(`${strings.path}: \`${formatShortPath(snapshot.globalScope.hooksJsonPath)}\``);

  if (!snapshot.workspaceStates.length) {
    lines.push('');
    lines.push(strings.noWorkspaceFolders);
    return new vscode.MarkdownString(lines.join('\n'));
  }

  lines.push('');
  lines.push(`${strings.workspaceTitle}:`);

  for (const state of snapshot.workspaceStates) {
    const prefix = activeWorkspaceState && activeWorkspaceState.folder.uri.toString() === state.folder.uri.toString() ? 'current' : 'folder';
    lines.push(`- ${prefix} \`${state.folder.name}\`: ${formatStatusLine(state.status, language)} ${state.reason}`);
    lines.push(`  ${strings.localStatus} ${formatStatusLine(state.local.status, language)} / ${strings.globalStatus} ${formatStatusLine(state.global.status, language)}`);
    lines.push(`  ${strings.path} \`${formatShortPath(state.local.hooksJsonPath)}\``);
    if (state.local.rulePath) {
      lines.push(`  ${strings.ruleExists} ${formatRuleStatus(state.local, language)}: \`${formatShortPath(state.local.rulePath)}\``);
    }
  }

  return new vscode.MarkdownString(lines.join('\n'));
}

function renderSidebarHtml(webview: vscode.Webview, snapshot: Snapshot, language: UiLanguage): string {
  const strings = STRINGS[language];
  const nonce = createNonce();
  const statusSummary = formatStatusLine(snapshot.aggregate.status, language);
  const globalCard = renderScopeCard(snapshot.globalScope, {
    language,
    folderUri: undefined,
    effectiveStatus: snapshot.globalScope.status,
    effectiveReason: snapshot.globalScope.reason
  });
  const workspaceCards = snapshot.workspaceStates.map((state) =>
    renderScopeCard(state.local, {
      language,
      folderUri: state.folder.uri.toString(),
      effectiveStatus: state.status,
      effectiveReason: state.reason,
      globalStatus: state.global.status,
      globalReason: state.global.reason
    })
  ).join('');

  return `<!DOCTYPE html>
<html lang="${language}">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(strings.appTitle)}</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: var(--vscode-sideBar-background);
      --fg: var(--vscode-sideBar-foreground);
      --muted: var(--vscode-descriptionForeground);
      --card: color-mix(in srgb, var(--vscode-editorWidget-background) 92%, transparent);
      --border: var(--vscode-widget-border, rgba(127,127,127,0.25));
      --accent: var(--vscode-button-background);
      --accent-fg: var(--vscode-button-foreground);
      --ok: #2da44e;
      --off: #cf222e;
      --warn: #d29922;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 10px;
      background: radial-gradient(circle at top left, color-mix(in srgb, var(--accent) 15%, var(--bg)) 0%, var(--bg) 52%);
      color: var(--fg);
      font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    .stack { display: grid; gap: 10px; }
    .toolbar, .card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 12px;
      backdrop-filter: blur(12px);
      min-width: 0;
    }
    .toolbar {
      display: grid;
      gap: 10px;
    }
    .toolbar-row {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      align-items: center;
      justify-content: space-between;
    }
    .toolbar-row > * { min-width: 0; }
    .title {
      font-size: 15px;
      font-weight: 700;
      overflow-wrap: anywhere;
    }
    .subtitle {
      color: var(--muted);
      font-size: 12px;
      overflow-wrap: anywhere;
    }
    .status-pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 3px 8px;
      border-radius: 999px;
      background: color-mix(in srgb, var(--accent) 16%, transparent);
      font-weight: 600;
      max-width: 100%;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    select, button {
      border: 1px solid var(--border);
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border-radius: 10px;
      min-height: 32px;
      padding: 0 12px;
      font: inherit;
      max-width: 100%;
      white-space: normal;
      overflow-wrap: anywhere;
      cursor: pointer;
    }
    button.primary {
      background: var(--accent);
      color: var(--accent-fg);
      border-color: transparent;
    }
    .section-title {
      font-weight: 700;
      font-size: 13px;
      margin-bottom: 8px;
    }
    .cards {
      display: grid;
      gap: 12px;
    }
    .section-divider {
      height: 1px;
      border: 0;
      background: linear-gradient(
        90deg,
        transparent 0%,
        color-mix(in srgb, var(--border) 75%, transparent) 20%,
        color-mix(in srgb, var(--border) 75%, transparent) 80%,
        transparent 100%
      );
      margin: 2px 0;
    }
    .card-header {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      gap: 10px;
      align-items: flex-start;
      margin-bottom: 12px;
    }
    .card-header > * { min-width: 0; }
    .card-title {
      font-size: 14px;
      font-weight: 700;
      overflow-wrap: anywhere;
    }
    .card-meta {
      color: var(--muted);
      font-size: 12px;
      word-break: break-all;
    }
    .grid {
      display: grid;
      gap: 8px;
      margin-top: 10px;
    }
    .row {
      display: grid;
      gap: 4px;
    }
    .label {
      color: var(--muted);
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .value {
      word-break: break-word;
    }
    .switch-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 12px 0;
      border-top: 1px solid var(--border);
      border-bottom: 1px solid var(--border);
      margin: 12px 0;
    }
    .switch-copy {
      display: grid;
      gap: 2px;
      flex: 1;
      min-width: 0;
    }
    .switch {
      position: relative;
      width: 40px;
      height: 24px;
      flex: 0 0 auto;
    }
    .switch input {
      opacity: 0;
      width: 0;
      height: 0;
    }
    .slider {
      position: absolute;
      inset: 0;
      cursor: pointer;
      background: color-mix(in srgb, var(--muted) 30%, transparent);
      border-radius: 999px;
      transition: .18s ease;
    }
    .slider::before {
      content: "";
      position: absolute;
      width: 16px;
      height: 16px;
      left: 4px;
      top: 4px;
      background: white;
      border-radius: 50%;
      transition: .18s ease;
    }
    .switch input:checked + .slider {
      background: color-mix(in srgb, var(--off) 78%, white 12%);
    }
    .switch input:checked + .slider::before {
      transform: translateX(16px);
    }
    .hint {
      color: var(--muted);
      font-size: 12px;
    }
    .warning {
      border-left: 3px solid var(--warn);
      padding-left: 10px;
      margin-top: 10px;
    }
    .actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin-top: 10px;
    }
    @media (max-width: 340px) {
      body { padding: 8px; }
      .toolbar, .card { padding: 10px; border-radius: 12px; }
      .toolbar-row { gap: 8px; }
      .title { font-size: 14px; }
      .status-pill { font-size: 11px; }
      .switch-row { align-items: flex-start; }
      .switch { margin-top: 2px; }
      select, button { width: 100%; }
      .actions button { width: 100%; }
    }
  </style>
</head>
<body>
  <div class="stack">
    <section class="toolbar">
      <div class="toolbar-row">
        <div>
          <div class="title">${escapeHtml(strings.appTitle)}</div>
          <div class="subtitle">${escapeHtml(strings.openSidebarHint)}</div>
        </div>
        <button class="primary" data-action="refresh">${escapeHtml(strings.refresh)}</button>
      </div>
      <div class="toolbar-row">
        <div>
          <div class="label">${escapeHtml(strings.language)}</div>
        </div>
        <select id="language">
          <option value="en"${language === 'en' ? ' selected' : ''}>${escapeHtml(strings.languageEnglish)}</option>
          <option value="ko"${language === 'ko' ? ' selected' : ''}>${escapeHtml(strings.languageKorean)}</option>
        </select>
      </div>
      <div class="toolbar-row">
        <span class="label">${escapeHtml(strings.currentWindowStatus)}</span>
        <span class="status-pill">${escapeHtml(statusSummary)}</span>
      </div>
      <div class="hint">${escapeHtml(snapshot.aggregate.reason)}</div>
    </section>

    <section class="cards">
      <div class="section-title">${escapeHtml(strings.globalTitle)}</div>
      ${globalCard}
    </section>

    <hr class="section-divider" />

    <section class="cards">
      <div class="section-title">${escapeHtml(strings.workspaceTitle)}</div>
      ${workspaceCards || `<div class="card"><div class="hint">${escapeHtml(strings.noWorkspaceFolders)}</div></div>`}
    </section>

    <section class="toolbar">
      <button data-action="openControls">${escapeHtml(strings.openControls)}</button>
    </section>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    document.getElementById('language')?.addEventListener('change', (event) => {
      vscode.postMessage({ type: 'setLanguage', language: event.target.value });
    });
    document.querySelectorAll('[data-action="refresh"]').forEach((button) => {
      button.addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
    });
    document.querySelectorAll('[data-action="openControls"]').forEach((button) => {
      button.addEventListener('click', () => vscode.postMessage({ type: 'showActions' }));
    });
    document.querySelectorAll('[data-action="toggle-global"]').forEach((input) => {
      input.addEventListener('change', (event) => vscode.postMessage({
        type: 'toggleGlobal',
        desiredEnabled: event.target.checked
      }));
    });
    document.querySelectorAll('[data-action="toggle-workspace"]').forEach((input) => {
      input.addEventListener('change', (event) => vscode.postMessage({
        type: 'toggleWorkspace',
        folderUri: input.dataset.folderUri,
        desiredEnabled: event.target.checked
      }));
    });
    document.querySelectorAll('[data-action="recommended-global"]').forEach((button) => {
      button.addEventListener('click', () => vscode.postMessage({ type: 'applyRecommendedGlobal' }));
    });
    document.querySelectorAll('[data-action="recommended-workspace"]').forEach((button) => {
      button.addEventListener('click', () => vscode.postMessage({ type: 'applyRecommendedWorkspace', folderUri: button.dataset.folderUri }));
    });
    document.querySelectorAll('[data-action="restore-workspace-rule"]').forEach((button) => {
      button.addEventListener('click', () => vscode.postMessage({ type: 'restoreWorkspaceRule', folderUri: button.dataset.folderUri }));
    });
  </script>
</body>
</html>`;
}

function renderScopeCard(scope: ScopeState, options: {
  language: UiLanguage;
  folderUri?: string;
  effectiveStatus: StatusKind;
  effectiveReason: string;
  globalStatus?: StatusKind;
  globalReason?: string;
}): string {
  const strings = STRINGS[options.language];
  const localMeta = STATUS_META[scope.status];
  const effectiveMeta = STATUS_META[options.effectiveStatus];
  const isChecked = scope.status === 'enabled';
  const toggleTitle = options.folderUri ? strings.blockerToggleLocal : strings.blockerToggleGlobal;
  const switchHint = scope.status === 'unknown'
    ? strings.unknownSwitchHelp
    : isChecked
      ? strings.blockedSwitchHelp
      : strings.enabledSwitchHelp;
  const isOverriddenByGlobal = Boolean(
    options.folderUri
    && options.globalStatus === 'blocked'
    && options.effectiveStatus === 'blocked'
    && scope.status !== 'blocked'
  );
  const toggleAction = options.folderUri ? 'toggle-workspace' : 'toggle-global';
  const recommendedAction = options.folderUri ? 'recommended-workspace' : 'recommended-global';
  const hasRuleWarning = hasManagedRuleWarning(scope, options.effectiveStatus);

  return `<article class="card">
    <div class="card-header">
      <div>
        <div class="card-title">${escapeHtml(scope.name)}</div>
        <div class="card-meta">${escapeHtml(formatShortPath(scope.hooksJsonPath))}</div>
      </div>
      <div class="status-pill">${escapeHtml(`${effectiveMeta.icon} ${statusLabel(options.effectiveStatus, options.language)}`)}</div>
    </div>

    <div class="switch-row">
      <div class="switch-copy">
        <strong>${escapeHtml(toggleTitle)}</strong>
        <span class="hint">${escapeHtml(switchHint)}</span>
      </div>
      <label class="switch">
        <input type="checkbox" data-action="${toggleAction}"${options.folderUri ? ` data-folder-uri="${escapeHtmlAttribute(options.folderUri)}"` : ''}${isChecked ? ' checked' : ''}>
        <span class="slider"></span>
      </label>
    </div>

    ${isOverriddenByGlobal ? `<div class="warning">
      <div class="hint">${escapeHtml(strings.overriddenByGlobal)}</div>
    </div>` : ''}

    <div class="grid">
      <div class="row">
        <div class="label">${escapeHtml(strings.effectiveStatus)}</div>
        <div class="value">${escapeHtml(`${effectiveMeta.icon} ${statusLabel(options.effectiveStatus, options.language)}`)}</div>
      </div>
      <div class="row">
        <div class="label">${escapeHtml(strings.localStatus)}</div>
        <div class="value">${escapeHtml(`${localMeta.icon} ${statusLabel(scope.status, options.language)}`)}</div>
      </div>
      ${options.globalStatus ? `<div class="row">
        <div class="label">${escapeHtml(strings.globalStatus)}</div>
        <div class="value">${escapeHtml(`${STATUS_META[options.globalStatus].icon} ${statusLabel(options.globalStatus, options.language)}`)}</div>
      </div>` : ''}
      <div class="row">
        <div class="label">${escapeHtml(strings.reason)}</div>
        <div class="value">${escapeHtml(options.effectiveReason)}</div>
      </div>
      <div class="row">
        <div class="label">${escapeHtml(strings.configExists)}</div>
        <div class="value">${escapeHtml(scope.configExists ? strings.yes : strings.no)}</div>
      </div>
      <div class="row">
        <div class="label">${escapeHtml(strings.scriptExists)}</div>
        <div class="value">${escapeHtml(scope.scriptExists ? strings.yes : strings.no)}</div>
      </div>
      ${scope.rulePath ? `<div class="row">
        <div class="label">${escapeHtml(strings.ruleExists)}</div>
        <div class="value">${escapeHtml(formatRuleStatus(scope, options.language))}</div>
      </div>` : ''}
    </div>

    ${hasRuleWarning ? `<div class="warning">
      <div><strong>${escapeHtml(strings.ruleWarningTitle)}</strong></div>
      <div class="hint">${escapeHtml(strings.ruleWarningHelp)}</div>
      ${options.folderUri ? `<div class="actions">
        <button data-action="restore-workspace-rule" data-folder-uri="${escapeHtmlAttribute(options.folderUri)}">${escapeHtml(strings.restoreRule)}</button>
      </div>` : ''}
    </div>` : ''}

    ${scope.status === 'unknown' ? `<div class="warning">
      <div><strong>${escapeHtml(strings.customDetected)}</strong></div>
      <div class="hint">${escapeHtml(strings.recommendedHelp)}</div>
      <div class="actions">
        <button data-action="${recommendedAction}"${options.folderUri ? ` data-folder-uri="${escapeHtmlAttribute(options.folderUri)}"` : ''}>${escapeHtml(strings.recommended)}</button>
      </div>
    </div>` : ''}
  </article>`;
}

function formatStatusLine(status: StatusKind, language: UiLanguage): string {
  const meta = STATUS_META[status];
  return `${meta.icon} ${statusLabel(status, language)}`;
}

function statusLabel(status: StatusKind, language: UiLanguage): string {
  const strings = STRINGS[language];
  switch (status) {
    case 'enabled':
      return strings.statusEnabled;
    case 'blocked':
      return strings.statusBlocked;
    case 'mixed':
      return strings.statusMixed;
    case 'unknown':
      return strings.statusUnknown;
    case 'error':
      return strings.statusError;
  }
}

function hasManagedRuleWarning(scope: ScopeState, effectiveStatus: StatusKind): boolean {
  return Boolean(
    scope.rulePath
    && effectiveStatus === 'blocked'
    && (!scope.ruleExists || !scope.ruleMatchesManagedRule)
  );
}

function formatRuleStatus(scope: ScopeState, language: UiLanguage): string {
  const strings = STRINGS[language];

  if (!scope.ruleExists) {
    return strings.ruleMissingValue;
  }

  return scope.ruleMatchesManagedRule ? strings.ruleManagedValue : strings.ruleModifiedValue;
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

function getProjectRulePath(baseDir: string): string {
  return path.join(baseDir, '.cursor', 'rules', MANAGED_RULE_FILE_NAME);
}

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n/g, '\n');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeHtmlAttribute(value: string): string {
  return escapeHtml(value);
}

function createNonce(): string {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

function interpolate(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? '');
}

function isObject(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCommandEntry(value: unknown): value is HooksCommandEntry {
  return isObject(value) && typeof value.command === 'string';
}
