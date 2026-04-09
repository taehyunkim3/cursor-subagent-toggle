# Cursor Subagent Toggle

## English

Cursor Subagent Toggle controls whether Cursor can create subagents by managing `subagentStart` hooks in:

- Local workspace folder: `.cursor/hooks.json`
- Global user scope: `~/.cursor/hooks.json`

The extension shows both scopes together in a dedicated sidebar and in the status bar, including support for multi-root workspaces.

### Main Features

- Sidebar cards for global and each workspace folder
- Small toggle switch per scope
- Live final-status summary in the status bar
- Language selector (`English / 한국어`)
- Safe handling for custom `subagentStart` hooks (`CHECK` state)
- One-click `Apply Recommended Config` to replace only `hooks.subagentStart`

### Toggle Semantics

- Toggle `ON` means subagent is enabled in that local scope.
- Toggle `OFF` means managed blocker is enabled in that local scope.
- Effective final state still follows Cursor scope priority (global can override local).

### Status Model

- `🟢 ON`: No blocking hook is applied.
- `🔴 OFF`: Managed blocking hook is applied.
- `🟡 MIXED`: Different effective states across folders in multi-root.
- `⚪ CHECK`: Custom `subagentStart` exists, so safe ON/OFF inference is not possible.
- `🟠 ERROR`: Invalid `hooks.json` or missing managed script.

### Priority Rules

- If global scope is `OFF`, effective state is `OFF` for all folders.
- If global scope is `ON`, each folder follows its own local state.
- Multi-root view shows global, local, and effective status per folder.

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

## 한국어

Cursor Subagent Toggle은 아래 두 범위의 `subagentStart` hook을 관리해서, Cursor의 subagent 생성 허용 여부를 제어합니다.

- 로컬 워크스페이스 폴더: `.cursor/hooks.json`
- 전역 사용자 범위: `~/.cursor/hooks.json`

확장은 전용 사이드바와 status bar에서 전역/로컬 상태를 함께 보여주며, 멀티 루트 워크스페이스도 지원합니다.

### 주요 기능

- 전역 카드 + 워크스페이스 폴더별 카드 제공
- 범위별 작은 토글 스위치 제공
- status bar에 최종 상태 실시간 요약 표시
- 언어 선택기 (`English / 한국어`)
- 커스텀 `subagentStart`에 대한 안전 모드(`CHECK` 상태)
- `Apply Recommended Config` 버튼으로 `hooks.subagentStart`만 권장 설정으로 교체

### 토글 의미

- 토글 `ON`: 해당 로컬 범위에서 subagent 활성화
- 토글 `OFF`: 해당 로컬 범위에서 managed blocker 활성화
- 최종 상태는 Cursor 범위 우선순위(전역 우선)의 영향을 받음

### 상태 모델

- `🟢 ON`: 차단 hook 없음
- `🔴 OFF`: managed 차단 hook 적용됨
- `🟡 MIXED`: 멀티 루트에서 폴더별 최종 상태가 다름
- `⚪ CHECK`: 커스텀 `subagentStart`가 있어 ON/OFF를 안전하게 단정할 수 없음
- `🟠 ERROR`: `hooks.json` 파싱 오류 또는 managed 스크립트 누락

### 우선순위 규칙

- 전역이 `OFF`면 모든 폴더의 최종 상태는 `OFF`
- 전역이 `ON`이면 각 폴더는 로컬 상태를 따름
- 멀티 루트에서는 폴더별 global/local/effective 상태를 함께 표시

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
