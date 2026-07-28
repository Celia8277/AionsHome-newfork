# LiveKit Agents 语音通话

服务端项目位于：`E:\Desktop\YSClaude-project\ysclaude-livekit-brain`。

该模式只在以下组合启用：

- 通话引擎：LiveKit Agents
- 通话 STT：Aliyun
- 通话 TTS：Cartesia

App 由 LiveKit React Native SDK 独占 communication audio session，通过 WebRTC 发布麦克风并播放 Agent 远端音频；旧的本地 PCM → STT → LLM → TTS 通话引擎及其 `VoiceCallAudioModule` 已移除。

当前聊天 API 配置会交给 Agent 的 OpenAI-compatible LLM adapter，因此语音通话和文字聊天使用同一个模型端点与模型名。开始通话时，App 会读取当前窗口对应的 SQLite 会话历史，排除已隐藏消息，并在 dispatch 大小预算内从最近消息向前注入 Agent 的初始 `ChatContext`。

当前启用的本地工具、Memory Vault、MCP、网页与 Android 原生工具会以 JSON Schema 交给 Agent。Agent 发起工具调用后，Brain 使用 LiveKit RPC 将调用转回 App，由 App 复用 `src/services/tools.ts` 的执行器完成操作，再把文本结果返回语音模型。工具密钥和本地配置不会复制到 Brain 的工具定义中。

视频通话会由 LiveKit 发布麦克风和前置摄像头轨道；共享屏幕通话会发布麦克风和 Android MediaProjection 屏幕轨道。Brain 持续订阅视频，在每个用户语音回合结束时把最新帧附加到该轮消息，因此当前聊天模型必须支持图片输入。LiveKit 模式不再使用本地定时截图作为模型视觉输入。
