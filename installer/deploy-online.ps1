# Cloudflare Online Deploy & Asset Downloader for kancolle-notify
# Node.js / Wrangler 不要。Windows PowerShell 5.1+ ネイティブで動作します。

[CmdletBinding()]
param(
    [Parameter(Mandatory=$false)]
    [string]$ApiToken = "",

    [Parameter(Mandatory=$false)]
    [string]$DiscordWebhookUrl = "",

    [Parameter(Mandatory=$false)]
    [string]$TelegramBotToken = "",

    [Parameter(Mandatory=$false)]
    [string]$TelegramChatId = "",

    [Parameter(Mandatory=$false)]
    [string]$TelegramWebhookSecret = "",

    [Parameter(Mandatory=$false)]
    [string]$DeviceName = "windows",

    [Parameter(Mandatory=$true)]
    [string]$InstallDir,

    [Parameter(Mandatory=$false)]
    [string]$RepoSlug = "Ikumyon/kancolle-notify",

    [Parameter(Mandatory=$false)]
    [ValidateSet("Full", "Update", "Test")]
    [string]$Mode = "Full",

    [Parameter(Mandatory=$false)]
    [switch]$Test
)

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function LogInfo([string]$msg) {
    Write-Host "[kancolle-setup] $msg"
}

if ($Test) {
    $Mode = "Test"
}

$IsTest = ($Mode -eq "Test")
$IsUpdate = ($Mode -eq "Update")
$WritesCloudflare = ($Mode -eq "Full")
$UploadsWorker = ($Mode -eq "Full" -or $Mode -eq "Update")
$InstallsAssets = $true
$WritesLocalConfig = ($Mode -ne "Update")

function Invoke-CfApi {
    param(
        [string]$Uri,
        [string]$Method = "GET",
        [object]$Body = $null,
        [string]$ContentType = "application/json"
    )
    $h = @{ "Authorization" = "Bearer $ApiToken" }
    $p = @{ Uri = $Uri; Method = $Method; Headers = $h }
    if ($Body) {
        if ($Body -is [string]) { $p["Body"] = $Body }
        else { $p["Body"] = ($Body | ConvertTo-Json -Compress -Depth 10) }
        $p["ContentType"] = $ContentType
    }
    try {
        return (Invoke-RestMethod @p)
    } catch {
        $err = $_
        if ($err.Exception.Response) {
            $stream = $err.Exception.Response.GetResponseStream()
            $reader = New-Object System.IO.StreamReader($stream)
            $resBody = $reader.ReadToEnd()
            throw ("Cloudflare API Error: " + $Method + " " + $Uri + " - " + $resBody)
        }
        throw ("Cloudflare API Connection Error: " + $err.Message)
    }
}

function Download-ReleaseAsset {
    param(
        [object]$Release,
        [string]$AssetName,
        [string]$DestinationDir
    )

    $asset = $Release.assets | Where-Object { $_.name -eq $AssetName } | Select-Object -First 1
    if (!$asset) {
        throw "Release asset was not found: $AssetName"
    }

    $targetFile = Join-Path $DestinationDir $AssetName
    LogInfo "Downloading: $AssetName..."
    Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $targetFile -UseBasicParsing
    if (!(Test-Path $targetFile) -or ((Get-Item $targetFile).Length -le 0)) {
        throw "Downloaded asset is missing or empty: $AssetName"
    }
}

# --- 1. ディレクトリの準備 ---
$desktopDir = Join-Path $InstallDir "desktop"
$extensionDir = Join-Path $InstallDir "extension"
$tempDir = Join-Path $env:TEMP ("kancolle-setup-" + [System.Guid]::NewGuid().ToString("N").Substring(0, 8))

if ($IsTest) {
    LogInfo "Mode: Test"
    LogInfo "Test install will run GitHub download, local placement, Cloudflare token/account checks, upload preparation, and local config generation. Cloudflare changes are skipped."
} elseif ($IsUpdate) {
    LogInfo "Mode: Update"
    LogInfo "Update will refresh local assets and update the existing Cloudflare Worker script. Secrets and local config are preserved."
} else {
    LogInfo "Mode: Full"
    LogInfo "GitHub download, asset placement, Cloudflare writes, and local config generation will run."
}

New-Item -ItemType Directory -Path $tempDir -Force | Out-Null

