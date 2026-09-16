# Inno Setup Compiler Runner for kancolle-notify
# インストーラーEXE (dist-installer\kancolle-notify-setup.exe) をビルドします。

$ErrorActionPreference = "Stop"

$isccPaths = @(
    "C:\Program Files (x86)\Inno Setup 6\ISCC.exe",
    "C:\Program Files\Inno Setup 6\ISCC.exe",
    (Get-Command ISCC.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source)
)

$iscc = $isccPaths | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1

if (!$iscc) {
    Write-Host "[ERROR] Inno Setup 6 (ISCC.exe) が見つかりませんでした。" -ForegroundColor Red
    Write-Host "Inno Setup 6 をインストールするか、ISCC.exe にPATHを通してください。"
    Write-Host "公式サイト: https://jrsoftware.org/isdl.php"
    exit 1
}

$issFile = Join-Path $PSScriptRoot "setup.iss"
Write-Host "[kancolle-installer] Compiling installer using: $iscc"
& $iscc $issFile

if ($LASTEXITCODE -eq 0) {
    Write-Host "[SUCCESS] インストーラーのビルドが完了しました！" -ForegroundColor Green
    Write-Host "出力先: dist-installer\kancolle-notify-setup.exe"
} else {
    Write-Host "[ERROR] インストーラーのコンパイルに失敗しました。" -ForegroundColor Red
    exit $LASTEXITCODE
}
