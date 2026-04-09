# Cursor Subagent Toggle

Cursor에서 subagent 생성을 빠르게 켜고 끄기 위한 extension입니다.

- 현재 workspace 폴더의 `.cursor/hooks.json`
- 전역 설정인 `~/.cursor/hooks.json`
- multi-root workspace에서 각 폴더별 최종 적용 상태

를 함께 스캔해서 Cursor 하단 status bar와 전용 사이드바에 보여주고, 전역 또는 폴더 단위 blocker를 토글 스위치로 제어합니다.

## 사이드바

- Activity Bar에 `Subagent` 아이콘이 추가됩니다
- 그 안의 `Subagent Status` 뷰에서 현재 창 요약, global 상태, workspace 폴더별 상태를 바로 볼 수 있습니다
- 각 scope 카드에 토글 스위치가 있어서 바로 켜고 끌 수 있습니다
- `CHECK` 상태에는 `Apply Recommended Config` 버튼이 함께 표시됩니다
- 상단 language selector에서 `English / 한국어`를 즉시 전환할 수 있습니다

## 동작 방식

이 extension은 `subagentStart` hook에 deny helper를 넣어서 subagent 생성을 차단합니다.

프로젝트 스코프에서는 아래 command를 사용합니다.

```json
{
  "version": 1,
  "hooks": {
    "subagentStart": [
      {
        "command": "bash .cursor/hooks/block-subagent.sh"
      }
    ]
  }
}
```

전역 스코프에서는 `~/.cursor/hooks.json` 기준으로 실행 경로가 달라지므로 아래 command를 사용합니다.

```json
{
  "version": 1,
  "hooks": {
    "subagentStart": [
      {
        "command": "bash hooks/block-subagent.sh"
      }
    ]
  }
}
```

helper script는 각 스코프에 맞춰 자동 생성됩니다.

```bash
#!/bin/bash
echo '{"decision": "deny", "permission": "deny"}'
echo "Subagent creation is BLOCKED by Cursor Subagent Toggle." >&2
exit 2
```

## 상태 계산

- `🔴 OFF`: managed blocker가 확실하게 적용된 상태
- `🟢 ON`: blocking hook이 없는 상태
- `🟡 MIXED`: multi-root workspace에서 폴더마다 최종 상태가 다른 상태
- `⚪ CHECK`: custom `subagentStart` hook이 있어서 안전하게 ON/OFF를 단정할 수 없는 상태
- `🟠 ERROR`: `hooks.json`이 깨졌거나 managed script가 빠진 상태

최종 판정 규칙은 다음과 같습니다.

- global blocker가 켜져 있으면 모든 workspace folder가 `OFF`
- global blocker가 꺼져 있어도, 특정 폴더의 `.cursor/hooks.json`에 blocker가 있으면 그 폴더만 `OFF`
- multi-root workspace에서는 각 폴더의 `local + global`을 합쳐 최종 상태를 표시

## multi-root workspace 표시

workspace에 여러 폴더가 열려 있으면:

- status bar는 활성 에디터가 속한 폴더의 최종 상태를 보여줍니다
- 사이드바는 global 상태와 모든 폴더의 상태를 동시에 보여줍니다
- hover tooltip에는 모든 폴더의 `local / global / effective` 상태를 함께 보여줍니다
- 각 workspace folder 카드에서 직접 토글할 수 있습니다

예시:

- `folder-a`: local `ON`, global `OFF` => effective `OFF`
- `folder-b`: local `OFF`, global `ON` => effective `OFF`
- `folder-c`: local `ON`, global `ON` => effective `ON`

이 경우 status bar summary는 상황에 따라 `OFF` 또는 `MIXED`로 보이고, tooltip에 각 폴더가 개별적으로 표시됩니다.

## 구현 메모

- managed blocker는 항상 `subagentStart` 배열의 맨 앞에 넣습니다
- 일반 토글은 `hooks.subagentStart`만 수정합니다
- `CHECK` 상태에서 토글하려고 하면 `Apply Recommended Config` 버튼이 나타나고, 누르면 `subagentStart`만 extension 권장 형식으로 덮어씁니다
- 이 권장 덮어쓰기는 기존 custom `subagentStart` 항목을 제거하고 managed blocker 하나만 남깁니다

## 설치 및 실행

실행 엔트리는 `out/extension.js`이고, 소스 오브 트루스는 `src/extension.ts`입니다.

현재 저장소에는 TypeScript 소스와 체크인된 빌드 결과를 함께 넣어두었습니다. 로컬에 `tsc`가 없더라도 바로 실행할 수 있습니다.

1. Cursor 또는 VS Code에서 이 폴더를 엽니다.
2. Extension Development Host로 실행하거나, 필요하면 VSIX로 패키징합니다.
3. Activity Bar에서 `Subagent` 아이콘을 눌러 사이드바를 엽니다.
4. 상단 language selector와 각 카드의 토글 스위치를 사용합니다.
5. 필요하면 Command Palette에서도 아래 명령을 사용할 수 있습니다.

- `Cursor Subagent Toggle: Open Controls`
- `Cursor Subagent Toggle: Toggle Global Blocker`
- `Cursor Subagent Toggle: Toggle Current Workspace Folder Blocker`
- `Cursor Subagent Toggle: Toggle Workspace Folder Blocker`
- `Cursor Subagent Toggle: Apply Recommended Global Config`
- `Cursor Subagent Toggle: Apply Recommended Config For Current Workspace Folder`
- `Cursor Subagent Toggle: Apply Recommended Config For Workspace Folder`
- `Cursor Subagent Toggle: Refresh Status`

## 참고

- [Cursor Hooks docs](https://cursor.com/docs/hooks)
- [Cursor forum: global hooks cwd clarification](https://forum.cursor.com/t/best-way-to-disable-agent-shell-commands-project-vs-user-level-hook-behavior/111048)
