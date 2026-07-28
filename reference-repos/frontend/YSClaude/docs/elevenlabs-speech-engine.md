# ElevenLabs Speech Engine 通话配置

YSClaude 仅在“通话 STT”和“通话 TTS”同时选择 `ElevenLabs` 时启用 Speech Engine。其他组合继续使用原有通话链路；只选择一边会在启动时提示配置错误。

## App 需要的配置

- `Token Endpoint`：你的服务端签发 ElevenLabs WebRTC conversation token 的 HTTPS GET 接口。
- `Voice ID`：可选。覆盖 Speech Engine 中配置的默认音色。
- `Language`：默认 `zh`。

Token Endpoint 可以返回以下任一 JSON 结构：

```json
{ "token": "..." }
```

```json
{ "conversationToken": "..." }
```

服务端应使用 ElevenLabs API Key 调用 conversation token API。不要把 API Key 返回给 App，也不要把它写入 YSClaude 设置。

## Brain Server

Speech Engine 会把识别结果和完整会话历史通过 WebSocket 发给 Brain Server。Brain Server 负责调用自定义 LLM，并将增量文本返回 ElevenLabs。请把 ElevenLabs SDK提供的取消信号传递给 LLM 请求，以便用户插话时停止旧回复。

移动端只负责：

1. 从 Token Endpoint 获取短期 token。
2. 通过 WebRTC 连接 Speech Engine。
3. 显示 ElevenLabs 返回的用户/助手字幕。
4. 处理静音、挂断、说话/聆听状态。

更换 Brain Server 中的 LLM 不需要重新构建 App。
