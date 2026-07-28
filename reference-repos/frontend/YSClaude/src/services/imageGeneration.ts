import { fetch as expoFetch } from 'expo/fetch';
import { randomUUID } from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';

interface ImageGenerationReferenceImage {
  uri: string;
}

export interface ImageGenerationRequest {
  baseUrl: string;
  apiKey: string;
  model: string;
  prompt: string;
  size?: string;
  quality?: string;
  referenceImages?: ImageGenerationReferenceImage[];
  signal?: AbortSignal;
  onProgress?: (label: string) => void;
}

export interface ImageGenerationResult {
  imageUri: string;
  revisedPrompt?: string;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/$/, '');
}

function ensureGeneratedPicsDir(): Directory {
  const dir = new Directory(Paths.document, 'generated-pics');
  dir.create({ intermediates: true, idempotent: true });
  return dir;
}

function decodeBase64(base64: string): Uint8Array {
  if (typeof globalThis.atob !== 'function') {
    throw new Error('当前运行环境不支持 base64 解码');
  }
  const binary = globalThis.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function extensionFromMimeType(mimeType: string | null | undefined): string {
  const normalized = (mimeType || '').toLowerCase();
  if (normalized.includes('jpeg')) return '.jpg';
  if (normalized.includes('webp')) return '.webp';
  if (normalized.includes('gif')) return '.gif';
  return '.png';
}

async function saveImageBytes(
  bytes: Uint8Array,
  mimeType: string | null | undefined,
  fileStem: string
): Promise<string> {
  const dir = ensureGeneratedPicsDir();
  const file = new File(dir, `${fileStem}${extensionFromMimeType(mimeType)}`);
  file.write(bytes);
  return file.uri;
}

async function resultFromImageApiResponse(
  response: Response,
  fileStem: string,
  onProgress?: (label: string) => void
): Promise<ImageGenerationResult> {
  onProgress?.('解析 API 响应');
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API Error ${response.status}: ${errorText}`);
  }

  const json = await response.json();
  const item = json?.data?.[0];
  if (!item) {
    throw new Error('生图接口未返回图片数据');
  }

  if (typeof item.b64_json === 'string' && item.b64_json.trim()) {
    onProgress?.('解码图片数据');
    const bytes = decodeBase64(item.b64_json.trim());
    onProgress?.('保存图片文件');
    return {
      imageUri: await saveImageBytes(bytes, 'image/png', fileStem),
      revisedPrompt: item.revised_prompt || undefined,
    };
  }

  if (typeof item.url === 'string' && item.url.trim()) {
    onProgress?.('下载图片文件');
    return {
      imageUri: await downloadImage(item.url.trim(), fileStem),
      revisedPrompt: item.revised_prompt || undefined,
    };
  }

  throw new Error('生图接口未返回可用的图片地址');
}

async function downloadImage(url: string, fileStem: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`图片下载失败 ${response.status}: ${errorText.slice(0, 200)}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  return saveImageBytes(bytes, response.headers.get('content-type'), fileStem);
}

async function editOpenAIImage(request: ImageGenerationRequest): Promise<ImageGenerationResult> {
  const { baseUrl, apiKey, model, prompt, size, quality, referenceImages, signal, onProgress } = request;
  const url = `${normalizeBaseUrl(baseUrl)}/images/edits`;
  const form = new FormData();

  form.append('model', model);
  form.append('prompt', prompt);
  if (size) {
    form.append('size', size);
  }
  if (quality) {
    form.append('quality', quality);
  }

  const images = (referenceImages || []).slice(0, 16);
  if (images.length === 0) {
    throw new Error('未选择生图参考图');
  }

  images.forEach((image) => {
    form.append('image[]', new File(image.uri) as any);
  });

  onProgress?.('上传参考图并请求生图');
  const response = await expoFetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey.trim()}`,
    },
    body: form as any,
    signal,
  });

  return resultFromImageApiResponse(
    response as Response,
    `pic-${Date.now().toString(36)}-${randomUUID()}`,
    onProgress
  );
}

export async function generateOpenAIImage(request: ImageGenerationRequest): Promise<ImageGenerationResult> {
  const { baseUrl, apiKey, model, prompt, size, quality, referenceImages, signal, onProgress } = request;
  if (referenceImages && referenceImages.length > 0) {
    return editOpenAIImage(request);
  }

  const url = `${normalizeBaseUrl(baseUrl)}/images/generations`;
  const body: Record<string, any> = {
    model,
    prompt,
  };
  if (size) {
    body.size = size;
  }
  if (quality) {
    body.quality = quality;
  }

  onProgress?.('请求生图 API');
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey.trim()}`,
    },
    body: JSON.stringify(body),
    signal,
  });

  const fileStem = `pic-${Date.now().toString(36)}-${randomUUID()}`;
  return resultFromImageApiResponse(response, fileStem, onProgress);
}

export async function deleteGeneratedImageFile(imageUri?: string): Promise<void> {
  if (!imageUri) return;
  const file = new File(imageUri);
  if (file.exists) {
    file.delete();
  }
}

export async function saveGeneratedImageToLibrary(imageUri: string): Promise<string> {
  const permission = await MediaLibrary.requestPermissionsAsync(true, ['photo']);
  if (!permission.granted) {
    throw new Error('未获得相册写入权限');
  }

  const asset = await MediaLibrary.Asset.create(imageUri);
  return asset.id;
}
