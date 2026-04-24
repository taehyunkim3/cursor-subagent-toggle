import * as vscode from 'vscode';

export type StatusKind = 'enabled' | 'blocked' | 'mixed' | 'unknown' | 'error';
export type ScopeType = 'global' | 'project';
export type UiLanguage = 'en' | 'ko';

export interface StatusMeta {
  icon: string;
  label: string;
}

export interface AggregateState {
  status: StatusKind;
  reason: string;
}

export interface JsonFileResult {
  exists: boolean;
  data?: unknown;
  error?: Error;
}

export interface ScriptFileResult {
  exists: boolean;
  looksLikeBlocker: boolean;
}

export interface RuleFileResult {
  exists: boolean;
  matchesManagedRule: boolean;
}

export interface ScopeDescriptor {
  type: ScopeType;
  name: string;
  baseDir: string;
  hooksJsonPath: string;
  scriptPath: string;
  taskScriptPath: string;
  rulePath?: string;
  gitignorePath?: string;
  managedCommand: string;
  managedTaskCommand: string;
  legacyManagedCommands?: string[];
  legacyManagedTaskCommands?: string[];
  folder?: vscode.WorkspaceFolder;
}

export interface ScopeState extends ScopeDescriptor {
  configExists: boolean;
  scriptExists: boolean;
  scriptLooksLikeBlocker: boolean;
  taskScriptExists: boolean;
  taskScriptLooksLikeBlocker: boolean;
  ruleExists: boolean;
  ruleMatchesManagedRule: boolean;
  gitignoreExists: boolean;
  gitignoreHasManagedRuleEntry: boolean;
  gitignoreHasManagedScriptEntry: boolean;
  gitignoreHasManagedTaskScriptEntry: boolean;
  gitignoreHasAllManagedEntries: boolean;
  gitignoreHasManagedBlock: boolean;
  gitignoreHasHooksJsonEntry: boolean;
  gitignoreHasHooksJsonBlock: boolean;
  status: StatusKind;
  reason: string;
}

export interface WorkspaceState {
  folder: vscode.WorkspaceFolder;
  local: ScopeState;
  global: ScopeState;
  status: StatusKind;
  reason: string;
}

export interface Snapshot {
  globalScope: ScopeState;
  workspaceStates: WorkspaceState[];
  aggregate: AggregateState;
}

export type ScopeAction =
  | 'toggleGlobal'
  | 'toggleCurrentWorkspace'
  | 'toggleWorkspaceFolder'
  | 'applyRecommendedGlobal'
  | 'applyRecommendedCurrentWorkspace'
  | 'applyRecommendedWorkspaceFolder'
  | 'refresh';

export interface ScopeActionItem extends vscode.QuickPickItem {
  action: ScopeAction;
}

export type SidebarMessage =
  | { type: 'refresh' }
  | { type: 'showActions' }
  | { type: 'setLanguage'; language: UiLanguage }
  | { type: 'toggleGlobal'; desiredEnabled?: boolean }
  | { type: 'applyRecommendedGlobal' }
  | { type: 'toggleWorkspace'; folderUri: string; desiredEnabled?: boolean }
  | { type: 'applyRecommendedWorkspace'; folderUri: string }
  | { type: 'restoreWorkspaceRule'; folderUri: string }
  | { type: 'toggleWorkspaceRule'; folderUri: string; enabled: boolean }
  | { type: 'toggleWorkspaceGitignore'; folderUri: string; enabled: boolean }
  | { type: 'toggleWorkspaceHooksJsonGitignore'; folderUri: string; enabled: boolean };
