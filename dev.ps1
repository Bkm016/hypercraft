#Requires -Version 5.1
<#
.SYNOPSIS
  一键启动 Hypercraft 前后端（本地开发）

.DESCRIPTION
  - 后端: cargo run -p hypercraft-api（默认 0.0.0.0:8080）
  - 前端: pnpm dev（默认 http://localhost:3000）
  - 缺 backend/.env 时从 .env.example 复制
  - Ctrl+C 同时停止前后端

.EXAMPLE
  .\dev.ps1
  .\dev.ps1 -SkipInstall
  .\dev.ps1 -ApiOnly
  .\dev.ps1 -WebOnly
#>
[CmdletBinding()]
param(
    [switch]$SkipInstall,
    [switch]$ApiOnly,
    [switch]$WebOnly,
    [string]$Bind = "127.0.0.1:8080",
    [int]$WebPort = 3000
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$Root = $PSScriptRoot
$BackendDir = Join-Path $Root "backend"
$WebDir = Join-Path $Root "web"
$ApiProc = $null
$WebProc = $null

function Write-Step([string]$Message) {
    Write-Host "[dev] $Message" -ForegroundColor Cyan
}

function Write-Ok([string]$Message) {
    Write-Host "[dev] $Message" -ForegroundColor Green
}

function Write-WarnMsg([string]$Message) {
    Write-Host "[dev] $Message" -ForegroundColor Yellow
}

function Assert-Command([string]$Name) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "未找到命令: $Name"
    }
}

function Ensure-BackendEnv {
    $envFile = Join-Path $BackendDir ".env"
    $example = Join-Path $BackendDir ".env.example"
    if (Test-Path -LiteralPath $envFile) {
        return
    }
    if (-not (Test-Path -LiteralPath $example)) {
        throw "缺少 backend/.env.example，无法生成 .env"
    }
    Copy-Item -LiteralPath $example -Destination $envFile
    Write-Ok "已生成 backend/.env（来自 .env.example）"
}

function Get-ApiBaseUrl {
    # 优先读 backend/.env 的 HC_BIND，再回退到参数
    $bind = $Bind
    $envFile = Join-Path $BackendDir ".env"
    if (Test-Path -LiteralPath $envFile) {
        $line = Get-Content -LiteralPath $envFile -Encoding UTF8 |
            Where-Object { $_ -match '^\s*HC_BIND\s*=' } |
            Select-Object -First 1
        if ($line -match '=\s*(.+)$') {
            $bind = $Matches[1].Trim().Trim('"').Trim("'")
        }
    }
    if ($bind -match '^\d+\.\d+\.\d+\.\d+:(\d+)$' -or $bind -match '^0\.0\.0\.0:(\d+)$' -or $bind -match '^\[::\]:(\d+)$') {
        $port = $Matches[1]
        return "http://127.0.0.1:$port"
    }
    if ($bind -match '^([^:]+):(\d+)$') {
        $hostPart = $Matches[1]
        $port = $Matches[2]
        if ($hostPart -eq "0.0.0.0" -or $hostPart -eq "::" -or $hostPart -eq "[::]") {
            return "http://127.0.0.1:$port"
        }
        return "http://${hostPart}:$port"
    }
    return "http://127.0.0.1:8080"
}

function Wait-ApiHealthy([string]$BaseUrl, [int]$TimeoutSec = 300) {
    $health = "$BaseUrl/health"
    Write-Step "等待 API 就绪: $health"
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        try {
            $resp = Invoke-WebRequest -Uri $health -UseBasicParsing -TimeoutSec 2
            if ($resp.StatusCode -eq 200) {
                Write-Ok "API 已就绪"
                return
            }
        } catch {
            # still starting
        }
        Start-Sleep -Milliseconds 500
    }
    throw "API 在 ${TimeoutSec}s 内未就绪: $health"
}

function Stop-Child([System.Diagnostics.Process]$Proc, [string]$Name) {
    if ($null -eq $Proc) { return }
    if ($Proc.HasExited) { return }
    Write-Step "停止 $Name (PID $($Proc.Id))"
    try {
        # 杀掉进程树，避免 cargo/next 子进程残留
        & taskkill.exe /PID $Proc.Id /T /F 2>$null | Out-Null
    } catch {
        try { $Proc.Kill() } catch { }
    }
}

