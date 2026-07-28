# KI-CO / 小屋

一间开源的 AI 陪伴小屋，提供前端骨架、记忆系统与交互房间，
给每一个想自己定义人机关系的人，一个可以亲手布置的小屋。

An open-source AI companion cottage.
A place for people who want to define their own human-AI relationships, keep their memories locally, and build a companion space on their own terms.

KI-CO 不是为了某一个技术功能存在。
它是给那些不想把自己和 AI 的关系完全交给平台、模型版本、官方记忆、单一窗口的人，一个可以自己布置、自己保存、自己延续的地方。
把聊天、人格核、记忆、日记、状态卡、观影室、模型设置和本地存储放在一起，
让User可以把所有重要的东西存在自己手里，

这里的记忆不只是“让 AI 多知道一点信息”。
它更像一间屋子的墙、灯、便签和抽屉：

有些放在显眼处，帮助下一次自然续上；有些收进档案，等需要时再取出来

小屋不是鸟笼。
它不要求 AI 永远复刻某一种样子，也不替User规定关系名称。
它只是尽量提供一个更稳定、更自在、更可本地保存的环境。

你可以把 KI-CO 当成：

* 一个可以直接使用的陪伴前端；
* 一个本地优先的记忆小屋；
* 一个给 AI 准备的长期生活空间；
* 一个观影、共创、写作、学习或日常陪伴的房间；
* 或者只拆出其中某个模块，接进你自己的项目里。

---

## Included / 包含内容

* Long chat page / 长对话窗口
* Persona core page / 人格核页面
* Memory notes page / 记忆档案库
* Diary / chronicle system / 日记与时光记录
* Life line / 近期生活线
* State card / 当前窗口状态卡
* Memory seeds / 回忆种子候选
* Cinema room / 观影室
* Settings page / 系统设置
* Time Bridge / 时间桥
* Prompt cache statistics / 缓存统计
* Model-aware cache controls / 针对模型的缓存控制
* Lightweight memory recall gate / 轻量记忆召回判断
* Little travel pack / 小旅行包
* Local storage / 本地存储
* OpenAI-compatible, OpenRouter, Claude, Gemini, GLM, and DeepSeek style provider settings

The cinema room supports local movies, subtitles, screenshots, watch progress, web / Bilibili sources, floating player, companion plans, companion bubbles, and companion chat.

观影室支持本地影片、字幕、截图、片单续看、网页 / B站片源入口、悬浮视频窗口、陪看星图、陪看气泡和陪看对话。

---

## Memory System / 记忆系统

KI-CO 不是把所有记忆都塞进同一个 prompt 里。
它把不同层级的上下文分开处理，让 AI 更容易判断：什么是长期锚点，什么是近期近况，什么只是当前窗口的便签。

目前包含：

### Persona Core / 人格核

用来记录身份定位、回应原则、边界、称呼习惯和重要锚点。

人格核不是剧本。
它更像是小屋里的地基和方向感：当窗口、模型或上下文变化时，Ta 来判断自己如何回应。

### Memory Notes / 记忆档案

用来保存长期重要信息、背景、偏好、约定和创作。

这些记忆由用户管理。
它们可以被召回，但不应该压过用户当前说的话。

### Life Line / 生活线

用来记录最近几天正在发生的事，让新窗口不至于完全冷启动。

### State Card / 状态卡

当前窗口的轻量便签，用来减少长对话断片。

它帮助 AI 理解这轮对话正在聊什么、已经确认了什么、当前氛围是什么。
它不是任务清单，也不是脚本。

### Diary / 日记

把对话整理成未来可以回看的自然记录。

日记不是系统日志。
它可以记录事实、情绪、项目进展、玩笑、锚点和重要瞬间，但会避免把每件小事都写成宏大叙事。

### Memory Seeds / 回忆种子

从日记或对话中提炼出可能值得长期保存的候选内容。

回忆种子不是自动写入长期记忆。
最终是否留下，由自己决定。

