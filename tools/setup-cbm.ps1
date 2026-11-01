$ErrorActionPreference = 'Stop'
# Optional Windows x64 tool. Downloads official assets; never runs the upstream installer.
if ($env:OS -ne 'Windows_NT' -or -not [Environment]::Is64BitOperatingSystem) {
  throw 'This setup supports Windows x64 only. See docs/CODE_INTELLIGENCE.md for other platforms.'
}
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$engineDir = Join-Path $repoRoot '.domino\tools\cbm-0.12.1'
New-Item -ItemType Directory -Path $engineDir -Force | Out-Null
$archive = Join-Path $engineDir 'codebase-memory-mcp-windows-amd64.zip'
$expected = '4e4e0f16b45233af5c757a1fcbe3c3b16e9056375b1fbe2ce020b6de75dedcc0'
if (-not (Test-Path -LiteralPath $archive)) {
  Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/DeusData/codebase-memory-mcp/releases/download/v0.12.1/codebase-memory-mcp-windows-amd64.zip' -OutFile $archive
}
$archiveStream = [IO.File]::OpenRead($archive)
$archiveHasher = [Security.Cryptography.SHA256]::Create()
try { $archiveHash = [BitConverter]::ToString($archiveHasher.ComputeHash($archiveStream)).Replace('-','').ToLowerInvariant() }
finally { $archiveStream.Dispose(); $archiveHasher.Dispose() }
if ($archiveHash -ne $expected) {
  throw 'CBM archive checksum mismatch. The file was preserved for inspection; do not execute it.'
}
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::OpenRead($archive)
$binDir = Join-Path $engineDir 'bin'
New-Item -ItemType Directory -Path $binDir -Force | Out-Null
try {
  foreach ($name in @('codebase-memory-mcp.exe', 'LICENSE', 'THIRD_PARTY_NOTICES.md')) {
    $entry = $zip.GetEntry($name)
    if ($null -eq $entry) { throw "Official archive is missing $name" }
    $destination = Join-Path $binDir $name
    # Only these known filenames are extracted, never arbitrary archive paths.
    if (-not (Test-Path -LiteralPath $destination)) {
      [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $destination)
    } else {
      $existing = [IO.File]::OpenRead($destination)
      $source = $entry.Open()
      $hasher = [Security.Cryptography.SHA256]::Create()
      try {
        $existingHash = [BitConverter]::ToString($hasher.ComputeHash($existing))
        $sourceHash = [BitConverter]::ToString($hasher.ComputeHash($source))
        if ($existingHash -ne $sourceHash) { throw "Existing $name differs from the verified archive; preserved it without overwriting" }
      } finally { $existing.Dispose(); $source.Dispose(); $hasher.Dispose() }
    }
  }
} finally { $zip.Dispose() }
$binary = Join-Path $binDir 'codebase-memory-mcp.exe'
$version = & $binary --version
if ($LASTEXITCODE -ne 0 -or $version.Trim() -ne 'codebase-memory-mcp 0.12.1') { throw 'Unexpected CBM executable version' }
Write-Output 'Verified CBM 0.12.1. Add these server-side settings to your ignored .env, then restart the worker and reindex:'
Write-Output 'DOMINO_CODE_INTELLIGENCE=cbm'
Write-Output "DOMINO_CBM_BINARY=$($binary.Replace('\','/'))"
Write-Output "DOMINO_CBM_CACHE_DIR=$((Join-Path $env:USERPROFILE '.domino-cbm').Replace('\','/'))"
Write-Output 'No global MCP configuration, agent hooks or imported repository scripts were installed.'
