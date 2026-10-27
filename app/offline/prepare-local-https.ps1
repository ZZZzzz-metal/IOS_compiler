#requires -Version 7.0
<##
Creates files for a short-lived, private-network HTTPS experiment.
Does not install certificates, start a listener, or change firewall rules.
##>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Address,
    [ValidateRange(1, 30)][int]$Days = 7,
    [ValidateRange(1, 65535)][int]$Port = 4187
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($PSVersionTable.PSEdition -ne 'Core') { throw 'Use PowerShell 7 (pwsh), not Windows PowerShell 5.' }
$parsedAddress = $null
if (-not [System.Net.IPAddress]::TryParse($Address, [ref]$parsedAddress) -or
    $parsedAddress.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork -or
    $parsedAddress.Equals([System.Net.IPAddress]::Any) -or
    $parsedAddress.Equals([System.Net.IPAddress]::Broadcast) -or
    $parsedAddress.GetAddressBytes()[0] -ge 224) {
    throw '-Address must be an explicit unicast IPv4 address, for example the computer Wi-Fi address.'
}
$Address = $parsedAddress.ToString()
$offlineRoot = [System.IO.Path]::GetFullPath($PSScriptRoot)
$siteRoot = Join-Path $offlineRoot '.local/site'
if (-not (Test-Path -LiteralPath (Join-Path $siteRoot 'index.html') -PathType Leaf)) {
    throw 'First run npm.cmd run prepare:offline. The generated .local/site/index.html must exist.'
}
$tlsRoot = [System.IO.Path]::GetFullPath((Join-Path $offlineRoot '.local/tls'))
$packageId = 'local-https-' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ') + '-' + [Guid]::NewGuid().ToString('N').Substring(0, 8)
$destination = [System.IO.Path]::GetFullPath((Join-Path $tlsRoot $packageId))
if (-not $destination.StartsWith($tlsRoot + [System.IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'TLS output escaped its local directory.' }
if (Test-Path -LiteralPath $destination) { throw 'Refusing to overwrite an existing TLS package.' }
[System.IO.Directory]::CreateDirectory($destination) | Out-Null
$utf8 = [System.Text.UTF8Encoding]::new($false)
function Write-NewText([string]$Name, [string]$Text) {
    $stream = [System.IO.File]::Open((Join-Path $destination $Name), [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write)
    try { $bytes = $utf8.GetBytes($Text); $stream.Write($bytes, 0, $bytes.Length) } finally { $stream.Dispose() }
}
function Write-NewBytes([string]$Name, [byte[]]$Bytes) {
    $stream = [System.IO.File]::Open((Join-Path $destination $Name), [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write)
    try { $stream.Write($Bytes, 0, $Bytes.Length) } finally { $stream.Dispose() }
}
function Fingerprint([byte[]]$Bytes) {
    $algorithm = [System.Security.Cryptography.SHA256]::Create()
    try { return 'sha256:' + [BitConverter]::ToString($algorithm.ComputeHash($Bytes)).Replace('-', '').ToLowerInvariant() } finally { $algorithm.Dispose() }
}
function PEM([string]$Label, [byte[]]$Bytes) {
    $encoded = [Convert]::ToBase64String($Bytes, [Base64FormattingOptions]::InsertLineBreaks).Replace("`r`n", "`n")
    return "-----BEGIN $Label-----`n$encoded`n-----END $Label-----`n"
}

$rootKey = $null; $serverKey = $null; $rootCertificate = $null; $serverCertificate = $null; $serverPublic = $null
try {
    $rootKey = [System.Security.Cryptography.RSA]::Create(2048)
    $serverKey = [System.Security.Cryptography.RSA]::Create(2048)
    $signatureHash = [System.Security.Cryptography.HashAlgorithmName]::SHA256
    $padding = [System.Security.Cryptography.RSASignaturePadding]::Pkcs1
    $now = [DateTimeOffset]::FromUnixTimeSeconds([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())
    $notBefore = $now.AddMinutes(-5)
    $notAfter = $now.AddDays($Days)
    $rootName = 'iPad Debugger Local Test Root ' + $packageId.Substring($packageId.Length - 8)
    $rootRequest = [System.Security.Cryptography.X509Certificates.CertificateRequest]::new("CN=$rootName", $rootKey, $signatureHash, $padding)
    $rootRequest.CertificateExtensions.Add([System.Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]::new($true, $true, 0, $true))
    $rootRequest.CertificateExtensions.Add([System.Security.Cryptography.X509Certificates.X509KeyUsageExtension]::new(
        [System.Security.Cryptography.X509Certificates.X509KeyUsageFlags]::KeyCertSign -bor [System.Security.Cryptography.X509Certificates.X509KeyUsageFlags]::CrlSign, $true))
    $rootRequest.CertificateExtensions.Add([System.Security.Cryptography.X509Certificates.X509SubjectKeyIdentifierExtension]::new($rootRequest.PublicKey, $false))
    $rootCertificate = $rootRequest.CreateSelfSigned($notBefore, $notAfter)

    $serverRequest = [System.Security.Cryptography.X509Certificates.CertificateRequest]::new("CN=$Address", $serverKey, $signatureHash, $padding)
    $serverRequest.CertificateExtensions.Add([System.Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]::new($false, $false, 0, $true))
    $serverRequest.CertificateExtensions.Add([System.Security.Cryptography.X509Certificates.X509KeyUsageExtension]::new(
        [System.Security.Cryptography.X509Certificates.X509KeyUsageFlags]::DigitalSignature -bor [System.Security.Cryptography.X509Certificates.X509KeyUsageFlags]::KeyEncipherment, $true))
    $usages = [System.Security.Cryptography.OidCollection]::new()
    $usages.Add([System.Security.Cryptography.Oid]::new('1.3.6.1.5.5.7.3.1', 'TLS Web Server Authentication')) | Out-Null
    $serverRequest.CertificateExtensions.Add([System.Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension]::new($usages, $false))
    $serverRequest.CertificateExtensions.Add([System.Security.Cryptography.X509Certificates.X509SubjectKeyIdentifierExtension]::new($serverRequest.PublicKey, $false))
    $names = [System.Security.Cryptography.X509Certificates.SubjectAlternativeNameBuilder]::new()
    $names.AddIpAddress($parsedAddress)
    if ($Address -ne '127.0.0.1') { $names.AddIpAddress([System.Net.IPAddress]::Loopback) }
    $names.AddDnsName('localhost')
    $serverRequest.CertificateExtensions.Add($names.Build())
    $serial = [byte[]]::new(16)
    [System.Security.Cryptography.RandomNumberGenerator]::Fill($serial)
    $serial[0] = $serial[0] -band 0x7f
    $serial[15] = $serial[15] -bor 1
    $serverPublic = $serverRequest.Create($rootCertificate, $notBefore, $notAfter, $serial)
    $serverCertificate = [System.Security.Cryptography.X509Certificates.RSACertificateExtensions]::CopyWithPrivateKey($serverPublic, $serverKey)
    $rootBytes = $rootCertificate.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Cert)
    $serverBytes = $serverCertificate.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Cert)
    Write-NewText 'server-key.pem' (PEM 'PRIVATE KEY' $serverKey.ExportPkcs8PrivateKey())
    Write-NewText 'server-cert.pem' (PEM 'CERTIFICATE' $serverBytes)
    Write-NewText 'root-ca.pem' (PEM 'CERTIFICATE' $rootBytes)
    Write-NewBytes 'root-ca.cer' $rootBytes

    $profileUUID = [Guid]::NewGuid().ToString().ToUpperInvariant()
    $certificateUUID = [Guid]::NewGuid().ToString().ToUpperInvariant()
    $profile = @"
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>PayloadContent</key><array><dict>
<key>PayloadCertificateFileName</key><string>root-ca.cer</string>
<key>PayloadContent</key><data>$([Convert]::ToBase64String($rootBytes))</data>
<key>PayloadDescription</key><string>Short-lived root certificate for this private iPad debugger HTTPS test. No management, proxy, VPN, or account settings.</string>
<key>PayloadDisplayName</key><string>$rootName</string>
<key>PayloadIdentifier</key><string>local.ipad-debugger.$packageId.root</string>
<key>PayloadType</key><string>com.apple.security.root</string>
<key>PayloadUUID</key><string>$certificateUUID</string>
<key>PayloadVersion</key><integer>1</integer>
</dict></array>
<key>PayloadDescription</key><string>Only the test root certificate. Trust must be enabled manually; remove this profile after testing.</string>
<key>PayloadDisplayName</key><string>$rootName</string>
<key>PayloadIdentifier</key><string>local.ipad-debugger.$packageId</string>
<key>PayloadRemovalDisallowed</key><false/>
<key>PayloadType</key><string>Configuration</string>
<key>PayloadUUID</key><string>$profileUUID</string>
<key>PayloadVersion</key><integer>1</integer>
</dict></plist>
"@
    Write-NewText 'root-only.mobileconfig' ($profile + "`n")
    $setup = [ordered]@{
        schemaVersion = 1; kind = 'local-https-test'; packageId = $packageId
        generatedAt = $now.ToString('o'); address = $Address; port = $Port
        httpsURL = "https://${Address}:$Port/"
        rootCertificateName = $rootName; rootSHA256 = (Fingerprint $rootBytes); serverSHA256 = (Fingerprint $serverBytes)
        notBefore = $notBefore.ToString('o'); expiresAt = $notAfter.ToString('o')
        directory = $destination
        files = [ordered]@{ serverCertificate = 'server-cert.pem'; serverPrivateKey = 'server-key.pem'; rootCertificate = 'root-ca.cer'; rootPEM = 'root-ca.pem'; profile = 'root-only.mobileconfig' }
        declaration = 'Files only. No listener, system trust, firewall change, or iPad reachability validation. Root private key was not saved.'
    }
    Write-NewText 'setup.json' (($setup | ConvertTo-Json -Depth 5) + "`n")
    $setup | ConvertTo-Json -Depth 5
} finally {
    if ($serverCertificate) { $serverCertificate.Dispose() }
    if ($serverPublic) { $serverPublic.Dispose() }
    if ($rootCertificate) { $rootCertificate.Dispose() }
    if ($serverKey) { $serverKey.Dispose() }
    if ($rootKey) { $rootKey.Dispose() }
}
