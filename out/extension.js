"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const fs = __importStar(require("fs"));
const fsp = __importStar(require("fs/promises"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const vscode = __importStar(require("vscode"));
const GLOBAL_COMMAND = 'bash ~/.cursor/hooks/block-subagent.sh';
const GLOBAL_TASK_COMMAND = 'bash ~/.cursor/hooks/block-task-tool.sh';
const LEGACY_GLOBAL_COMMAND = 'bash hooks/block-subagent.sh';
const LEGACY_GLOBAL_TASK_COMMAND = 'bash hooks/block-task-tool.sh';
const PROJECT_COMMAND = 'bash .cursor/hooks/block-subagent.sh';
const PROJECT_TASK_COMMAND = 'bash .cursor/hooks/block-task-tool.sh';
const MANAGED_RULE_FILE_NAME = 'cursor-subagent-toggle.mdc';
const MANAGED_RULE_GITIGNORE_ENTRY = `.cursor/rules/${MANAGED_RULE_FILE_NAME}`;
const MANAGED_SCRIPT_GITIGNORE_ENTRY = '.cursor/hooks/block-subagent.sh';
const MANAGED_TASK_SCRIPT_GITIGNORE_ENTRY = '.cursor/hooks/block-task-tool.sh';
const MANAGED_GITIGNORE_ENTRIES = [
    MANAGED_SCRIPT_GITIGNORE_ENTRY,
    MANAGED_TASK_SCRIPT_GITIGNORE_ENTRY,
    MANAGED_RULE_GITIGNORE_ENTRY
];
const MANAGED_GITIGNORE_START = '# Cursor Subagent Toggle: managed generated files';
const HOOKS_JSON_GITIGNORE_ENTRY = '.cursor/hooks.json';
const HOOKS_JSON_GITIGNORE_START = '# Cursor Subagent Toggle: hooks config ignore';
const MANAGED_GITIGNORE_END = '# End Cursor Subagent Toggle';
const BLOCKER_SCRIPT = `#!/bin/bash
# Deny all subagent creation unconditionally.
# Uses exit-0 + JSON permission:deny (the canonical deny pattern).
cat <<'EOF'
{
  "permission": "deny",
  "user_message": "서브에이전트 사용이 훅에 의해 차단되었습니다. 도구를 직접 호출하세요."
}
EOF
exit 0
`;
const TASK_BLOCKER_SCRIPT = `#!/bin/bash
cat <<'EOF'
{
  "permission": "deny",
  "user_message": "Task(서브에이전트) 도구 호출이 차단되었습니다.",
  "agent_message": "Task tool is BLOCKED. You MUST NOT use the Task tool. Instead, directly use Grep, Glob, SemanticSearch, Read, Shell, StrReplace, Write, and other tools yourself. Batch multiple tool calls in a single message for parallelism."
}
EOF
exit 0
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
const GITIGNORE_PREF_PREFIX = 'gitignoreManagedRule:';
const RULE_PREF_PREFIX = 'managedRuleEnabled:';
const STATUS_META = {
    enabled: { icon: '🟢', label: 'ON' },
    blocked: { icon: '🔴', label: 'OFF' },
    mixed: { icon: '🟡', label: 'MIXED' },
    unknown: { icon: '⚪', label: 'CHECK' },
    error: { icon: '🟠', label: 'ERROR' }
};
const STRINGS = {
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
        more: 'More',
        close: 'Close',
        advancedSettings: 'Advanced settings',
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
        taskScriptExists: 'Task blocker script',
        ruleExists: 'project rule',
        ruleManaged: 'rule content',
        ruleManagedValue: 'Managed',
        ruleMissingValue: 'Missing',
        ruleModifiedValue: 'Modified - protected',
        ruleDisabledValue: 'Optional - off',
        optionalRule: 'Also install managed project rule (Recommended off)',
        optionalRuleHelp: 'Adds the managed Cursor rule only when this checkbox is on. Hooks remain the default blocker.',
        optionalRuleDone: '{name}: managed project rule option was updated.',
        gitignoreRule: 'Ignore generated blocker files in git (Recommended on)',
        gitignoreRuleHelp: 'Adds only .cursor/hooks/block-subagent.sh, .cursor/hooks/block-task-tool.sh, and the optional managed rule path to this workspace .gitignore.',
        gitignoreStatus: '.gitignore',
        gitignoreEnabledValue: 'Enabled',
        gitignoreDisabledValue: 'Disabled',
        gitignoreExternalValue: 'Already ignored',
        gitignorePreferenceDone: '{name}: managed rule git ignore preference was updated.',
        hooksJsonGitignoreRule: 'Ignore hooks.json in git (Recommended on)',
        hooksJsonGitignoreRuleHelp: 'Adds only .cursor/hooks.json to this workspace .gitignore.',
        hooksJsonGitignoreStatus: 'hooks.json .gitignore',
        hooksJsonGitignoreDone: '{name}: hooks.json git ignore setting was updated.',
        yes: 'Present',
        no: 'Missing',
        customDetected: 'Custom subagentStart hooks were detected.',
        recommended: 'Apply Recommended Config',
        recommendedHelp: 'This replaces only the managed Task and subagent hook arrays and recreates the extension-managed guard files.',
        ruleWarningTitle: 'Managed project rule needs attention.',
        ruleWarningHelp: 'The hook can still block subagents, but the project rule is missing or was edited. Existing user rules are not touched.',
        restoreRule: 'Restore Project Rule',
        restoreRuleDone: '{name}: managed project rule was restored.',
        unknownSwitchHelp: 'Custom hooks exist, so this switch may not reflect the final behavior.',
        blockedSwitchHelp: 'Switch off to block subagent creation in this scope.',
        enabledSwitchHelp: 'Switch on to allow subagent creation in this scope.',
        overriddenByGlobal: 'Global blocker is ON, so final status remains blocked in this folder.',
        globalNotification: 'Global subagent status',
        recommendedGlobalDone: 'Global hooks were replaced with the recommended blocker config.',
        recommendedWorkspaceDone: '{name}: hooks were replaced with the recommended blocker config.',
        unknownConfirm: 'Custom or partial managed hooks were detected in {path}. Replace only the Task and subagent hook arrays with the recommended blocker config?',
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
        more: '더보기',
        close: '닫기',
        advancedSettings: '고급 설정',
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
        taskScriptExists: 'Task 차단 스크립트',
        ruleExists: 'project rule',
        ruleManaged: 'rule 내용',
        ruleManagedValue: '관리됨',
        ruleMissingValue: '없음',
        ruleModifiedValue: '수정됨 - 보호',
        ruleDisabledValue: '선택 기능 - 꺼짐',
        optionalRule: '관리 project rule도 함께 설치 (권장 off)',
        optionalRuleHelp: '이 체크박스가 켜져 있을 때만 관리 Cursor rule을 추가합니다. 기본 차단은 hooks만 사용합니다.',
        optionalRuleDone: '{name}: 관리 project rule 옵션을 업데이트했습니다.',
        gitignoreRule: '생성된 blocker 파일을 git에서 무시 (권장 on)',
        gitignoreRuleHelp: '이 workspace .gitignore에 .cursor/hooks/block-subagent.sh, .cursor/hooks/block-task-tool.sh 및 선택 관리 rule 경로만 추가합니다.',
        gitignoreStatus: '.gitignore',
        gitignoreEnabledValue: '활성',
        gitignoreDisabledValue: '비활성',
        gitignoreExternalValue: '이미 무시됨',
        gitignorePreferenceDone: '{name}: managed rule git ignore 설정을 업데이트했습니다.',
        hooksJsonGitignoreRule: 'hooks.json을 git에서 무시 (권장 on)',
        hooksJsonGitignoreRuleHelp: '이 workspace .gitignore에 .cursor/hooks.json 파일만 추가합니다.',
        hooksJsonGitignoreStatus: 'hooks.json .gitignore',
        hooksJsonGitignoreDone: '{name}: hooks.json git ignore 설정을 업데이트했습니다.',
        yes: '있음',
        no: '없음',
        customDetected: '커스텀 subagentStart hook이 감지되었습니다.',
        recommended: '권장 설정 적용',
        recommendedHelp: '관리 대상 Task hook과 subagent hook 배열만 교체하고 extension 관리 guard 파일을 다시 생성합니다.',
        ruleWarningTitle: '관리 project rule 확인이 필요합니다.',
        ruleWarningHelp: 'hook은 subagent를 계속 차단할 수 있지만, project rule이 없거나 수정되었습니다. 기존 사용자 rule은 건드리지 않습니다.',
        restoreRule: 'Project Rule 복구',
        restoreRuleDone: '{name}: 관리 project rule을 복구했습니다.',
        unknownSwitchHelp: '커스텀 hook이 있어 이 스위치가 최종 동작을 정확히 반영하지 않을 수 있습니다.',
        blockedSwitchHelp: '스위치를 끄면 이 범위에서 subagent 생성이 차단됩니다.',
        enabledSwitchHelp: '스위치를 켜면 이 범위에서 subagent 생성이 허용됩니다.',
        overriddenByGlobal: '전역 차단이 켜져 있어서 이 폴더의 최종 상태는 비활성으로 유지됩니다.',
        globalNotification: '전역 subagent 상태',
        recommendedGlobalDone: '전역 hooks를 권장 blocker 설정으로 교체했습니다.',
        recommendedWorkspaceDone: '{name}: hooks를 권장 blocker 설정으로 교체했습니다.',
        unknownConfirm: '{path} 에 커스텀 또는 일부 managed hook이 있습니다. Task hook과 subagent hook 배열만 권장 blocker 설정으로 교체할까요?',
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
function activate(context) {
    const controller = new SubagentController(context);
    context.subscriptions.push(controller);
    return controller.activate();
}
function deactivate() { }
class SubagentController {
    constructor(context) {
        this.snapshot = null;
        this.globalWatchTargets = [];
        this.context = context;
        this.statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
        this.statusBar.name = 'Cursor Subagent Toggle';
        this.statusBar.command = 'cursorSubagentToggle.showActions';
        this.sidebarProvider = new SidebarWebviewProvider(context, this);
    }
    async activate() {
        this.context.subscriptions.push(this.statusBar, vscode.window.registerWebviewViewProvider('cursorSubagentToggle.sidebar', this.sidebarProvider, {
            webviewOptions: {
                retainContextWhenHidden: true
            }
        }));
        this.registerCommands();
        this.registerWorkspaceWatchers();
        this.registerGlobalWatchers();
        await this.refresh();
    }
    dispose() {
        this.clearScheduledRefresh();
        if (this.handleGlobalWatchChange) {
            for (const target of this.globalWatchTargets) {
                fs.unwatchFile(target, this.handleGlobalWatchChange);
            }
        }
    }
    registerCommands() {
        this.context.subscriptions.push(vscode.commands.registerCommand('cursorSubagentToggle.showActions', () => this.showActions()), vscode.commands.registerCommand('cursorSubagentToggle.toggleGlobal', () => this.toggleGlobal()), vscode.commands.registerCommand('cursorSubagentToggle.toggleCurrentWorkspaceFolder', () => this.toggleCurrentWorkspaceFolder()), vscode.commands.registerCommand('cursorSubagentToggle.toggleWorkspaceFolder', () => this.toggleWorkspaceFolder()), vscode.commands.registerCommand('cursorSubagentToggle.applyRecommendedGlobal', () => this.applyRecommendedGlobal()), vscode.commands.registerCommand('cursorSubagentToggle.applyRecommendedCurrentWorkspaceFolder', () => this.applyRecommendedCurrentWorkspaceFolder()), vscode.commands.registerCommand('cursorSubagentToggle.applyRecommendedWorkspaceFolder', () => this.applyRecommendedWorkspaceFolder()), vscode.commands.registerCommand('cursorSubagentToggle.refresh', () => this.refresh(true)));
    }
    registerWorkspaceWatchers() {
        const hookWatcher = vscode.workspace.createFileSystemWatcher('**/.cursor/hooks.json');
        const scriptWatcher = vscode.workspace.createFileSystemWatcher('**/.cursor/hooks/block-subagent.sh');
        const taskScriptWatcher = vscode.workspace.createFileSystemWatcher('**/.cursor/hooks/block-task-tool.sh');
        const ruleWatcher = vscode.workspace.createFileSystemWatcher(`**/.cursor/rules/${MANAGED_RULE_FILE_NAME}`);
        const gitignoreWatcher = vscode.workspace.createFileSystemWatcher('**/.gitignore');
        const triggerRefresh = () => this.scheduleRefresh();
        hookWatcher.onDidCreate(triggerRefresh, this, this.context.subscriptions);
        hookWatcher.onDidChange(triggerRefresh, this, this.context.subscriptions);
        hookWatcher.onDidDelete(triggerRefresh, this, this.context.subscriptions);
        scriptWatcher.onDidCreate(triggerRefresh, this, this.context.subscriptions);
        scriptWatcher.onDidChange(triggerRefresh, this, this.context.subscriptions);
        scriptWatcher.onDidDelete(triggerRefresh, this, this.context.subscriptions);
        taskScriptWatcher.onDidCreate(triggerRefresh, this, this.context.subscriptions);
        taskScriptWatcher.onDidChange(triggerRefresh, this, this.context.subscriptions);
        taskScriptWatcher.onDidDelete(triggerRefresh, this, this.context.subscriptions);
        ruleWatcher.onDidCreate(triggerRefresh, this, this.context.subscriptions);
        ruleWatcher.onDidChange(triggerRefresh, this, this.context.subscriptions);
        ruleWatcher.onDidDelete(triggerRefresh, this, this.context.subscriptions);
        gitignoreWatcher.onDidCreate(triggerRefresh, this, this.context.subscriptions);
        gitignoreWatcher.onDidChange(triggerRefresh, this, this.context.subscriptions);
        gitignoreWatcher.onDidDelete(triggerRefresh, this, this.context.subscriptions);
        this.context.subscriptions.push(hookWatcher, scriptWatcher, taskScriptWatcher, ruleWatcher, gitignoreWatcher, vscode.workspace.onDidChangeWorkspaceFolders(() => {
            void this.refresh();
        }), vscode.window.onDidChangeActiveTextEditor(() => this.renderStatusBar()));
    }
    registerGlobalWatchers() {
        this.handleGlobalWatchChange = () => this.scheduleRefresh();
        this.globalWatchTargets = [getGlobalHooksJsonPath(), getGlobalScriptPath(), getGlobalTaskScriptPath()];
        for (const target of this.globalWatchTargets) {
            fs.watchFile(target, { interval: 1000 }, this.handleGlobalWatchChange);
        }
    }
    scheduleRefresh() {
        this.clearScheduledRefresh();
        this.refreshTimer = setTimeout(() => {
            void this.refresh().catch((error) => this.showError(error));
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
            this.sidebarProvider.update(this.snapshot, this.getLanguage());
        }
        catch (error) {
            this.snapshot = buildErrorSnapshot(error);
            this.renderStatusBar();
            this.sidebarProvider.update(this.snapshot, this.getLanguage());
            if (notifyOnError) {
                this.showError(error);
            }
        }
    }
    getSnapshot() {
        return this.snapshot ?? buildErrorSnapshot(new Error('Status is not ready yet.'));
    }
    getLanguage() {
        const stored = this.context.globalState.get(LANGUAGE_KEY);
        if (stored === 'en' || stored === 'ko') {
            return stored;
        }
        return vscode.env.language.toLowerCase().startsWith('ko') ? 'ko' : 'en';
    }
    async setLanguage(language) {
        await this.context.globalState.update(LANGUAGE_KEY, language);
        this.renderStatusBar();
        this.sidebarProvider.update(this.getSnapshot(), language);
    }
    async handleSidebarMessage(message) {
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
                }
                else {
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
                    }
                    else {
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
            case 'toggleWorkspaceRule': {
                const workspaceState = this.findWorkspaceState(message.folderUri);
                if (workspaceState) {
                    await this.setWorkspaceRuleEnabled(workspaceState, message.enabled);
                }
                break;
            }
            case 'toggleWorkspaceGitignore': {
                const workspaceState = this.findWorkspaceState(message.folderUri);
                if (workspaceState) {
                    await this.setWorkspaceGitignoreEnabled(workspaceState, message.enabled);
                }
                break;
            }
            case 'toggleWorkspaceHooksJsonGitignore': {
                const workspaceState = this.findWorkspaceState(message.folderUri);
                if (workspaceState) {
                    await this.setWorkspaceHooksJsonGitignoreEnabled(workspaceState, message.enabled);
                }
                break;
            }
        }
    }
    getWorkspaceGitignoreEnabled(folderUri) {
        return this.context.workspaceState.get(getGitignorePreferenceKey(folderUri), true);
    }
    getWorkspaceRuleEnabled(folderUri) {
        return this.context.workspaceState.get(getRulePreferenceKey(folderUri), false);
    }
    renderStatusBar() {
        const snapshot = this.getSnapshot();
        const language = this.getLanguage();
        const activeWorkspaceState = getActiveWorkspaceState(snapshot.workspaceStates);
        const statusSource = activeWorkspaceState ?? snapshot.aggregate;
        const meta = STATUS_META[statusSource.status] ?? STATUS_META.unknown;
        const title = language === 'ko' ? 'Subagent' : 'Subagent';
        if (activeWorkspaceState && snapshot.workspaceStates.length > 1) {
            this.statusBar.text = `${meta.icon} ${title} ${truncateLabel(activeWorkspaceState.folder.name)} ${meta.label}`;
        }
        else {
            this.statusBar.text = `${meta.icon} ${title} ${meta.label}`;
        }
        this.statusBar.tooltip = buildTooltip(snapshot, activeWorkspaceState, language);
        this.statusBar.show();
    }
    async showActions() {
        await this.refresh();
        const language = this.getLanguage();
        const strings = STRINGS[language];
        const snapshot = this.getSnapshot();
        const picks = [];
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
    async toggleGlobal() {
        const global = this.getSnapshot().globalScope;
        let shouldBlock;
        if (global.status === 'unknown') {
            const confirmed = await confirmRecommendedOverwrite(global, this.getLanguage());
            if (!confirmed) {
                return;
            }
            await applyRecommendedBlock(global);
            shouldBlock = true;
        }
        else {
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
    async setGlobalEnabled(desiredEnabled) {
        const global = this.getSnapshot().globalScope;
        let shouldBlock;
        if (global.status === 'unknown') {
            if (desiredEnabled) {
                await setManagedBlock(global, false);
                shouldBlock = false;
            }
            else {
                const confirmed = await confirmRecommendedOverwrite(global, this.getLanguage());
                if (!confirmed) {
                    await this.refresh();
                    return;
                }
                await applyRecommendedBlock(global);
                shouldBlock = true;
            }
        }
        else {
            shouldBlock = !desiredEnabled;
            await setManagedBlock(global, shouldBlock);
        }
        await this.syncWorkspaceRulesForGlobalBlock(shouldBlock);
        await this.refresh(true);
    }
    async toggleCurrentWorkspaceFolder() {
        await this.refresh();
        const activeWorkspaceState = getActiveWorkspaceState(this.getSnapshot().workspaceStates);
        if (!activeWorkspaceState) {
            vscode.window.showWarningMessage(STRINGS[this.getLanguage()].activeFolderMissing);
            return;
        }
        await this.toggleWorkspaceState(activeWorkspaceState);
    }
    async toggleWorkspaceFolder() {
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
    async toggleWorkspaceState(workspaceState) {
        let shouldBlock;
        if (workspaceState.local.status === 'unknown') {
            const confirmed = await confirmRecommendedOverwrite(workspaceState.local, this.getLanguage());
            if (!confirmed) {
                return;
            }
            await applyRecommendedBlock(workspaceState.local);
            shouldBlock = true;
        }
        else {
            shouldBlock = workspaceState.local.status !== 'blocked';
            await setManagedBlock(workspaceState.local, shouldBlock);
        }
        const effectiveShouldBlock = shouldBlock || this.getSnapshot().globalScope.status === 'blocked';
        await this.syncOptionalWorkspaceRule(workspaceState, effectiveShouldBlock);
        await this.syncGitignoreForRulePresence(workspaceState, effectiveShouldBlock);
        await this.refresh(true);
        const updatedState = this.findWorkspaceState(workspaceState.folder.uri.toString());
        if (!updatedState) {
            return;
        }
        const meta = STATUS_META[updatedState.status] ?? STATUS_META.unknown;
        vscode.window.showInformationMessage(`${updatedState.folder.name}: ${meta.icon} ${meta.label}`);
    }
    async setWorkspaceEnabled(workspaceState, desiredEnabled) {
        let shouldBlock;
        if (workspaceState.local.status === 'unknown') {
            if (desiredEnabled) {
                await setManagedBlock(workspaceState.local, false);
                shouldBlock = false;
            }
            else {
                const confirmed = await confirmRecommendedOverwrite(workspaceState.local, this.getLanguage());
                if (!confirmed) {
                    await this.refresh();
                    return;
                }
                await applyRecommendedBlock(workspaceState.local);
                shouldBlock = true;
            }
        }
        else {
            shouldBlock = !desiredEnabled;
            await setManagedBlock(workspaceState.local, shouldBlock);
        }
        const effectiveShouldBlock = shouldBlock || this.getSnapshot().globalScope.status === 'blocked';
        await this.syncOptionalWorkspaceRule(workspaceState, effectiveShouldBlock);
        await this.syncGitignoreForRulePresence(workspaceState, effectiveShouldBlock);
        await this.refresh(true);
    }
    async applyRecommendedGlobal() {
        await this.applyRecommendedScope(this.getSnapshot().globalScope);
    }
    async applyRecommendedCurrentWorkspaceFolder() {
        await this.refresh();
        const activeWorkspaceState = getActiveWorkspaceState(this.getSnapshot().workspaceStates);
        if (!activeWorkspaceState) {
            vscode.window.showWarningMessage(STRINGS[this.getLanguage()].activeFolderMissing);
            return;
        }
        await this.applyRecommendedScope(activeWorkspaceState.local);
    }
    async applyRecommendedWorkspaceFolder() {
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
    async applyRecommendedScope(scope) {
        await applyRecommendedBlock(scope);
        if (scope.type === 'global') {
            await this.syncWorkspaceRulesForGlobalBlock(true);
        }
        else {
            const workspaceState = this.findWorkspaceState(scope.folder?.uri.toString() ?? '');
            if (workspaceState) {
                await this.syncOptionalWorkspaceRule(workspaceState, true);
                await this.syncGitignoreForRulePresence(workspaceState, true);
            }
        }
        await this.refresh(true);
        const strings = STRINGS[this.getLanguage()];
        if (scope.type === 'global') {
            vscode.window.showInformationMessage(strings.recommendedGlobalDone);
            return;
        }
        vscode.window.showInformationMessage(interpolate(strings.recommendedWorkspaceDone, { name: scope.name }));
    }
    async restoreWorkspaceRule(workspaceState) {
        await this.context.workspaceState.update(getRulePreferenceKey(workspaceState.folder.uri.toString()), true);
        await ensureManagedRule(workspaceState.local.rulePath);
        await this.syncGitignoreForRulePresence(workspaceState, true);
        await this.refresh(true);
        vscode.window.showInformationMessage(interpolate(STRINGS[this.getLanguage()].restoreRuleDone, { name: workspaceState.folder.name }));
    }
    async setWorkspaceRuleEnabled(workspaceState, enabled) {
        const folderUri = workspaceState.folder.uri.toString();
        await this.context.workspaceState.update(getRulePreferenceKey(folderUri), enabled);
        const shouldHaveRule = enabled && workspaceState.status === 'blocked';
        if (shouldHaveRule) {
            await ensureManagedRule(workspaceState.local.rulePath);
            await this.syncGitignoreForRulePresence(workspaceState, true);
        }
        else {
            await deleteManagedRule(workspaceState.local.rulePath);
            await this.syncGitignoreForRulePresence(workspaceState, workspaceState.local.status === 'blocked');
        }
        await this.refresh(true);
        vscode.window.showInformationMessage(interpolate(STRINGS[this.getLanguage()].optionalRuleDone, { name: workspaceState.folder.name }));
    }
    async syncOptionalWorkspaceRule(workspaceState, shouldBlock) {
        if (this.getWorkspaceRuleEnabled(workspaceState.folder.uri.toString()) && shouldBlock) {
            await ensureManagedRule(workspaceState.local.rulePath);
            return;
        }
        await deleteManagedRule(workspaceState.local.rulePath);
    }
    async setWorkspaceGitignoreEnabled(workspaceState, enabled) {
        const folderUri = workspaceState.folder.uri.toString();
        await this.context.workspaceState.update(getGitignorePreferenceKey(folderUri), enabled);
        await this.syncGitignoreForRulePresence(workspaceState, workspaceState.status === 'blocked');
        await this.refresh(true);
        vscode.window.showInformationMessage(interpolate(STRINGS[this.getLanguage()].gitignorePreferenceDone, { name: workspaceState.folder.name }));
    }
    async setWorkspaceHooksJsonGitignoreEnabled(workspaceState, enabled) {
        if (!workspaceState.local.gitignorePath) {
            return;
        }
        if (enabled) {
            await ensureHooksJsonGitignoreEntry(workspaceState.local.gitignorePath);
        }
        else {
            await deleteHooksJsonGitignoreBlock(workspaceState.local.gitignorePath);
        }
        await this.refresh(true);
        vscode.window.showInformationMessage(interpolate(STRINGS[this.getLanguage()].hooksJsonGitignoreDone, { name: workspaceState.folder.name }));
    }
    async syncGitignoreForRulePresence(workspaceState, ruleShouldExist) {
        if (!workspaceState.local.gitignorePath) {
            return;
        }
        if (ruleShouldExist && this.getWorkspaceGitignoreEnabled(workspaceState.folder.uri.toString())) {
            await ensureManagedGitignoreEntry(workspaceState.local.gitignorePath);
            return;
        }
        await deleteManagedGitignoreBlock(workspaceState.local.gitignorePath);
    }
    async syncWorkspaceRulesForGlobalBlock(shouldBlock) {
        const folders = vscode.workspace.workspaceFolders ?? [];
        const scopes = await Promise.all(folders.map((folder) => inspectProjectScope(folder)));
        if (shouldBlock) {
            await Promise.all(scopes.map(async (scope) => {
                const workspaceState = this.getWorkspaceStateForScope(scope);
                if (workspaceState) {
                    const shouldSyncGeneratedIgnores = scope.status === 'blocked'
                        || this.getWorkspaceRuleEnabled(workspaceState.folder.uri.toString());
                    await this.syncOptionalWorkspaceRule(workspaceState, true);
                    await this.syncGitignoreForRulePresence(workspaceState, shouldSyncGeneratedIgnores);
                }
            }));
            return;
        }
        await Promise.all(scopes
            .filter((scope) => scope.status !== 'blocked')
            .map(async (scope) => {
            await deleteManagedRule(scope.rulePath);
            const workspaceState = this.getWorkspaceStateForScope(scope);
            if (workspaceState) {
                await this.syncGitignoreForRulePresence(workspaceState, false);
            }
        }));
    }
    getWorkspaceStateForScope(scope) {
        if (!scope.folder) {
            return undefined;
        }
        return this.findWorkspaceState(scope.folder.uri.toString());
    }
    findWorkspaceState(folderUri) {
        return this.getSnapshot().workspaceStates.find((state) => state.folder.uri.toString() === folderUri);
    }
    showError(error) {
        const message = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`Cursor Subagent Toggle: ${message}`);
    }
}
class SidebarWebviewProvider {
    constructor(context, controller) {
        this.context = context;
        this.controller = controller;
    }
    resolveWebviewView(webviewView) {
        this.view = webviewView;
        webviewView.webview.options = {
            enableScripts: true
        };
        webviewView.webview.onDidReceiveMessage((message) => {
            void this.controller.handleSidebarMessage(message);
        });
        this.update(this.controller.getSnapshot(), this.controller.getLanguage());
    }
    update(snapshot, language) {
        if (!this.view) {
            return;
        }
        this.view.webview.html = renderSidebarHtml(this.view.webview, snapshot, language, this.controller);
    }
}
async function buildSnapshot() {
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
function buildErrorSnapshot(error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
        globalScope: {
            type: 'global',
            name: 'Global',
            baseDir: getGlobalCursorDir(),
            hooksJsonPath: getGlobalHooksJsonPath(),
            scriptPath: getGlobalScriptPath(),
            taskScriptPath: getGlobalTaskScriptPath(),
            managedCommand: GLOBAL_COMMAND,
            managedTaskCommand: GLOBAL_TASK_COMMAND,
            configExists: false,
            scriptExists: false,
            scriptLooksLikeBlocker: false,
            taskScriptExists: false,
            taskScriptLooksLikeBlocker: false,
            ruleExists: false,
            ruleMatchesManagedRule: false,
            gitignoreExists: false,
            gitignoreHasManagedRuleEntry: false,
            gitignoreHasManagedScriptEntry: false,
            gitignoreHasManagedTaskScriptEntry: false,
            gitignoreHasAllManagedEntries: false,
            gitignoreHasManagedBlock: false,
            gitignoreHasHooksJsonEntry: false,
            gitignoreHasHooksJsonBlock: false,
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
async function inspectGlobalScope() {
    return inspectScope({
        type: 'global',
        name: 'Global',
        baseDir: getGlobalCursorDir(),
        hooksJsonPath: getGlobalHooksJsonPath(),
        scriptPath: getGlobalScriptPath(),
        taskScriptPath: getGlobalTaskScriptPath(),
        managedCommand: GLOBAL_COMMAND,
        managedTaskCommand: GLOBAL_TASK_COMMAND,
        legacyManagedCommands: [LEGACY_GLOBAL_COMMAND],
        legacyManagedTaskCommands: [LEGACY_GLOBAL_TASK_COMMAND]
    });
}
async function inspectProjectScope(folder) {
    return inspectScope({
        type: 'project',
        name: folder.name,
        folder,
        baseDir: folder.uri.fsPath,
        hooksJsonPath: path.join(folder.uri.fsPath, '.cursor', 'hooks.json'),
        scriptPath: path.join(folder.uri.fsPath, '.cursor', 'hooks', 'block-subagent.sh'),
        taskScriptPath: path.join(folder.uri.fsPath, '.cursor', 'hooks', 'block-task-tool.sh'),
        rulePath: getProjectRulePath(folder.uri.fsPath),
        gitignorePath: path.join(folder.uri.fsPath, '.gitignore'),
        managedCommand: PROJECT_COMMAND,
        managedTaskCommand: PROJECT_TASK_COMMAND
    });
}
async function inspectScope(scope) {
    const configState = await readJsonFile(scope.hooksJsonPath);
    const scriptState = await readScriptFile(scope.scriptPath);
    const taskScriptState = await readScriptFile(scope.taskScriptPath);
    const ruleState = await readRuleFile(scope.rulePath);
    const gitignoreState = await readGitignoreFile(scope.gitignorePath);
    const base = {
        ...scope,
        configExists: configState.exists,
        scriptExists: scriptState.exists,
        scriptLooksLikeBlocker: scriptState.looksLikeBlocker,
        taskScriptExists: taskScriptState.exists,
        taskScriptLooksLikeBlocker: taskScriptState.looksLikeBlocker,
        ruleExists: ruleState.exists,
        ruleMatchesManagedRule: ruleState.matchesManagedRule,
        gitignoreExists: gitignoreState.exists,
        gitignoreHasManagedRuleEntry: gitignoreState.hasManagedRuleEntry,
        gitignoreHasManagedScriptEntry: gitignoreState.hasManagedScriptEntry,
        gitignoreHasManagedTaskScriptEntry: gitignoreState.hasManagedTaskScriptEntry,
        gitignoreHasAllManagedEntries: gitignoreState.hasAllManagedEntries,
        gitignoreHasManagedBlock: gitignoreState.hasManagedBlock,
        gitignoreHasHooksJsonEntry: gitignoreState.hasHooksJsonEntry,
        gitignoreHasHooksJsonBlock: gitignoreState.hasHooksJsonBlock
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
    const preToolUseHooks = hooksRoot?.preToolUse;
    const subagentHooks = hooksRoot?.subagentStart;
    if (preToolUseHooks !== undefined && !Array.isArray(preToolUseHooks)) {
        return {
            ...base,
            status: 'error',
            reason: `preToolUse must be an array in ${formatShortPath(scope.hooksJsonPath)}`
        };
    }
    if (subagentHooks !== undefined && !Array.isArray(subagentHooks)) {
        return {
            ...base,
            status: 'error',
            reason: `subagentStart must be an array in ${formatShortPath(scope.hooksJsonPath)}`
        };
    }
    const hookEntries = Array.isArray(subagentHooks) ? subagentHooks : [];
    const taskHookEntries = Array.isArray(preToolUseHooks) ? preToolUseHooks : [];
    const commandEntries = hookEntries.map((entry, index) => ({
        index,
        command: isCommandEntry(entry) ? entry.command : undefined
    }));
    const taskCommandEntries = taskHookEntries.map((entry, index) => ({
        index,
        command: isCommandEntry(entry) ? entry.command : undefined
    }));
    const managedCommands = getManagedCommands(scope);
    const managedTaskCommands = getManagedTaskCommands(scope);
    const managedIndex = commandEntries.findIndex((entry) => entry.command !== undefined && managedCommands.includes(entry.command));
    const managedTaskIndex = taskCommandEntries.findIndex((entry) => entry.command !== undefined && managedTaskCommands.includes(entry.command));
    const hasAnySubagentHooks = hookEntries.length > 0;
    const hasCustomCommands = commandEntries.some((entry) => entry.command && !managedCommands.includes(entry.command));
    const hasInvalidEntries = hookEntries.some((entry) => !isCommandEntry(entry));
    if (managedIndex === 0 && managedTaskIndex === 0) {
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
        if (!taskScriptState.exists) {
            return {
                ...base,
                status: 'error',
                reason: `Managed Task blocker is configured, but ${formatShortPath(scope.taskScriptPath)} is missing`
            };
        }
        if (!taskScriptState.looksLikeBlocker) {
            return {
                ...base,
                status: 'unknown',
                reason: `Managed Task blocker command exists, but ${formatShortPath(scope.taskScriptPath)} no longer matches the expected deny helper`
            };
        }
        return {
            ...base,
            status: 'blocked',
            reason: 'Managed blocker is active'
        };
    }
    if (managedIndex >= 0 || managedTaskIndex >= 0) {
        if (managedIndex > 0 || managedTaskIndex > 0) {
            return {
                ...base,
                status: 'unknown',
                reason: 'Managed blocker exists, but it is not the first managed hook'
            };
        }
        return {
            ...base,
            status: 'unknown',
            reason: 'Only part of the recommended managed hook pair is configured'
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
    const blockers = [];
    const uncertainScopes = [];
    const brokenScopes = [];
    if (globalScope.status === 'blocked') {
        blockers.push('global');
    }
    else if (globalScope.status === 'error') {
        brokenScopes.push('global');
    }
    else if (globalScope.status === 'unknown') {
        uncertainScopes.push('global');
    }
    if (localScope.status === 'blocked') {
        blockers.push('folder');
    }
    else if (localScope.status === 'error') {
        brokenScopes.push('folder');
    }
    else if (localScope.status === 'unknown') {
        uncertainScopes.push('folder');
    }
    if (blockers.length > 0) {
        return {
            folder: localScope.folder,
            local: localScope,
            global: globalScope,
            status: 'blocked',
            reason: blockers.length === 2 ? 'Blocked by global and folder scopes' : `Blocked by ${blockers[0]} scope`
        };
    }
    if (brokenScopes.length > 0) {
        return {
            folder: localScope.folder,
            local: localScope,
            global: globalScope,
            status: 'error',
            reason: `Cannot confirm final state because ${brokenScopes.join(' and ')} scope is misconfigured`
        };
    }
    if (uncertainScopes.length > 0) {
        return {
            folder: localScope.folder,
            local: localScope,
            global: globalScope,
            status: 'unknown',
            reason: `Cannot confirm final state because ${uncertainScopes.join(' and ')} scope has custom or ambiguous hooks`
        };
    }
    return {
        folder: localScope.folder,
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
    const data = await loadEditableHooksConfig(scope.hooksJsonPath);
    const existing = Array.isArray(data.hooks.subagentStart) ? [...data.hooks.subagentStart] : [];
    const existingTaskHooks = Array.isArray(data.hooks.preToolUse) ? [...data.hooks.preToolUse] : [];
    const managedCommands = getManagedCommands(scope);
    const managedTaskCommands = getManagedTaskCommands(scope);
    const withoutManaged = existing.filter((entry) => !managedCommands.includes(entry.command));
    const withoutManagedTaskHooks = existingTaskHooks.filter((entry) => !managedTaskCommands.includes(entry.command));
    if (shouldBlock) {
        withoutManaged.unshift({ command: scope.managedCommand, failClosed: true });
        withoutManagedTaskHooks.unshift({ command: scope.managedTaskCommand, matcher: 'Task', failClosed: true });
        await ensureManagedScripts(scope);
    }
    await writeManagedHookArrays(scope.hooksJsonPath, data, withoutManagedTaskHooks.length > 0 ? withoutManagedTaskHooks : undefined, withoutManaged.length > 0 ? withoutManaged : undefined);
}
async function applyRecommendedBlock(scope) {
    const data = await loadEditableHooksConfig(scope.hooksJsonPath);
    await ensureManagedScripts(scope);
    await writeManagedHookArrays(scope.hooksJsonPath, data, [{ command: scope.managedTaskCommand, matcher: 'Task', failClosed: true }], [{ command: scope.managedCommand, failClosed: true }]);
}
async function loadEditableHooksConfig(hooksJsonPath) {
    const configState = await readJsonFile(hooksJsonPath);
    if (configState.error) {
        throw new Error(`Fix invalid JSON first: ${formatShortPath(hooksJsonPath)}`);
    }
    if (isObject(configState.data) && configState.data.hooks !== undefined) {
        if (!isObject(configState.data.hooks)) {
            throw new Error(`Fix invalid hooks object first: ${formatShortPath(hooksJsonPath)}`);
        }
        if (configState.data.hooks.preToolUse !== undefined && !Array.isArray(configState.data.hooks.preToolUse)) {
            throw new Error(`Fix invalid preToolUse first: ${formatShortPath(hooksJsonPath)}`);
        }
        if (configState.data.hooks.subagentStart !== undefined && !Array.isArray(configState.data.hooks.subagentStart)) {
            throw new Error(`Fix invalid subagentStart first: ${formatShortPath(hooksJsonPath)}`);
        }
    }
    return normalizeHooksConfig(configState.data);
}
async function writeManagedHookArrays(hooksJsonPath, config, preToolUse, subagentStart) {
    if (preToolUse && preToolUse.length > 0) {
        config.hooks.preToolUse = preToolUse;
    }
    else {
        delete config.hooks.preToolUse;
    }
    if (subagentStart && subagentStart.length > 0) {
        config.hooks.subagentStart = subagentStart;
    }
    else {
        delete config.hooks.subagentStart;
    }
    await fsp.mkdir(path.dirname(hooksJsonPath), { recursive: true });
    await fsp.writeFile(hooksJsonPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}
function normalizeHooksConfig(input) {
    const base = isObject(input) ? { ...input } : {};
    const hooks = isObject(base.hooks) ? { ...base.hooks } : {};
    return {
        ...base,
        version: typeof base.version === 'number' ? base.version : 1,
        hooks
    };
}
function getManagedCommands(scope) {
    return [scope.managedCommand, ...(scope.legacyManagedCommands ?? [])];
}
function getManagedTaskCommands(scope) {
    return [scope.managedTaskCommand, ...(scope.legacyManagedTaskCommands ?? [])];
}
async function ensureManagedScripts(scope) {
    await Promise.all([
        ensureManagedScript(scope.scriptPath, BLOCKER_SCRIPT),
        ensureManagedScript(scope.taskScriptPath, TASK_BLOCKER_SCRIPT)
    ]);
}
async function ensureManagedScript(scriptPath, contents) {
    await fsp.mkdir(path.dirname(scriptPath), { recursive: true });
    await fsp.writeFile(scriptPath, contents, 'utf8');
    await fsp.chmod(scriptPath, 0o755);
}
async function ensureManagedRule(rulePath) {
    if (!rulePath) {
        return;
    }
    await fsp.mkdir(path.dirname(rulePath), { recursive: true });
    await fsp.writeFile(rulePath, MANAGED_RULE, 'utf8');
}
async function deleteManagedRule(rulePath) {
    if (!rulePath) {
        return;
    }
    const ruleState = await readRuleFile(rulePath);
    if (!ruleState.exists || !ruleState.matchesManagedRule) {
        return;
    }
    await fsp.unlink(rulePath);
}
async function ensureManagedGitignoreEntry(gitignorePath) {
    if (!gitignorePath) {
        return;
    }
    const existing = await readGitignoreRaw(gitignorePath);
    const managedBlock = `${MANAGED_GITIGNORE_START}\n${MANAGED_GITIGNORE_ENTRIES.join('\n')}\n${MANAGED_GITIGNORE_END}\n`;
    if (existing === undefined) {
        await fsp.writeFile(gitignorePath, managedBlock, 'utf8');
        return;
    }
    const gitignoreState = parseGitignoreState(existing);
    if (gitignoreState.hasAllManagedEntries) {
        return;
    }
    const normalized = normalizeLineEndings(existing);
    const separator = normalized.length > 0 && !normalized.endsWith('\n') ? '\n' : '';
    const spacer = normalized.length > 0 && !normalized.endsWith('\n\n') ? '\n' : '';
    await fsp.writeFile(gitignorePath, `${normalized}${separator}${spacer}${managedBlock}`, 'utf8');
}
async function deleteManagedGitignoreBlock(gitignorePath) {
    if (!gitignorePath) {
        return;
    }
    const existing = await readGitignoreRaw(gitignorePath);
    if (existing === undefined) {
        return;
    }
    const next = removeManagedGitignoreBlock(existing);
    if (next === existing) {
        return;
    }
    await fsp.writeFile(gitignorePath, next, 'utf8');
}
async function ensureHooksJsonGitignoreEntry(gitignorePath) {
    if (!gitignorePath) {
        return;
    }
    const existing = await readGitignoreRaw(gitignorePath);
    const hooksJsonBlock = `${HOOKS_JSON_GITIGNORE_START}\n${HOOKS_JSON_GITIGNORE_ENTRY}\n${MANAGED_GITIGNORE_END}\n`;
    if (existing === undefined) {
        await fsp.writeFile(gitignorePath, hooksJsonBlock, 'utf8');
        return;
    }
    const gitignoreState = parseGitignoreState(existing);
    if (gitignoreState.hasHooksJsonEntry) {
        return;
    }
    const normalized = normalizeLineEndings(existing);
    const separator = normalized.length > 0 && !normalized.endsWith('\n') ? '\n' : '';
    const spacer = normalized.length > 0 && !normalized.endsWith('\n\n') ? '\n' : '';
    await fsp.writeFile(gitignorePath, `${normalized}${separator}${spacer}${hooksJsonBlock}`, 'utf8');
}
async function deleteHooksJsonGitignoreBlock(gitignorePath) {
    if (!gitignorePath) {
        return;
    }
    const existing = await readGitignoreRaw(gitignorePath);
    if (existing === undefined) {
        return;
    }
    const next = removeGitignoreBlock(existing, HOOKS_JSON_GITIGNORE_START);
    if (next === existing) {
        return;
    }
    await fsp.writeFile(gitignorePath, next, 'utf8');
}
async function readJsonFile(filePath) {
    try {
        const raw = await fsp.readFile(filePath, 'utf8');
        return {
            exists: true,
            data: JSON.parse(raw)
        };
    }
    catch (error) {
        const nodeError = error;
        if (nodeError.code === 'ENOENT') {
            return { exists: false };
        }
        if (error instanceof SyntaxError) {
            return { exists: true, error };
        }
        throw error;
    }
}
async function readGitignoreRaw(filePath) {
    try {
        return await fsp.readFile(filePath, 'utf8');
    }
    catch (error) {
        const nodeError = error;
        if (nodeError.code === 'ENOENT') {
            return undefined;
        }
        throw error;
    }
}
async function readGitignoreFile(filePath) {
    if (!filePath) {
        return {
            exists: false,
            hasManagedRuleEntry: false,
            hasManagedScriptEntry: false,
            hasManagedTaskScriptEntry: false,
            hasAllManagedEntries: false,
            hasManagedBlock: false,
            hasHooksJsonEntry: false,
            hasHooksJsonBlock: false
        };
    }
    const raw = await readGitignoreRaw(filePath);
    if (raw === undefined) {
        return {
            exists: false,
            hasManagedRuleEntry: false,
            hasManagedScriptEntry: false,
            hasManagedTaskScriptEntry: false,
            hasAllManagedEntries: false,
            hasManagedBlock: false,
            hasHooksJsonEntry: false,
            hasHooksJsonBlock: false
        };
    }
    return {
        exists: true,
        ...parseGitignoreState(raw)
    };
}
async function readRuleFile(filePath) {
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
    }
    catch (error) {
        const nodeError = error;
        if (nodeError.code === 'ENOENT') {
            return {
                exists: false,
                matchesManagedRule: false
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
            looksLikeBlocker: normalized.includes('"permission": "deny"')
                && (normalized.includes('exit 0') || normalized.includes('exit 2'))
        };
    }
    catch (error) {
        const nodeError = error;
        if (nodeError.code === 'ENOENT') {
            return {
                exists: false,
                looksLikeBlocker: false
            };
        }
        throw error;
    }
}
async function confirmRecommendedOverwrite(scope, language) {
    const strings = STRINGS[language];
    const response = await vscode.window.showWarningMessage(interpolate(strings.unknownConfirm, { path: formatShortPath(scope.hooksJsonPath) }), strings.recommended);
    return response === strings.recommended;
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
async function pickWorkspaceState(workspaceStates, language) {
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
function buildTooltip(snapshot, activeWorkspaceState, language) {
    const strings = STRINGS[language];
    const lines = [];
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
function renderSidebarHtml(webview, snapshot, language, controller) {
    const strings = STRINGS[language];
    const nonce = createNonce();
    const statusSummary = formatStatusLine(snapshot.aggregate.status, language);
    const globalCard = renderScopeCard(snapshot.globalScope, {
        language,
        folderUri: undefined,
        effectiveStatus: snapshot.globalScope.status,
        effectiveReason: snapshot.globalScope.reason
    });
    const workspaceCards = snapshot.workspaceStates.map((state) => renderScopeCard(state.local, {
        language,
        folderUri: state.folder.uri.toString(),
        effectiveStatus: state.status,
        effectiveReason: state.reason,
        globalStatus: state.global.status,
        globalReason: state.global.reason,
        gitignorePreferenceEnabled: controller.getWorkspaceGitignoreEnabled(state.folder.uri.toString()),
        rulePreferenceEnabled: controller.getWorkspaceRuleEnabled(state.folder.uri.toString())
    })).join('');
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
    .checkbox-row {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      padding: 10px 0;
      border-bottom: 1px solid var(--border);
      margin-bottom: 10px;
    }
    .checkbox-row input {
      width: 16px;
      height: 16px;
      margin: 2px 0 0;
      flex: 0 0 auto;
      accent-color: var(--accent);
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
    .modal {
      position: fixed;
      inset: 0;
      display: none;
      align-items: center;
      justify-content: center;
      padding: 16px;
      background: rgba(0, 0, 0, 0.45);
      z-index: 10;
    }
    .modal.is-open {
      display: flex;
    }
    .modal-panel {
      width: min(100%, 360px);
      max-height: 86vh;
      overflow: auto;
      background: var(--vscode-editorWidget-background);
      color: var(--fg);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 14px;
      box-shadow: 0 12px 36px rgba(0, 0, 0, 0.35);
    }
    .modal-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 10px;
    }
    .modal-title {
      font-weight: 700;
      overflow-wrap: anywhere;
    }
    .icon-button {
      width: 32px;
      min-height: 32px;
      padding: 0;
      flex: 0 0 auto;
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
    document.querySelectorAll('[data-action="open-workspace-settings"]').forEach((button) => {
      button.addEventListener('click', () => {
        const modal = Array.from(document.querySelectorAll('[data-settings-modal]')).find((item) => item.dataset.folderUri === button.dataset.folderUri);
        modal?.classList.add('is-open');
        modal?.setAttribute('aria-hidden', 'false');
      });
    });
    document.querySelectorAll('[data-action="close-workspace-settings"]').forEach((button) => {
      button.addEventListener('click', () => {
        const modal = button.closest('[data-settings-modal]');
        modal?.classList.remove('is-open');
        modal?.setAttribute('aria-hidden', 'true');
      });
    });
    document.querySelectorAll('[data-settings-modal]').forEach((modal) => {
      modal.addEventListener('click', (event) => {
        if (event.target === modal) {
          modal.classList.remove('is-open');
          modal.setAttribute('aria-hidden', 'true');
        }
      });
    });
    document.querySelectorAll('[data-action="toggle-workspace-rule"]').forEach((input) => {
      input.addEventListener('change', (event) => vscode.postMessage({
        type: 'toggleWorkspaceRule',
        folderUri: input.dataset.folderUri,
        enabled: event.target.checked
      }));
    });
    document.querySelectorAll('[data-action="toggle-workspace-gitignore"]').forEach((input) => {
      input.addEventListener('change', (event) => vscode.postMessage({
        type: 'toggleWorkspaceGitignore',
        folderUri: input.dataset.folderUri,
        enabled: event.target.checked
      }));
    });
    document.querySelectorAll('[data-action="toggle-workspace-hooks-json-gitignore"]').forEach((input) => {
      input.addEventListener('change', (event) => vscode.postMessage({
        type: 'toggleWorkspaceHooksJsonGitignore',
        folderUri: input.dataset.folderUri,
        enabled: event.target.checked
      }));
    });
  </script>
</body>
</html>`;
}
function renderScopeCard(scope, options) {
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
    const isOverriddenByGlobal = Boolean(options.folderUri
        && options.globalStatus === 'blocked'
        && options.effectiveStatus === 'blocked'
        && scope.status !== 'blocked');
    const toggleAction = options.folderUri ? 'toggle-workspace' : 'toggle-global';
    const recommendedAction = options.folderUri ? 'recommended-workspace' : 'recommended-global';
    const hasRuleWarning = Boolean(options.rulePreferenceEnabled) && hasManagedRuleWarning(scope, options.effectiveStatus);
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

    ${options.folderUri ? `<label class="checkbox-row">
      <input type="checkbox" data-action="toggle-workspace-gitignore" data-folder-uri="${escapeHtmlAttribute(options.folderUri)}"${scope.gitignoreHasAllManagedEntries ? ' checked' : ''}>
      <span class="switch-copy">
        <strong>${escapeHtml(strings.gitignoreRule)}</strong>
        <span class="hint">${escapeHtml(strings.gitignoreRuleHelp)}</span>
      </span>
    </label>
    <label class="checkbox-row">
      <input type="checkbox" data-action="toggle-workspace-hooks-json-gitignore" data-folder-uri="${escapeHtmlAttribute(options.folderUri)}"${scope.gitignoreHasHooksJsonEntry ? ' checked' : ''}>
      <span class="switch-copy">
        <strong>${escapeHtml(strings.hooksJsonGitignoreRule)}</strong>
        <span class="hint">${escapeHtml(strings.hooksJsonGitignoreRuleHelp)}</span>
      </span>
    </label>
    <div class="actions">
      <button data-action="open-workspace-settings" data-folder-uri="${escapeHtmlAttribute(options.folderUri)}">${escapeHtml(strings.more)}</button>
    </div>
    <div class="modal" data-settings-modal data-folder-uri="${escapeHtmlAttribute(options.folderUri)}" aria-hidden="true">
      <div class="modal-panel" role="dialog" aria-modal="true" aria-label="${escapeHtmlAttribute(strings.advancedSettings)}">
        <div class="modal-header">
          <div>
            <div class="modal-title">${escapeHtml(strings.advancedSettings)}</div>
            <div class="hint">${escapeHtml(scope.name)}</div>
          </div>
          <button class="icon-button" data-action="close-workspace-settings" aria-label="${escapeHtmlAttribute(strings.close)}">x</button>
        </div>
        <label class="checkbox-row">
          <input type="checkbox" data-action="toggle-workspace-rule" data-folder-uri="${escapeHtmlAttribute(options.folderUri)}"${options.rulePreferenceEnabled ? ' checked' : ''}>
          <span class="switch-copy">
            <strong>${escapeHtml(strings.optionalRule)}</strong>
            <span class="hint">${escapeHtml(strings.optionalRuleHelp)}</span>
          </span>
        </label>
      </div>
    </div>` : ''}

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
      <div class="row">
        <div class="label">${escapeHtml(strings.taskScriptExists)}</div>
        <div class="value">${escapeHtml(scope.taskScriptExists ? strings.yes : strings.no)}</div>
      </div>
      ${scope.rulePath ? `<div class="row">
        <div class="label">${escapeHtml(strings.ruleExists)}</div>
        <div class="value">${escapeHtml(formatRuleStatus(scope, options.language, options.rulePreferenceEnabled === true))}</div>
      </div>
      <div class="row">
        <div class="label">${escapeHtml(strings.gitignoreStatus)}</div>
        <div class="value">${escapeHtml(formatGitignoreStatus(scope, options.gitignorePreferenceEnabled !== false, options.language))}</div>
      </div>
      <div class="row">
        <div class="label">${escapeHtml(strings.hooksJsonGitignoreStatus)}</div>
        <div class="value">${escapeHtml(formatHooksJsonGitignoreStatus(scope, options.language))}</div>
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
function formatStatusLine(status, language) {
    const meta = STATUS_META[status];
    return `${meta.icon} ${statusLabel(status, language)}`;
}
function statusLabel(status, language) {
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
function hasManagedRuleWarning(scope, effectiveStatus) {
    return Boolean(scope.rulePath
        && effectiveStatus === 'blocked'
        && (!scope.ruleExists || !scope.ruleMatchesManagedRule));
}
function formatRuleStatus(scope, language, rulePreferenceEnabled = true) {
    const strings = STRINGS[language];
    if (!rulePreferenceEnabled && !scope.ruleExists) {
        return strings.ruleDisabledValue;
    }
    if (!scope.ruleExists) {
        return strings.ruleMissingValue;
    }
    return scope.ruleMatchesManagedRule ? strings.ruleManagedValue : strings.ruleModifiedValue;
}
function formatGitignoreStatus(scope, preferenceEnabled, language) {
    const strings = STRINGS[language];
    if (!preferenceEnabled) {
        return strings.gitignoreDisabledValue;
    }
    if (scope.gitignoreHasAllManagedEntries && !scope.gitignoreHasManagedBlock) {
        return strings.gitignoreExternalValue;
    }
    return scope.gitignoreHasAllManagedEntries ? strings.gitignoreEnabledValue : strings.gitignoreDisabledValue;
}
function formatHooksJsonGitignoreStatus(scope, language) {
    const strings = STRINGS[language];
    if (scope.gitignoreHasHooksJsonEntry && !scope.gitignoreHasHooksJsonBlock) {
        return strings.gitignoreExternalValue;
    }
    return scope.gitignoreHasHooksJsonEntry ? strings.gitignoreEnabledValue : strings.gitignoreDisabledValue;
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
function getGlobalTaskScriptPath() {
    return path.join(getGlobalCursorDir(), 'hooks', 'block-task-tool.sh');
}
function getProjectRulePath(baseDir) {
    return path.join(baseDir, '.cursor', 'rules', MANAGED_RULE_FILE_NAME);
}
function getGitignorePreferenceKey(folderUri) {
    return `${GITIGNORE_PREF_PREFIX}${folderUri}`;
}
function getRulePreferenceKey(folderUri) {
    return `${RULE_PREF_PREFIX}${folderUri}`;
}
function normalizeLineEndings(value) {
    return value.replace(/\r\n/g, '\n');
}
function parseGitignoreState(raw) {
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
function removeManagedGitignoreBlock(raw) {
    return removeGitignoreBlock(raw, MANAGED_GITIGNORE_START);
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
    return trimTrailingBlankLines(nextLines).join('\n');
}
function trimTrailingBlankLines(lines) {
    const next = [...lines];
    while (next.length > 0 && next[next.length - 1] === '') {
        next.pop();
    }
    return next.length > 0 ? [...next, ''] : [];
}
function escapeHtml(value) {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
function escapeHtmlAttribute(value) {
    return escapeHtml(value);
}
function createNonce() {
    return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}
function interpolate(template, values) {
    return template.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? '');
}
function isObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function isCommandEntry(value) {
    return isObject(value) && typeof value.command === 'string';
}
