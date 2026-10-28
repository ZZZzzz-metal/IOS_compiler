$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$auditRepo = 'C:\Users\20964\Documents\ChatGPT\C++算法编译器\ipad-debugger-05'
$auditZipPath = 'C:\Users\20964\Documents\ChatGPT\C++算法编译器\ipad-offline-debugger\app\offline\.local\packages\ipad-offline-debugger-v0.4.5-r3.zip'
$auditOutput = Join-Path $auditRepo 'tests\.local\final-v045-r3'
$auditEvidence = $PSScriptRoot
$auditExpectedZip = 'f1877f4e031f5a46bdafab71ea5ae611a8dd74c58c7256c9ed367e92cb00c068'
if (Test-Path -LiteralPath $auditOutput) { throw 'Refusing to overwrite extraction directory' }
$auditZipHash = (Get-FileHash -LiteralPath $auditZipPath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($auditZipHash -ne $auditExpectedZip) { throw 'Archive hash differs' }
$auditOutputAbsolute = [IO.Path]::GetFullPath($auditOutput)
$auditTestsAbsolute = [IO.Path]::GetFullPath((Join-Path $auditRepo 'tests'))
if (-not $auditOutputAbsolute.StartsWith($auditTestsAbsolute + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Extraction outside tests' }
$auditArchive = [IO.Compression.ZipFile]::OpenRead($auditZipPath)
try {
  $auditNames = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  $auditEntries = foreach ($auditEntry in $auditArchive.Entries) {
    $auditName = $auditEntry.FullName
    if ($auditName -match '[\\:\x00-\x1f]' -or $auditName.StartsWith('/') -or $auditName.Split('/').Where({$_ -eq '' -or $_ -eq '.' -or $_ -eq '..'}).Count) { throw "Unsafe ZIP path: $auditName" }
    if (-not $auditNames.Add($auditName)) { throw "Duplicate path: $auditName" }
    $auditUnixMode = ($auditEntry.ExternalAttributes -shr 16) -band 0xF000
    if ($auditUnixMode -eq 0xA000) { throw "Linked ZIP member: $auditName" }
    $auditTarget = [IO.Path]::GetFullPath((Join-Path $auditOutputAbsolute $auditName))
    if (-not $auditTarget.StartsWith($auditOutputAbsolute + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw "Escaping path: $auditName" }
    [pscustomobject]@{name=$auditName; byteLength=$auditEntry.Length; compressedBytes=$auditEntry.CompressedLength; target=$auditTarget}
  }
  New-Item -ItemType Directory -Path $auditOutputAbsolute | Out-Null
  $auditIgnore = Join-Path $auditRepo 'tests\.local\.gitignore'
  if (-not (Test-Path -LiteralPath $auditIgnore)) { [IO.File]::WriteAllText($auditIgnore, "*`n", [Text.UTF8Encoding]::new($false)) }
  foreach ($auditMeta in $auditEntries) {
    New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($auditMeta.target)) -Force | Out-Null
    [IO.Compression.ZipFileExtensions]::ExtractToFile($auditArchive.GetEntry($auditMeta.name), $auditMeta.target, $false)
    $auditMeta | Add-Member -NotePropertyName sha256 -NotePropertyValue ((Get-FileHash -LiteralPath $auditMeta.target -Algorithm SHA256).Hash.ToLowerInvariant())
  }
  $auditReport = [ordered]@{schemaVersion=1; recordedAt=[DateTime]::UtcNow.ToString('o'); sourceArchive=$auditZipPath; zipSHA256=$auditZipHash; zipBytes=(Get-Item -LiteralPath $auditZipPath).Length; fileCount=$auditEntries.Count; allPathsContained=$true; duplicateOrLinkedEntries=$false; extractionDirectory=$auditOutputAbsolute; staticSiteRoot=(Join-Path $auditOutputAbsolute 'site'); members=$auditEntries}
  [IO.File]::WriteAllText((Join-Path $auditEvidence 'zip-members.json'), ($auditReport | ConvertTo-Json -Depth 8) + "`n", [Text.UTF8Encoding]::new($false))
  [IO.File]::WriteAllText((Join-Path $auditEvidence '.gitattributes'), "* -text`n", [Text.UTF8Encoding]::new($false))
  [pscustomobject]@{staticSiteRoot=$auditReport.staticSiteRoot; fileCount=$auditEntries.Count; zipSHA256=$auditZipHash} | ConvertTo-Json
} finally { $auditArchive.Dispose() }
