$ErrorActionPreference = 'Stop'

$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$PackageDir = Join-Path $ProjectDir 'src'
Set-Location $PackageDir

$BuildMarker = Join-Path $PackageDir 'app\main\main.js'
$RendererMarker = Join-Path $PackageDir 'app\renderer\index.html'
$LogoTarget = Join-Path $PackageDir 'build\icon.png'
$ElectronBin = Join-Path $PackageDir 'node_modules\.bin\electron.cmd'

$SourceLogo = ''
$LogoCandidates = @(
  (Join-Path $ProjectDir 'resource\logo.png'),
  (Join-Path $ProjectDir 'resource\logo_with_white_border.png')
)
foreach ($Candidate in $LogoCandidates) {
  if (Test-Path -LiteralPath $Candidate -PathType Leaf) {
    $SourceLogo = $Candidate
    break
  }
}

function Test-NeedsBuild {
  if (!(Test-Path -LiteralPath $BuildMarker -PathType Leaf) -or !(Test-Path -LiteralPath $RendererMarker -PathType Leaf)) {
    return $true
  }

  $BuildTime = (Get-Item -LiteralPath $BuildMarker).LastWriteTimeUtc
  $TrackedFiles = @(
    (Join-Path $PackageDir 'package.json'),
    (Join-Path $PackageDir 'package-lock.json'),
    (Join-Path $PackageDir 'tsconfig.main.json'),
    (Join-Path $PackageDir 'tsconfig.renderer.json')
  )

  foreach ($File in $TrackedFiles) {
    if ((Test-Path -LiteralPath $File -PathType Leaf) -and (Get-Item -LiteralPath $File).LastWriteTimeUtc -gt $BuildTime) {
      return $true
    }
  }

  $SourceDirs = @('main', 'renderer', 'scripts') | ForEach-Object { Join-Path $PackageDir $_ }
  foreach ($Dir in $SourceDirs) {
    if (!(Test-Path -LiteralPath $Dir -PathType Container)) {
      continue
    }
    $NewerFile = Get-ChildItem -LiteralPath $Dir -Recurse -File |
      Where-Object { $_.LastWriteTimeUtc -gt $BuildTime } |
      Select-Object -First 1
    if ($NewerFile) {
      return $true
    }
  }

  return $false
}

function Test-NeedsLogoSync {
  if (!$SourceLogo) {
    return $false
  }
  if (!(Test-Path -LiteralPath $LogoTarget -PathType Leaf)) {
    return $true
  }
  return (Get-Item -LiteralPath $SourceLogo).LastWriteTimeUtc -gt (Get-Item -LiteralPath $LogoTarget).LastWriteTimeUtc
}

if (!(Test-Path -LiteralPath 'node_modules' -PathType Container)) {
  Write-Host '[Conductor] installing dependencies...'
  npm install
}

if (Test-NeedsBuild) {
  Write-Host '[Conductor] source changed, rebuilding app ...'
  npm run build
} else {
  Write-Host '[Conductor] build outputs are up to date, skip rebuild.'
}

if (Test-NeedsLogoSync) {
  Write-Host '[Conductor] syncing logo ...'
  node app/scripts/sync-logo.js
} elseif ($SourceLogo) {
  Write-Host '[Conductor] logo is up to date, skip sync.'
} else {
  Write-Host '[Conductor] warning: resource/logo.png not found, keep existing app icon.'
}

if (!(Test-Path -LiteralPath $ElectronBin -PathType Leaf)) {
  Write-Error "[Conductor] error: electron binary not found: $ElectronBin"
  exit 1
}

& $ElectronBin .
exit $LASTEXITCODE
