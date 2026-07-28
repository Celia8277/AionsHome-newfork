# 参考仓库索引（reference-repos）

这里存放从几位大佬的开源仓库拉取的代码快照，按 **前端 / 后端 / 工具** 分类，供自己改造前后端时参考。
所有代码均为快照（已去除各自的 `.git`），来源、版本和许可证如下表。

## 前端（frontend/）

| 目录 | 来源 | 快照 commit | 简介 | 许可证 |
|------|------|------------|------|--------|
| `Hamster-Nest` | [chuan-101/Hamster-Nest](https://github.com/chuan-101/Hamster-Nest) | `e55a9bc` | 布丁仓鼠"串串"与饲养员 AI 的独立应用。React + Vite + Phaser 的 PWA，`supabase/` 目录内含 16 个 Edge Functions 后端（实际是全栈项目） | 未声明 |
| `KI-CO` | [Kisera001/KI-CO](https://github.com/Kisera001/KI-CO) | `47f14a6` | 「小屋」：开源 AI 陪伴小屋，React + Vite + Electron 桌面应用，含记忆系统、日记、观影室等房间 | CC BY-NC-SA 4.0（非商用） |
| `YSClaude` | [winter-bit-cry/YSClaude](https://github.com/winter-bit-cry/YSClaude) | `cf75204` | Android 优先的个人 AI Agent 工作台。React Native + Expo，含工具调用、长期记忆、子 Agent、MCP、Kotlin 原生层 | 自定义 License（见其 LICENSE） |

## 后端（backend/）

| 目录 | 来源 | 快照 commit | 简介 | 许可证 |
|------|------|------------|------|--------|
| `paramecium` | [Shitsuten/paramecium](https://github.com/Shitsuten/paramecium) | `7695d52` | 「草履虫」网关记忆架构：`chat-api` / `gateway-admin` / `memory` 三个模块，原文+检索的极简记忆系统 | 未声明 |
| `aifarm-oss` | [tutusagi/aifarm-oss](https://github.com/tutusagi/aifarm-oss) | `03c3074` | 纯文字的 AI 联网抽卡养成农场游戏（Node + TypeScript），引擎和数值完整，flavor 文案已被作者抽空 | PolyForm Noncommercial 1.0（非商用） |
| `cyberboss` | [WenXiaoWendy/cyberboss](https://github.com/WenXiaoWendy/cyberboss) | `373ab17` | Codex / Claude Code 的微信桥接（Node 22+），含时间线功能 | AGPLv3 |

## 工具（tools/）

| 目录 | 来源 | 快照 commit | 简介 | 许可证 |
|------|------|------------|------|--------|
| `La-Releve-Forge-3.0` | [Vivi-Seth/La-Rel-ve-Forge-3.0](https://github.com/Vivi-Seth/La-Rel-ve-Forge-3.0) | `91fc9bd` | Claude Code 换 session 交接工具（forge-reload 下一代），单脚本 `releve-reload.js` | MIT |

## 注意事项

- 快照拉取日期：2026-07-28，均为各仓库默认分支当日最新。
- **许可证提醒**：KI-CO（CC BY-NC-SA）与 aifarm-oss（PolyForm NC）明确禁止商用；cyberboss 是 AGPLv3（改造后如对外提供网络服务需开源）；Hamster-Nest 和 paramecium 未附许可证，默认保留所有权利——自用参考没问题，公开分发改造版之前建议先问作者。
- 想更新某个快照时，重新 clone 对应仓库覆盖同名目录即可。
