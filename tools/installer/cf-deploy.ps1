# Cloudflare REST API Deploy Script for kancolle-notify
# Node.js / Wrangler is not required. Uses Windows PowerShell 5.1+ native cmdlets.

[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)]
    [string]$ApiToken,

    [Parameter(Mandatory=$false)]
    [string]$DiscordWebhookUrl = "",

    [Parameter(Mandatory=$false)]
    [string]$TelegramBotToken = "",

    [Parameter(Mandatory=$false)]
    [string]$TelegramChatId = "",

    [Parameter(Mandatory=$false)]
    [string]$DeviceName = "windows",

    [Parameter(Mandatory=$false)]
    [string]$ScriptDir = $PSScriptRoot,

    [Parameter(Mandatory=$false)]
    [string]$OutputDir = "$PSScriptRoot\output"
)

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function LogInfo([string]$msg) {
    Write-Host "[kancolle-setup] $msg"
}

function Invoke-CfApi {
    param(
        [string]$Uri,
        [string]$Method = "GET",
        [object]$Body = $null,
        [string]$ContentType = "application/json"
    )
    $headers = @{
        "Authorization" = "Bearer $ApiToken"
    }
    $params = @{
        Uri = $Uri
        Method = $Method
        Headers = $headers
    }
    if ($Body) {
        if ($Body -is [string]) {
            $params["Body"] = $Body
        } else {
            $params["Body"] = ($Body | ConvertTo-Json -Compress -Depth 10)
        }
        $params["ContentType"] = $ContentType
    }
    try {
        $resp = Invoke-RestMethod @params
        return $resp
    } catch {
        $err = $_
        if ($err.Exception.Response) {
            $stream = $err.Exception.Response.GetResponseStream()
            $reader = New-Object System.IO.StreamReader($stream)
            $resBody = $reader.ReadToEnd()
            throw "Cloudflare API Error ($Method $Uri): $resBody"
        }
        throw "Cloudflare API Connection Error: $($err.Message)"
    }
}

# 1. Verify Token & Get Account ID
LogInfo "Verifying Cloudflare API token..."
$verify = Invoke-CfApi -Uri "https://api.cloudflare.com/client/v4/user/tokens/verify"
if ($verify.success -ne $true) {
    throw "Cloudflare API token is invalid or expired."
}

LogInfo "Retrieving Cloudflare account..."
$accountsResp = Invoke-CfApi -Uri "https://api.cloudflare.com/client/v4/accounts"
if (!$accountsResp.result -or $accountsResp.result.Count -eq 0) {
    throw "No Cloudflare accounts found for this token."
}
$accountId = $accountsResp.result[0].id
LogInfo "Account ID: $accountId ($($accountsResp.result[0].name))"

# 2. D1 Database Check / Create
LogInfo "Checking D1 database (kancolle-notify)..."
$d1List = Invoke-CfApi -Uri "https://api.cloudflare.com/client/v4/accounts/$accountId/d1/database?name=kancolle-notify"
$dbId = $null
if ($d1List.result -and $d1List.result.Count -gt 0) {
    $dbId = $d1List.result[0].uuid
    LogInfo "Using existing D1 database: $dbId"
} else {
    LogInfo "Creating new D1 database..."
    $d1Create = Invoke-CfApi -Uri "https://api.cloudflare.com/client/v4/accounts/$accountId/d1/database" -Method "POST" -Body @{ name = "kancolle-notify" }
    $dbId = $d1Create.result.uuid
    LogInfo "D1 database created: $dbId"
}

# 3. D1 Schema Initialization
LogInfo "Applying D1 schema..."
$schemaFile = Join-Path $ScriptDir "..\..\server\schema.sql"
if (!(Test-Path $schemaFile)) {
    $schemaFile = Join-Path $ScriptDir "schema.sql"
}
$schemaSql = Get-Content -Raw -Path $schemaFile -Encoding UTF8
$queryBody = @{ sql = $schemaSql }
$null = Invoke-CfApi -Uri "https://api.cloudflare.com/client/v4/accounts/$accountId/d1/database/$dbId/query" -Method "POST" -Body $queryBody
LogInfo "Schema applied successfully."

# 4. Upload Worker Script (multipart/form-data)
LogInfo "Deploying Worker script..."
$workerFile = Join-Path $ScriptDir "bundled-worker.js"
if (!(Test-Path $workerFile)) {
    throw "bundled-worker.js not found: $workerFile"
}
$workerContent = [System.IO.File]::ReadAllBytes($workerFile)

$metadata = @{
    main_module = "bundled-worker.js"
    compatibility_date = "2026-09-09"
    bindings = @(
        @{
            type = "d1"
            name = "DB"
            id = $dbId
        }
    )
} | ConvertTo-Json -Compress -Depth 10

$boundary = "----WebKitFormBoundary" + [System.Guid]::NewGuid().ToString("N")
$LF = "`r`n"

$bodyStream = New-Object System.IO.MemoryStream
$sw = New-Object System.IO.StreamWriter($bodyStream, [System.Text.Encoding]::UTF8)

# metadata part
$sw.Write("--$boundary$LF")
$sw.Write("Content-Disposition: form-data; name=`"metadata`"$LF")
$sw.Write("Content-Type: application/json$LF$LF")
$sw.Write("$metadata$LF")
$sw.Flush()

# script part
$sw.Write("--$boundary$LF")
$sw.Write("Content-Disposition: form-data; name=`"bundled-worker.js`"; filename=`"bundled-worker.js`"$LF")
$sw.Write("Content-Type: application/javascript+module$LF$LF")
$sw.Flush()

