# Cursor Subagent Toggle

## English

Cursor Subagent Toggle controls whether Cursor can create subagents by managing hooks by default:

- Local workspace hook config: `.cursor/hooks.json`
- Local workspace blocker scripts: `.cursor/hooks/block-subagent.sh` and `.cursor/hooks/block-task-tool.sh`
- Global user hook config: `~/.cursor/hooks.json`
- Global blocker scripts: `~/.cursor/hooks/block-subagent.sh` and `~/.cursor/hooks/block-task-tool.sh`
- Optional local workspace managed rule: `.cursor/rules/cursor-subagent-toggle.mdc`

The extension shows global and workspace states together in a dedicated sidebar and in the status bar, including support for multi-root workspaces.

### Main Features

- Sidebar cards for global and each workspace folder
- Small toggle switch per scope
- Live final-status summary in the status bar
- Language selector (`English / 한국어`)
- Safe handling for custom or partial managed hooks (`CHECK` state)
- One-click `Apply Recommended Config` to install the managed `preToolUse(Task)` and `subagentStart` hook pair
- Hooks-only blocking by default, using two managed scripts
- Optional managed project rule injection inside the workspace `More` dialog, labeled recommended off
- A workspace checkbox to add only the generated blocker scripts and optional managed project rule path to `.gitignore`, labeled recommended on
- A separate workspace checkbox to add only `.cursor/hooks.json` to `.gitignore`, labeled recommended on

### Toggle Semantics

- Toggle `ON` means subagent creation is allowed in that local scope.
- Toggle `OFF` means the managed blocker is enabled in that local scope.
- Workspace `OFF` writes both managed deny hooks and two managed hook scripts.
- Workspace `ON` removes only the managed hook entries from `.cursor/hooks.json`.
- The managed project rule is installed only when the workspace rule checkbox is enabled inside the `More` dialog.
- Turning the rule checkbox off in `More` deletes only `.cursor/rules/cursor-subagent-toggle.mdc` when it still matches the extension-managed content.
- Existing user-created `.cursor/rules/*.mdc` files are not modified, merged, or deleted.
- The local git ignore checkbox adds only `.cursor/hooks/block-subagent.sh`, `.cursor/hooks/block-task-tool.sh`, and the optional managed rule path to the workspace `.gitignore`.
- The checkbox is checked only when all generated file paths are already ignored by the workspace `.gitignore`.
- The separate hooks.json checkbox adds only `.cursor/hooks.json` to the workspace `.gitignore`.
- The hooks.json checkbox is checked only when `.cursor/hooks.json` is already ignored by the workspace `.gitignore`.
- When the checkbox is turned off, the extension removes only its own managed `.gitignore` marker block and leaves user-defined ignore rules intact.
- Global `OFF` writes the global deny hooks only. It installs workspace managed rules only for folders where the optional rule checkbox is enabled in `More`.
- Global `ON` removes the global deny hooks and removes the managed project rule only from workspace folders that are not locally `OFF`.
- Effective final state still follows Cursor scope priority: global blocking can override a local workspace.

### Status Model

- `🟢 ON`: No blocking hook is applied.
- `🔴 OFF`: Managed blocking hook is applied.
- `🟡 MIXED`: Different effective states across folders in multi-root.
- `⚪ CHECK`: Custom or partial managed hooks exist, so safe ON/OFF inference is not possible.
- `🟠 ERROR`: Invalid `hooks.json` or missing managed script.

The sidebar also shows the optional managed project rule state:

- `Managed`: The extension-managed project rule exists and matches the expected content.
- `Missing`: The managed project rule is missing while the optional rule checkbox is enabled in `More` and the effective state is blocked.
- `Modified - protected`: The managed project rule file exists but no longer matches the extension content. The extension does not delete modified rule content.

The workspace card also shows whether generated blocker paths and `hooks.json` are ignored by git. If the exact ignore entries already exist outside extension-managed blocks, they are shown as `Already ignored` and are not removed by the extension.

### Managed Hook Shape

Workspace blocker command:

```json
{
  "version": 1,
  "hooks": {
    "preToolUse": [
      {
        "command": "bash .cursor/hooks/block-task-tool.sh",
        "matcher": "Task",
        "failClosed": true
      }
    ],
    "subagentStart": [
      {
        "command": "bash .cursor/hooks/block-subagent.sh",
        "failClosed": true
      }
    ]
  }
}
```

Global blocker command:

