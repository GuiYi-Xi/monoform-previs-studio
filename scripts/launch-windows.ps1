param(
  [switch]$SetupOnly
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$RuntimeRoot = Join-Path $ProjectRoot '.monoform-runtime'
$PortableNodeRoot = Join-Path $RuntimeRoot 'node'
$RequiredNodeVersion = 'v22.15.0'
$OnlineUrl = 'https://guiyi-xi.github.io/monoform-previs-studio/'

function Write-Step([string]$Message) {
  Write-Host "[MONOFORM] $Message" -ForegroundColor Cyan
}

function Test-NodeCompatible([string]$NodeExecutable) {
  if (-not $NodeExecutable -or -not (Test-Path -LiteralPath $NodeExecutable)) { return $false }
  try {
    $rawVersion = (& $NodeExecutable --version 2>$null).TrimStart('v')
    $version = [version]$rawVersion
    return $version.Major -gt 22 `
      -or ($version.Major -eq 22 -and $version.Minor -ge 12) `
      -or ($version.Major -eq 20 -and $version.Minor -ge 19)
  } catch {
    return $false
  }
}

function Install-PortableNode {
  $architecture = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
  $folderName = "node-$RequiredNodeVersion-win-$architecture"
  $archivePath = Join-Path $RuntimeRoot "$folderName.zip"
  $extractRoot = Join-Path $RuntimeRoot 'node-extract'
  $downloadUrls = @(
    "https://nodejs.org/dist/$RequiredNodeVersion/$folderName.zip",
    "https://npmmirror.com/mirrors/node/$RequiredNodeVersion/$folderName.zip"
  )

  New-Item -ItemType Directory -Force -Path $RuntimeRoot | Out-Null
  if (Test-Path -LiteralPath $archivePath) { Remove-Item -LiteralPath $archivePath -Force }

  $downloaded = $false
  foreach ($url in $downloadUrls) {
    try {
      Write-Step "Downloading portable runtime ($RequiredNodeVersion / $architecture)..."
      Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $archivePath
      $downloaded = $true
      break
    } catch {
      Write-Host "Download source unavailable; trying the next mirror: $url" -ForegroundColor Yellow
      if (Test-Path -LiteralPath $archivePath) { Remove-Item -LiteralPath $archivePath -Force }
    }
  }
  if (-not $downloaded) { throw 'Runtime download failed. Check the network connection and try again.' }

  if (Test-Path -LiteralPath $extractRoot) { Remove-Item -LiteralPath $extractRoot -Recurse -Force }
  if (Test-Path -LiteralPath $PortableNodeRoot) { Remove-Item -LiteralPath $PortableNodeRoot -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $extractRoot | Out-Null
  Expand-Archive -LiteralPath $archivePath -DestinationPath $extractRoot -Force
  Move-Item -LiteralPath (Join-Path $extractRoot $folderName) -Destination $PortableNodeRoot
  Remove-Item -LiteralPath $extractRoot -Recurse -Force
  Remove-Item -LiteralPath $archivePath -Force
  Write-Step 'Portable runtime is ready.'
}

try {
  Set-Location -LiteralPath $ProjectRoot
  New-Item -ItemType Directory -Force -Path $RuntimeRoot | Out-Null

  $systemNode = Get-Command node.exe -ErrorAction SilentlyContinue
  $nodeExecutable = if ($systemNode) { $systemNode.Source } else { $null }
  $npmExecutable = $null

  if (Test-NodeCompatible $nodeExecutable) {
    $systemNpm = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if ($systemNpm) { $npmExecutable = $systemNpm.Source }
  }

  if (-not $npmExecutable) {
    $portableNode = Join-Path $PortableNodeRoot 'node.exe'
    if (-not (Test-NodeCompatible $portableNode)) { Install-PortableNode }
    $nodeExecutable = $portableNode
    $npmExecutable = Join-Path $PortableNodeRoot 'npm.cmd'
  }

  $env:Path = "$(Split-Path -Parent $nodeExecutable);$env:Path"
  $lockFile = Join-Path $ProjectRoot 'package-lock.json'
  $dependencyStamp = Join-Path $RuntimeRoot 'dependencies.sha256'
  $lockHash = (Get-FileHash -LiteralPath $lockFile -Algorithm SHA256).Hash
  $savedHash = if (Test-Path -LiteralPath $dependencyStamp) { (Get-Content -LiteralPath $dependencyStamp -Raw).Trim() } else { '' }
  $needsDependencies = -not (Test-Path -LiteralPath (Join-Path $ProjectRoot 'node_modules')) -or $savedHash -ne $lockHash

  if ($needsDependencies) {
    Write-Step 'First launch: installing project packages. Keep the network connected...'
    & $npmExecutable 'ci' '--no-audit' '--no-fund'
    if ($LASTEXITCODE -ne 0) {
      Write-Host 'Default registry failed; retrying with the mirror...' -ForegroundColor Yellow
      & $npmExecutable 'ci' '--no-audit' '--no-fund' '--registry=https://registry.npmmirror.com'
    }
    if ($LASTEXITCODE -ne 0) { throw "Package installation failed (exit code $LASTEXITCODE)." }
    Set-Content -LiteralPath $dependencyStamp -Value $lockHash -Encoding ASCII
    Write-Step 'Project packages are ready.'
  } else {
    Write-Step 'Runtime check passed.'
  }

  if ($SetupOnly) {
    Write-Step 'Launcher self-check completed.'
    exit 0
  }

  Write-Step 'Opening the browser. Keep this window open; press Ctrl+C to stop.'
  & $npmExecutable 'run' 'dev' '--' '--host=127.0.0.1' '--port=5173' '--open'
  if ($LASTEXITCODE -ne 0) { throw "Local server stopped unexpectedly (exit code $LASTEXITCODE)." }
  exit 0
} catch {
  Write-Host ''
  Write-Host "[ERROR] $($_.Exception.Message)" -ForegroundColor Red
  Write-Host 'Local startup failed. Opening the online version instead:' -ForegroundColor Yellow
  Write-Host $OnlineUrl -ForegroundColor Yellow
  try { Start-Process $OnlineUrl } catch { }
  exit 1
}
