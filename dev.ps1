#Requires -Version 5.1
<#
.SYNOPSIS
  Start Hypercraft API + Web for local dev

.DESCRIPTION
  - API: cargo run -p hypercraft-api
  - Web: pnpm dev
  - Copy .env.example -> .env when missing
  - Ctrl+C stops child processes

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
        throw "command not found: $Name"
    }
}

function Ensure-RootEnv {
    $envFile = Join-Path $Root ".env"
    $example = Join-Path $Root ".env.example"
    if (Test-Path -LiteralPath $envFile) {
        return
    }
    if (-not (Test-Path -LiteralPath $example)) {
        throw "missing .env.example, cannot create .env"
    }
    Copy-Item -LiteralPath $example -Destination $envFile
    Write-Ok "created .env from .env.example"
}

function Get-ApiBaseUrl {
    $bind = $Bind
    $envFile = Join-Path $Root ".env"
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
    Write-Step "waiting API: $health"
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        try {
            $resp = Invoke-WebRequest -Uri $health -UseBasicParsing -TimeoutSec 2
            if ($resp.StatusCode -eq 200) {
                Write-Ok "API ready"
                return
            }
        } catch {
            # still starting
        }
        Start-Sleep -Milliseconds 500
    }
    throw "API not ready within ${TimeoutSec}s: $health"
}

function Stop-Child([System.Diagnostics.Process]$Proc, [string]$Name) {
    if ($null -eq $Proc) { return }
    if ($Proc.HasExited) { return }
    Write-Step "stop $Name (PID $($Proc.Id))"
    try {
        & taskkill.exe /PID $Proc.Id /T /F 2>$null | Out-Null
    } catch {
        try { $Proc.Kill() } catch { }
    }
}

function Cleanup {
    Stop-Child $script:ApiProc "API"
    Stop-Child $script:WebProc "Web"
}

if (-not $WebOnly) {
    Assert-Command "cargo"
}
if (-not $ApiOnly) {
    Assert-Command "pnpm"
    Assert-Command "node"
}

if (-not (Test-Path -LiteralPath $BackendDir)) {
    throw "backend dir not found: $BackendDir"
}
if (-not (Test-Path -LiteralPath $WebDir)) {
    throw "web dir not found: $WebDir"
}

Ensure-RootEnv
$ApiBase = Get-ApiBaseUrl

if (-not $ApiOnly -and -not $SkipInstall) {
    if (-not (Test-Path -LiteralPath (Join-Path $WebDir "node_modules"))) {
        Write-Step "pnpm install..."
        Push-Location $WebDir
        try {
            & pnpm install
            if ($LASTEXITCODE -ne 0) { throw "pnpm install failed" }
        } finally {
            Pop-Location
        }
    }
}

try {
    if (-not $WebOnly) {
        Write-Step "start API: cargo run -p hypercraft-api"
        Write-Step "  cwd: $BackendDir"
        Write-Step "  bind: $Bind (.env HC_BIND wins when present)"

        $apiArgs = @(
            "-NoProfile"
            "-ExecutionPolicy", "Bypass"
            "-Command"
            @"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Set-Location -LiteralPath '$BackendDir'
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
        Write-Step "start Web: pnpm dev --port $WebPort"
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
    Write-Ok "local stack started"
    if (-not $WebOnly) {
        Write-Host "  API : $ApiBase"
        Write-Host "  Health: $ApiBase/health"
    }
    if (-not $ApiOnly) {
        Write-Host "  Web : http://localhost:$WebPort"
    }
    Write-Host ""
    Write-WarnMsg "close this window or Ctrl+C to stop children"
    Write-Host ""

    while ($true) {
        if ($ApiProc -and $ApiProc.HasExited -and -not $WebOnly) {
            Write-WarnMsg "API exited (code=$($ApiProc.ExitCode))"
            break
        }
        if ($WebProc -and $WebProc.HasExited -and -not $ApiOnly) {
            Write-WarnMsg "Web exited (code=$($WebProc.ExitCode))"
            break
        }
        Start-Sleep -Seconds 1
    }
} finally {
    Cleanup
}