function Cleanup {
    Stop-Child $script:ApiProc "API"
    Stop-Child $script:WebProc "Web"
}

# ── 前置检查 ──────────────────────────────────────────────
if (-not $WebOnly) {
    Assert-Command "cargo"
}
if (-not $ApiOnly) {
    Assert-Command "pnpm"
    Assert-Command "node"
}

if (-not (Test-Path -LiteralPath $BackendDir)) {
    throw "找不到 backend 目录: $BackendDir"
}
if (-not (Test-Path -LiteralPath $WebDir)) {
    throw "找不到 web 目录: $WebDir"
}

Ensure-BackendEnv
$ApiBase = Get-ApiBaseUrl

if (-not $ApiOnly -and -not $SkipInstall) {
    if (-not (Test-Path -LiteralPath (Join-Path $WebDir "node_modules"))) {
        Write-Step "安装前端依赖 (pnpm install)..."
        Push-Location $WebDir
        try {
            & pnpm install
            if ($LASTEXITCODE -ne 0) { throw "pnpm install 失败" }
        } finally {
            Pop-Location
        }
    }
}

# ── 启动 ─────────────────────────────────────────────────
try {
    if (-not $WebOnly) {
        Write-Step "启动后端: cargo run -p hypercraft-api"
        Write-Step "  工作目录: $BackendDir"
        Write-Step "  绑定: $Bind（可用 -Bind 覆盖；.env 中 HC_BIND 优先于默认）"

        $apiArgs = @(
            "-NoProfile"
            "-ExecutionPolicy", "Bypass"
            "-Command"
            @"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Set-Location -LiteralPath '$BackendDir'
# 本地测试默认绑定，.env 已存在时以 .env 为准（dotenv 优先读文件）
if (-not `$env:HC_BIND) { `$env:HC_BIND = '$Bind' }
if (-not `$env:HC_CORS_ORIGINS) { `$env:HC_CORS_ORIGINS = 'http://localhost:$WebPort,http://127.0.0.1:$WebPort' }
Write-Host '[api] cargo run -p hypercraft-api' -ForegroundColor Cyan
cargo run -p hypercraft-api
exit `$LASTEXITCODE
"@
        )
        $ApiProc = Start-Process -FilePath "powershell.exe" -ArgumentList $apiArgs -PassThru -WindowStyle Normal
        Wait-ApiHealthy -BaseUrl $ApiBase
    }

    if (-not $ApiOnly) {
        Write-Step "启动前端: pnpm dev --port $WebPort"
        $webArgs = @(
            "-NoProfile"
            "-ExecutionPolicy", "Bypass"
            "-Command"
            @"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Set-Location -LiteralPath '$WebDir'
Write-Host '[web] pnpm dev --port $WebPort' -ForegroundColor Cyan
pnpm dev --port $WebPort
exit `$LASTEXITCODE
"@
        )
        $WebProc = Start-Process -FilePath "powershell.exe" -ArgumentList $webArgs -PassThru -WindowStyle Normal
    }

    Write-Host ""
    Write-Ok "本地环境已启动"
    if (-not $WebOnly) {
        Write-Host "  API : $ApiBase"
        Write-Host "  Health: $ApiBase/health"
    }
    if (-not $ApiOnly) {
        Write-Host "  Web : http://localhost:$WebPort"
    }
    Write-Host ""
    Write-WarnMsg "关闭本窗口或按 Ctrl+C 将停止已拉起的子进程窗口"
    Write-Host ""

    # 阻塞主脚本，便于 Ctrl+C 统一清理
    while ($true) {
        if ($ApiProc -and $ApiProc.HasExited -and -not $WebOnly) {
            Write-WarnMsg "API 进程已退出 (code=$($ApiProc.ExitCode))"
            break
        }
        if ($WebProc -and $WebProc.HasExited -and -not $ApiOnly) {
            Write-WarnMsg "Web 进程已退出 (code=$($WebProc.ExitCode))"
            break
        }
        Start-Sleep -Seconds 1
    }
} finally {
    Cleanup
}
