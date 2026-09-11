$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$telegramSecret = Read-Host 'Bot token (hidden)' -AsSecureString
$telegramCredential = [System.Management.Automation.PSCredential]::new('bot', $telegramSecret)
$telegramToken = $telegramCredential.GetNetworkCredential().Password
try {
    if ($telegramToken -notmatch '^\d+:[A-Za-z0-9_-]+$') {
        Write-Host 'Invalid token format.'
        exit 1
    }
    $telegramResponse = Invoke-RestMethod -Method Post -Uri ('https://api.telegram.org/bot' + $telegramToken + '/getUpdates') -ContentType 'application/json' -Body '{"timeout":0}' -TimeoutSec 20
    if (-not $telegramResponse.ok) {
        Write-Host 'Telegram request failed.'
        exit 1
    }
    $telegramChatIds = @($telegramResponse.result | Where-Object { $_.message.chat.type -eq 'private' -and $_.message.text -match '^/start(?:\s|$)' } | ForEach-Object { $_.message.chat.id } | Sort-Object -Unique)
    if ($telegramChatIds.Count -eq 0) {
        Write-Host 'No private /start found. Send /start to your bot and run again.'
    } else {
        Write-Host 'Private chat IDs:'
        $telegramChatIds | ForEach-Object { Write-Host $_ }
    }
} catch {
    # Do not print the exception: PowerShell may include the token-bearing request URL.
    Write-Host 'Could not read Telegram updates. Check the token and connection. An existing webhook or another bot receiver can also prevent this lookup.'
    exit 1
} finally {
    $telegramToken = $null
    $telegramCredential = $null
    $telegramSecret.Dispose()
}
