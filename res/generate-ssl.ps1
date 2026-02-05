#!/usr/bin/env pwsh
# =============================================================================
# Sync-Player HTTPS Certificate Generator
# =============================================================================
# Generates a self-signed SSL certificate for enabling HTTPS
# Also updates config.env to enable HTTPS and JASSUB
#
# Usage: .\generate-ssl.ps1
# =============================================================================

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host " Sync-Player HTTPS Setup" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Paths - script is in res/, certs also go in res/
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Split-Path -Parent $ScriptDir
$KeyFile = Join-Path $ScriptDir "key.pem"
$CertFile = Join-Path $ScriptDir "cert.pem"
$ConfigFile = Join-Path $RootDir "config.env"

# Get local IP for default values
$localIP = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -ne "127.0.0.1" -and $_.PrefixOrigin -ne "WellKnown" } | Select-Object -First 1).IPAddress
if (-not $localIP) { $localIP = "192.168.1.1" }

# Default certificate settings
$defaults = @{
    Country = "US"
    State = "State"
    City = "City"
    Organization = "Sync-Player"
    Unit = "Development"
    CommonName = "localhost"
    Days = 365
    IP = $localIP
}

# Check for OpenSSL first
$opensslPath = $null
$possiblePaths = @(
    "openssl",
    "C:\Program Files\Git\usr\bin\openssl.exe",
    "C:\Program Files\OpenSSL-Win64\bin\openssl.exe",
    "C:\OpenSSL-Win64\bin\openssl.exe"
)

foreach ($path in $possiblePaths) {
    try {
        $null = & $path version 2>&1
        $opensslPath = $path
        break
    } catch {
        continue
    }
}

