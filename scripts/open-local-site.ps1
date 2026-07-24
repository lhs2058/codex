$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$npmCommand = (Get-Command npm.cmd -ErrorAction Stop).Source
$siteUrl = "http://127.0.0.1:4173/codex/"

Set-Location -LiteralPath $projectRoot

if (-not (Test-Path -LiteralPath (Join-Path $projectRoot "node_modules"))) {
    Write-Host "최초 실행에 필요한 패키지를 설치합니다..."
    & $npmCommand install
    if ($LASTEXITCODE -ne 0) {
        throw "패키지 설치에 실패했습니다."
    }
}

Write-Host "최신 화면을 준비합니다..."
& $npmCommand run build:pages
if ($LASTEXITCODE -ne 0) {
    throw "사이트 빌드에 실패했습니다."
}

$portInUse = Get-NetTCPConnection -LocalAddress "127.0.0.1" -LocalPort 4173 `
    -State Listen -ErrorAction SilentlyContinue

if (-not $portInUse) {
    Start-Process -FilePath $npmCommand `
        -ArgumentList @("run", "preview:pages") `
        -WorkingDirectory $projectRoot `
        -WindowStyle Hidden
}

for ($attempt = 0; $attempt -lt 20; $attempt++) {
    try {
        $response = Invoke-WebRequest -Uri $siteUrl -UseBasicParsing -TimeoutSec 2
        if ($response.StatusCode -eq 200) {
            Start-Process $siteUrl
            Write-Host "사이트를 열었습니다: $siteUrl"
            exit 0
        }
    }
    catch {
        Start-Sleep -Milliseconds 500
    }
}

throw "로컬 사이트가 제한 시간 안에 시작되지 않았습니다."
