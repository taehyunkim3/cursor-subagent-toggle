# Changelog

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