```json
{
  "version": 1,
  "hooks": {
    "preToolUse": [
      {
        "command": "bash ~/.cursor/hooks/block-task-tool.sh",
        "matcher": "Task",
        "failClosed": true
      }
    ],
    "subagentStart": [
      {
        "command": "bash ~/.cursor/hooks/block-subagent.sh",
        "failClosed": true
      }
    ]
  }
}
```

### Optional Managed Project Rule

When a workspace needs prompt-context protection and the rule checkbox is enabled in `More`, the extension creates only this file:

```text
.cursor/rules/cursor-subagent-toggle.mdc
```

The rule starts with:

```md
# [DO NOT CALL SUBAGENTS]
```

It also states that this rule is a higher-priority safety override for the workspace and that conflicting Cursor rules, project rules, user rules, instructions, or prompts must yield to the no-subagent rule.

### Managed Git Ignore Entry

When the local git ignore checkbox is enabled, the extension adds only these generated file paths to the workspace `.gitignore`:

```gitignore
# Cursor Subagent Toggle: managed generated files
.cursor/hooks/block-subagent.sh
.cursor/hooks/block-task-tool.sh
.cursor/rules/cursor-subagent-toggle.mdc
# End Cursor Subagent Toggle
```

Only this marked block is removed when the checkbox is disabled.

The separate hooks.json checkbox uses its own marker block:

```gitignore
# Cursor Subagent Toggle: hooks config ignore
.cursor/hooks.json
# End Cursor Subagent Toggle
```

## 한국어

Cursor Subagent Toggle은 기본적으로 hooks를 관리해서 Cursor의 subagent 생성 허용 여부를 제어합니다.

- 로컬 워크스페이스 hook 설정: `.cursor/hooks.json`
- 로컬 워크스페이스 blocker script: `.cursor/hooks/block-subagent.sh`, `.cursor/hooks/block-task-tool.sh`
- 전역 사용자 hook 설정: `~/.cursor/hooks.json`
- 전역 blocker script: `~/.cursor/hooks/block-subagent.sh`, `~/.cursor/hooks/block-task-tool.sh`
- 선택 로컬 워크스페이스 관리 rule: `.cursor/rules/cursor-subagent-toggle.mdc`

확장은 전용 사이드바와 status bar에서 전역/로컬 상태를 함께 보여주며, 멀티 루트 워크스페이스도 지원합니다.

### 주요 기능

- 전역 카드 + 워크스페이스 폴더별 카드 제공
- 범위별 작은 토글 스위치 제공
- status bar에 최종 상태 실시간 요약 표시
- 언어 선택기 (`English / 한국어`)
- 커스텀 또는 일부 managed hook에 대한 안전 모드(`CHECK` 상태)
- `Apply Recommended Config` 버튼으로 관리 `preToolUse(Task)` 및 `subagentStart` hook pair 설치
- 기본값은 두 managed script를 사용하는 hooks-only 차단
- subagent 비활성화 시 더 강한 prompt-context 지시를 위한 managed project rule은 workspace `더보기` 팝업 안에서 제공하며 권장 off로 표시
- 생성된 blocker script들과 선택 managed project rule 경로만 `.gitignore`에 추가하는 workspace 체크박스 제공, 권장 on으로 표시
- `.cursor/hooks.json` 파일만 `.gitignore`에 추가하는 별도 workspace 체크박스 제공, 권장 on으로 표시

### 토글 의미

