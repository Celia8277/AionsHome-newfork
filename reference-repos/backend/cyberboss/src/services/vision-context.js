const fs = require("fs/promises");

const DEFAULT_VISION_TIMEOUT_MS = 30_000;
const DEFAULT_VISION_PROMPT = "Describe this image concisely for a text-only assistant. Include visible text, people, objects, scene context, and whether it looks like a reusable chat sticker.";

async function resolveVisionContext({ prepared, config = {}, runtimeAdapter = null, model = "" }) {
  const attachments = Array.isArray(prepared?.attachments) ? prepared.attachments : [];
  const images = attachments.filter((item) => isImageAttachmentItem(item));
  if (!images.length) {
    return emptyVisionContext("none");
  }

  const mode = normalizeVisionMode(config.visionMode);
  if (mode === "off") {
    return emptyVisionContext("none");
  }

  if (mode !== "caption") {
    const runtimeImageAccess = resolveRuntimeImageAccess({ runtimeAdapter, model });
    if (runtimeImageAccess.nativeImageInput) {
      return {
        route: "native",
        items: [],
        errors: [],
        runtimeAttachments: attachments,
      };
    }
    if (runtimeImageAccess.toolImageRead) {
      return {
        route: "tool",
        items: [],
        errors: [],
        runtimeAttachments: [],
      };
    }
  }

  if (mode === "native") {
    return {
      route: "none",
      items: [],
      errors: images.map((item) => ({
        ...pickAttachmentLabel(item),
        reason: "native image input is not available for the current runtime/model",
      })),
      runtimeAttachments: [],
    };
  }

  if (!isCaptionProviderConfigured(config)) {
    return {
      route: "none",
      items: [],
      errors: images.map((item) => ({
        ...pickAttachmentLabel(item),
        reason: "vision caption provider is not configured",
      })),
      runtimeAttachments: [],
    };
  }

  return captionImages({ images, config });
}

async function captionImages({ images, config }) {
  const items = [];
  const errors = [];
  for (const image of images) {
    try {
      const description = await captionImageWithOpenAiCompatibleProvider({ image, config });
      items.push({
        ...pickAttachmentLabel(image),
        description,
      });
    } catch (error) {
      errors.push({
        ...pickAttachmentLabel(image),
        reason: error instanceof Error ? error.message : String(error || "vision caption failed"),
      });
    }
  }
  return {
    route: items.length ? "caption" : "none",
    items,
    errors,
    runtimeAttachments: [],
  };
}

async function captionImageWithOpenAiCompatibleProvider({ image, config }) {
  const baseUrl = normalizeText(config.visionApiBaseUrl);
  const model = normalizeText(config.visionModel);
  const apiKey = normalizeText(config.visionApiKey);
  const absolutePath = normalizeText(image.absolutePath);
  if (!baseUrl || !model) {
    throw new Error("vision API base URL and model are required");
  }
  if (!absolutePath) {
    throw new Error("image has no saved local path");
  }

  const imageBytes = await fs.readFile(absolutePath);
  const contentType = normalizeText(image.contentType) || "image/jpeg";
  const dataUrl = `data:${contentType};base64,${imageBytes.toString("base64")}`;
  const response = await postJsonWithTimeout({
    url: joinUrl(baseUrl, "chat/completions"),
    apiKey,
    timeoutMs: config.visionTimeoutMs || DEFAULT_VISION_TIMEOUT_MS,
    body: {
      model,
      messages: [{
        role: "user",
        content: [
          { type: "text", text: DEFAULT_VISION_PROMPT },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      }],
    },
  });
  const text = extractOpenAiCompatibleText(response);
  if (!text) {
    throw new Error("vision API returned no description");
  }
  return text;
}

async function postJsonWithTimeout({ url, apiKey, body, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, Number(timeoutMs) || DEFAULT_VISION_TIMEOUT_MS));
  try {
    const headers = {
      "content-type": "application/json",
    };
    if (apiKey) {
      headers.authorization = `Bearer ${apiKey}`;
    }
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const raw = await response.text();
    let parsed = null;
    if (raw) {
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = null;
      }
    }
    if (!response.ok) {
      const message = normalizeText(parsed?.error?.message) || normalizeText(raw) || response.statusText;
      throw new Error(`vision API request failed (${response.status}): ${message}`);
    }
    return parsed;
  } finally {
    clearTimeout(timer);
  }
}

function extractOpenAiCompatibleText(response) {
  const content = response?.choices?.[0]?.message?.content;
  if (typeof content === "string") {
    return content.trim();
  }
  if (Array.isArray(content)) {
    return content
      .map((item) => typeof item?.text === "string" ? item.text.trim() : "")
      .filter(Boolean)
      .join("\n")
      .trim();
  }
  return "";
}

function resolveRuntimeImageAccess({ runtimeAdapter, model }) {
  const capabilitySource = typeof runtimeAdapter?.getTurnCapabilities === "function"
    ? runtimeAdapter.getTurnCapabilities({ model })
    : runtimeAdapter?.describe?.()?.capabilities;
  return {
    nativeImageInput: Boolean(capabilitySource?.nativeImageInput),
    toolImageRead: Boolean(capabilitySource?.toolImageRead),
  };
}

function isCaptionProviderConfigured(config) {
  const provider = normalizeText(config.visionProvider) || "openai-compatible";
  return provider === "openai-compatible"
    && Boolean(normalizeText(config.visionApiBaseUrl))
    && Boolean(normalizeText(config.visionModel));
}

function normalizeVisionMode(value) {
  const normalized = normalizeText(value).toLowerCase();
  if (["off", "native", "caption"].includes(normalized)) {
    return normalized;
  }
  return "auto";
}

function emptyVisionContext(route) {
  return {
    route,
    items: [],
    errors: [],
    runtimeAttachments: [],
  };
}

function pickAttachmentLabel(item) {
  return {
    kind: item?.kind || "image",
    sourceFileName: item?.sourceFileName || "",
    absolutePath: item?.absolutePath || "",
  };
}

function isImageAttachmentItem(item) {
  return Boolean(item?.isImage) || normalizeText(item?.contentType).toLowerCase().startsWith("image/")
    || normalizeText(item?.kind).toLowerCase() === "image";
}

function joinUrl(baseUrl, suffix) {
  return `${normalizeText(baseUrl).replace(/\/+$/, "")}/${normalizeText(suffix).replace(/^\/+/, "")}`;
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

module.exports = {
  resolveVisionContext,
};
