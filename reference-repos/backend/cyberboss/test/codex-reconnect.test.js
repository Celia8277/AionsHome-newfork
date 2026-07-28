const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

test("codex adapter reinitializes when the websocket transport has dropped", async () => {
  const indexPath = path.resolve(__dirname, "../src/adapters/runtime/codex/index.js");
  const rpcClientPath = path.resolve(__dirname, "../src/adapters/runtime/codex/rpc-client.js");
  const mcpConfigPath = path.resolve(__dirname, "../src/adapters/runtime/codex/mcp-config.js");

  const originalIndex = require.cache[indexPath];
  const originalRpc = require.cache[rpcClientPath];
  const originalMcp = require.cache[mcpConfigPath];

  class MockCodexRpcClient {
    constructor() {
      this.isReady = false;
      this.transportReady = false;
      this.connectCalls = 0;
      this.initializeCalls = 0;
    }

    async connect() {
      this.connectCalls += 1;
      this.transportReady = true;
    }

    async initialize() {
      this.initializeCalls += 1;
      this.isReady = true;
    }

    isTransportReady() {
      return this.transportReady;
    }

    async listModels() {
      return { result: { data: [] } };
    }

    onMessage() {
      return () => {};
    }

    async close() {}
  }

  delete require.cache[indexPath];
  require.cache[rpcClientPath] = {
    id: rpcClientPath,
    filename: rpcClientPath,
    loaded: true,
    exports: {
      CodexRpcClient: MockCodexRpcClient,
    },
  };
  require.cache[mcpConfigPath] = {
    id: mcpConfigPath,
    filename: mcpConfigPath,
    loaded: true,
    exports: {
      resolveCodexProjectToolMcpServerConfig() {
        return null;
      },
    },
  };

  try {
    const { createCodexRuntimeAdapter } = require(indexPath);
    const adapter = createCodexRuntimeAdapter({
      sessionsFile: path.join(__dirname, "..", "tmp", "codex-reconnect-sessions.json"),
      codexEndpoint: "ws://127.0.0.1:8765",
      stateDir: path.join(__dirname, "..", "tmp"),
    });

    await adapter.initialize();
    const client = adapter.createClient();
    assert.equal(client.connectCalls, 1);
    assert.equal(client.initializeCalls, 1);

    client.transportReady = false;
    client.isReady = false;

    await adapter.initialize();
    assert.equal(client.connectCalls, 2);
    assert.equal(client.initializeCalls, 2);
  } finally {
    delete require.cache[indexPath];
    if (originalIndex) {
      require.cache[indexPath] = originalIndex;
    }
    if (originalRpc) {
      require.cache[rpcClientPath] = originalRpc;
    } else {
      delete require.cache[rpcClientPath];
    }
    if (originalMcp) {
      require.cache[mcpConfigPath] = originalMcp;
    } else {
      delete require.cache[mcpConfigPath];
    }
  }
});