if (-not $opensslPath) {
    Write-Host "OpenSSL not found!" -ForegroundColor Red
    Write-Host ""
    Write-Host "Please install OpenSSL or Git for Windows (includes OpenSSL):" -ForegroundColor Yellow
    Write-Host "  1. Git for Windows: https://git-scm.com/download/win" -ForegroundColor Gray
    Write-Host "  2. OpenSSL: https://slproweb.com/products/Win32OpenSSL.html" -ForegroundColor Gray
    Write-Host ""
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host "Using OpenSSL: $opensslPath" -ForegroundColor Gray
Write-Host ""

# Check if certificates already exist
if ((Test-Path $KeyFile) -and (Test-Path $CertFile)) {
    Write-Host "Existing certificates found:" -ForegroundColor Yellow
    Write-Host "  - $KeyFile" -ForegroundColor Gray
    Write-Host "  - $CertFile" -ForegroundColor Gray
    Write-Host ""
    $response = Read-Host "Regenerate certificates? (y/N)"
    if ($response -ne "y" -and $response -ne "Y") {
        Write-Host "Keeping existing certificates." -ForegroundColor Green
        # Jump to config update
        $skipGeneration = $true
    }
    Write-Host ""
}

if (-not $skipGeneration) {
    # Setup mode selection
    Write-Host "Setup Mode:" -ForegroundColor Cyan
    Write-Host "  [1] Default - Quick setup with standard values" -ForegroundColor Gray
    Write-Host "  [2] Advanced - Customize certificate details" -ForegroundColor Gray
    Write-Host ""
    $mode = Read-Host "Select mode (1/2) [1]"
    if ([string]::IsNullOrWhiteSpace($mode)) { $mode = "1" }
    Write-Host ""

    $certSettings = $defaults.Clone()

    if ($mode -eq "2") {
        Write-Host "Advanced Setup - Press Enter for default value" -ForegroundColor Cyan
        Write-Host ""

        # Helper function to prompt with default
        function Read-WithDefault($prompt, $default) {
            $input = Read-Host "$prompt [$default]"
            if ([string]::IsNullOrWhiteSpace($input)) { return $default }
            return $input
        }

        $certSettings.Country = Read-WithDefault "Country Code (2 letters)" $defaults.Country
        $certSettings.State = Read-WithDefault "State/Province" $defaults.State
        $certSettings.City = Read-WithDefault "City" $defaults.City
        $certSettings.Organization = Read-WithDefault "Organization" $defaults.Organization
        $certSettings.Unit = Read-WithDefault "Organizational Unit" $defaults.Unit
        $certSettings.CommonName = Read-WithDefault "Common Name (hostname)" $defaults.CommonName
        $certSettings.Days = [int](Read-WithDefault "Certificate validity (days)" $defaults.Days)
        $certSettings.IP = Read-WithDefault "Local IP address" $defaults.IP
        Write-Host ""
    }

    Write-Host "Generating certificate with:" -ForegroundColor Cyan
    Write-Host "  Organization: $($certSettings.Organization)" -ForegroundColor Gray
    Write-Host "  Common Name: $($certSettings.CommonName)" -ForegroundColor Gray
    Write-Host "  Valid for: $($certSettings.Days) days" -ForegroundColor Gray
    Write-Host "  IP: $($certSettings.IP)" -ForegroundColor Gray
    Write-Host ""

    # Create OpenSSL config for SAN
    $opensslConfig = @"
[req]
default_bits = 2048
prompt = no
default_md = sha256
distinguished_name = dn
x509_extensions = v3_req

[dn]
C = $($certSettings.Country)
ST = $($certSettings.State)
L = $($certSettings.City)
O = $($certSettings.Organization)
OU = $($certSettings.Unit)
CN = $($certSettings.CommonName)

[v3_req]
basicConstraints = CA:FALSE
keyUsage = nonRepudiation, digitalSignature, keyEncipherment
subjectAltName = @alt_names

[alt_names]
DNS.1 = localhost
DNS.2 = *.localhost
IP.1 = 127.0.0.1
IP.2 = $($certSettings.IP)
"@

    $configPath = Join-Path $env:TEMP "openssl-sync-player.cnf"
    $opensslConfig | Out-File -FilePath $configPath -Encoding ASCII

    try {
        Write-Host "Generating certificate..." -ForegroundColor Cyan
        
        $args = @(
            "req", "-x509", "-newkey", "rsa:2048",
            "-keyout", $KeyFile,
            "-out", $CertFile,
            "-days", $certSettings.Days,
            "-nodes",
            "-config", $configPath
        )
        
        $process = Start-Process -FilePath $opensslPath -ArgumentList $args -NoNewWindow -Wait -PassThru
        
        if ($process.ExitCode -ne 0) {
            throw "OpenSSL failed with exit code $($process.ExitCode)"
        }
        
        Write-Host ""
        Write-Host "Certificate generated successfully!" -ForegroundColor Green
        Write-Host "  - Private Key: $KeyFile" -ForegroundColor Gray
        Write-Host "  - Certificate: $CertFile" -ForegroundColor Gray
        Write-Host "  - Valid for: $($certSettings.Days) days" -ForegroundColor Gray
        Write-Host ""
        
    } catch {
        Write-Host "Failed to generate certificate: $_" -ForegroundColor Red
        Read-Host "Press Enter to exit"
        exit 1
    } finally {
        if (Test-Path $configPath) {
            Remove-Item $configPath -Force
        }
    }
}

# Update config.env
Write-Host "Updating config.env..." -ForegroundColor Cyan

if (Test-Path $ConfigFile) {
    $content = Get-Content $ConfigFile -Raw
    
    # Enable HTTPS
    $content = $content -replace "SYNC_USE_HTTPS=false", "SYNC_USE_HTTPS=true"
    
    # Set JASSUB renderer
    if ($content -match "SYNC_SUBTITLE_RENDERER=wsr") {
        $content = $content -replace "SYNC_SUBTITLE_RENDERER=wsr", "SYNC_SUBTITLE_RENDERER=jassub"
    }
    
    $content | Set-Content $ConfigFile -NoNewline
    
    Write-Host "  - SYNC_USE_HTTPS=true" -ForegroundColor Green
    Write-Host "  - SYNC_SUBTITLE_RENDERER=jassub" -ForegroundColor Green
    Write-Host ""
} else {
    Write-Host "  config.env not found, skipping config update" -ForegroundColor Yellow
    Write-Host ""
}

# Display IP for final message
if (-not $certSettings) { $certSettings = $defaults }

Write-Host "========================================" -ForegroundColor Cyan
Write-Host " Setup Complete!" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "  1. Restart Sync-Player" -ForegroundColor Gray
Write-Host "  2. Access via https://$($certSettings.IP):3000" -ForegroundColor Gray
Write-Host "  3. Accept the certificate warning in your browser" -ForegroundColor Gray
Write-Host ""
Write-Host "Note: Clients will see a browser warning because this is a" -ForegroundColor Gray
Write-Host "self-signed certificate. This is normal for LAN use." -ForegroundColor Gray
Write-Host "Click 'Advanced' > 'Proceed to site' to continue." -ForegroundColor Gray
Write-Host ""
Read-Host "Press Enter to exit"
