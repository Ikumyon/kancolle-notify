# Cloudflare Online Deploy & Asset Downloader for kancolle-notify
# Node.js / Wrangler 不要。Windows PowerShell 5.1+ ネイティブで動作します。

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
    [string]$TelegramWebhookSecret = "",

    [Parameter(Mandatory=$false)]
    [string]$DeviceName = "windows",

    [Parameter(Mandatory=$true)]
    [string]$InstallDir,

    [Parameter(Mandatory=$false)]
    [string]$RepoSlug = "Ikumyon/kancolle-notify"
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

# --- 1. ディレクトリの準備 ---
$desktopDir = Join-Path $InstallDir "desktop"
$extensionDir = Join-Path $InstallDir "extension"
$tempDir = Join-Path $env:TEMP ("kancolle-setup-" + [System.Guid]::NewGuid().ToString("N").Substring(0, 8))

New-Item -ItemType Directory -Path $desktopDir -Force | Out-Null
New-Item -ItemType Directory -Path $extensionDir -Force | Out-Null
New-Item -ItemType Directory -Path $tempDir -Force | Out-Null

try {
    # --- 2. GitHubから最新プログラム・拡張機能の取得 ---
    LogInfo "GitHub ($RepoSlug) から最新の資材を取得中..."

    # (A) リポジトリ最新コードZIPの取得（拡張機能およびWorkerスクリプト）
    $repoZipUrl = "https://github.com/$RepoSlug/archive/refs/heads/main.zip"
    $zipPath = Join-Path $tempDir "repo.zip"
    $extractPath = Join-Path $tempDir "repo_extracted"

    LogInfo "拡張機能およびサーバー定義をダウンロード中..."
    Invoke-WebRequest -Uri $repoZipUrl -OutFile $zipPath -UseBasicParsing
    Expand-Archive -Path $zipPath -DestinationPath $extractPath -Force

    $rootFolder = Get-ChildItem -Path $extractPath -Directory | Select-Object -First 1
    if (!$rootFolder) {
        throw "リポジトリZIPの展開に失敗しました。"
    }

    # 拡張機能の配置
    $sourceExt = Join-Path $rootFolder.FullName "extension"
    if (Test-Path $sourceExt) {
        Copy-Item -Path (Join-Path $sourceExt "*") -Destination $extensionDir -Recurse -Force
        LogInfo "ブラウザ拡張機能を配置しました: $extensionDir"
    }

    # Workerスクリプト・スキーマの取得
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

    # (B) デスクトップ最新バイナリの取得
    LogInfo "デスクトップ最新バイナリを取得中..."
    $apiUrl = "https://api.github.com/repos/$RepoSlug/releases/latest"

    try {
        $headers = @{ "User-Agent" = "kancolle-notify-installer" }
        $release = Invoke-RestMethod -Uri $apiUrl -Headers $headers -UseBasicParsing
        if ($release.assets) {
            foreach ($asset in $release.assets) {
                if ($asset.name -eq "kancolle-gui.exe" -or $asset.name -eq "kancolle-daemon.exe") {
                    $targetFile = Join-Path $desktopDir $asset.name
                    LogInfo "ダウンロード中: $($asset.name)..."
                    Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $targetFile -UseBasicParsing
                } elseif ($asset.name -like "*desktop*.zip") {
                    $dZip = Join-Path $tempDir "desktop.zip"
                    Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $dZip -UseBasicParsing
                    Expand-Archive -Path $dZip -DestinationPath $desktopDir -Force
                }
            }
        }
    } catch {
        LogInfo "Releases API取得スキップ: $($_.Exception.Message)"
    }

    # Releases にない場合のフォールバック: 既存 dist があれば同期
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

    # アイコンアセットの同期
    $localIcons = Join-Path $PSScriptRoot "..\desktop\icons"
    if (Test-Path $localIcons) {
        $targetIcons = Join-Path $desktopDir "icons"
        Copy-Item -Path $localIcons -Destination $targetIcons -Recurse -Force
    }
    $localIcon = Join-Path $PSScriptRoot "..\desktop\icon.ico"
    if (Test-Path $localIcon) {
        Copy-Item -Path $localIcon -Destination (Join-Path $desktopDir "icon.ico") -Force
    }

    # --- 3. Cloudflare REST API による全自動デプロイ ---
    LogInfo "Cloudflare API トークンを検証中..."
    $verify = Invoke-CfApi -Uri "https://api.cloudflare.com/client/v4/user/tokens/verify"
    if ($verify.success -ne $true) {
        throw "Cloudflare APIトークンが無効または有効期限切れです。"
    }

    LogInfo "Cloudflare アカウントを取得中..."
    $accountsResp = Invoke-CfApi -Uri "https://api.cloudflare.com/client/v4/accounts"
    if (!$accountsResp.result -or $accountsResp.result.Count -eq 0) {
        throw "有効なCloudflareアカウントが見つかりませんでした。"
    }
    $accountId = $accountsResp.result[0].id
    $accountName = $accountsResp.result[0].name
    LogInfo ("Account ID: " + $accountId + " (" + $accountName + ")")

    # D1 データベース確認・作成
    LogInfo "D1 データベース (kancolle-notify) を確認中..."
    $d1List = Invoke-CfApi -Uri "https://api.cloudflare.com/client/v4/accounts/$accountId/d1/database?name=kancolle-notify"
    $dbId = $null
    if ($d1List.result -and $d1List.result.Count -gt 0) {
        $dbId = $d1List.result[0].uuid
        LogInfo "既存のD1データベースを使用: $dbId"
    } else {
        LogInfo "D1データベースを新規作成中..."
        $d1Create = Invoke-CfApi -Uri "https://api.cloudflare.com/client/v4/accounts/$accountId/d1/database" -Method "POST" -Body @{ name = "kancolle-notify" }
        if ($d1Create.success -ne $true) { throw "D1データベースの作成に失敗しました。" }
        $dbId = $d1Create.result.uuid
        LogInfo "D1データベース作成完了: $dbId"
    }

    # スキーマ適用
    LogInfo "D1 スキーマを適用中..."
    $schemaSql = Get-Content -Raw -Path $schemaFile -Encoding UTF8
    $null = Invoke-CfApi -Uri "https://api.cloudflare.com/client/v4/accounts/$accountId/d1/database/$dbId/query" -Method "POST" -Body @{ sql = $schemaSql }
    LogInfo "スキーマ適用完了。"

    # Worker スクリプトのアップロード
    LogInfo "Worker スクリプトをデプロイ中..."
    $workerBytes = [System.IO.File]::ReadAllBytes($workerFile)

    $scripts = Invoke-CfApi -Uri "https://api.cloudflare.com/client/v4/accounts/$accountId/workers/scripts"
    $existingScript = $scripts.result | Where-Object { $_.id -eq 'kancolle-notify' } | Select-Object -First 1
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

    $uploadResp = Invoke-RestMethod -Uri "https://api.cloudflare.com/client/v4/accounts/$accountId/workers/scripts/kancolle-notify" `
        -Method "PUT" `
        -Headers @{ "Authorization" = "Bearer $ApiToken" } `
        -ContentType "multipart/form-data; boundary=$boundary" `
        -Body $uploadData
    if ($uploadResp.success -ne $true) {
        throw "Worker スクリプトのデプロイに失敗しました。"
    }
    LogInfo "Worker スクリプトのデプロイ完了。"

    # シークレット生成
    LogInfo "認証トークンを生成中..."
    $tokenBytes = New-Object byte[] 32
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $rng.GetBytes($tokenBytes)
    $rawToken = [Convert]::ToBase64String($tokenBytes).Replace('+', '-').Replace('/', '_').Replace('=', '')

    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    $tokenHashBytes = $sha256.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($rawToken))
    $tokenHash = [System.BitConverter]::ToString($tokenHashBytes).Replace("-", "").ToLower()

    $deviceJson = @{ $DeviceName = $tokenHash } | ConvertTo-Json -Compress
    $null = Invoke-CfApi -Uri "https://api.cloudflare.com/client/v4/accounts/$accountId/workers/scripts/kancolle-notify/secrets" -Method "PUT" -Body @{
        name = "DEVICE_TOKENS"
        text = $deviceJson
        type = "secret_text"
    }

    if (![string]::IsNullOrWhiteSpace($DiscordWebhookUrl)) {
        LogInfo "Discord Webhookシークレットを設定中..."
        $null = Invoke-CfApi -Uri "https://api.cloudflare.com/client/v4/accounts/$accountId/workers/scripts/kancolle-notify/secrets" -Method "PUT" -Body @{
            name = "DISCORD_WEBHOOK_URL"
            text = $DiscordWebhookUrl.Trim()
            type = "secret_text"
        }
    }

    if (![string]::IsNullOrWhiteSpace($TelegramBotToken) -and ![string]::IsNullOrWhiteSpace($TelegramChatId)) {
        if ([string]::IsNullOrWhiteSpace($TelegramWebhookSecret)) {
            $sBytes = New-Object byte[] 32
            $rng.GetBytes($sBytes)
            $TelegramWebhookSecret = [Convert]::ToBase64String($sBytes).Replace('+', '-').Replace('/', '_').Replace('=', '')
        }
        $null = Invoke-CfApi -Uri "https://api.cloudflare.com/client/v4/accounts/$accountId/workers/scripts/kancolle-notify/secrets" -Method "PUT" -Body @{
            name = "TELEGRAM_BOT_TOKEN"; text = $TelegramBotToken.Trim(); type = "secret_text"
        }
        $null = Invoke-CfApi -Uri "https://api.cloudflare.com/client/v4/accounts/$accountId/workers/scripts/kancolle-notify/secrets" -Method "PUT" -Body @{
            name = "TELEGRAM_CHAT_ID"; text = $TelegramChatId.Trim(); type = "secret_text"
        }
        $null = Invoke-CfApi -Uri "https://api.cloudflare.com/client/v4/accounts/$accountId/workers/scripts/kancolle-notify/secrets" -Method "PUT" -Body @{
            name = "TELEGRAM_WEBHOOK_SECRET"; text = $TelegramWebhookSecret; type = "secret_text"
        }
    }

    # サブドメインの確認
    $subdomainResp = Invoke-CfApi -Uri "https://api.cloudflare.com/client/v4/accounts/$accountId/workers/subdomain"
    $subdomain = $subdomainResp.result.subdomain
    $workerUrl = "https://kancolle-notify.$subdomain.workers.dev"

    if (![string]::IsNullOrWhiteSpace($TelegramBotToken) -and ![string]::IsNullOrWhiteSpace($TelegramChatId)) {
        $webhookBody = @{ url = "$workerUrl/webhook/telegram"; secret_token = $TelegramWebhookSecret; allowed_updates = @('message') } | ConvertTo-Json -Compress
        $null = Invoke-RestMethod -Uri "https://api.telegram.org/bot$($TelegramBotToken.Trim())/setWebhook" -Method POST -ContentType 'application/json' -Body $webhookBody
    }

    LogInfo "=================================================="
    LogInfo "セットアップ完了！"
    LogInfo "サーバーURL: $workerUrl"
    LogInfo "=================================================="

    # --- 4. 新仕様デスクトップ設定ファイル (config.json) の出力 ---
    $desktopConfig = @{
        server_url = $workerUrl
        token = $rawToken
        play_sound = $true
    } | ConvertTo-Json -Indent 2

    $cfgPath = Join-Path $desktopDir "config.json"
    Set-Content -Path $cfgPath -Value $desktopConfig -Encoding UTF8
    LogInfo "初期設定ファイルを生成しました: $cfgPath"

    return @{
        server_url = $workerUrl
        token = $rawToken
        ok = $true
    }
}
finally {
    if (Test-Path $tempDir) {
        Remove-Item -Path $tempDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}
