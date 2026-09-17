; Inno Setup 6 Script for kancolle-notify (Online Installer)
; プログラム本体を内蔵せず、実行時に GitHub から最新資材を自動ダウンロードしてセットアップします。

#define MyAppName "艦これ通知"
#define MyAppVersion "0.9.2-beta"
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
DefaultDirName={src}\kancolle-notify
DisableDirPage=no
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
OutputDir=..\dist-installer
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
; デプロイ用スクリプトのみを同梱（本体バイナリはGitHubから自動ダウンロード）
Source: "deploy-online.ps1"; DestDir: "{tmp}"; Flags: ignoreversion

[Icons]
Name: "{group}\{#MyAppName} 管理"; Filename: "{app}\desktop\{#MyAppExeName}"; WorkingDir: "{app}\desktop"
Name: "{group}\拡張機能フォルダを開く"; Filename: "{app}\extension"
Name: "{group}\アンインストール"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName} 管理"; Filename: "{app}\desktop\{#MyAppExeName}"; WorkingDir: "{app}\desktop"; Tasks: desktopicon

[Run]
Filename: "{app}\desktop\{#MyAppExeName}"; Description: "{#MyAppName} を起動する"; Flags: postinstall nowait skipifsilent
Filename: "explorer.exe"; Parameters: """{app}\extension"""; Description: "拡張機能フォルダをエクスプローラーで開く"; Flags: postinstall nowait skipifsilent unchecked

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
  ConfigPage := CreateCustomPage(wpSelectDir,
    '通知設定とCloudflare連携',
    '通知を受け取るための情報を入力してください。');

  NoteLbl := TLabel.Create(WizardForm);
  NoteLbl.Parent := ConfigPage.Surface;
  NoteLbl.Left := ScaleX(0);
  NoteLbl.Top := ScaleY(0);
  NoteLbl.Width := ScaleX(400);
  NoteLbl.Caption := 'Cloudflare APIトークンを入力すると、サーバーが自動構築されます。' + #13#10 +
                     '最新のプログラムおよびブラウザ拡張機能は GitHub より自動取得されます。';

  // Cloudflare API Token
  Lbl1 := TLabel.Create(WizardForm);
  Lbl1.Parent := ConfigPage.Surface;
  Lbl1.Left := ScaleX(0);
  Lbl1.Top := ScaleY(42);
  Lbl1.Caption := 'Cloudflare APIトークン (Workers/D1 編集権限):';

  ApiTokenEdit := TNewEdit.Create(WizardForm);
  ApiTokenEdit.Parent := ConfigPage.Surface;
  ApiTokenEdit.Left := ScaleX(0);
  ApiTokenEdit.Top := ScaleY(60);
  ApiTokenEdit.Width := ScaleX(320);

  LinkButton := TNewButton.Create(WizardForm);
  LinkButton.Parent := ConfigPage.Surface;
  LinkButton.Left := ScaleX(330);
  LinkButton.Top := ScaleY(58);
  LinkButton.Width := ScaleX(85);
  LinkButton.Height := ScaleY(26);
  LinkButton.Caption := 'トークン発行...';
  LinkButton.OnClick := @OpenApiTokenUrl;

  // Discord Webhook URL
  Lbl2 := TLabel.Create(WizardForm);
  Lbl2.Parent := ConfigPage.Surface;
  Lbl2.Left := ScaleX(0);
  Lbl2.Top := ScaleY(98);
  Lbl2.Caption := 'Discord Webhook URL (任意・通知先チャンネルのURL):';

  DiscordUrlEdit := TNewEdit.Create(WizardForm);
  DiscordUrlEdit.Parent := ConfigPage.Surface;
  DiscordUrlEdit.Left := ScaleX(0);
  DiscordUrlEdit.Top := ScaleY(116);
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

    WizardForm.StatusLabel.Caption := 'GitHub から最新プログラムを取得し、セットアップ中...';

    Params := Format('-ExecutionPolicy Bypass -NoProfile -File "%s\deploy-online.ps1" -ApiToken "%s" -DiscordWebhookUrl "%s" -InstallDir "%s"', [
      ExpandConstant('{tmp}'),
      ApiToken,
      DiscordUrl,
      ExpandConstant('{app}')
    ]);

    if not Exec('powershell.exe', Params, ExpandConstant('{tmp}'), SW_HIDE, ewWaitUntilTerminated, ResultCode) or (ResultCode <> 0) then
    begin
      MsgBox('セットアップまたはCloudflareへのデプロイ中に問題が発生しました。' + #13#10 +
             'APIトークンやネットワーク接続を確認してください。' + #13#10 +
             '後からでも設定可能です。', mbInformation, MB_OK);
    end;
  end;
end;
