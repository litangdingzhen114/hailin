# 海林村小程序后端

零依赖 Node.js 后端，提供小程序内容接口、Kimi AI 导游代理、预约/反馈写入、慢直播视频代理，以及运营后台。

## 启动

```bash
npm run backend
```

默认地址：

```text
http://127.0.0.1:8787
```

健康检查：

```text
GET http://127.0.0.1:8787/health
```

后台管理页：

```text
http://127.0.0.1:8787/admin/
```

本地开发如果没有配置 `ADMIN_TOKEN`，后端会使用开发默认值：

```text
hailin-admin-dev-token
```

生产环境必须设置自己的强随机 `ADMIN_TOKEN`，否则后端会拒绝启动。

## 环境变量

把 `backend/.env.example` 复制为 `backend/.env`：

```text
NODE_ENV=production
PORT=8787
HOST=0.0.0.0
PUBLIC_BASE_URL=https://api.sunmaosun.com
STORAGE_DIR=backend/storage
ALLOWED_ORIGINS=https://api.sunmaosun.com
ADMIN_USER=hailin-admin
ADMIN_TOKEN=换成强随机Token
KIMI_API_KEY=你的KimiKey
KIMI_BASE_URL=https://api.moonshot.cn/v1
KIMI_MODEL=kimi-k2.6
```

`KIMI_API_KEY` 也兼容官方常用变量名 `MOONSHOT_API_KEY`。Key 只放后端，不放进小程序。

## 小程序接口

- `GET /api/hailin/home`
- `GET /api/hailin/map-points`
- `GET /api/hailin/foods`
- `GET /api/hailin/lives`
- `POST /api/hailin/ai-guide`
- `POST /api/hailin/bookings`
- `POST /api/hailin/feedback`
- `GET /media/hailin-live.mp4`

## 管理接口

所有 `/api/admin/*` 接口都需要：

```text
Authorization: Bearer <ADMIN_TOKEN>
```

已提供：

- `GET /api/admin/session`
- `GET /api/admin/summary`
- `GET /api/admin/home-content`
- `PUT /api/admin/home-content`
- `POST /api/admin/home-content/reset`
- `GET /api/admin/bookings`
- `GET /api/admin/feedback`
- `GET /api/admin/audit`
- `GET /api/admin/backup`
- `PATCH /api/admin/bookings/:id/status`
- `PATCH /api/admin/feedback/:id/status`
- `GET /api/admin/export?type=bookings`
- `GET /api/admin/export?type=feedback`

## 生产化能力

- 管理后台 Token 鉴权
- 生产环境缺少强 `ADMIN_TOKEN` 或 HTTPS `PUBLIC_BASE_URL` 时拒绝启动
- 后台系统健康面板显示正式域名、HTTPS、Token 和 CORS 限制状态
- 公开接口和后台接口分级限流
- 预约/反馈输入校验
- 公开接口禁止读取预约/反馈列表，避免游客联系方式暴露
- 操作审计写入 `backend/storage/audit.json`
- 后台支持完整 JSON 备份下载，包含预约、反馈和审计记录
- 后台列表默认脱敏展示联系方式，详情抽屉保留完整联系方式用于处理
- JSON 存储原子写入
- 请求日志写入 `backend/storage/logs/`
- CSV 导出
- 健康检查返回存储、AI、后台配置状态
- Kimi 请求失败时自动回退本地导游话术

当前存储仍是文件型，适合轻量上线或试运营。高并发、多管理员、多点部署时建议迁移到数据库。

## 测试

```bash
npm test
```

或分别运行：

```bash
npm run test:backend
npm run test:production
```
