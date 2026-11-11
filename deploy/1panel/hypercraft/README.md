## 产品介绍

**Hypercraft** 是一款跨平台进程管理与监控系统，面向 Minecraft 服务端及其他需长期运行的进程。

## 主要功能

- **进程管理**：启动、停止、重启、强杀，支持自动重启与优雅关闭指令。
- **多运行环境**：内置 mise，一键安装 Java（Temurin、Zulu、Corretto、Dragonwell、Kona 等）、Node.js、Python、Go 等任意工具，每个服务可同时选择多个；支持清华 / 中科大 / npmmirror 镜像与 GitHub 代理。
- **Web 终端**：基于 WebSocket + PTY 的交互式终端，可直接向进程输入命令。
- **日志**：历史日志截取、实时跟随与自动截断。
- **定时调度**：通过 Cron 定时启动、停止或重启服务。
- **权限体系**：超级管理员、系统管理员、普通用户三级角色，支持服务级 ACL。
- **Agent API**：长期 API Key 与 /agent/* 运维接口，便于自动化与 AI Agent 接入。
