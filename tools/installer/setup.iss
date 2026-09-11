; Inno Setup 6 Script for kancolle-notify
; 利用者はNode.js不要で、このインストーラーを実行するだけで全環境が整います。

#define MyAppName "艦これ通知"
#define MyAppVersion "0.4.0"
#define MyAppPublisher "kancolle-notify"
#define MyAppURL "https://github.com/Ikumyon/kancolle-notify"
#define MyAppExeName "kancolle-gui.exe"

[Setup]
AppId={{D37E7459-1A3B-492F-B0D1-21B09C7C1604}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
DefaultDirName={localappdata}\kancolle-notify
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
OutputDir=..\..\dist-installer
OutputBaseFilename=kancolle-notify-setup
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=lowest
ArchitecturesInstallIn64BitMode=x64

[Languages]
Name: "japanese"; MessagesFile: "compiler:Languages\Japanese.isl"

[Tasks]
Name: "desktopicon"; Description: "デスクトップにショートカットを作成する"; GroupDescription: "追加アイコン:"; Flags: checkedonce

[Files]
; デスクトップ常駐通知バイナリ
Source: "..\..\desktop\dist\kancolle-gui.exe"; DestDir: "{app}\desktop"; Flags: ignoreversion
Source: "..\..\desktop\dist\kancolle-daemon.exe"; DestDir: "{app}\desktop"; Flags: ignoreversion

; ブラウザ拡張機能ファイル一式
Source: "..\..\extension\*"; DestDir: "{app}\extension"; Flags: ignoreversion recursesubdirs createallsubdirs

; Cloudflare デプロイ用ファイル
Source: "bundled-worker.js"; DestDir: "{app}\installer"; Flags: ignoreversion
Source: "cf-deploy.ps1"; DestDir: "{app}\installer"; Flags: ignoreversion
Source: "..\..\server\schema.sql"; DestDir: "{app}\installer"; Flags: ignoreversion

[Icons]
Name: "{group}\{#MyAppName} 時刻表"; Filename: "{app}\desktop\{#MyAppExeName}"; WorkingDir: "{app}\desktop"
Name: "{group}\拡張機能フォルダを開く"; Filename: "{app}\extension"
Name: "{group}\アンインストール"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName} 時刻表"; Filename: "{app}\desktop\{#MyAppExeName}"; WorkingDir: "{app}\desktop"; Tasks: desktopicon

[Run]
Filename: "{app}\desktop\{#MyAppExeName}"; Description: "{#MyAppName} を起動する"; Flags: postinstall nowait skipifsilent

[Code]
var
  ConfigPage: TWizardPage;
  ApiTokenEdit: TNewEdit;
  DiscordUrlEdit: TNewEdit;
  LinkButton: TNewButton;

procedure OpenApiTokenUrl(Sender: TObject);
var
  ErrorCode: Integer;
begin
  ShellExec('open', 'https://dash.cloudflare.com/profile/api-tokens', '', '', SW_SHOWNORMAL, ewNoWait, ErrorCode);
end;

procedure InitializeWizard;
var
  Lbl1, Lbl2, NoteLbl: TLabel;
begin
  // カスタム設定入力ページを作成
  ConfigPage := CreateCustomPage(wpSelectDir,
    '通知設定とCloudflare連携',
    '通知を受け取るための情報を入力してください。');

  NoteLbl := TLabel.Create(WizardForm);
  NoteLbl.Parent := ConfigPage.Surface;
  NoteLbl.Left := ScaleX(0);
  NoteLbl.Top := ScaleY(0);
  NoteLbl.Width := ScaleX(400);
  NoteLbl.Caption := 'Cloudflare APIトークンを入力すると、サーバーが自動構築されます。' + #13#10 +
                     '（スキップして後から手動設定することも可能です）';

  // Cloudflare API Token
  Lbl1 := TLabel.Create(WizardForm);
  Lbl1.Parent := ConfigPage.Surface;
  Lbl1.Left := ScaleX(0);
  Lbl1.Top := ScaleY(40);
  Lbl1.Caption := 'Cloudflare APIトークン (Workers編集権限):';

  ApiTokenEdit := TNewEdit.Create(WizardForm);
  ApiTokenEdit.Parent := ConfigPage.Surface;
  ApiTokenEdit.Left := ScaleX(0);
  ApiTokenEdit.Top := ScaleY(58);
  ApiTokenEdit.Width := ScaleX(320);

  LinkButton := TNewButton.Create(WizardForm);
  LinkButton.Parent := ConfigPage.Surface;
  LinkButton.Left := ScaleX(330);
  LinkButton.Top := ScaleY(56);
  LinkButton.Width := ScaleX(85);
  LinkButton.Height := ScaleY(26);
  LinkButton.Caption := 'トークン発行...';
  LinkButton.OnClick := @OpenApiTokenUrl;

  // Discord Webhook URL
  Lbl2 := TLabel.Create(WizardForm);
  Lbl2.Parent := ConfigPage.Surface;
  Lbl2.Left := ScaleX(0);
  Lbl2.Top := ScaleY(95);
  Lbl2.Caption := 'Discord Webhook URL (通知先チャンネルのURL):';

  DiscordUrlEdit := TNewEdit.Create(WizardForm);
  DiscordUrlEdit.Parent := ConfigPage.Surface;
  DiscordUrlEdit.Left := ScaleX(0);
  DiscordUrlEdit.Top := ScaleY(113);
  DiscordUrlEdit.Width := ScaleX(415);
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  ApiToken, DiscordUrl: String;
  Params: String;
  ResultCode: Integer;
begin
  if CurStep = ssPostInstall then
  begin
    ApiToken := Trim(ApiTokenEdit.Text);
    DiscordUrl := Trim(DiscordUrlEdit.Text);

    if ApiToken <> '' then
    begin
      WizardForm.StatusLabel.Caption := 'Cloudflare サーバーを自動デプロイ中...';
      
      Params := Format('-ExecutionPolicy Bypass -NoProfile -File "%s\installer\cf-deploy.ps1" -ApiToken "%s" -DiscordWebhookUrl "%s" -ScriptDir "%s\installer" -OutputDir "%s\desktop"', [
        ExpandConstant('{app}'),
        ApiToken,
        DiscordUrl,
        ExpandConstant('{app}'),
        ExpandConstant('{app}')
      ]);

      if not Exec('powershell.exe', Params, ExpandConstant('{app}\installer'), SW_HIDE, ewWaitUntilTerminated, ResultCode) or (ResultCode <> 0) then
      begin
        MsgBox('Cloudflareへのデプロイ中に問題が発生しました。APIトークンを確認してください。' + #13#10 +
               '後からでも desktop\config.json を直接設定可能です。', mbInformation, MB_OK);
      end;
    end;
  end;
end;