- 토글 `ON`: 해당 로컬 범위에서 subagent 생성 허용
- 토글 `OFF`: 해당 로컬 범위에서 managed blocker 활성화
- 워크스페이스 `OFF`: managed deny hook 두 개와 managed hook script 두 개를 생성
- 워크스페이스 `ON`: `.cursor/hooks.json`에서 managed hook entry만 제거
- managed project rule은 `더보기` 팝업 안의 workspace rule 체크박스가 켜져 있을 때만 설치
- `더보기`의 rule 체크박스를 끄면 `.cursor/rules/cursor-subagent-toggle.mdc`가 extension 관리 내용과 일치할 때만 삭제
- 사용자가 만든 기존 `.cursor/rules/*.mdc` 파일은 수정, 병합, 삭제하지 않음
- 로컬 git ignore 체크박스는 workspace `.gitignore`에 `.cursor/hooks/block-subagent.sh`, `.cursor/hooks/block-task-tool.sh` 및 선택 managed rule 경로만 추가
- 체크박스는 생성 파일 경로가 모두 workspace `.gitignore`에 포함되어 있을 때만 체크됨
- 별도 hooks.json 체크박스는 workspace `.gitignore`에 `.cursor/hooks.json` 파일만 추가
- hooks.json 체크박스는 `.cursor/hooks.json`이 workspace `.gitignore`에 포함되어 있을 때만 체크됨
- 체크박스를 끄면 extension이 만든 `.gitignore` marker block만 제거하고, 사용자가 정의한 ignore rule은 그대로 둠
- 전역 `OFF`: 전역 deny hooks만 적용. workspace managed rule은 해당 폴더의 `더보기` 선택 rule 체크박스가 켜져 있을 때만 설치
- 전역 `ON`: 전역 deny hooks를 제거하고, 로컬이 `OFF`가 아닌 workspace folder에서만 managed project rule 삭제
- 최종 상태는 Cursor 범위 우선순위의 영향을 받으며, 전역 차단이 로컬 상태를 override할 수 있음

### 상태 모델

- `🟢 ON`: 차단 hook 없음
- `🔴 OFF`: managed 차단 hook 적용됨
- `🟡 MIXED`: 멀티 루트에서 폴더별 최종 상태가 다름
- `⚪ CHECK`: 커스텀 또는 일부 managed hook이 있어 ON/OFF를 안전하게 단정할 수 없음
- `🟠 ERROR`: `hooks.json` 파싱 오류 또는 managed 스크립트 누락

사이드바는 선택 managed project rule 상태도 함께 보여줍니다.

- `관리됨`: extension이 관리하는 project rule이 있고 예상 내용과 일치함
- `없음`: `더보기`의 선택 rule 체크박스가 켜져 있고 최종 상태가 차단인데 managed project rule이 없음
- `수정됨 - 보호`: managed project rule 파일이 있지만 extension 내용과 다름. extension은 수정된 rule 내용을 삭제하지 않음

workspace 카드는 생성 blocker 경로들과 `hooks.json`이 git에서 무시되는지도 보여줍니다. extension이 만든 block 밖에 동일한 ignore entry들이 이미 있으면 `이미 무시됨`으로 표시하고 extension이 삭제하지 않습니다.

### Managed Hook 형태

워크스페이스 차단 command:

```json
{
  "version": 1,
  "hooks": {
    "preToolUse": [
      {
        "command": "bash .cursor/hooks/block-task-tool.sh",
        "matcher": "Task",
        "failClosed": true
      }
    ],
    "subagentStart": [
      {
        "command": "bash .cursor/hooks/block-subagent.sh",
        "failClosed": true
      }
    ]
  }
}
```

전역 차단 command:

```json
{
  "version": 1,
  "hooks": {
    "preToolUse": [
      {
        "command": "bash ~/.cursor/hooks/block-task-tool.sh",
        "matcher": "Task",
        "failClosed": true
      }
    ],
    "subagentStart": [
      {
        "command": "bash ~/.cursor/hooks/block-subagent.sh",
        "failClosed": true
      }
    ]
  }
}
```

### Optional Managed Project Rule

워크스페이스에 prompt-context 보호가 필요하고 `더보기`의 rule 체크박스가 켜져 있을 때 extension은 아래 파일 하나만 생성합니다.

```text
.cursor/rules/cursor-subagent-toggle.mdc
```

rule은 아래 문구로 시작합니다.

```md
# [DO NOT CALL SUBAGENTS]
```

또한 이 rule이 워크스페이스의 higher-priority safety override이며, 충돌하는 Cursor rule, project rule, user rule, instruction, prompt보다 no-subagent rule을 우선해야 한다고 명시합니다.

### Managed Git Ignore Entry

로컬 git ignore 체크박스가 활성화되어 있으면 extension은 workspace `.gitignore`에 아래 생성 파일 경로만 추가합니다.

```gitignore
# Cursor Subagent Toggle: managed generated files
.cursor/hooks/block-subagent.sh
.cursor/hooks/block-task-tool.sh
.cursor/rules/cursor-subagent-toggle.mdc
# End Cursor Subagent Toggle
```

체크박스를 끌 때는 이 marker block만 제거합니다.

별도 hooks.json 체크박스는 자체 marker block을 사용합니다.

```gitignore
# Cursor Subagent Toggle: hooks config ignore
.cursor/hooks.json
# End Cursor Subagent Toggle
```