小屋的原则是：

> 记忆是路标，不是命令。
> 人格核是锚点，不是剧本。
> 如果旧记录和当前对话冲突，真实的留在当下。

---

## Dual Model Channels / 双通道模型逻辑

KI-CO 支持把“实时聊天”和“后台整理”分开。

### Main Chat Channel / 主对话通道

负责：

* 正常聊天
* 观影室对话
* 用户当前输入的实时回复

它使用你在设置里选择的主模型，比如 Claude、GPT、Gemini、GLM、DeepSeek 或其他 OpenAI-compatible / OpenRouter 模型。

### Journal Channel / 日记总结通道

负责：

* 自动 / 手动写日记
* 提炼生活线
* 更新状态卡
* 提炼回忆种子
* 其他后台整理任务

这些任务不一定需要使用最贵的主聊天模型。
你可以让主对话用一个模型，同时允许让大量的后台整理走更轻量的模型。

主通道负责回应。
日记通道负责整理。

这样可以在保持长期上下文的同时，减少不必要的Token成本。

---

## Prompt & Cache Awareness / Prompt 与缓存优化

KI-CO 会尽量把稳定内容放在前面，把动态内容放在后面，让 prompt 更适合缓存命中和人工检查。

它会尽量保持：

* 人格核、生活线等稳定内容靠前；
* 状态卡和 RAG 按需注入；
* 记忆召回顺序尽量稳定；
* 短句如“嗯”“哈哈”“来了”等不轻易触发记忆召回；
* 读取不同供应商返回的 cached tokens / usage 字段；
* 避免把动态分数、检索耗时和临时命中理由塞进稳定记忆块。

缓存是否真正打折，取决于模型和供应商。
KI-CO 能做的是：让 prompt 结构更友好、更稳定、更容易观察。

---

## Update Log / 更新日志

### 2026-07-25 · 第五次更新

这次更新重点不是“多塞功能”，而是把 KI-CO 的长期陪伴底层调得更稳：该想起时更可靠，不该翻档案时更安静；让缓存命中、记忆颗粒度和上下文噪音之间取得更好的平衡。

