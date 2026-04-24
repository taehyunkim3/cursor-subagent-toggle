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
const core_1 = require("./core");
const i18n_1 = require("./i18n");
const ui_1 = require("./ui");
const GLOBAL_COMMAND = 'bash ./hooks/block-subagent.sh';
const GLOBAL_TASK_COMMAND = 'bash ./hooks/block-task-tool.sh';
const LEGACY_GLOBAL_COMMANDS = ['bash ~/.cursor/hooks/block-subagent.sh', 'bash hooks/block-subagent.sh'];
const LEGACY_GLOBAL_TASK_COMMANDS = ['bash ~/.cursor/hooks/block-task-tool.sh', 'bash hooks/block-task-tool.sh'];
const PROJECT_COMMAND = 'bash .cursor/hooks/block-subagent.sh';
const PROJECT_TASK_COMMAND = 'bash .cursor/hooks/block-task-tool.sh';
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
        const ruleWatcher = vscode.workspace.createFileSystemWatcher(`**/.cursor/rules/${core_1.MANAGED_RULE_FILE_NAME}`);
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
        const meta = i18n_1.STATUS_META[statusSource.status] ?? i18n_1.STATUS_META.unknown;
        const title = language === 'ko' ? 'Subagent' : 'Subagent';
        if (activeWorkspaceState && snapshot.workspaceStates.length > 1) {
            this.statusBar.text = `${meta.icon} ${title} ${(0, ui_1.truncateLabel)(activeWorkspaceState.folder.name)} ${meta.label}`;
        }
        else {
            this.statusBar.text = `${meta.icon} ${title} ${meta.label}`;
        }
        this.statusBar.tooltip = (0, ui_1.buildTooltip)(snapshot, activeWorkspaceState, language);
        this.statusBar.show();
    }
    async showActions() {
        await this.refresh();
        const language = this.getLanguage();
        const strings = i18n_1.STRINGS[language];
        const snapshot = this.getSnapshot();
        const picks = [];
        const global = snapshot.globalScope;
        picks.push({
            label: global.status === 'blocked' ? `🟢 ${strings.globalEnable}` : `🔴 ${strings.globalDisable}`,
            detail: (0, ui_1.formatShortPath)(global.hooksJsonPath),
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
                    ? `🟢 ${(0, ui_1.interpolate)(strings.folderEnable, { name: activeWorkspaceState.folder.name })}`
                    : `🔴 ${(0, ui_1.interpolate)(strings.folderDisable, { name: activeWorkspaceState.folder.name })}`,
                detail: `${activeWorkspaceState.reason}`,
                action: 'toggleCurrentWorkspace'
            });
            if (activeWorkspaceState.local.status === 'unknown') {
                picks.push({
                    label: `✨ ${(0, ui_1.interpolate)(strings.applyRecommendedFor, { name: activeWorkspaceState.folder.name })}`,
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
        const strings = i18n_1.STRINGS[this.getLanguage()];
        const nextGlobal = this.getSnapshot().globalScope;
        const meta = i18n_1.STATUS_META[nextGlobal.status] ?? i18n_1.STATUS_META.unknown;
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
            vscode.window.showWarningMessage(i18n_1.STRINGS[this.getLanguage()].activeFolderMissing);
            return;
        }
        await this.toggleWorkspaceState(activeWorkspaceState);
    }
    async toggleWorkspaceFolder() {
        await this.refresh();
        const workspaceStates = this.getSnapshot().workspaceStates;
        if (!workspaceStates.length) {
            vscode.window.showWarningMessage(i18n_1.STRINGS[this.getLanguage()].noFolders);
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
        const meta = i18n_1.STATUS_META[updatedState.status] ?? i18n_1.STATUS_META.unknown;
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
            vscode.window.showWarningMessage(i18n_1.STRINGS[this.getLanguage()].activeFolderMissing);
            return;
        }
        await this.applyRecommendedScope(activeWorkspaceState.local);
    }
    async applyRecommendedWorkspaceFolder() {
        await this.refresh();
        const workspaceStates = this.getSnapshot().workspaceStates;
        if (!workspaceStates.length) {
            vscode.window.showWarningMessage(i18n_1.STRINGS[this.getLanguage()].noFolders);
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
        const strings = i18n_1.STRINGS[this.getLanguage()];
        if (scope.type === 'global') {
            vscode.window.showInformationMessage(strings.recommendedGlobalDone);
            return;
        }
        vscode.window.showInformationMessage((0, ui_1.interpolate)(strings.recommendedWorkspaceDone, { name: scope.name }));
    }
    async restoreWorkspaceRule(workspaceState) {
        await this.context.workspaceState.update(getRulePreferenceKey(workspaceState.folder.uri.toString()), true);
        await ensureManagedRule(workspaceState.local.rulePath);
        await this.syncGitignoreForRulePresence(workspaceState, true);
        await this.refresh(true);
        vscode.window.showInformationMessage((0, ui_1.interpolate)(i18n_1.STRINGS[this.getLanguage()].restoreRuleDone, { name: workspaceState.folder.name }));
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
        vscode.window.showInformationMessage((0, ui_1.interpolate)(i18n_1.STRINGS[this.getLanguage()].optionalRuleDone, { name: workspaceState.folder.name }));
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
        vscode.window.showInformationMessage((0, ui_1.interpolate)(i18n_1.STRINGS[this.getLanguage()].gitignorePreferenceDone, { name: workspaceState.folder.name }));
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
        vscode.window.showInformationMessage((0, ui_1.interpolate)(i18n_1.STRINGS[this.getLanguage()].hooksJsonGitignoreDone, { name: workspaceState.folder.name }));
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
        webviewView.webview.onDidReceiveMessage((rawMessage) => {
            const message = parseSidebarMessage(rawMessage);
            if (message) {
                void this.controller.handleSidebarMessage(message);
            }
        });
        this.update(this.controller.getSnapshot(), this.controller.getLanguage());
    }
    update(snapshot, language) {
        if (!this.view) {
            return;
        }
        this.view.webview.html = (0, ui_1.renderSidebarHtml)(this.view.webview, snapshot, language, this.controller);
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
        legacyManagedCommands: LEGACY_GLOBAL_COMMANDS,
        legacyManagedTaskCommands: LEGACY_GLOBAL_TASK_COMMANDS
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
            reason: `Invalid JSON in ${(0, ui_1.formatShortPath)(scope.hooksJsonPath)}`
        };
    }
    const hooksConfig = configState.data;
    const hooksRoot = (0, core_1.isObject)(hooksConfig) && (0, core_1.isObject)(hooksConfig.hooks) ? hooksConfig.hooks : undefined;
    const preToolUseHooks = hooksRoot?.preToolUse;
    const subagentHooks = hooksRoot?.subagentStart;
    if (preToolUseHooks !== undefined && !Array.isArray(preToolUseHooks)) {
        return {
            ...base,
            status: 'error',
            reason: `preToolUse must be an array in ${(0, ui_1.formatShortPath)(scope.hooksJsonPath)}`
        };
    }
    if (subagentHooks !== undefined && !Array.isArray(subagentHooks)) {
        return {
            ...base,
            status: 'error',
            reason: `subagentStart must be an array in ${(0, ui_1.formatShortPath)(scope.hooksJsonPath)}`
        };
    }
    const hookEntries = Array.isArray(subagentHooks) ? subagentHooks : [];
    const commandEntries = hookEntries.map((entry, index) => ({
        index,
        command: (0, core_1.isCommandEntry)(entry) ? entry.command : undefined
    }));
    const managedTaskCommands = getManagedTaskCommands(scope);
    const taskHookEntries = Array.isArray(preToolUseHooks)
        ? preToolUseHooks.filter((entry) => !(0, core_1.isCommandEntry)(entry)
            || managedTaskCommands.includes(entry.command)
            || (0, core_1.isTaskPreToolUseEntry)(entry))
        : [];
    const taskCommandEntries = taskHookEntries.map((entry, index) => ({
        index,
        command: (0, core_1.isCommandEntry)(entry) ? entry.command : undefined
    }));
    const managedCommands = getManagedCommands(scope);
    const managedIndex = commandEntries.findIndex((entry) => entry.command !== undefined && managedCommands.includes(entry.command));
    const managedTaskIndex = taskCommandEntries.findIndex((entry) => entry.command !== undefined && managedTaskCommands.includes(entry.command));
    const hasAnySubagentHooks = hookEntries.length > 0;
    const hasCustomCommands = commandEntries.some((entry) => entry.command && !managedCommands.includes(entry.command));
    const hasInvalidEntries = hookEntries.some((entry) => !(0, core_1.isCommandEntry)(entry));
    const hasCustomTaskCommands = taskCommandEntries.some((entry) => entry.command && !managedTaskCommands.includes(entry.command));
    const hasInvalidTaskEntries = taskHookEntries.some((entry) => !(0, core_1.isCommandEntry)(entry));
    if (managedIndex === 0 && managedTaskIndex === 0) {
        if (!scriptState.exists) {
            return {
                ...base,
                status: 'error',
                reason: `Managed blocker is configured, but ${(0, ui_1.formatShortPath)(scope.scriptPath)} is missing`
            };
        }
        if (!scriptState.looksLikeBlocker) {
            return {
                ...base,
                status: 'unknown',
                reason: `Managed blocker command exists, but ${(0, ui_1.formatShortPath)(scope.scriptPath)} no longer matches the expected deny helper`
            };
        }
        if (!taskScriptState.exists) {
            return {
                ...base,
                status: 'error',
                reason: `Managed Task blocker is configured, but ${(0, ui_1.formatShortPath)(scope.taskScriptPath)} is missing`
            };
        }
        if (!taskScriptState.looksLikeBlocker) {
            return {
                ...base,
                status: 'unknown',
                reason: `Managed Task blocker command exists, but ${(0, ui_1.formatShortPath)(scope.taskScriptPath)} no longer matches the expected deny helper`
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
    if (hasInvalidEntries || hasInvalidTaskEntries) {
        return {
            ...base,
            status: 'unknown',
            reason: 'Task-related preToolUse or subagentStart contains unsupported entries that cannot be evaluated safely'
        };
    }
    if (hasCustomCommands || hasCustomTaskCommands || hasAnySubagentHooks) {
        return {
            ...base,
            status: 'unknown',
            reason: 'Custom Task-related preToolUse or subagentStart hooks exist, so the final allow/deny result cannot be inferred safely'
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
        throw new Error(`Fix invalid JSON first: ${(0, ui_1.formatShortPath)(hooksJsonPath)}`);
    }
    if ((0, core_1.isObject)(configState.data) && configState.data.hooks !== undefined) {
        if (!(0, core_1.isObject)(configState.data.hooks)) {
            throw new Error(`Fix invalid hooks object first: ${(0, ui_1.formatShortPath)(hooksJsonPath)}`);
        }
        if (configState.data.hooks.preToolUse !== undefined && !Array.isArray(configState.data.hooks.preToolUse)) {
            throw new Error(`Fix invalid preToolUse first: ${(0, ui_1.formatShortPath)(hooksJsonPath)}`);
        }
        if (configState.data.hooks.subagentStart !== undefined && !Array.isArray(configState.data.hooks.subagentStart)) {
            throw new Error(`Fix invalid subagentStart first: ${(0, ui_1.formatShortPath)(hooksJsonPath)}`);
        }
    }
    return (0, core_1.normalizeHooksConfig)(configState.data);
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
    const managedBlock = `${core_1.MANAGED_GITIGNORE_START}\n${core_1.MANAGED_GITIGNORE_ENTRIES.join('\n')}\n${core_1.MANAGED_GITIGNORE_END}\n`;
    if (existing === undefined) {
        await fsp.writeFile(gitignorePath, managedBlock, 'utf8');
        return;
    }
    const gitignoreState = (0, core_1.parseGitignoreState)(existing);
    if (gitignoreState.hasAllManagedEntries) {
        return;
    }
    const normalized = (0, core_1.normalizeLineEndings)(existing);
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
    const next = (0, core_1.removeManagedGitignoreBlock)(existing);
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
    const hooksJsonBlock = `${core_1.HOOKS_JSON_GITIGNORE_START}\n${core_1.HOOKS_JSON_GITIGNORE_ENTRY}\n${core_1.MANAGED_GITIGNORE_END}\n`;
    if (existing === undefined) {
        await fsp.writeFile(gitignorePath, hooksJsonBlock, 'utf8');
        return;
    }
    const gitignoreState = (0, core_1.parseGitignoreState)(existing);
    if (gitignoreState.hasHooksJsonEntry) {
        return;
    }
    const normalized = (0, core_1.normalizeLineEndings)(existing);
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
    const next = (0, core_1.removeGitignoreBlock)(existing, core_1.HOOKS_JSON_GITIGNORE_START);
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
        ...(0, core_1.parseGitignoreState)(raw)
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
            matchesManagedRule: (0, core_1.normalizeLineEndings)(raw) === (0, core_1.normalizeLineEndings)(MANAGED_RULE)
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
    const strings = i18n_1.STRINGS[language];
    const response = await vscode.window.showWarningMessage((0, ui_1.interpolate)(strings.unknownConfirm, { path: (0, ui_1.formatShortPath)(scope.hooksJsonPath) }), strings.recommended);
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
    const strings = i18n_1.STRINGS[language];
    const picks = workspaceStates.map((state) => {
        const effectiveMeta = i18n_1.STATUS_META[state.status] ?? i18n_1.STATUS_META.unknown;
        const localMeta = i18n_1.STATUS_META[state.local.status] ?? i18n_1.STATUS_META.unknown;
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
    return path.join(baseDir, '.cursor', 'rules', core_1.MANAGED_RULE_FILE_NAME);
}
function getGitignorePreferenceKey(folderUri) {
    return `${GITIGNORE_PREF_PREFIX}${folderUri}`;
}
function getRulePreferenceKey(folderUri) {
    return `${RULE_PREF_PREFIX}${folderUri}`;
}
function parseSidebarMessage(value) {
    if (!(0, core_1.isObject)(value) || typeof value.type !== 'string') {
        return undefined;
    }
    switch (value.type) {
        case 'refresh':
        case 'showActions':
        case 'applyRecommendedGlobal':
            return { type: value.type };
        case 'setLanguage':
            return value.language === 'en' || value.language === 'ko'
                ? { type: 'setLanguage', language: value.language }
                : undefined;
        case 'toggleGlobal':
            return value.desiredEnabled === undefined || typeof value.desiredEnabled === 'boolean'
                ? { type: 'toggleGlobal', desiredEnabled: value.desiredEnabled }
                : undefined;
        case 'applyRecommendedWorkspace':
        case 'restoreWorkspaceRule':
            return typeof value.folderUri === 'string'
                ? { type: value.type, folderUri: value.folderUri }
                : undefined;
        case 'toggleWorkspace':
            return typeof value.folderUri === 'string'
                && (value.desiredEnabled === undefined || typeof value.desiredEnabled === 'boolean')
                ? { type: 'toggleWorkspace', folderUri: value.folderUri, desiredEnabled: value.desiredEnabled }
                : undefined;
        case 'toggleWorkspaceRule':
        case 'toggleWorkspaceGitignore':
        case 'toggleWorkspaceHooksJsonGitignore':
            return typeof value.folderUri === 'string' && typeof value.enabled === 'boolean'
                ? { type: value.type, folderUri: value.folderUri, enabled: value.enabled }
                : undefined;
        default:
            return undefined;
    }
}
