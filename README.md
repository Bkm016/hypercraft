# Hypercraft

跨平台的进程管理与监控平台，适用于 Minecraft 服务端等长期运行的进程。

![](/images/PixPin_2025-12-12_03-14-57.png)
![](/images/PixPin_2025-12-12_03-15-27.png)
![](/images/PixPin_2025-12-12_03-15-31.png)

## 功能

- **进程管理** - 启动、停止、重启服务，支持自动重启和优雅关闭命令
- **实时终端** - 通过 WebSocket + PTY 实现终端 attach，支持输入输出交互
- **日志管理** - 实时日志流、历史日志查看、自动截断
- **定时调度** - 基于 Cron 表达式的定时启动/停止/重启
- **用户认证** - JWT 认证，支持 Token 刷新与撤销
- **权限控制** - 超级管理员 / 系统管理员 / 普通用户三层角色，用户级服务访问权限
- **Agent API** - 长期 API Key + `/agent/*` 运维面，便于脚本与 LLM Agent 控服/看日志/挂终端
- **安全策略** - 可配置命令白名单和工作目录限制
- **Web 管理界面** - 服务分组、标签筛选、拖拽排序

## 安装

### 使用预编译版本

从 [Releases](https://github.com/Bkm016/hypercraft/releases) 页面下载。

#### Windows

**后端服务**

```powershell
# 1. 创建环境配置文件（参考下方"环境变量"章节）

# 2. 启动 API 服务
.\hypercraft-api.exe

# 3. 使用 CLI 工具
.\hypercraft-cli.exe list
.\hypercraft-cli.exe start <service-id>
```

**Web 管理界面**

下载 `web-standalone-windows.zip`，解压后运行：

```powershell
.\start.ps1
# 或
start.cmd
```

默认运行在 `http://localhost:3000`。

#### Linux

```bash
# 添加执行权限
chmod +x hypercraft-api hypercraft-cli

# 启动 API 服务
./hypercraft-api

# 使用 CLI 工具
./hypercraft-cli list
```

### 从源码构建

#### 环境要求

- Rust 1.75+
- Node.js 20+ & pnpm

#### 启动后端

```bash
cd backend
cp .env.example .env
# 编辑 .env 配置

cargo run -p hypercraft-api
```

#### 启动前端

```bash
cd web
pnpm install
pnpm dev
```

访问 `http://localhost:3000`。

### CLI 命令

```bash
# 设置 API 地址
export HC_API_BASE="http://127.0.0.1:8080"

# 服务管理
hypercraft-cli list                     # 列出所有服务
hypercraft-cli get <id>                 # 查看服务详情
hypercraft-cli start <id>               # 启动服务
hypercraft-cli stop <id>                # 停止服务
hypercraft-cli restart <id>             # 重启服务
hypercraft-cli attach <id>              # 附加到终端
hypercraft-cli logs <id> --follow       # 实时日志
hypercraft-cli shell                    # 交互式命令行

# 定时调度
hypercraft-cli schedule get <id>
hypercraft-cli schedule set <id> --cron "0 0 8 * * *" --action start
hypercraft-cli schedule enable <id>
hypercraft-cli schedule disable <id>
hypercraft-cli schedule remove <id>

# 用户管理（管理员）
hypercraft-cli user list
hypercraft-cli user create -u <username> -p <password>
hypercraft-cli user grant <user-id> <service-id>
hypercraft-cli user revoke <user-id> <service-id>
```

## Agent API

面向自动化与 LLM Agent 的长期凭证 + 薄封装接口。Key **不是**超管，不能管理用户；权限 = `service_ids` ∩ `scopes`。

### 创建 API Key（管理员 JWT）

```bash
# 先用 DevToken / 用户登录拿到 access_token
curl -X POST http://127.0.0.1:8080/api-keys \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "ops-bot",
    "service_ids": ["mc-survival"],
    "scopes": ["read", "control", "logs", "attach"]
  }'
# 响应中 secret（hc_ak_...）仅返回一次
```

| scope | 能力 |
|-------|------|
| `read` | 列表 / 详情 / 状态 |
| `control` | start / stop / restart / shutdown / kill |
| `logs` | 日志 tail / follow |
| `attach` | WebSocket 终端 |

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api-keys` | 列出 Key |
| POST | `/api-keys` | 创建（明文仅一次） |
| GET | `/api-keys/:id` | 摘要 |
| DELETE | `/api-keys/:id` | 撤销 |

### 调用示例

```bash
export HC_API=http://127.0.0.1:8080
export HC_API_KEY=hc_ak_...

curl -H "Authorization: Bearer $HC_API_KEY" $HC_API/agent/me
curl -H "Authorization: Bearer $HC_API_KEY" $HC_API/agent/help
curl -H "Authorization: Bearer $HC_API_KEY" $HC_API/agent/services

curl -X POST -H "Authorization: Bearer $HC_API_KEY" \
  $HC_API/agent/services/mc-survival/restart

# 默认 text/plain，tail 为行数
curl -H "Authorization: Bearer $HC_API_KEY" \
  "$HC_API/agent/services/mc-survival/logs?tail=100"

# 实时日志 SSE（纯文本）
curl -N -H "Authorization: Bearer $HC_API_KEY" \
  "$HC_API/agent/services/mc-survival/logs?follow=true"

# 终端 WebSocket（也可用 ?token=$HC_API_KEY）
# ws://127.0.0.1:8080/agent/services/mc-survival/attach
```

同一 Key 也可直接调用现有 `/services/:id/*` 路径；`/services/:id/logs?format=text` 可拿纯文本日志。

Web 超管可在 **测试** 页（`/api-test`）选择已有 API Key，对 `/agent/*` 端点做真实请求调试（含 curl 复制与 control 二次确认）。

## 项目结构

```
hypercraft/
├── backend/                     # Rust 后端 (Cargo workspace)
│   ├── hypercraft-core/         # 核心库
│   │   ├── manager/             # 进程生命周期、attach、日志、调度
│   │   └── user/                # 用户认证、权限、JWT
│   ├── hypercraft-api/          # HTTP/WebSocket API (Axum)
│   └── hypercraft-cli/          # 命令行工具 (Clap)
└── web/                         # Next.js 管理界面
    ├── app/                     # 页面路由 (services, users, login, profile)
    ├── components/              # UI 组件
    ├── hooks/                   # 自定义 Hooks (useTerminal, useXterm)
    └── lib/                     # API 客户端、认证上下文
```

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `HC_DATA_DIR` | 数据存储目录 | `./data` |
| `HC_BIND` | API 监听地址 | `127.0.0.1:8080` |
| `HC_DEV_TOKEN` | 管理员开发令牌（>=32 字符） | - |
| `HC_JWT_SECRET` | JWT 签名密钥 | 运行时生成 |
| `HC_JWT_ISSUER` | JWT 签发者 | `hypercraft-api` |
| `HC_JWT_AUDIENCE` | JWT 受众 | `hypercraft-clients` |
| `HC_ALLOWED_COMMANDS` | 命令白名单（逗号分隔） | `*` |
| `HC_ALLOWED_CWD_PREFIXES` | 工作目录白名单（分号分隔） | `*` |
| `HC_CORS_ORIGINS` | 前端面板的 Origin（逗号分隔，不支持 `*`） | 本地 `localhost:3000` / `127.0.0.1:3000` |
| `HC_WEB_GATEWAY_BASE_DOMAIN` | 服务 Web 反代根域名（按服务 ID 生成子域，不含协议和路径） | - |

## 使用 systemd 托管

Linux 上建议用 **两个 unit**：`hypercraft-api`（Rust 后端）与 `hypercraft-web`（Next standalone）。被管理的业务进程仍由 API 写入 `HC_DATA_DIR`（默认 `./data`），与 systemd 无关。

### 1. 准备目录与配置

1. 将 Release 中的 `hypercraft-api`、`hypercraft-cli` 放到同一目录（下文记为 `BACKEND_DIR`），例如 `/opt/hypercraft/backend`。
2. 在 `BACKEND_DIR` 复制 `backend/.env.example` 为 `.env`，设置 `HC_BIND`、`HC_DATA_DIR` 等（见「环境变量」）。密钥与 `HC_DEV_TOKEN` 只保留在服务器上的 `.env`，不要提交仓库。
3. 解压 `web-standalone` 到 `WEB_DIR`（例如 `/opt/hypercraft/web`），确认存在 `server.js`；包内通常自带 `node` 可执行文件。
4. 若构建时已写入 API 地址，检查 standalone 内的 `NEXT_PUBLIC_API_URL`；否则按「跨域部署」在构建或运行前配置，使浏览器能访问 API。

运行用户需对 `BACKEND_DIR`（含 `data/`）和 `WEB_DIR` 有读写/执行权限；不要用 root 跑长期服务。

### 2. 编写 API 的 unit

新建 `/etc/systemd/system/hypercraft-api.service`：

| 配置项 | 作用 |
|--------|------|
| `WorkingDirectory` | 必须为 `BACKEND_DIR`，保证相对路径 `HC_DATA_DIR=./data` 落在正确位置 |
| `EnvironmentFile` | 指向 `BACKEND_DIR/.env`，由 systemd 注入进程环境 |
| `ExecStart` | `BACKEND_DIR/hypercraft-api` 的绝对路径 |
| `User` / `Group` | 专用系统用户，避免 root |
| `After=network-online.target` | 网络就绪后再启动 |
| `Restart=always` | 进程退出后自动拉起 |

示例（替换路径与用户）：

```ini
[Unit]
Description=HyperCraft API
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=hypercraft
Group=hypercraft
WorkingDirectory=/opt/hypercraft/backend
EnvironmentFile=/opt/hypercraft/backend/.env
ExecStart=/opt/hypercraft/backend/hypercraft-api
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

监听地址与端口仅由 `.env` 中的 `HC_BIND` 控制，unit 里不必再写 `Environment=HC_BIND`。

### 3. 编写 Web 的 unit

新建 `/etc/systemd/system/hypercraft-web.service`：

| 配置项 | 作用 |
|--------|------|
| `After=hypercraft-api.service` | 面板依赖 API；仅保证启动顺序，不表示 API 必须已监听成功 |
| `WorkingDirectory` | `WEB_DIR`，Next standalone 的根目录 |
| `Environment=PORT` / `HOSTNAME` | standalone 用 `PORT` 监听；`0.0.0.0` 表示对外网卡开放 |
| `ExecStart` | 使用包内 `node` 的绝对路径执行 `server.js`，避免依赖系统 Node 版本 |

示例：

```ini
[Unit]
Description=HyperCraft Web
After=network-online.target hypercraft-api.service
Wants=network-online.target

[Service]
Type=simple
User=hypercraft
Group=hypercraft
WorkingDirectory=/opt/hypercraft/web
Environment=PORT=3000
Environment=HOSTNAME=0.0.0.0
ExecStart=/opt/hypercraft/web/node /opt/hypercraft/web/server.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Web 的环境变量一般不用 `EnvironmentFile`，除非你在运行前用脚本生成 `.env` 并由 standalone 读取；API 地址应在构建时写入或通过反向代理统一入口。

### 4. 加载并开机自启

```bash
sudo systemctl daemon-reload
sudo systemctl enable hypercraft-api.service
sudo systemctl enable hypercraft-web.service
sudo systemctl start hypercraft-api.service
sudo systemctl start hypercraft-web.service
```

### 5. 检查与排错

```bash
systemctl status hypercraft-api hypercraft-web
journalctl -u hypercraft-api -f
journalctl -u hypercraft-web -f
```

- API 无响应：核对 `HC_BIND`、防火墙、以及 `curl http://127.0.0.1:<端口>/health`。
- Web 白屏或登录失败：核对 `NEXT_PUBLIC_API_URL`、Nginx/Caddy 反代与「跨域部署」中的 `HC_CORS_ORIGINS`。
- 更新二进制后：`systemctl restart hypercraft-api`（或 web）；仅改 `.env` 同样需要 restart 才会读入新环境。

## 服务配置示例

服务配置保存为 JSON 格式：

```json
{
  "id": "minecraft-server",
  "name": "Minecraft Server",
  "command": "java",
  "args": ["-Xmx4G", "-jar", "server.jar", "nogui"],
  "cwd": "/opt/minecraft",
  "env": {
    "JAVA_HOME": "/usr/lib/jvm/java-17"
  },
  "auto_start": false,
  "auto_restart": true,
  "shutdown_command": "stop",
  "tags": ["game", "production"],
  "schedule": {
    "enabled": true,
    "cron": "0 0 8 * * *",
    "action": "start"
  }
}
```

## 跨域部署

当前端和后端部署在不同域名时：

`HC_CORS_ORIGINS` 必须填写用户浏览器实际访问的前端面板 Origin（协议 + 域名 + 非默认端口），不能填写 `*`、API 地址、Web Gateway 地址或带路径的 URL。浏览器会话使用 HttpOnly Cookie，带凭据的 CORS 请求不支持通配来源。

**后端配置**
```bash
# backend/.env
HC_CORS_ORIGINS=https://panel.example.com
```

多个前端入口使用逗号分隔：

```bash
HC_CORS_ORIGINS=https://panel.example.com,https://admin.example.com
```

内嵌浏览器通过 Web Gateway iframe 导航，不依赖 API CORS。可以让面板与 Web Gateway 共用根域名，例如：

```bash
HC_CORS_ORIGINS=https://hyper.sacredcraft.cn
HC_WEB_GATEWAY_BASE_DOMAIN=hyper.sacredcraft.cn
```

此时服务页面使用 `https://<服务编码>.hyper.sacredcraft.cn`，需要为 `*.hyper.sacredcraft.cn` 配置 DNS、TLS 证书和到 Hypercraft API 的反向代理。

**前端配置**
```bash
# web/.env
NEXT_PUBLIC_API_URL=https://api.example.com
```

**Nginx 示例**
```nginx
# 后端
server {
    listen 443 ssl;
    server_name api.example.com;
    
    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        # WebSocket 支持
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}

# 前端
server {
    listen 443 ssl;
    server_name panel.example.com;
    
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

## 许可证

MIT