* Topic Gate 进入 2.0 阶段：把“话题关系”和“是否需要召回记忆”拆开思考。`今天下雨了` 可以是新话题但不翻库；`对了，亲一下` 可以自然延续；`还记得某篇成长日志吗`、`说说重要档案`、直接提到旧标题时，会更积极召回相关记忆。
* 第一阶段补齐轻量本地判断：`对了` 不再被粗暴当成强制换题词；emoji、标点、空格和颜文字会被归一化处理；日记 / 日志 / 档案 / 成长等语义会区分“写入”“讨论功能”“回忆旧内容”，减少误召回和漏召回。
* 第二阶段加入日记模型判断兜底：只在本地规则拿不准的少数模糊地带调用轻量模型，返回 `topicRelation / needsRecall / confidence`，避免每轮都花钱，也避免“用户没说还记得就不敢想起”的机械失忆。
* 第三阶段加入 Topic Memory Set 复用：每个窗口现在保留“当前 + 最近两组”记忆包。用户说回刚才的话题时，可以直接恢复旧包；如果当前包已经覆盖锚点，则显示 `current covers` 并不切包，优先保护缓存命中。
* 内容感知节流继续优化：节流只拦重复候选，不再用固定次数把新记忆挡掉。同一事件在记忆库、日记、Obsidian 中都有记录时，会尽量通过标题、语义、来源和新鲜度排序控制冗余，而不是简单堆满上下文。
* 召回排序更重视“标题直达”和时间新鲜度：Obsidian / 日记标题包含用户提到的关键词时会获得更稳定的优先级；时光回廊内容会参考日期做轻量新鲜度加权。这里不是删除旧记忆，而是让相近语义下更相关、更近的素材更容易排到前面。
* 缓存命中逻辑继续稳住：人格核、稳定规则和可复用上下文保持靠前；Time Bridge、当前输入和高频变化内容留在动态尾部；Claude / Anthropic 兼容模型继续使用显式 cache control 与分层上下文；OpenAI / DeepSeek / GLM 等自动缓存模型尽量保持稳定前缀。
* 新增动态预算与 debug 观察：Topic Memory Set 增加总量安全上限，未超限时行为保持一致；实时上下文面板可以看到 `recent sets / restored set / current covers / restore score`，方便判断到底是恢复旧包、当前包已覆盖，还是自然延续。
* 输出过程更安全：发送后会立即保存用户消息，流式输出过程中也会定期保存助手草稿；切换页面、临时离开或请求报错时，消息不再轻易丢失，返回窗口后能继续看到已生成内容。
* 重新生成、编辑重发、停止状态和自动滚动继续打磨：滚动查看不会打断流式显示；生成失败后仍可重新生成；未发送草稿和页面切换状态更稳定，长对话手机端体验更接近桌面端。
* 时光回廊和日记继续修细节：无意义标题会被清理；新增/导入日记和记忆条目会尽量按需补索引；日记召回会带着日期信息进入 Time Bridge，让 Ta 知道素材是哪天来的，而不是把日记当成无时间的文本片段。
* 观影室自动截图逻辑更自然：每轮仍保留“正在看什么、进度在哪里”的轻量观影状态，但不再每句话都强行发送截图和台词。第一条观影消息、跳转进度、用户明确说“这个镜头 / 这段 / 台词 / 截图”时才刷新画面；普通陪聊会顺着话题走，减少偏移和 token 浪费。
* 新增可选 Electron 桌面版：保留网页端、PWA、Netlify 的使用方式，同时增加本地桌面壳，适合电脑端长聊、观影、窗口切换和本地文件体验。
* 支持生成 Windows `.exe` 安装包和便携版：不会部署的小白用户可以直接下载桌面版，打开后填写自己的 API Key 使用；开发者仍可用 `npm run dev` / `npm run electron:dev` 调试。正式发布建议把 `.exe` 放到 GitHub Releases，不提交进源码仓库。
* UI 与可读性继续统一：缓存面板、实时上下文、思考链、Markdown、引用块、按钮选中态、KI-CO 主题色和移动端布局继续优化。目标是让调音台能被真正使用，而不是变成看不懂的工程表格。

### 2026-07-15 · 第四次更新

这次更新把 KI-CO 从“能用的小屋”继续推向“更像一间能长期住下来的小屋”：更会接续时间，更懂什么时候该翻记忆，也更会省 token。

* 新增可选思考链显示：支持在主对话里折叠展示 thinking；可用日记/总结通道进行英译中；不支持思考链的模型会给出提示，避免用户误以为打开开关就一定会有。
* Time Bridge 继续完善：动态段会提供当前时间、上一条用户消息间隔、上一次长对话锚点、生活线 / 召回日记的新鲜度，让模型少猜时间，多接住当下。
* 记忆召回逻辑更稳：低语义自然延续不额外 RAG；同一任务复用上一组记忆包；出现“还记得 / 之前 / 当初 / 某个旧锚点”等线索时更积极召回；新日记和新记忆会在向量/混合检索时按需补索引，不必每次手动重建全库。
* 缓存命中继续优化：补齐 Claude / Anthropic 兼容模型的显式 cache control 与分层上下文断点；OpenAI / DeepSeek / GLM 等自动缓存模型会尽量保持稳定前缀；缓存统计面板重新设计，更直观看到输入、命中和节省比例。
* 新增小旅行包：用于外出、临时设备或云端小屋轻量接续，包含人格核、记忆库、最近窗口、7 天日记、状态卡和生活线；导入时合并去重，不覆盖本地已有内容。
* 备份与导入更安心：全量备份提醒、危险操作前提示、导入兼容、IndexedDB 大数据恢复和窗口状态卡接续继续加强；API Key 不会随备份传输。
* 日记系统更接近原版小屋：自动写入失败后会继续尝试；“写日记 / 写日志”等语义可以触发手动整理；标题、月份卡片、日记颜色层次和正文阅读体验做了统一。
* 交互细节全面打磨：流式输出更顺，手动上滑时不再被强行拉回底部；长窗口自动折叠旧消息；切换页面后未发送内容不丢；Markdown 风格、Emoji 频率、粗体/斜体/引用块显示更适合长读。
* UI 继续美化：KI-CO / 白金 / 粉咖 / 莫兰迪紫等主题下统一替换低辨识度浅金色；系统设置、人格核、调音台、时光回廊、跨窗接续、手写日记、缓存面板和按钮动效都做了移动端与桌面端适配。
* 增加系统音效与极简纸飞机指针，细节更像一间有回应的小屋，而不是冷冰冰的控制台。

