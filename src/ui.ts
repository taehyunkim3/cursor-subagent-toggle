import * as crypto from 'crypto';
import * as os from 'os';
import * as vscode from 'vscode';
import { STATUS_META, STRINGS } from './i18n';
import { ScopeState, Snapshot, StatusKind, UiLanguage, WorkspaceState } from './types';

interface SidebarRenderPreferences {
  getWorkspaceGitignoreEnabled(folderUri: string): boolean;
  getWorkspaceRuleEnabled(folderUri: string): boolean;
}

export function buildTooltip(snapshot: Snapshot, activeWorkspaceState: WorkspaceState | undefined, language: UiLanguage): vscode.MarkdownString {
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

export function renderSidebarHtml(webview: vscode.Webview, snapshot: Snapshot, language: UiLanguage, preferences: SidebarRenderPreferences): string {
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
      globalReason: state.global.reason,
      gitignorePreferenceEnabled: preferences.getWorkspaceGitignoreEnabled(state.folder.uri.toString()),
      rulePreferenceEnabled: preferences.getWorkspaceRuleEnabled(state.folder.uri.toString())
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

function renderScopeCard(scope: ScopeState, options: {
  language: UiLanguage;
  folderUri?: string;
  effectiveStatus: StatusKind;
  effectiveReason: string;
  globalStatus?: StatusKind;
  globalReason?: string;
  gitignorePreferenceEnabled?: boolean;
  rulePreferenceEnabled?: boolean;
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

export function formatStatusLine(status: StatusKind, language: UiLanguage): string {
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

export function formatRuleStatus(scope: ScopeState, language: UiLanguage, rulePreferenceEnabled = true): string {
  const strings = STRINGS[language];

  if (!rulePreferenceEnabled && !scope.ruleExists) {
    return strings.ruleDisabledValue;
  }

  if (!scope.ruleExists) {
    return strings.ruleMissingValue;
  }

  return scope.ruleMatchesManagedRule ? strings.ruleManagedValue : strings.ruleModifiedValue;
}

function formatGitignoreStatus(scope: ScopeState, preferenceEnabled: boolean, language: UiLanguage): string {
  const strings = STRINGS[language];

  if (!preferenceEnabled) {
    return strings.gitignoreDisabledValue;
  }

  if (scope.gitignoreHasAllManagedEntries && !scope.gitignoreHasManagedBlock) {
    return strings.gitignoreExternalValue;
  }

  return scope.gitignoreHasAllManagedEntries ? strings.gitignoreEnabledValue : strings.gitignoreDisabledValue;
}

function formatHooksJsonGitignoreStatus(scope: ScopeState, language: UiLanguage): string {
  const strings = STRINGS[language];

  if (scope.gitignoreHasHooksJsonEntry && !scope.gitignoreHasHooksJsonBlock) {
    return strings.gitignoreExternalValue;
  }

  return scope.gitignoreHasHooksJsonEntry ? strings.gitignoreEnabledValue : strings.gitignoreDisabledValue;
}

export function truncateLabel(label: string): string {
  return label.length > 18 ? `${label.slice(0, 15)}...` : label;
}

export function formatShortPath(targetPath: string): string {
  const home = os.homedir();
  if (targetPath.startsWith(home)) {
    return `~${targetPath.slice(home.length)}`;
  }
  return targetPath;
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
  return crypto.randomBytes(16).toString('base64').replace(/[+/=]/g, '');
}

export function interpolate(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? '');
}