try {
    $workerFile = $null
    $schemaFile = $null

    if ($InstallsAssets) {
        New-Item -ItemType Directory -Path $desktopDir -Force | Out-Null
        New-Item -ItemType Directory -Path $extensionDir -Force | Out-Null

        LogInfo "Fetching latest assets from GitHub ($RepoSlug)..."

        $repoZipUrl = "https://github.com/$RepoSlug/archive/refs/heads/main.zip"
        $zipPath = Join-Path $tempDir "repo.zip"
        $extractPath = Join-Path $tempDir "repo_extracted"

        LogInfo "Downloading browser extension and server definitions..."
        Invoke-WebRequest -Uri $repoZipUrl -OutFile $zipPath -UseBasicParsing
        Expand-Archive -Path $zipPath -DestinationPath $extractPath -Force

        $rootFolder = Get-ChildItem -Path $extractPath -Directory | Select-Object -First 1
        if (!$rootFolder) {
            throw "Failed to extract repository ZIP."
        }

        $sourceExt = Join-Path $rootFolder.FullName "extension"
        if (Test-Path $sourceExt) {
            Copy-Item -Path (Join-Path $sourceExt "*") -Destination $extensionDir -Recurse -Force
            LogInfo "Browser extension placed: $extensionDir"
        }

        $sourceDesktop = Join-Path $rootFolder.FullName "desktop"
        if (Test-Path $sourceDesktop) {
            $sourceIcons = Join-Path $sourceDesktop "icons"
            if (Test-Path $sourceIcons) {
                $destIcons = Join-Path $desktopDir "icons"
                New-Item -ItemType Directory -Path $destIcons -Force | Out-Null
                Copy-Item -Path (Join-Path $sourceIcons "*") -Destination $destIcons -Recurse -Force
                LogInfo "Notification icons placed: $destIcons"
            }

            $sourceSounds = Join-Path $sourceDesktop "sounds"
            if (Test-Path $sourceSounds) {
                $destSounds = Join-Path $desktopDir "sounds"
                New-Item -ItemType Directory -Path $destSounds -Force | Out-Null
                Copy-Item -Path (Join-Path $sourceSounds "*") -Destination $destSounds -Recurse -Force
                LogInfo "Notification sounds placed: $destSounds"
            }

            $sourceReadme = Join-Path $sourceDesktop "README.md"
            if (Test-Path $sourceReadme) {
                Copy-Item -Path $sourceReadme -Destination (Join-Path $desktopDir "README.md") -Force
            }
        }

        $workerFile = Join-Path $tempDir "bundled-worker.js"
        $sourceWorker = Join-Path $rootFolder.FullName "installer\bundled-worker.js"

        if (Test-Path $sourceWorker) {
            Copy-Item -Path $sourceWorker -Destination $workerFile -Force
        } else {
            $rawWorkerUrl = "https://raw.githubusercontent.com/$RepoSlug/main/installer/bundled-worker.js"
            Invoke-WebRequest -Uri $rawWorkerUrl -OutFile $workerFile -UseBasicParsing
        }

        $schemaFile = Join-Path $rootFolder.FullName "server\schema.sql"
        if (!(Test-Path $schemaFile)) {
            $schemaFile = Join-Path $tempDir "schema.sql"
            $rawSchemaUrl = "https://raw.githubusercontent.com/$RepoSlug/main/server/schema.sql"
            Invoke-WebRequest -Uri $rawSchemaUrl -OutFile $schemaFile -UseBasicParsing
        }

        LogInfo "Fetching latest desktop binaries..."

        try {
            $headers = @{ "User-Agent" = "kancolle-notify-installer" }
            $release = Invoke-RestMethod -Uri "https://api.github.com/repos/$RepoSlug/releases/latest" -Headers $headers -UseBasicParsing
            LogInfo "Using release: $($release.tag_name)"
            Download-ReleaseAsset -Release $release -AssetName "kancolle-gui.exe" -DestinationDir $desktopDir
            Download-ReleaseAsset -Release $release -AssetName "kancolle-daemon.exe" -DestinationDir $desktopDir
        } catch {
            LogInfo "Release asset download failed: $($_.Exception.Message)"
        }

        if (!(Test-Path (Join-Path $desktopDir "kancolle-gui.exe"))) {
            $localGui = Join-Path $PSScriptRoot "..\desktop\dist\kancolle-gui.exe"
            if (Test-Path $localGui) {
                Copy-Item -Path $localGui -Destination (Join-Path $desktopDir "kancolle-gui.exe") -Force
            }
        }
        if (!(Test-Path (Join-Path $desktopDir "kancolle-daemon.exe"))) {
            $localDaemon = Join-Path $PSScriptRoot "..\desktop\daemon\target\release\kancolle-daemon.exe"
            if (!(Test-Path $localDaemon)) {
                $localDaemon = Join-Path $PSScriptRoot "..\desktop\dist\kancolle-daemon.exe"
            }
            if (Test-Path $localDaemon) {
                Copy-Item -Path $localDaemon -Destination (Join-Path $desktopDir "kancolle-daemon.exe") -Force
            }
        }

        if (!(Test-Path (Join-Path $desktopDir "kancolle-gui.exe"))) {
            throw "kancolle-gui.exe was not downloaded. Check the latest GitHub release assets."
        }
        if (!(Test-Path (Join-Path $desktopDir "kancolle-daemon.exe"))) {
            throw "kancolle-daemon.exe was not downloaded. Check the latest GitHub release assets."
        }

        $localIcons = Join-Path $PSScriptRoot "..\desktop\icons"
        if (Test-Path $localIcons) {
            $targetIcons = Join-Path $desktopDir "icons"
            New-Item -ItemType Directory -Path $targetIcons -Force | Out-Null
            Copy-Item -Path (Join-Path $localIcons "*") -Destination $targetIcons -Recurse -Force
        }
        $localSounds = Join-Path $PSScriptRoot "..\desktop\sounds"
        if (Test-Path $localSounds) {
            $targetSounds = Join-Path $desktopDir "sounds"
            New-Item -ItemType Directory -Path $targetSounds -Force | Out-Null
            Copy-Item -Path (Join-Path $localSounds "*") -Destination $targetSounds -Recurse -Force
        }
        $localReadme = Join-Path $PSScriptRoot "..\desktop\README.md"
        if (Test-Path $localReadme) {
            Copy-Item -Path $localReadme -Destination (Join-Path $desktopDir "README.md") -Force
        }
        $localIcon = Join-Path $PSScriptRoot "..\desktop\icon.ico"
        if (Test-Path $localIcon) {
            Copy-Item -Path $localIcon -Destination (Join-Path $desktopDir "icon.ico") -Force
        }
    }

    LogInfo "Verifying Cloudflare API token..."
    $verify = Invoke-CfApi -Uri "https://api.cloudflare.com/client/v4/user/tokens/verify"
    if ($verify.success -ne $true) {
        throw "Cloudflare API token is invalid or expired."
    }

    LogInfo "Fetching Cloudflare account..."
    $accountsResp = Invoke-CfApi -Uri "https://api.cloudflare.com/client/v4/accounts"
    if (!$accountsResp.result -or $accountsResp.result.Count -eq 0) {
        throw "No available Cloudflare account was found."
    }
    $accountId = $accountsResp.result[0].id
    $accountName = $accountsResp.result[0].name
    LogInfo ("Account ID: " + $accountId + " (" + $accountName + ")")

    $dbId = $null
    if ($IsTest) {
        LogInfo "Test: D1 database check skipped. Using simulated D1 binding."
        $dbId = "test-d1-database-id"
    } else {
        LogInfo "Checking D1 database (kancolle-notify)..."
        $d1List = Invoke-CfApi -Uri "https://api.cloudflare.com/client/v4/accounts/$accountId/d1/database?name=kancolle-notify"
        if ($d1List.result -and $d1List.result.Count -gt 0) {
            $dbId = $d1List.result[0].uuid
            LogInfo "Using existing D1 database: $dbId"
        }
    }
    if (!$dbId -and $IsUpdate) {
        throw "Update requires an existing D1 database named kancolle-notify. Run a new setup first."
    }
    if (!$dbId -and $WritesCloudflare) {
        LogInfo "Creating D1 database..."
        $d1Create = Invoke-CfApi -Uri "https://api.cloudflare.com/client/v4/accounts/$accountId/d1/database" -Method "POST" -Body @{ name = "kancolle-notify" }
        if ($d1Create.success -ne $true) { throw "Failed to create D1 database." }
        $dbId = $d1Create.result.uuid
        LogInfo "D1 database created: $dbId"
    }

    if ($WritesCloudflare) {
        LogInfo "Applying D1 schema..."
        $schemaSql = Get-Content -Raw -Path $schemaFile -Encoding UTF8
        $null = Invoke-CfApi -Uri "https://api.cloudflare.com/client/v4/accounts/$accountId/d1/database/$dbId/query" -Method "POST" -Body @{ sql = $schemaSql }
        LogInfo "D1 schema applied."
    } elseif ($IsTest) {
        if (Test-Path $schemaFile) {
            $schemaSql = Get-Content -Raw -Path $schemaFile -Encoding UTF8
            LogInfo "Test: D1 schema loaded locally ($($schemaSql.Length) chars). Schema apply skipped."
        }
    }

    LogInfo "Preparing Worker script..."
    $workerBytes = [System.IO.File]::ReadAllBytes($workerFile)

    if ($IsTest) {
        $existingScript = $null
        LogInfo "Test: Worker script lookup skipped. Simulating a new Worker."
    } else {
        $scripts = Invoke-CfApi -Uri "https://api.cloudflare.com/client/v4/accounts/$accountId/workers/scripts"
        $existingScript = $scripts.result | Where-Object { $_.id -eq 'kancolle-notify' } | Select-Object -First 1
        if (!$existingScript -and $IsUpdate) {
            throw "Update requires an existing Worker named kancolle-notify. Run a new setup first."
        }
    }
    $metadataObject = @{
        main_module = "bundled-worker.js"
        compatibility_date = "2026-09-09"
        bindings = @(
            @{ type = "d1"; name = "DB"; id = $dbId },
            @{ type = "durable_object_namespace"; name = "SCHEDULER"; class_name = "NotificationScheduler" }
        )
    }
    if ($existingScript.migration_tag -ne 'scheduler-v1') {
        $migration = @{ new_tag = 'scheduler-v1'; steps = @( @{ new_sqlite_classes = @('NotificationScheduler') } ) }
        if ($existingScript.migration_tag) { $migration.old_tag = $existingScript.migration_tag }
        $metadataObject.migrations = $migration
    }
    $metadata = $metadataObject | ConvertTo-Json -Compress -Depth 10

    $boundary = "----WebKitFormBoundary" + [System.Guid]::NewGuid().ToString("N")
    $LF = "`r`n"
    $bodyStream = New-Object System.IO.MemoryStream
    $sw = New-Object System.IO.StreamWriter($bodyStream, [System.Text.Encoding]::UTF8)

    $sw.Write("--$boundary$LF")
    $sw.Write("Content-Disposition: form-data; name=`"metadata`"$LF")
    $sw.Write("Content-Type: application/json$LF$LF")
    $sw.Write("$metadata$LF")
    $sw.Flush()

    $sw.Write("--$boundary$LF")
    $sw.Write("Content-Disposition: form-data; name=`"bundled-worker.js`"; filename=`"bundled-worker.js`"$LF")
    $sw.Write("Content-Type: application/javascript+module$LF$LF")
    $sw.Flush()

    $bodyStream.Write($workerBytes, 0, $workerBytes.Length)
    $sw.Write("$LF--$boundary--$LF")
    $sw.Flush()

    $uploadData = $bodyStream.ToArray()
    $sw.Close()
    $bodyStream.Close()

    if ($IsTest) {
        LogInfo "Test: Worker upload prepared ($($uploadData.Length) bytes). Upload skipped."
        $uploadResp = [pscustomobject]@{ success = $true }
    } elseif ($UploadsWorker) {
        $uploadResp = Invoke-RestMethod -Uri "https://api.cloudflare.com/client/v4/accounts/$accountId/workers/scripts/kancolle-notify" `
            -Method "PUT" `
            -Headers @{ "Authorization" = "Bearer $ApiToken" } `
            -ContentType "multipart/form-data; boundary=$boundary" `
            -Body $uploadData
    } else {
        $uploadResp = [pscustomobject]@{ success = $true }
    }
    if ($uploadResp.success -ne $true) {
        throw "Failed to deploy Worker script."
    }
    if ($IsTest) {
        LogInfo "Test: Worker deploy skipped."
    } elseif ($IsUpdate) {
        LogInfo "Worker script updated. Existing secrets were preserved."
    } else {
        LogInfo "Worker script deployed."
    }

    # シークレット生成
    LogInfo "Generating device token..."
    $tokenBytes = New-Object byte[] 32
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $rng.GetBytes($tokenBytes)
    $rawToken = [Convert]::ToBase64String($tokenBytes).Replace('+', '-').Replace('/', '_').Replace('=', '')

    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    $tokenHashBytes = $sha256.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($rawToken))
    $tokenHash = [System.BitConverter]::ToString($tokenHashBytes).Replace("-", "").ToLower()

    $deviceJson = @{ $DeviceName = $tokenHash } | ConvertTo-Json -Compress
    if ($WritesCloudflare) {
        $null = Invoke-CfApi -Uri "https://api.cloudflare.com/client/v4/accounts/$accountId/workers/scripts/kancolle-notify/secrets" -Method "PUT" -Body @{
            name = "DEVICE_TOKENS"
            text = $deviceJson
            type = "secret_text"
        }
    } else {
        if ($IsUpdate) {
            LogInfo "Update: DEVICE_TOKENS secret preserved."
        } else {
            LogInfo "Test: DEVICE_TOKENS secret prepared. Secret registration skipped."
        }
    }

    if (![string]::IsNullOrWhiteSpace($DiscordWebhookUrl)) {
        LogInfo "Setting Discord Webhook secret..."
        if ($WritesCloudflare) {
            $null = Invoke-CfApi -Uri "https://api.cloudflare.com/client/v4/accounts/$accountId/workers/scripts/kancolle-notify/secrets" -Method "PUT" -Body @{
                name = "DISCORD_WEBHOOK_URL"
                text = $DiscordWebhookUrl.Trim()
                type = "secret_text"
            }
        } else {
            if ($IsUpdate) {
                LogInfo "Update: Discord Webhook secret preserved."
            } else {
                LogInfo "Test: Discord Webhook secret prepared. Secret registration skipped."
            }
        }
    }

    if (![string]::IsNullOrWhiteSpace($TelegramBotToken) -and ![string]::IsNullOrWhiteSpace($TelegramChatId)) {
        if ([string]::IsNullOrWhiteSpace($TelegramWebhookSecret)) {
            $sBytes = New-Object byte[] 32
            $rng.GetBytes($sBytes)
            $TelegramWebhookSecret = [Convert]::ToBase64String($sBytes).Replace('+', '-').Replace('/', '_').Replace('=', '')
        }
        if ($WritesCloudflare) {
            $null = Invoke-CfApi -Uri "https://api.cloudflare.com/client/v4/accounts/$accountId/workers/scripts/kancolle-notify/secrets" -Method "PUT" -Body @{
                name = "TELEGRAM_BOT_TOKEN"; text = $TelegramBotToken.Trim(); type = "secret_text"
            }
            $null = Invoke-CfApi -Uri "https://api.cloudflare.com/client/v4/accounts/$accountId/workers/scripts/kancolle-notify/secrets" -Method "PUT" -Body @{
                name = "TELEGRAM_CHAT_ID"; text = $TelegramChatId.Trim(); type = "secret_text"
            }
            $null = Invoke-CfApi -Uri "https://api.cloudflare.com/client/v4/accounts/$accountId/workers/scripts/kancolle-notify/secrets" -Method "PUT" -Body @{
                name = "TELEGRAM_WEBHOOK_SECRET"; text = $TelegramWebhookSecret; type = "secret_text"
            }
        } else {
            if ($IsUpdate) {
                LogInfo "Update: Telegram secrets preserved."
            } else {
                LogInfo "Test: Telegram secrets prepared. Secret registration skipped."
            }
        }
    }

    if ($IsTest) {
        LogInfo "Test: Worker subdomain lookup skipped. Using simulated URL."
        $workerUrl = "https://kancolle-notify.test.local"
    } elseif ($IsUpdate) {
        $workerUrl = "(preserved)"
    } else {
        $subdomainResp = Invoke-CfApi -Uri "https://api.cloudflare.com/client/v4/accounts/$accountId/workers/subdomain"
        $subdomain = $subdomainResp.result.subdomain
        $workerUrl = "https://kancolle-notify.$subdomain.workers.dev"
    }

    if (![string]::IsNullOrWhiteSpace($TelegramBotToken) -and ![string]::IsNullOrWhiteSpace($TelegramChatId)) {
        $webhookBody = @{ url = "$workerUrl/webhook/telegram"; secret_token = $TelegramWebhookSecret; allowed_updates = @('message') } | ConvertTo-Json -Compress
        if ($IsTest) {
            LogInfo "Test: Telegram setWebhook skipped."
        } elseif ($IsUpdate) {
            LogInfo "Update: Telegram setWebhook skipped."
        } else {
            $null = Invoke-RestMethod -Uri "https://api.telegram.org/bot$($TelegramBotToken.Trim())/setWebhook" -Method POST -ContentType 'application/json' -Body $webhookBody
        }
    }

    LogInfo "=================================================="
    LogInfo "Setup completed."
    LogInfo "Server URL: $workerUrl"
    LogInfo "=================================================="

    if ($WritesLocalConfig) {
        $desktopConfig = @{
            server_url = $workerUrl
            token = $rawToken
            play_sound = $true
        } | ConvertTo-Json -Indent 2

        $cfgPath = Join-Path $desktopDir "config.json"
        Set-Content -Path $cfgPath -Value $desktopConfig -Encoding UTF8
        LogInfo "Initial config file created: $cfgPath"
    }

    return @{
        server_url = $workerUrl
        token = $rawToken
        ok = $true
        mode = $Mode
    }
}
finally {
    if (Test-Path $tempDir) {
        Remove-Item -Path $tempDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}
