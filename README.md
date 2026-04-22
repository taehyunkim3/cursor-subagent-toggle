# Cursor Subagent Toggle

## English

Cursor Subagent Toggle controls whether Cursor can create subagents by managing:

- Local workspace hook config: `.cursor/hooks.json`
- Local workspace managed rule: `.cursor/rules/cursor-subagent-toggle.mdc`
- Global user hook config: `~/.cursor/hooks.json`

The extension shows global and workspace states together in a dedicated sidebar and in the status bar, including support for multi-root workspaces.

### Main Features

- Sidebar cards for global and each workspace folder
- Small toggle switch per scope
- Live final-status summary in the status bar
- Language selector (`English / 한국어`)
- Safe handling for custom `subagentStart` hooks (`CHECK` state)
- One-click `Apply Recommended Config` to replace only `hooks.subagentStart` and recreate extension-managed guard files
- Managed project rule injection for stronger prompt-context guidance when subagents are disabled
- A workspace checkbox to add only the generated blocker script and managed project rule file to `.gitignore`
- A separate workspace checkbox to add only `.cursor/hooks.json` to `.gitignore`

### Toggle Semantics

- Toggle `ON` means subagent creation is allowed in that local scope.
- Toggle `OFF` means the managed blocker is enabled in that local scope.
- Workspace `OFF` writes both the deny hook and a separate managed project rule.
- Workspace `ON` removes the managed hook and deletes only `.cursor/rules/cursor-subagent-toggle.mdc` when it still matches the extension-managed content.
- Existing user-created `.cursor/rules/*.mdc` files are not modified, merged, or deleted.
- The local git ignore checkbox adds only `.cursor/hooks/block-subagent.sh` and `.cursor/rules/cursor-subagent-toggle.mdc` to the workspace `.gitignore`.
- The checkbox is checked only when both generated files are already ignored by the workspace `.gitignore`.
- The separate hooks.json checkbox adds only `.cursor/hooks.json` to the workspace `.gitignore`.
- The hooks.json checkbox is checked only when `.cursor/hooks.json` is already ignored by the workspace `.gitignore`.
- When the checkbox is turned off, the extension removes only its own managed `.gitignore` marker block and leaves user-defined ignore rules intact.
- Global `OFF` writes the global deny hook and injects the managed project rule into currently open workspace folders.
- Global `ON` removes the global deny hook and removes the managed project rule only from workspace folders that are not locally `OFF`.
- Effective final state still follows Cursor scope priority: global blocking can override a local workspace.

### Status Model

- `🟢 ON`: No blocking hook is applied.
- `🔴 OFF`: Managed blocking hook is applied.
- `🟡 MIXED`: Different effective states across folders in multi-root.
- `⚪ CHECK`: Custom `subagentStart` exists, so safe ON/OFF inference is not possible.
- `🟠 ERROR`: Invalid `hooks.json` or missing managed script.

The sidebar also shows the managed project rule state:

- `Managed`: The extension-managed project rule exists and matches the expected content.
- `Missing`: The managed project rule is missing while the effective state is blocked.
- `Modified - protected`: The managed project rule file exists but no longer matches the extension content. The extension does not delete modified rule content.

The workspace card also shows whether both generated files and `hooks.json` are ignored by git. If the exact ignore entries already exist outside extension-managed blocks, they are shown as `Already ignored` and are not removed by the extension.

### Managed Hook Shape

Workspace blocker command:

```json
{
  "version": 1,
  "hooks": {
    "subagentStart": [
      { "command": "bash .cursor/hooks/block-subagent.sh" }
    ]
  }
}
```

Global blocker command:

```json
{
  "version": 1,
  "hooks": {
    "subagentStart": [
      { "command": "bash hooks/block-subagent.sh" }
    ]
  }
}
```

### Managed Project Rule

When a workspace needs prompt-context protection, the extension creates only this file:

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

Cursor Subagent Toggle은 아래 항목을 관리해서 Cursor의 subagent 생성 허용 여부를 제어합니다.

- 로컬 워크스페이스 hook 설정: `.cursor/hooks.json`
- 로컬 워크스페이스 관리 rule: `.cursor/rules/cursor-subagent-toggle.mdc`
- 전역 사용자 hook 설정: `~/.cursor/hooks.json`