test("codex adapter lets configured env model override stored session model", async () => {
  const indexPath = path.resolve(__dirname, "../src/adapters/runtime/codex/index.js");
  const rpcClientPath = path.resolve(__dirname, "../src/adapters/runtime/codex/rpc-client.js");
  const mcpConfigPath = path.resolve(__dirname, "../src/adapters/runtime/codex/mcp-config.js");

  const originalIndex = require.cache[indexPath];
  const originalRpc = require.cache[rpcClientPath];
  const originalMcp = require.cache[mcpConfigPath];
  const calls = {
    startThread: [],
    resumeThread: [],
    sendUserMessage: [],
  };
  const listeners = new Set();

  class MockCodexRpcClient {
    async connect() {}
    async initialize() {}
    isTransportReady() {
      return true;
    }
    async listModels() {
      return { result: { data: [] } };
    }
    onMessage(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
    async startThread(params) {
      calls.startThread.push(params);
      return { result: { thread: { id: "new-thread" } } };
    }
    async resumeThread(params) {
      calls.resumeThread.push(params);
      return { result: { thread: { id: params.threadId } } };
    }
    async sendUserMessage(params) {
      calls.sendUserMessage.push(params);
      const turnId = `turn-${calls.sendUserMessage.length}`;
      queueMicrotask(() => {
        emitMockCodexTurnCompleted(listeners, params.threadId, turnId);
      });
      return { result: { turn: { id: turnId } } };
    }
    async close() {}
  }

  delete require.cache[indexPath];
  require.cache[rpcClientPath] = {
    id: rpcClientPath,
    filename: rpcClientPath,
    loaded: true,
    exports: {
      CodexRpcClient: MockCodexRpcClient,
    },
  };
  require.cache[mcpConfigPath] = {
    id: mcpConfigPath,
    filename: mcpConfigPath,
    loaded: true,
    exports: {
      resolveCodexProjectToolMcpServerConfig() {
        return null;
      },
    },
  };

  try {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cyberboss-codex-env-model-"));
    const sessionsFile = path.join(tempDir, "sessions.json");
    const workspaceRoot = path.join(tempDir, "workspace");
    fs.mkdirSync(workspaceRoot);

    const { createCodexRuntimeAdapter } = require(indexPath);
    const adapter = createCodexRuntimeAdapter({
      sessionsFile,
      codexEndpoint: "ws://127.0.0.1:8765",
      stateDir: tempDir,
      codexModel: "gemma4:26b",
      codexModelProvider: "ollama",
    });

    const sessionStore = adapter.getSessionStore();
    sessionStore.setThreadIdForWorkspace("binding", workspaceRoot, "old-thread");
    sessionStore.setRuntimeParamsForWorkspace("binding", workspaceRoot, {
      model: "gpt-oss:20b",
      modelProvider: "ollama",
    });

    const result = await adapter.sendTextTurn({
      bindingKey: "binding",
      workspaceRoot,
      text: "hello",
      model: "gpt-oss:20b",
    });

    assert.equal(result.threadId, "new-thread");
    assert.deepEqual(calls.resumeThread, []);
    assert.equal(calls.startThread.length, 1);
    assert.equal(calls.startThread[0].model, "gemma4:26b");
    assert.equal(calls.startThread[0].modelProvider, "ollama");
    assert.equal(calls.sendUserMessage[0].model, "gemma4:26b");
    assert.equal(calls.sendUserMessage[0].modelProvider, "ollama");
    assert.deepEqual(sessionStore.getRuntimeParamsForWorkspace("binding", workspaceRoot), {
      model: "gemma4:26b",
      modelProvider: "ollama",
    });
    assert.equal(sessionStore.getThreadIdForWorkspace("binding", workspaceRoot), "new-thread");

    calls.startThread.length = 0;
    calls.resumeThread.length = 0;
    calls.sendUserMessage.length = 0;

    const cloudSessionsFile = path.join(tempDir, "cloud-sessions.json");
    const cloudAdapter = createCodexRuntimeAdapter({
      sessionsFile: cloudSessionsFile,
      codexEndpoint: "ws://127.0.0.1:8765",
      stateDir: tempDir,
    });
    const cloudSessionStore = cloudAdapter.getSessionStore();
    cloudSessionStore.setThreadIdForWorkspace("binding", workspaceRoot, "old-local-thread");
    cloudSessionStore.setRuntimeParamsForWorkspace("binding", workspaceRoot, {
      model: "gemma4:26b",
      modelProvider: "ollama",
    });

    await cloudAdapter.refreshThreadInstructions({
      threadId: "old-local-thread",
      workspaceRoot,
      model: "gemma4:26b",
      modelProvider: "ollama",
    });

    assert.equal(calls.resumeThread.length, 1);
    assert.equal(calls.resumeThread[0].model, "");
    assert.equal(calls.resumeThread[0].modelProvider, "");
    assert.equal(calls.sendUserMessage[0].model, "");
    assert.equal(calls.sendUserMessage[0].modelProvider, "");

    calls.startThread.length = 0;
    calls.resumeThread.length = 0;
    calls.sendUserMessage.length = 0;

    await cloudAdapter.sendTextTurn({
      bindingKey: "binding",
      workspaceRoot,
      text: "hello cloud",
      model: "gemma4:26b",
    });

    assert.deepEqual(calls.resumeThread, []);
    assert.equal(calls.startThread.length, 1);
    assert.equal(calls.startThread[0].model, "");
    assert.equal(calls.startThread[0].modelProvider, "");
    assert.equal(calls.sendUserMessage[0].model, "");
    assert.equal(calls.sendUserMessage[0].modelProvider, "");
    assert.deepEqual(cloudSessionStore.getRuntimeParamsForWorkspace("binding", workspaceRoot), {
      model: "",
      modelProvider: "",
    });
  } finally {
    delete require.cache[indexPath];
    if (originalIndex) {
      require.cache[indexPath] = originalIndex;
    }
    if (originalRpc) {
      require.cache[rpcClientPath] = originalRpc;
    } else {
      delete require.cache[rpcClientPath];
    }
    if (originalMcp) {
      require.cache[mcpConfigPath] = originalMcp;
    } else {
      delete require.cache[mcpConfigPath];
    }
  }
});

test("codex adapter enables native image input from model metadata or explicit override", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cyberboss-codex-image-cap-"));
  const sessionsFile = path.join(tempDir, "sessions.json");
  const indexPath = path.resolve(__dirname, "../src/adapters/runtime/codex/index.js");
  delete require.cache[indexPath];
  const { createCodexRuntimeAdapter } = require(indexPath);

  const adapter = createCodexRuntimeAdapter({
    sessionsFile,
    codexEndpoint: "ws://127.0.0.1:8765",
    stateDir: tempDir,
    codexModel: "gemma4:26b-32k",
    codexModelProvider: "ollama",
  });
  adapter.getSessionStore().setAvailableModelCatalog([{
    slug: "gemma4:26b-32k",
    input_modalities: ["text", "image"],
  }]);

  assert.deepEqual(adapter.getTurnCapabilities({ model: "gemma4:26b-32k" }), {
    nativeImageInput: true,
    toolImageRead: false,
  });

  const forcedOff = createCodexRuntimeAdapter({
    sessionsFile: path.join(tempDir, "forced-off.json"),
    codexNativeImageInput: false,
    stateDir: tempDir,
  });
  assert.equal(forcedOff.getTurnCapabilities({ model: "gemma4:26b-32k" }).nativeImageInput, false);

  const forcedOn = createCodexRuntimeAdapter({
    sessionsFile: path.join(tempDir, "forced-on.json"),
    codexNativeImageInput: true,
    stateDir: tempDir,
  });
  assert.equal(forcedOn.getTurnCapabilities({ model: "unknown" }).nativeImageInput, true);
});

function emitMockCodexTurnCompleted(listeners, threadId, turnId) {
  for (const listener of listeners) {
    listener({
      method: "turn/started",
      params: {
        threadId,
        turn: { id: turnId },
      },
    });
    listener({
      method: "item/completed",
      params: {
        threadId,
        item: {
          id: `item-${turnId}`,
          type: "agentMessage",
          text: "ok",
        },
      },
    });
    listener({
      method: "turn/completed",
      params: {
        threadId,
        turn: { id: turnId },
      },
    });
  }
}
