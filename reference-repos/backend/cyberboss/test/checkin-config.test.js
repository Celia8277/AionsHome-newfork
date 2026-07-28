const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  CheckinConfigStore,
  DEFAULT_MIN_INTERVAL_MS,
  DEFAULT_MAX_INTERVAL_MS,
  parseCheckinRangeMinutes,
} = require("../src/core/checkin-config-store");
const { CyberbossApp } = require("../src/core/app");

function createStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cyberboss-checkin-test-"));
  return new CheckinConfigStore({ filePath: path.join(dir, "checkin-config.json") });
}

test("parseCheckinRangeMinutes accepts min-max minute ranges", () => {
  assert.deepEqual(parseCheckinRangeMinutes("7-21"), { minMinutes: 7, maxMinutes: 21 });
  assert.deepEqual(parseCheckinRangeMinutes("5 - 10"), { minMinutes: 5, maxMinutes: 10 });
  assert.equal(parseCheckinRangeMinutes("10-3"), null);
  assert.equal(parseCheckinRangeMinutes("abc"), null);
});

test("checkin config store falls back to defaults and persists overrides", () => {
  const store = createStore();
  assert.deepEqual(store.getRange(), {
    minIntervalMs: DEFAULT_MIN_INTERVAL_MS,
    maxIntervalMs: DEFAULT_MAX_INTERVAL_MS,
  });
  store.setRange({ minIntervalMs: 4 * 60_000, maxIntervalMs: 25 * 60_000 });
  assert.deepEqual(store.getRange(), {
    minIntervalMs: 4 * 60_000,
    maxIntervalMs: 25 * 60_000,
  });
});

test("handleCheckinCommand stores the new range and replies in English", async () => {
  const sent = [];
  const store = createStore();
  const appLike = {
    checkinConfigStore: store,
    channelAdapter: {
      async sendText(payload) {
        sent.push(payload);
      },
    },
  };

  await CyberbossApp.prototype.handleCheckinCommand.call(appLike, {
    senderId: "user-1",
    contextToken: "ctx-1",
  }, {
    args: "7-21",
  });

  assert.deepEqual(store.getRange(), {
    minIntervalMs: 7 * 60_000,
    maxIntervalMs: 21 * 60_000,
  });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].text, "✅ Check-in interval reset to 7-21 minutes and will apply on the next polling cycle.");
});

test("handleChunkCommand reports current value and persists updates through the channel adapter", async () => {
  const sent = [];
  let minChunk = 20;
  const appLike = {
    channelAdapter: {
      getMinChunkChars() {
        return minChunk;
      },
      setMinChunkChars(value) {
        minChunk = value;
        return minChunk;
      },
      async sendText(payload) {
        sent.push(payload);
      },
    },
  };

  await CyberbossApp.prototype.handleChunkCommand.call(appLike, {
    senderId: "user-1",
    contextToken: "ctx-1",
  }, {
    args: "",
  });
  await CyberbossApp.prototype.handleChunkCommand.call(appLike, {
    senderId: "user-1",
    contextToken: "ctx-1",
  }, {
    args: "50",
  });

  assert.equal(sent[0].text, "💡 Current minimum merge chunk is 20 characters. Usage: /chunk <number> (e.g. /chunk 50)");
  assert.equal(sent[1].text, "✅ Minimum merge chunk set to 50 characters. Shorter fragments will be merged into one message up to this size.");
  assert.equal(minChunk, 50);
});