확장은 전용 사이드바와 status bar에서 전역/로컬 상태를 함께 보여주며, 멀티 루트 워크스페이스도 지원합니다.

### 주요 기능

- 전역 카드 + 워크스페이스 폴더별 카드 제공
- 범위별 작은 토글 스위치 제공
- status bar에 최종 상태 실시간 요약 표시
- 언어 선택기 (`English / 한국어`)
- 커스텀 `subagentStart`에 대한 안전 모드(`CHECK` 상태)
- `Apply Recommended Config` 버튼으로 `hooks.subagentStart`만 교체하고 extension 관리 guard 파일 재생성
- subagent 비활성화 시 더 강한 prompt-context 지시를 위한 managed project rule 주입
- 생성된 blocker script와 managed project rule 파일만 `.gitignore`에 추가하는 workspace 체크박스 제공
- `.cursor/hooks.json` 파일만 `.gitignore`에 추가하는 별도 workspace 체크박스 제공

### 토글 의미

- 토글 `ON`: 해당 로컬 범위에서 subagent 생성 허용
- 토글 `OFF`: 해당 로컬 범위에서 managed blocker 활성화
- 워크스페이스 `OFF`: deny hook과 별도 managed project rule을 함께 생성
- 워크스페이스 `ON`: managed hook을 제거하고, `.cursor/rules/cursor-subagent-toggle.mdc`가 extension 관리 내용과 일치할 때만 삭제
- 사용자가 만든 기존 `.cursor/rules/*.mdc` 파일은 수정, 병합, 삭제하지 않음
- 로컬 git ignore 체크박스는 workspace `.gitignore`에 `.cursor/hooks/block-subagent.sh` 및 `.cursor/rules/cursor-subagent-toggle.mdc` 파일만 추가
- 체크박스는 생성 파일 두 개가 모두 workspace `.gitignore`에 포함되어 있을 때만 체크됨
- 별도 hooks.json 체크박스는 workspace `.gitignore`에 `.cursor/hooks.json` 파일만 추가
- hooks.json 체크박스는 `.cursor/hooks.json`이 workspace `.gitignore`에 포함되어 있을 때만 체크됨
- 체크박스를 끄면 extension이 만든 `.gitignore` marker block만 제거하고, 사용자가 정의한 ignore rule은 그대로 둠
- 전역 `OFF`: 전역 deny hook을 적용하고 현재 열려 있는 workspace folder들에 managed project rule 주입
- 전역 `ON`: 전역 deny hook을 제거하고, 로컬이 `OFF`가 아닌 workspace folder에서만 managed project rule 삭제
- 최종 상태는 Cursor 범위 우선순위의 영향을 받으며, 전역 차단이 로컬 상태를 override할 수 있음

### 상태 모델

- `🟢 ON`: 차단 hook 없음
- `🔴 OFF`: managed 차단 hook 적용됨
- `🟡 MIXED`: 멀티 루트에서 폴더별 최종 상태가 다름
- `⚪ CHECK`: 커스텀 `subagentStart`가 있어 ON/OFF를 안전하게 단정할 수 없음
- `🟠 ERROR`: `hooks.json` 파싱 오류 또는 managed 스크립트 누락

사이드바는 managed project rule 상태도 함께 보여줍니다.

- `관리됨`: extension이 관리하는 project rule이 있고 예상 내용과 일치함
- `없음`: 최종 상태가 차단인데 managed project rule이 없음
- `수정됨 - 보호`: managed project rule 파일이 있지만 extension 내용과 다름. extension은 수정된 rule 내용을 삭제하지 않음

workspace 카드는 생성 파일 두 개와 `hooks.json`이 git에서 무시되는지도 보여줍니다. extension이 만든 block 밖에 동일한 ignore entry들이 이미 있으면 `이미 무시됨`으로 표시하고 extension이 삭제하지 않습니다.

### Managed Hook 형태

워크스페이스 차단 command:

```json
{
  "version": 1,
  "hooks": {
    "subagentStart": [
      { "command": "bash .cursor/hooks/block-subagent.sh" }
    ]
  }
}
```

전역 차단 command:

```json
{
  "version": 1,
  "hooks": {
    "subagentStart": [
      { "command": "bash hooks/block-subagent.sh" }
    ]
  }
}
```

### Managed Project Rule

워크스페이스에 prompt-context 보호가 필요할 때 extension은 아래 파일 하나만 생성합니다.

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
