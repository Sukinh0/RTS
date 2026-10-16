param(
  [string]$Archive = (Join-Path $PSScriptRoot '..\external-assets\Tiny Swords (Free Pack).zip')
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$destinationRoot = [IO.Path]::GetFullPath((Join-Path $projectRoot 'public\assets\tiny-swords'))
if (-not [IO.File]::Exists($Archive)) {
  throw "Tiny Swords archive not found: $Archive. Obtain it from https://pixelfrog-assets.itch.io/tiny-swords."
}

$zip = [IO.Compression.ZipFile]::OpenRead($Archive)
try {
  $count = 0
  foreach ($entry in $zip.Entries) {
    if ($entry.FullName -like '__MACOSX/*' -or $entry.FullName -match '/\.' -or $entry.FullName -notmatch '\.png$') { continue }
    $relative = $entry.FullName -replace '^Tiny Swords \(Free Pack\)/', ''
    if ($relative -eq $entry.FullName) { continue }
    $target = [IO.Path]::GetFullPath((Join-Path $destinationRoot $relative))
    if (-not $target.StartsWith($destinationRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
      throw "Unsafe archive path: $relative"
    }
    [IO.Directory]::CreateDirectory((Split-Path -Parent $target)) | Out-Null
    $source = $entry.Open()
    try {
      $output = [IO.File]::Create($target)
      try { $source.CopyTo($output) } finally { $output.Dispose() }
    } finally { $source.Dispose() }
    $count++
  }
  Write-Output "Installed $count Tiny Swords PNGs to $destinationRoot"
} finally {
  $zip.Dispose()
}
