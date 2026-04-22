# Changelog

## 0.1.6 - 2026-04-22

### English

- Added a separate workspace checkbox for ignoring `.cursor/hooks.json` in git.
- Made the hooks.json checkbox reflect the actual workspace `.gitignore` state.
- Added and removed only the extension-managed hooks.json marker block, preserving user-defined ignore rules.
- Surfaced hooks.json git ignore state separately from generated blocker file ignore state.

### 한국어

- `.cursor/hooks.json`을 git에서 무시할지 설정하는 별도 workspace 체크박스를 추가했습니다.
- hooks.json 체크박스가 실제 workspace `.gitignore` 상태를 반영하도록 했습니다.
- 사용자가 정의한 ignore rule을 보호하기 위해 extension이 관리하는 hooks.json marker block만 추가/삭제하도록 했습니다.
- hooks.json git ignore 상태를 생성된 blocker 파일 ignore 상태와 분리해서 표시합니다.

## 0.1.5 - 2026-04-22

### English

- Added `.cursor/hooks/block-subagent.sh` to the managed `.gitignore` block together with `.cursor/rules/cursor-subagent-toggle.mdc`.
- Changed the workspace git ignore checkbox to reflect the actual `.gitignore` state: it is checked only when both generated files are ignored.
- Kept `.gitignore` cleanup limited to the extension-managed marker block so user-defined ignore rules remain untouched.

### 한국어

- `.cursor/rules/cursor-subagent-toggle.mdc`와 함께 `.cursor/hooks/block-subagent.sh`도 managed `.gitignore` block에 포함했습니다.
- workspace git ignore 체크박스가 실제 `.gitignore` 상태를 반영하도록 수정했습니다. 생성 파일 두 개가 모두 무시될 때만 체크됩니다.
- `.gitignore` 정리는 extension이 관리하는 marker block에만 제한해서 사용자가 정의한 ignore rule은 그대로 유지합니다.

## 0.1.4 - 2026-04-22

### English

- Added a workspace checkbox to ignore only `.cursor/rules/cursor-subagent-toggle.mdc` in git.
- Enabled the git ignore option by default for local workspace rule injection.
- Added and removed only the extension-managed `.gitignore` marker block, preserving user-defined ignore rules.
- Surfaced managed rule git ignore state in each workspace card.

### 한국어

- `.cursor/rules/cursor-subagent-toggle.mdc` 파일만 git에서 무시하도록 설정하는 workspace 체크박스를 추가했습니다.
- 로컬 workspace rule 주입 시 git ignore 옵션이 기본 활성화되도록 했습니다.
- 사용자가 정의한 ignore rule을 보호하기 위해 extension이 관리하는 `.gitignore` marker block만 추가/삭제하도록 했습니다.
- 각 workspace 카드에서 managed rule git ignore 상태를 확인할 수 있게 했습니다.

## 0.1.3 - 2026-04-21

### English

- Added an extension-managed Cursor Project Rule at `.cursor/rules/cursor-subagent-toggle.mdc` when subagents are disabled.
- Added the `# [DO NOT CALL SUBAGENTS]` rule header and English override instructions so the no-subagent rule takes priority over conflicting rules, instructions, and prompts.
- Preserved user-defined project rules by creating and deleting only the extension-managed rule file.
- Protected modified managed rule files from deletion and surfaced their state in the sidebar.
- Updated global OFF behavior to inject the managed project rule into currently open workspace folders.

### 한국어

- subagent가 비활성화될 때 `.cursor/rules/cursor-subagent-toggle.mdc` 위치에 extension 관리 Cursor Project Rule을 추가했습니다.
- `# [DO NOT CALL SUBAGENTS]` rule 헤더와 영어 override 지시를 추가해서 충돌하는 rule, instruction, prompt보다 no-subagent rule을 우선하도록 명시했습니다.
- 사용자가 정의한 project rule을 보호하기 위해 extension 관리 rule 파일만 생성/삭제하도록 했습니다.
- 사용자가 수정한 managed rule 파일은 삭제하지 않고 보호하며, 사이드바에서 상태를 보여주도록 했습니다.
- 전역 OFF 상태에서 현재 열린 workspace folder들에 managed project rule을 주입하도록 업데이트했습니다.
