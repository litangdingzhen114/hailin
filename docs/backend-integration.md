# 海林村小程序真实服务接入说明

## 小程序配置

小程序端只配置后端域名，不保存 AI Key、直播密钥或后台 Token。

文件：`miniprogram/config/service.js`

```js
apiBaseUrl: 'https://api.sunmaosun.com'
```

本地开发可以使用：

```js
apiBaseUrl: 'http://127.0.0.1:8787'
```

真机预览时不要使用 `127.0.0.1`，需要换成电脑局域网 IP；正式上线必须使用 HTTPS 域名，并在微信公众平台配置合法 request 域名。

## 后端启动

```bash
npm run backend
```

健康检查：

```text
GET /health
```

后台管理页：

```text
GET /admin/
```

## 小程序接口

- `GET /api/hailin/home`
- `GET /api/hailin/map-points`
- `GET /api/hailin/foods`
- `GET /api/hailin/lives`
- `POST /api/hailin/ai-guide`
- `POST /api/hailin/bookings`
- `POST /api/hailin/feedback`

小程序会兼容 `{ data: ... }` 返回格式。

## AI 导游

`POST /api/hailin/ai-guide`

请求示例：

```json
{
  "message": "推荐一条半日路线",
  "history": [],
  "location": "浙江省丽水市青田县海口镇海林村",
  "context": ["瓯江", "青田石", "田鱼", "侨乡", "山水村落"]
}
```

后端优先读取 `KIMI_API_KEY`，也兼容 `MOONSHOT_API_KEY`。配置后会代理调用 Kimi/Moonshot 的 `https://api.moonshot.cn/v1/chat/completions`；未配置 Key 或请求失败时，会返回本地兜底导游话术。

Kimi 官方文档：https://platform.moonshot.cn/docs

## 后台管理

访问：

```text
https://api.sunmaosun.com/admin/
```

登录使用后端环境变量 `ADMIN_TOKEN`。后台支持：

- 看预约、反馈、AI、慢直播总览
- 按状态筛选预约和反馈
- 更新预约/反馈处理状态
- 导出预约和反馈 CSV
- 查看存储、运行时间、AI Provider 等系统健康信息
- 查看操作审计，追踪预约/反馈处理、导出和备份动作
- 下载完整 JSON 备份，包含预约、反馈和审计记录
- 列表默认脱敏显示联系方式，详情页用于实际处理时可复制完整联系方式

## 首页内容

小程序首页继续请求：

```text
GET /api/hailin/home
```

后台可维护首页 JSON 内容：

```text
GET /api/admin/home-content
PUT /api/admin/home-content
POST /api/admin/home-content/reset
```

可管理内容包含轮播、快捷入口、文创商品、热门推荐、榜单、长廊、游记流、公告、天气和服务状态。保存后会写入 `backend/storage/home-content.json`，并同步进入审计和完整备份。

## 慢直播

本地后端已提供：

```text
GET /media/hailin-live.mp4
```

并在 `GET /api/hailin/lives` 中把所有点位的 `liveUrl` 指向这段视频。后续接真实摄像头时，把 `backend/server.js` 的 `livePayload()` 替换成摄像头/HLS 地址即可。

## 预约和反馈

写入文件：

- `backend/storage/bookings.json`
- `backend/storage/feedback.json`
- `backend/storage/audit.json`

日志文件：

- `backend/storage/logs/YYYY-MM-DD.log`

正式多实例部署时建议迁移到数据库，避免多个进程同时写同一份 JSON 文件。
