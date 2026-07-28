import {
  activateShizukuInputMethod,
  captureShizukuScreen,
  commitShizukuInputMethodText,
  deleteShizukuInputMethodText,
  executeShizukuShell,
  getShizukuStatus,
  isShizukuInputMethodReady,
  performShizukuInputMethodAction,
  requestShizukuPermission,
} from './shizukuShell';

type Bounds = { left: number; top: number; right: number; bottom: number; width: number; height: number; centerX: number; centerY: number };
type UiNode = { id: string; className: string; packageName: string; text: string; contentDescription: string; viewIdResourceName: string; bounds: Bounds; clickable: boolean; longClickable: boolean; scrollable: boolean; editable: boolean; enabled: boolean; visibleToUser: boolean; actionable: boolean; children: UiNode[] };
const nodeBounds = new Map<string, Bounds>();
let lastDisplay = { width: 1080, height: 1920 };

export async function ensureShizukuPermission(): Promise<void> {
  const status = await getShizukuStatus();
  if (!status.installed) throw new Error('Shizuku 未运行，请先启动 Shizuku');
  if (!status.permissionGranted && !await requestShizukuPermission()) throw new Error('Shizuku 授权被拒绝');
}

function decodeXml(value = ''): string {
  return value.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}
function attr(tag: string, name: string): string { return decodeXml(tag.match(new RegExp(`${name}="([^"]*)"`))?.[1] || ''); }
function boolAttr(tag: string, name: string): boolean { return attr(tag, name) === 'true'; }
function parseBounds(value: string): Bounds | null {
  const match = value.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/); if (!match) return null;
  const [, l, t, r, b] = match.map(Number); if (r <= l || b <= t) return null;
  return { left:l, top:t, right:r, bottom:b, width:r-l, height:b-t, centerX:Math.round((l+r)/2), centerY:Math.round((t+b)/2) };
}

function parseUiXml(xml: string) {
  nodeBounds.clear();
  const nodes: UiNode[] = [];
  for (const [index, match] of Array.from(xml.matchAll(/<node\b[^>]*>/g)).entries()) {
    const tag = match[0]; const bounds = parseBounds(attr(tag, 'bounds')); if (!bounds) continue;
    const id = `w0.${index}`; nodeBounds.set(id, bounds);
    const className = attr(tag, 'class');
    const clickable = boolAttr(tag, 'clickable'); const scrollable = boolAttr(tag, 'scrollable');
    const editable = className.includes('EditText') || boolAttr(tag, 'focusable') && boolAttr(tag, 'focused');
    nodes.push({ id, className, packageName:attr(tag,'package'), text:attr(tag,'text'), contentDescription:attr(tag,'content-desc'), viewIdResourceName:attr(tag,'resource-id'), bounds, clickable, longClickable:boolAttr(tag,'long-clickable'), scrollable, editable, enabled:attr(tag,'enabled') !== 'false', visibleToUser:true, actionable:clickable || scrollable || editable, children:[] });
  }
  const activePackage = nodes.find((node) => node.packageName)?.packageName || '';
  return { activePackage, display:lastDisplay, windows:[{ root:{ id:'w0', className:'hierarchy', packageName:activePackage, enabled:true, visibleToUser:true, actionable:false, children:nodes } }] };
}

async function shell(command: string, timeout = 15000, limit = 1000000) {
  await ensureShizukuPermission();
  const result = await executeShizukuShell(command, timeout, limit);
  if (result.exitCode !== 0) throw new Error(result.stderr || `Shell 退出码 ${result.exitCode}`);
  return result;
}

export async function captureShizukuScreenContext(includeTree = true) {
  await ensureShizukuPermission();
  const imageUri = await captureShizukuScreen();
  if (!includeTree) return { imageUri, screen:null };
  const result = await shell("uiautomator dump /data/local/tmp/ysclaude-window.xml >/dev/null && cat /data/local/tmp/ysclaude-window.xml; rm -f /data/local/tmp/ysclaude-window.xml", 20000);
  const size = await shell('wm size', 5000, 4000).catch(() => null);
  const sizeMatch = size?.stdout.match(/(?:Physical|Override) size:\s*(\d+)x(\d+)/g)?.pop()?.match(/(\d+)x(\d+)/);
  if (sizeMatch) lastDisplay = { width:Number(sizeMatch[1]), height:Number(sizeMatch[2]) };
  return { imageUri, screen:parseUiXml(result.stdout) };
}

export async function shizukuTap(x: number, y: number) { await shell(`input tap ${Math.round(x)} ${Math.round(y)}`, 5000, 4000); }
export async function shizukuTapRelative(x: number, y: number) { await shizukuTap(lastDisplay.width * x, lastDisplay.height * y); }
export async function shizukuSwipe(sx:number, sy:number, ex:number, ey:number, duration:number) { await shell(`input swipe ${Math.round(sx)} ${Math.round(sy)} ${Math.round(ex)} ${Math.round(ey)} ${Math.round(duration)}`, 10000, 4000); }
export async function shizukuClickNode(id:string) { const b=nodeBounds.get(id); if (!b) throw new Error('节点已过期，请重新观察屏幕'); await shizukuTap(b.centerX,b.centerY); }
export async function shizukuScrollNode(id:string, direction:string) { const b=nodeBounds.get(id); if (!b) throw new Error('节点已过期，请重新观察屏幕'); const forward=!/back|up|left|previous/i.test(direction); const pad=Math.max(10,Math.round(b.height*.2)); await shizukuSwipe(b.centerX, forward?b.bottom-pad:b.top+pad, b.centerX, forward?b.top+pad:b.bottom-pad, 360); }
export async function shizukuGlobalAction(action:string) {
  if (action === 'notifications') return void await shell('cmd statusbar expand-notifications',5000,4000);
  if (action === 'quick_settings') return void await shell('cmd statusbar expand-settings',5000,4000);
  const keys:Record<string,string>={back:'KEYCODE_BACK',home:'KEYCODE_HOME',recents:'KEYCODE_APP_SWITCH'};
  await shell(`input keyevent ${keys[action] || keys.back}`,5000,4000);
}
export async function ensureShizukuIme() { await ensureShizukuPermission(); if (!await isShizukuInputMethodReady()) { await activateShizukuInputMethod(); await new Promise((r)=>setTimeout(r,500)); } }
export async function shizukuCommitText(text:string) { await ensureShizukuIme(); return commitShizukuInputMethodText(text); }
export async function shizukuEditorAction(action:string) { await ensureShizukuIme(); return performShizukuInputMethodAction(action); }
export async function shizukuDeleteText(before:number,after:number) { await ensureShizukuIme(); return deleteShizukuInputMethodText(before,after); }