$bodyStream.Write($workerContent, 0, $workerContent.Length)

$sw.Write("$LF--$boundary--$LF")
$sw.Flush()

$uploadData = $bodyStream.ToArray()
$sw.Close()
$bodyStream.Close()

$uploadHeaders = @{
    "Authorization" = "Bearer $ApiToken"
}
$uploadParams = @{
    Uri = "https://api.cloudflare.com/client/v4/accounts/$accountId/workers/scripts/kancolle-notify"
    Method = "PUT"
    Headers = $uploadHeaders
    ContentType = "multipart/form-data; boundary=$boundary"
    Body = $uploadData
}
$uploadResp = Invoke-RestMethod @uploadParams
if ($uploadResp.success -ne $true) {
    throw "Failed to deploy Worker script."
}
LogInfo "Worker script deployed successfully."

# 5. Set Cron Trigger (* * * * *)
LogInfo "Setting schedule trigger (* * * * *)..."
$cronBody = @( @{ cron = "* * * * *" } )
$null = Invoke-CfApi -Uri "https://api.cloudflare.com/client/v4/accounts/$accountId/workers/scripts/kancolle-notify/schedules" -Method "PUT" -Body $cronBody
LogInfo "Schedule trigger configured."

# 6. Generate Device Token & Secrets
LogInfo "Generating device authentication token..."
$tokenBytes = New-Object byte[] 32
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$rng.GetBytes($tokenBytes)
$rawToken = [Convert]::ToBase64String($tokenBytes).Replace('+', '-').Replace('/', '_').Replace('=', '')

$sha256 = [System.Security.Cryptography.SHA256]::Create()
$tokenHashBytes = $sha256.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($rawToken))
$tokenHash = [System.BitConverter]::ToString($tokenHashBytes).Replace("-", "").ToLower()

$deviceJson = @{ $DeviceName = $tokenHash } | ConvertTo-Json -Compress

LogInfo "Setting secret: DEVICE_TOKENS..."
$null = Invoke-CfApi -Uri "https://api.cloudflare.com/client/v4/accounts/$accountId/workers/scripts/kancolle-notify/secrets" -Method "PUT" -Body @{
    name = "DEVICE_TOKENS"
    text = $deviceJson
    type = "secret_text"
}

if (![string]::IsNullOrWhiteSpace($DiscordWebhookUrl)) {
    LogInfo "Setting secret: DISCORD_WEBHOOK_URL..."
    $null = Invoke-CfApi -Uri "https://api.cloudflare.com/client/v4/accounts/$accountId/workers/scripts/kancolle-notify/secrets" -Method "PUT" -Body @{
        name = "DISCORD_WEBHOOK_URL"
        text = $DiscordWebhookUrl.Trim()
        type = "secret_text"
    }
}

if (![string]::IsNullOrWhiteSpace($TelegramBotToken) -and ![string]::IsNullOrWhiteSpace($TelegramChatId)) {
    LogInfo "Setting secrets: TELEGRAM_BOT_TOKEN / CHAT_ID..."
    $null = Invoke-CfApi -Uri "https://api.cloudflare.com/client/v4/accounts/$accountId/workers/scripts/kancolle-notify/secrets" -Method "PUT" -Body @{
        name = "TELEGRAM_BOT_TOKEN"
        text = $TelegramBotToken.Trim()
        type = "secret_text"
    }
    $null = Invoke-CfApi -Uri "https://api.cloudflare.com/client/v4/accounts/$accountId/workers/scripts/kancolle-notify/secrets" -Method "PUT" -Body @{
        name = "TELEGRAM_CHAT_ID"
        text = $TelegramChatId.Trim()
        type = "secret_text"
    }
}

# 7. Check Subdomain & Worker URL
LogInfo "Checking Worker subdomain..."
$subdomainResp = Invoke-CfApi -Uri "https://api.cloudflare.com/client/v4/accounts/$accountId/workers/subdomain"
$subdomain = $subdomainResp.result.subdomain
$workerUrl = "https://kancolle-notify.$subdomain.workers.dev"

LogInfo "=================================================="
LogInfo "Setup Completed!"
LogInfo "Server URL: $workerUrl"
LogInfo "Device Token: $rawToken"
LogInfo "=================================================="

# 8. Write Client Config Files
if (!(Test-Path $OutputDir)) {
    New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
}

$clientConfig = @{
    server_url = $workerUrl
    token = $rawToken
    discord_configured = (![string]::IsNullOrWhiteSpace($DiscordWebhookUrl))
    telegram_configured = (![string]::IsNullOrWhiteSpace($TelegramBotToken))
    created_at = (Get-Date).ToString("yyyy-MM-ddTHH:mm:sszzz")
}

$clientConfigJson = $clientConfig | ConvertTo-Json -Indent 2
Set-Content -Path (Join-Path $OutputDir "kancolle-notify-config.json") -Value $clientConfigJson -Encoding UTF8

$desktopConfig = @{
    server_url = $workerUrl
    token = $rawToken
    notify_minutes_before = 0
} | ConvertTo-Json -Indent 2
Set-Content -Path (Join-Path $OutputDir "desktop-config.json") -Value $desktopConfig -Encoding UTF8

return $clientConfig
