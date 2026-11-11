# Hypercraft 1Panel 应用包

`hypercraft/` 是 1Panel 本地应用格式的安装包（同源网关 + API + Web 三个容器）。

## 安装

1. 发布镜像：推送 `v*` 标签后，`.github/workflows/docker.yml` 会把 `hypercraft-api` / `hypercraft-web`
   （amd64 + arm64）推到 `ghcr.io/<owner>/`。也可以自行构建后推到私有仓库。
2. 把 `hypercraft/` 目录复制到 1Panel 服务器的 `/opt/1panel/resource/apps/local/hypercraft`，
   在 1Panel「应用商店 → 本地应用」点「同步」后安装。
3. 安装参数：
   | 参数 | 说明 |
   |---|---|
   | 网页端口 | 同源网关端口，页面与 `/api` 同时在此端口 |
   | 游戏端口 / 附加端口 | 映射到 API 容器，供托管的 Minecraft 等进程使用（附加端口为 1:1 范围映射） |
   | 超级管理员口令 | ≥32 位；留空自动生成并保存在 `data/.secrets.env`（同时打印在 API 日志） |
   | 镜像仓库地址 | 默认 `ghcr.io/bkm016`；使用私有仓库时改为对应地址（HTTP 仓库需在 Docker 中配置 `insecure-registries`） |
   | Java 镜像 / 国内镜像 / GitHub 代理 | 运行环境下载源；国内服务器建议 `tuna` + 开启国内镜像 + 填 GitHub 代理 |

## 自行构建镜像（国内网络）

```bash
docker build -f docker/Dockerfile.api \
  --build-arg CARGO_MIRROR=sparse+https://rsproxy.cn/index/ \
  --build-arg GITHUB_PROXY=https://ghfast.top/ \
  -t <registry>/hypercraft-api:<version> .
docker build -f docker/Dockerfile.web \
  --build-arg NPM_REGISTRY=https://registry.npmmirror.com \
  -t <registry>/hypercraft-web:<version> .
```

## 重新生成

`hypercraft-1panel-appspec.json` 是生成用的中间描述，配合 1Panel appstore 生成器使用；
附加端口范围与 `conf/nginx.conf` 需在生成后手动补回（见其中 notes）。
