# Architecture

## Core

`core` is responsible for:

- reading config
- choosing which channel / runtime / integrations to use
- orchestrating capabilities instead of implementing concrete protocols

## Channel Adapters

`adapters/channel/*`

Responsible for:

- receiving messages
- sending messages
- typing / media / context token handling

Not responsible for:

- Codex / Claude Code thread logic
- reminder / timeline / diary logic

## Runtime Adapters

`adapters/runtime/*`

Responsible for:

- sending messages into the specific agent runtime
- handling thread / session / approval / stop

Not responsible for:

- WeChat protocol details
- timeline UI

## Capability Integrations

`integrations/*`

Examples:

- `timeline`
- `reminder`
- `diary`

These capabilities should depend on external standalone projects whenever possible, instead of being folded back into the main repository.

## Expected External Dependencies

- timeline:
  - `timeline-for-agent`
- weixin bridge:
  - to be split into a standalone adapter
- codex runtime:
  - to be split into a standalone adapter
