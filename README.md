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
- **权限控制** - 管理员和普通用户角色，用户级服务访问权限
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
| `HC_CORS_ORIGINS` | CORS 允许的来源（逗号分隔） | `*` |

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

**后端配置**
```bash
# backend/.env
HC_CORS_ORIGINS=https://panel.example.com
```

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
