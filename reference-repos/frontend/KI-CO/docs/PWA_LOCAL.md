# KI-CO PWA / 手机缓存说明

KI-CO 现在支持基础 PWA 壳：

- 可安装到手机主屏幕或桌面。
- 已访问过的前端壳会尽量进入浏览器缓存。
- 网络短暂不可用时，已缓存的页面可以尝试离线打开。
- API 对话、模型读图、Obsidian Bridge 等远程或局域网能力仍需要对应服务在线。

## 重要限制

PWA 缓存是“当前设备”的浏览器缓存。

如果电脑关机：

- 手机不能自动读取电脑浏览器里的 localStorage / IndexedDB。
- 手机只有在自己之前打开并缓存过 KI-CO 时，才能尽量打开自己的那份小屋。
- 如果需要把电脑端数据带到手机端，请使用系统备份 / 导入导出能力。

## 为什么手机局域网地址可能不能安装

Service Worker 通常要求安全上下文：

- `localhost`
- `https://...`

普通 `http://192.168.x.x` 页面可以访问，但很多手机浏览器不会允许注册 PWA 缓存。

本地调试可以先用：

```bash
npm run dev:pwa
```

如果要测试真实手机安装和离线壳，建议使用可信 HTTPS 预览：

```bash
npm run dev:pwa:https
```

如果已经配置本地证书，可以通过环境变量指定：

```powershell
$env:VITE_HTTPS_CERT="C:\path\to\cert.pem"
$env:VITE_HTTPS_KEY="C:\path\to\key.pem"
npm run dev:pwa:https
```

生产式预览：

```bash
npm run preview:pwa:https
```