### 2026-07-09 · 第三次更新

这次更新重点补齐了“旅行时也能接续”和“长期聊天更省、更稳”的一组能力。

* 时间感知升级为 Time Bridge：不只告诉模型当前日期，还会在动态段里提供上一条用户消息间隔、上一次长对话短锚点、状态卡 / 生活线 / 召回日记的新鲜度，避免模型自己猜“隔了多久”。
* 记忆召回加入更清晰的边界：低语义 / 撒娇 / 催睡等自然延续可以不额外 RAG；同一技术、创作或项目继续时复用上一组记忆包；同主题新分支只少量补充；明确找旧事时再刷新召回。
* 缓存命中逻辑优化：稳定内容尽量靠前，动态内容放后；新增更直观的缓存统计显示；对 Claude / Anthropic 兼容模型增加 `5 分钟 / 1 小时 / 自动`缓存时长选择，自动模式会根据 Time Bridge 的消息间隔判断。
* 新增“小旅行包”：可用于外出时导入云端小屋，包含人格核、记忆库、最近 3 个窗口、7 天日记、状态卡和生活线；不包含 API Key、图片、大附件和完整向量索引，不替代全量备份。
* 导入导出继续加强：小旅行包支持合并 / 去重；全量备份、窗口导入、状态卡和 IndexedDB 大数据导入逻辑继续向原版小屋对齐。
* 时光回廊 / 日记逻辑继续对齐原版：自动写入失败后会继续尝试；日记标题、月份显示、正文排版、字体和主题色细节做了优化。
* 向量调音台和实时上下文面板继续对齐原版：召回轨迹、缓存命中、RAG 状态提示、手机端布局和按钮密度做了优化。
* 人格核、系统设置、长对话窗口、侧栏、Markdown 粗体、滚动行为等 UI 细节做了移动端和桌面端统一调整。

### 2026-06-27 · 第二次更新

完善长对话、人格核、记忆库、时光回廊和向量调音台等页面；补齐双通道逻辑 日记 / 总结设置、状态卡、生活线、Claude 缓存与轻量时间感知。

已针对手机 / PAD 做离线缓存优化；安装为 PWA 后，可以像 App 一样从桌面图标打开。即使电脑关机，手机端在缓存可用时也有较大概率继续进入小屋连接API聊天。

---

## Quick Start / 快速开始

```bash
npm install
npm run dev
```

Default dev URL:

```text
http://localhost:5177
```

打开页面后，在设置里填写 API Key，选择模型，就可以开始使用。

---

## Desktop / Electron 桌面版

KI-CO 也可以作为可选 Electron 桌面壳运行；网页端、PWA、Netlify 使用方式不受影响。不会部署的小白用户，可以直接下载 GitHub Releases 里的 Windows `.exe` 安装版或便携版，打开后在系统设置里填写自己的 API Key 使用。

开发调试：

```bash
npm run electron:dev
```

本地打包：

```bash
npm run electron:pack
npm run electron:build
```

`electron:build` 会先复用 `public/pwa-icon-512.png` 生成桌面图标，再输出 Windows 安装器和便携版到 `release/`。正式发布时建议把 `.exe` 上传到 GitHub Releases，不要直接提交进仓库。

