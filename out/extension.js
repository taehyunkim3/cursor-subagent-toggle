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
function deactivate() { }
class SubagentStatusController {
    constructor(context) {
        this.snapshot = null;
        this.globalWatchTargets = [];
        this.context = context;
        this.statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
        this.statusBar.name = 'Cursor Subagent Toggle';
        this.statusBar.command = 'cursorSubagentToggle.showActions';
        this.treeProvider = new SubagentSidebarProvider();
        this.treeView = vscode.window.createTreeView('cursorSubagentToggle.sidebar', {
            treeDataProvider: this.treeProvider,
            showCollapseAll: false
        });
    }
    async activate() {
        this.context.subscriptions.push(this.statusBar, this.treeView);
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
        this.globalWatchTargets = [];
    }
    registerCommands() {
        const subscriptions = [
            vscode.commands.registerCommand('cursorSubagentToggle.showActions', () => this.showActions()),
            vscode.commands.registerCommand('cursorSubagentToggle.openItemActions', (item) => this.openItemActions(item)),
            vscode.commands.registerCommand('cursorSubagentToggle.performTreeItemPrimaryAction', (item) => this.performTreeItemPrimaryAction(item)),
            vscode.commands.registerCommand('cursorSubagentToggle.performTreeItemRecommendedAction', (item) => this.performTreeItemRecommendedAction(item)),
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
        this.context.subscriptions.push(hookWatcher, scriptWatcher, vscode.workspace.onDidChangeWorkspaceFolders(() => {
            void this.refresh();
        }), vscode.window.onDidChangeActiveTextEditor(() => this.renderStatusBar()));
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
            this.treeProvider.setSnapshot(this.snapshot);
            this.renderStatusBar();
        }
        catch (error) {
            this.snapshot = buildErrorSnapshot(error);
            this.treeProvider.setSnapshot(this.snapshot);
            this.renderStatusBar();
            if (notifyOnError) {
                this.showError(error);
            }
        }
    }
    renderStatusBar() {
        const snapshot = this.snapshot ?? buildErrorSnapshot(new Error('Status is not ready yet.'));
        const activeWorkspaceState = getActiveWorkspaceState(snapshot.workspaceStates);
        const statusSource = activeWorkspaceState ?? snapshot.aggregate;
        const meta = STATUS_META[statusSource.status] ?? STATUS_META.unknown;
        if (activeWorkspaceState && snapshot.workspaceStates.length > 1) {
            this.statusBar.text = `${meta.icon} Subagent ${truncateLabel(activeWorkspaceState.folder.name)} ${meta.label}`;
        }
        else {
            this.statusBar.text = `${meta.icon} Subagent ${meta.label}`;
        }
        this.statusBar.tooltip = buildTooltip(snapshot, activeWorkspaceState);
        this.statusBar.show();
    }
    async showActions() {
        await this.refresh();
        const snapshot = this.snapshot;
        if (!snapshot) {
            return;
        }
        const picks = [];
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
    async openItemActions(item) {
        if (!item || item.kind === 'summary' || item.kind === 'workspaceRoot' || item.kind === 'empty') {
            await this.showActions();
            return;
        }
        await this.refresh();
        const actionItems = [];
        if (item.kind === 'global') {
            const global = this.snapshot?.globalScope;
            if (!global) {
                return;
            }
            actionItems.push({
                label: global.status === 'blocked' ? '🟢 Enable subagent globally' : '🔴 Disable subagent globally',
                detail: global.reason,
                action: 'toggleGlobal'
            });
            if (global.status === 'unknown') {
                actionItems.push({
                    label: '✨ Apply Recommended Config',
                    detail: 'Replace only hooks.subagentStart with the extension-managed blocker.',
                    action: 'applyRecommendedGlobal'
                });
            }
        }
        if (item.kind === 'workspace') {
            const workspaceState = this.snapshot?.workspaceStates.find((state) => state.folder.uri.toString() === item.workspaceState?.folder.uri.toString());
            if (!workspaceState) {
                return;
            }
            actionItems.push({
                label: workspaceState.local.status === 'blocked'
                    ? `🟢 Enable subagent in ${workspaceState.folder.name}`
                    : `🔴 Disable subagent in ${workspaceState.folder.name}`,
                detail: workspaceState.reason,
                action: 'toggleCurrentWorkspace'
            });
            if (workspaceState.local.status === 'unknown') {
                actionItems.push({
                    label: '✨ Apply Recommended Config',
                    detail: 'Replace only hooks.subagentStart with the extension-managed blocker.',
                    action: 'applyRecommendedCurrentWorkspace'
                });
            }
        }
        actionItems.push({
            label: '🔄 Refresh status',
            detail: 'Re-scan global and workspace hook files.',
            action: 'refresh'
        });
        const picked = await vscode.window.showQuickPick(actionItems, {
            title: item.kind === 'global' ? 'Global scope' : item.workspaceState?.folder.name ?? 'Workspace folder',
            placeHolder: 'Choose an action.'
        });
        if (!picked) {
            return;
        }
        switch (picked.action) {
            case 'toggleGlobal':
                await this.toggleGlobal();
                break;
            case 'toggleCurrentWorkspace':
                if (item.workspaceState) {
                    await this.toggleWorkspaceState(item.workspaceState);
                }
                break;
            case 'applyRecommendedGlobal':
                await this.applyRecommendedGlobal();
                break;
            case 'applyRecommendedCurrentWorkspace':
                if (item.workspaceState) {
                    await this.applyRecommendedScope(item.workspaceState.local);
                }
                break;
            case 'refresh':
                await this.refresh(true);
                break;
        }
    }
    async performTreeItemPrimaryAction(item) {
        if (!item) {
            await this.showActions();
            return;
        }
        if (item.kind === 'global') {
            await this.toggleGlobal();
            return;
        }
        if (item.kind === 'workspace' && item.workspaceState) {
            await this.toggleWorkspaceState(item.workspaceState);
            return;
        }
        await this.showActions();
    }
    async performTreeItemRecommendedAction(item) {
        if (!item) {
            await this.showActions();
            return;
        }
        if (item.kind === 'global') {
            await this.applyRecommendedGlobal();
            return;
        }
        if (item.kind === 'workspace' && item.workspaceState) {
            await this.applyRecommendedScope(item.workspaceState.local);
            return;
        }
        await this.showActions();
    }
    async toggleGlobal() {
        const global = this.snapshot?.globalScope ?? await inspectGlobalScope();
        if (global.status === 'unknown') {
            const confirmed = await confirmRecommendedOverwrite(global);
            if (!confirmed) {
                return;
            }
            await applyRecommendedBlock(global);
        }
        else {
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
    async toggleCurrentWorkspaceFolder() {
        await this.refresh();
        const activeWorkspaceState = getActiveWorkspaceState(this.snapshot?.workspaceStates ?? []);
        if (!activeWorkspaceState) {
            vscode.window.showWarningMessage('No active workspace folder was found to toggle.');
            return;
        }
        await this.toggleWorkspaceState(activeWorkspaceState);
    }
    async toggleWorkspaceFolder() {
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
    async toggleWorkspaceState(workspaceState) {
        if (workspaceState.local.status === 'unknown') {
            const confirmed = await confirmRecommendedOverwrite(workspaceState.local);
            if (!confirmed) {
                return;
            }
            await applyRecommendedBlock(workspaceState.local);
        }
        else {
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
    async applyRecommendedGlobal() {
        const global = this.snapshot?.globalScope ?? await inspectGlobalScope();
        await this.applyRecommendedScope(global);
    }
    async applyRecommendedCurrentWorkspaceFolder() {
        await this.refresh();
        const activeWorkspaceState = getActiveWorkspaceState(this.snapshot?.workspaceStates ?? []);
        if (!activeWorkspaceState) {
            vscode.window.showWarningMessage('No active workspace folder was found to normalize.');
            return;
        }
        await this.applyRecommendedScope(activeWorkspaceState.local);
    }
    async applyRecommendedWorkspaceFolder() {
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
        await this.applyRecommendedScope(picked.local);
    }
    showError(error) {
        const message = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`Cursor Subagent Toggle: ${message}`);
    }
    async applyRecommendedScope(scope) {
        await applyRecommendedBlock(scope);
        await this.refresh(true);
        if (scope.type === 'global') {
            vscode.window.showInformationMessage('Global subagentStart was replaced with the recommended blocker config.');
            return;
        }
        vscode.window.showInformationMessage(`${scope.name}: subagentStart was replaced with the recommended blocker config.`);
    }
}
class SidebarNode extends vscode.TreeItem {
    constructor(kind, options) {
        super(options.label, options.collapsibleState ?? vscode.TreeItemCollapsibleState.None);
        this.kind = kind;
        this.description = options.description;
        this.tooltip = options.tooltip;
        this.contextValue = options.contextValue;
        this.command = options.command;
        this.workspaceState = options.workspaceState;
    }
}
class SubagentSidebarProvider {
    constructor() {
        this.onDidChangeTreeDataEmitter = new vscode.EventEmitter();
        this.onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;
        this.snapshot = buildErrorSnapshot(new Error('Status is not ready yet.'));
    }
    setSnapshot(snapshot) {
        this.snapshot = snapshot;
        this.onDidChangeTreeDataEmitter.fire();
    }
    getTreeItem(element) {
        return element;
    }
    getChildren(element) {
        if (!element) {
            return Promise.resolve(this.getRootItems());
        }
        if (element.kind === 'workspaceRoot') {
            return Promise.resolve(this.snapshot.workspaceStates.map((state) => createWorkspaceNode(state)));
        }
        return Promise.resolve([]);
    }
    getRootItems() {
        const items = [
            createSummaryNode(this.snapshot.aggregate, this.snapshot.workspaceStates.length),
            createGlobalNode(this.snapshot.globalScope)
        ];
        if (this.snapshot.workspaceStates.length) {
            items.push(createWorkspaceRootNode(this.snapshot.workspaceStates.length));
        }
        else {
            items.push(createEmptyWorkspaceNode());
        }
        return items;
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
function buildWorkspaceState(globalScope, localScope) {
    const folder = localScope.folder;
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
    const data = await loadEditableHooksConfig(scope.hooksJsonPath);
    const existing = Array.isArray(data.hooks.subagentStart) ? [...data.hooks.subagentStart] : [];
    const withoutManaged = existing.filter((entry) => entry.command !== scope.managedCommand);
    if (shouldBlock) {
        withoutManaged.unshift({ command: scope.managedCommand });
        await ensureManagedScript(scope.scriptPath);
    }
    await writeSubagentStart(scope.hooksJsonPath, data, withoutManaged.length > 0 ? withoutManaged : undefined);
}
async function applyRecommendedBlock(scope) {
    const data = await loadEditableHooksConfig(scope.hooksJsonPath);
    await ensureManagedScript(scope.scriptPath);
    await writeSubagentStart(scope.hooksJsonPath, data, [{ command: scope.managedCommand }]);
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
        if (configState.data.hooks.subagentStart !== undefined && !Array.isArray(configState.data.hooks.subagentStart)) {
            throw new Error(`Fix invalid subagentStart first: ${formatShortPath(hooksJsonPath)}`);
        }
    }
    return normalizeHooksConfig(configState.data);
}
async function writeSubagentStart(hooksJsonPath, config, subagentStart) {
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
    }
    catch (error) {
        const nodeError = error;
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
async function confirmRecommendedOverwrite(scope) {
    const response = await vscode.window.showWarningMessage(`Custom subagentStart hooks were detected in ${formatShortPath(scope.hooksJsonPath)}. Replace only hooks.subagentStart with the extension's recommended blocker config?`, APPLY_RECOMMENDED_LABEL);
    return response === APPLY_RECOMMENDED_LABEL;
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
function createSummaryNode(aggregate, workspaceFolderCount) {
    return new SidebarNode('summary', {
        label: 'Current Window',
        description: formatStatusLine(aggregate.status),
        tooltip: new vscode.MarkdownString([
            '**Current Window**',
            '',
            `Status: ${formatStatusLine(aggregate.status)}`,
            `Reason: ${aggregate.reason}`,
            workspaceFolderCount > 0 ? `Workspace folders: ${workspaceFolderCount}` : 'Workspace folders: none'
        ].join('\n'))
    });
}
function createGlobalNode(globalScope) {
    return new SidebarNode('global', {
        label: 'Global',
        description: formatStatusLine(globalScope.status),
        tooltip: new vscode.MarkdownString([
            '**Global Scope**',
            '',
            `Status: ${formatStatusLine(globalScope.status)}`,
            `Reason: ${globalScope.reason}`,
            `Path: \`${formatShortPath(globalScope.hooksJsonPath)}\``
        ].join('\n')),
        contextValue: globalScope.status === 'unknown' ? 'scope-global-unknown' : 'scope-global',
        command: {
            command: 'cursorSubagentToggle.openItemActions',
            title: 'Open Global Actions',
            arguments: [new SidebarNode('global', {
                    label: 'Global',
                    description: formatStatusLine(globalScope.status),
                    workspaceState: undefined
                })]
        }
    });
}
function createWorkspaceRootNode(workspaceFolderCount) {
    return new SidebarNode('workspaceRoot', {
        label: `Workspace Folders (${workspaceFolderCount})`,
        tooltip: 'Expand to inspect and control each workspace folder.',
        collapsibleState: vscode.TreeItemCollapsibleState.Expanded
    });
}
function createWorkspaceNode(workspaceState) {
    return new SidebarNode('workspace', {
        label: workspaceState.folder.name,
        description: formatStatusLine(workspaceState.status),
        tooltip: new vscode.MarkdownString([
            `**${workspaceState.folder.name}**`,
            '',
            `Effective: ${formatStatusLine(workspaceState.status)} ${workspaceState.reason}`,
            `Local: ${formatStatusLine(workspaceState.local.status)} ${workspaceState.local.reason}`,
            `Global: ${formatStatusLine(workspaceState.global.status)} ${workspaceState.global.reason}`,
            `Path: \`${formatShortPath(workspaceState.local.hooksJsonPath)}\``
        ].join('\n')),
        contextValue: workspaceState.local.status === 'unknown' ? 'scope-workspace-unknown' : 'scope-workspace',
        workspaceState,
        command: {
            command: 'cursorSubagentToggle.openItemActions',
            title: 'Open Workspace Actions',
            arguments: [new SidebarNode('workspace', {
                    label: workspaceState.folder.name,
                    description: formatStatusLine(workspaceState.status),
                    workspaceState
                })]
        }
    });
}
function createEmptyWorkspaceNode() {
    return new SidebarNode('empty', {
        label: 'No workspace folders',
        tooltip: 'Open a folder or a multi-root workspace to see per-project subagent status.'
    });
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
    const meta = STATUS_META[status] ?? STATUS_META.unknown;
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
function isObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function isCommandEntry(value) {
    return isObject(value) && typeof value.command === 'string';
}
