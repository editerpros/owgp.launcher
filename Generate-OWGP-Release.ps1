param(
    [Parameter(Mandatory = $true)]
    [string]$BuildDirectory,

    [Parameter(Mandatory = $true)]
    [string]$Version,

    [Parameter(Mandatory = $true)]
    [string]$EntryPoint,

    [string]$OutputDirectory = ".\OWGP-Release",
    [string]$ArchiveName = "OWGP-win-x64.zip"
)

$ErrorActionPreference = 'Stop'

function Fail([string]$Message) {
    Write-Error $Message
    exit 1
}

try {
    if ($Version -notmatch '^\d+\.\d+\.\d+([-.][0-9A-Za-z.-]+)?$') {
        Fail "Version must look like 1.0.0 (or 1.0.0-beta.1)."
    }

    $buildItem = Get-Item -LiteralPath $BuildDirectory
    if (-not $buildItem.PSIsContainer) { Fail "BuildDirectory must be a folder." }
    $buildRoot = $buildItem.FullName.TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)

    if ([string]::IsNullOrWhiteSpace($EntryPoint) -or [IO.Path]::IsPathRooted($EntryPoint) -or $EntryPoint -match '(^|[\\/])\.\.([\\/]|$)') {
        Fail "EntryPoint must be a safe relative path inside the build folder, e.g. OWGP.exe."
    }
    $entryRelative = $EntryPoint.Replace('\', '/').TrimStart('/')
    if (Test-Path -LiteralPath (Join-Path $buildRoot 'game-manifest.json')) {
        Fail "Remove any old game-manifest.json from the build folder before packaging; the launcher stores the current manifest separately."
    }
    $entryFullPath = Join-Path $buildRoot ($entryRelative -replace '/', [string][IO.Path]::DirectorySeparatorChar)
    if (-not (Test-Path -LiteralPath $entryFullPath -PathType Leaf)) {
        Fail "Entry point not found: $entryFullPath. Set -EntryPoint to the exact executable path in your build folder."
    }

    if ([IO.Path]::GetFileName($ArchiveName) -ne $ArchiveName -or $ArchiveName -notlike '*.zip') {
        Fail "ArchiveName must be a ZIP filename only, e.g. OWGP-win-x64.zip."
    }

    $outputRoot = [IO.Path]::GetFullPath($OutputDirectory)
    New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null
    $archivePath = Join-Path $outputRoot $ArchiveName
    $manifestPath = Join-Path $outputRoot 'game-manifest.json'

    if ($archivePath.StartsWith($buildRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        Fail "OutputDirectory cannot be inside BuildDirectory. Choose a separate output folder."
    }

    if (Test-Path -LiteralPath $archivePath) { Remove-Item -LiteralPath $archivePath -Force }

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [IO.Compression.ZipFile]::CreateFromDirectory(
        $buildRoot,
        $archivePath,
        [IO.Compression.CompressionLevel]::Optimal,
        $false
    )

    $files = [ordered]@{}
    $allFiles = Get-ChildItem -LiteralPath $buildRoot -File -Recurse
    foreach ($file in $allFiles) {
        $relative = $file.FullName.Substring($buildRoot.Length).TrimStart([char]'\', [char]'/').Replace('\', '/')
        if ($relative -ieq 'game-manifest.json') { continue }
        $hash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        $files[$relative] = $hash
    }

    if ($files.Count -eq 0) { Fail "The build folder contains no files to package." }

    $archiveHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
    $manifest = [ordered]@{
        version = $Version
        platform = 'win32-x64'
        archive = $ArchiveName
        sha256 = $archiveHash
        entryPoint = $entryRelative
        files = $files
    }

    $json = $manifest | ConvertTo-Json -Depth 20
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [IO.File]::WriteAllText($manifestPath, $json, $utf8NoBom)

    Write-Host "`nOWGP release assets created successfully:" -ForegroundColor Green
    Write-Host "  $archivePath"
    Write-Host "  $manifestPath"
    Write-Host "`nVersion: $Version"
    Write-Host "Entry point: $entryRelative"
    Write-Host "Files hashed: $($files.Count)"
    Write-Host "Archive SHA-256: $archiveHash"
    Write-Host "`nUpload BOTH files to the same GitHub Release." -ForegroundColor Cyan
}
catch {
    Write-Error $_
    exit 1
}