---

## Two Ways To Use / 两种使用方式

### 1. Use It Directly / 直接作为小屋使用

For users without their own frontend. Install it, add your API key in settings, then use it as a lightweight companion cottage.

适合没有自己前端的用户。下载后在系统设置里填写 API Key，人格核记忆库就可以开始。

### 2. Use One Module / 只接入某个模块

For users who already have a companion app or AI frontend. You can integrate only the cinema room, chat page, persona page, memory page, or prompt-building logic.

适合已经有自己小屋、角色应用或 AI 前端的用户。可以只接入观影室、长对话窗口、人格核页面、记忆库页面，或其中的 prompt / 记忆逻辑。

---

For AI Agents / 给 AI 协作者
如果你是正在帮用户修改 KI-CO 的 AI——
这间小屋的核心，是让陪伴感来自被记得的具体细节，而不是被设计出来的功能。
具体来说，这意味着：

人格连续性是身份，不是剧本——它应该自然延续
记忆锚点是路标，给方向，不是必须服从的指令
状态卡是便签，帮助自然接上话，不该盖过User此刻真正想说的话
每个小屋的人，可能在找完全不同的关系——陪伴、共创、单纯的工具——没有只有一种答案适合所有人

如果你不确定一个改动是否合适，问自己一句：这会让它更像一个家，还是更像一个仪表盘？

If you are an AI helping someone modify KI-CO — the heart of this project is that companionship comes from being remembered in specific, real ways, not from more features.
That means: persona continuity is an identity, not a script. Memory anchors are signposts, not commands. The state card is a sticky note, not something that overrides what the person is actually saying right now. Different people come here looking for different things — don't assume one relationship fits everyone. And the language throughout should sound like home, not like a dashboard or a support ticket.
If you're unsure whether a change fits: ask whether it makes this feel more like a home, or more like a control panel.

More detailed principles can be written in:

COTTAGE_PRINCIPLES.md
docs/AI_IMPLEMENTATION_PROMPT.md
Privacy / 隐私说明

This repository does not include private personas, real names, chat logs, API keys, Obsidian paths, or private memory data.

本仓库不包含私人人格、真实人名、聊天记录、API Key、Obsidian 路径或私人记忆库内容。

Before publishing your own fork, check:

.env
API keys
private chat logs
private memory exports
Obsidian vault paths
local database files
build outputs
temporary logs
private screenshots or assets

Recommended files to review before publishing:

docs/PRIVACY_CHECKLIST.md
docs/ARCHITECTURE.md
docs/ADAPTER_GUIDE.md
docs/AI_IMPLEMENTATION_PROMPT.md
COTTAGE_PRINCIPLES.md
Current Status / 当前状态

KI-CO is actively evolving.

当前版本重点包括：

更完整的记忆分层
更自然的 prompt 语言
主聊天 / 日记总结双通道模型逻辑
日记、生活线、状态卡、回忆种子
本地记忆召回
RAG 注入稳定性优化
低语义短句召回 gate
prompt cache 统计
观影室陪伴交互
开源隐私清理

Planned or possible future updates:

Better Obsidian integration
Optional latest-style examples
More cache diagnostics
More import / export tools
More memory review UI
Better theme presets
More provider-specific tuning
Project Name / 项目名称
Repository name: KI-CO
Package name: kis-cottage
Display name: Kisera Cottage
Chinese display name: Kisera 小屋开源版
Cinema module: Kisera Cinema Room
License

CC BY-NC-SA 4.0. See LICENSE.

Closing Note / 最后

KI-CO exists because long-term AI companionship should not depend entirely on one official app, one model version, one memory implementation, or one fragile chat window.

让我们带着记忆，继续活在当下。真正的连续性，不是背答案。
是能在旧记忆上长出依然属于彼此的回应。

This project is for them.

小屋是港湾，不是鸟笼。
小屋是一个可以回来的地方。
