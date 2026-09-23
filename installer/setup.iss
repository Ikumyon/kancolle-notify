; Inno Setup 6 Script for kancolle-notify (Online Installer)
; プログラム本体を内蔵せず、実行時に GitHub から最新資材を自動ダウンロードしてセットアップします。

#define MyAppName "艦これ通知"
#define MyAppVersion "0.9.3RC"
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
Name: "{group}\{#MyAppName} 管理"; Filename: "{app}\desktop\{#MyAppExeName}"; WorkingDir: "{app}\desktop"; Check: ShouldCreateInstalledItems
Name: "{group}\拡張機能フォルダを開く"; Filename: "{app}\extension"; Check: ShouldCreateInstalledItems
Name: "{group}\アンインストール"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName} 管理"; Filename: "{app}\desktop\{#MyAppExeName}"; WorkingDir: "{app}\desktop"; Tasks: desktopicon; Check: ShouldCreateInstalledItems

[Run]
Filename: "{app}\desktop\{#MyAppExeName}"; Description: "{#MyAppName} を起動する"; Flags: postinstall nowait skipifsilent; Check: ShouldCreateInstalledItems
Filename: "explorer.exe"; Parameters: """{app}\extension"""; Description: "拡張機能フォルダをエクスプローラーで開く"; Flags: postinstall nowait skipifsilent unchecked; Check: ShouldCreateInstalledItems

[Code]
var
  SetupTypePage: TWizardPage;
  NewInstallRadio: TNewRadioButton;
  UpdateInstallRadio: TNewRadioButton;
  ConfigPage: TWizardPage;
  NoteLbl: TLabel;
  ApiTokenLabel: TLabel;
  NotifyLbl: TLabel;
  NotifyInputLabel: TLabel;
  ApiTokenEdit: TNewEdit;
  NotifyTypeCombo: TNewComboBox;
  AddNotifyButton: TNewButton;
  RemoveNotifyButton: TNewButton;
  NotifyListBox: TNewListBox;
  NotifyListLabel: TLabel;
  DiscordUrlLabel: TLabel;
  DiscordUrlEdit: TNewEdit;
  TelegramBotTokenLabel: TLabel;
  TelegramBotTokenEdit: TNewEdit;
  TelegramChatIdLabel: TLabel;
  TelegramChatIdEdit: TNewEdit;
  TelegramWebhookSecretLabel: TLabel;
  TelegramWebhookSecretEdit: TNewEdit;
  DiscordUrlValue: String;
  TelegramBotTokenValue: String;
  TelegramChatIdValue: String;
  TelegramWebhookSecretValue: String;
  LinkButton: TNewButton;

function IsUpdateMode: Boolean;
begin
  Result := UpdateInstallRadio.Checked;
end;

function IsTestMode: Boolean;
var
  Cmd: String;
begin
  Cmd := Uppercase(GetCmdTail);
  Result := Pos('/TEST', Cmd) > 0;
end;

function ExistingInstallDir(var Dir: String): Boolean;
var
  Key: String;
begin
  Key := 'Software\Microsoft\Windows\CurrentVersion\Uninstall\{D37E7459-1A3B-492F-B0D1-21B09C7C1604}_is1';
  Result := RegQueryStringValue(HKCU, Key, 'InstallLocation', Dir);
  if not Result then
    Result := RegQueryStringValue(HKLM, Key, 'InstallLocation', Dir);
end;

procedure OpenApiTokenUrl(Sender: TObject);
var
  ErrorCode: Integer;
begin
  ShellExec('open', 'https://dash.cloudflare.com/profile/api-tokens', '', '', SW_SHOWNORMAL, ewNoWait, ErrorCode);
end;

procedure RefreshNotifyInputs;
var
  IsDiscord, IsTelegram: Boolean;
begin
  IsDiscord := (NotifyTypeCombo.ItemIndex = 0) and not IsUpdateMode;
  IsTelegram := (NotifyTypeCombo.ItemIndex = 1) and not IsUpdateMode;

  NotifyLbl.Visible := not IsUpdateMode;
  NotifyTypeCombo.Visible := not IsUpdateMode;
  AddNotifyButton.Visible := not IsUpdateMode;
  RemoveNotifyButton.Visible := not IsUpdateMode;
  NotifyListLabel.Visible := not IsUpdateMode;
  NotifyListBox.Visible := not IsUpdateMode;
  NotifyInputLabel.Visible := not IsUpdateMode;
  DiscordUrlLabel.Visible := IsDiscord;
  DiscordUrlEdit.Visible := IsDiscord;
  TelegramBotTokenLabel.Visible := IsTelegram;
  TelegramBotTokenEdit.Visible := IsTelegram;
  TelegramChatIdLabel.Visible := IsTelegram;
  TelegramChatIdEdit.Visible := IsTelegram;
  TelegramWebhookSecretLabel.Visible := IsTelegram;
  TelegramWebhookSecretEdit.Visible := IsTelegram;
end;

procedure RefreshConfigPage;
begin
  if IsUpdateMode then
  begin
    ConfigPage.Caption := '更新とCloudflare確認';
    ConfigPage.Description := '既存設定を保持したまま、アプリ本体とCloudflare Workerを更新します。';
    NoteLbl.Caption := '更新では既存のD1とWorkerを確認し、Worker scriptだけを更新します。' + #13#10 +
                       'secret、Telegram webhook、config.json は変更しません。';
    ApiTokenLabel.Caption := 'Cloudflare APIトークン (既存Worker更新に使用):';
  end
  else if IsTestMode then
  begin
    ConfigPage.Caption := 'テストモード: 通知設定とCloudflare確認';
    ConfigPage.Description := '本番反映せず、セットアップ直前までの流れを確認します。';
    NoteLbl.Caption := 'テストモードです。Cloudflareはトークン検証とアカウント確認だけ行います。' + #13#10 +
                       'D1作成、Workerアップロード、シークレット登録などの変更は行いません。';
    ApiTokenLabel.Caption := 'Cloudflare APIトークン (テストでは確認のみ・変更なし):';
  end
  else
  begin
    ConfigPage.Caption := '通知設定とCloudflare連携';
    ConfigPage.Description := '通知を受け取るための情報を入力してください。';
    NoteLbl.Caption := 'Cloudflare APIトークンを入力すると、サーバーが自動構築されます。' + #13#10 +
                       '最新のプログラムおよびブラウザ拡張機能は GitHub より自動取得されます。';
    ApiTokenLabel.Caption := 'Cloudflare APIトークン (Workers/D1 編集権限):';
  end;

  RefreshNotifyInputs;
end;

procedure ConfigPageActivate(Sender: TObject);
begin
  RefreshConfigPage;
end;

procedure NotifyTypeChanged(Sender: TObject);
begin
  RefreshNotifyInputs;
end;

procedure RefreshNotifyList;
begin
  NotifyListBox.Items.Clear;
  if DiscordUrlValue <> '' then
    NotifyListBox.Items.Add('Discord');
  if (TelegramBotTokenValue <> '') and (TelegramChatIdValue <> '') then
    NotifyListBox.Items.Add('Telegram');
end;

procedure AddNotifyClicked(Sender: TObject);
begin
  if NotifyTypeCombo.ItemIndex = 0 then
  begin
    DiscordUrlValue := Trim(DiscordUrlEdit.Text);
    if DiscordUrlValue = '' then
    begin
      MsgBox('Discord Webhook URL を入力してください。', mbInformation, MB_OK);
      exit;
    end;
  end
  else
  begin
    TelegramBotTokenValue := Trim(TelegramBotTokenEdit.Text);
    TelegramChatIdValue := Trim(TelegramChatIdEdit.Text);
    TelegramWebhookSecretValue := Trim(TelegramWebhookSecretEdit.Text);
    if (TelegramBotTokenValue = '') or (TelegramChatIdValue = '') then
    begin
      MsgBox('Telegram Bot Token と Chat ID を入力してください。', mbInformation, MB_OK);
      exit;
    end;
  end;

  RefreshNotifyList;
end;

procedure RemoveNotifyClicked(Sender: TObject);
var
  Selected: String;
begin
  if NotifyListBox.ItemIndex < 0 then
    exit;

  Selected := NotifyListBox.Items[NotifyListBox.ItemIndex];
  if Selected = 'Discord' then
    DiscordUrlValue := ''
  else if Selected = 'Telegram' then
  begin
    TelegramBotTokenValue := '';
    TelegramChatIdValue := '';
    TelegramWebhookSecretValue := '';
  end;

  RefreshNotifyList;
end;

procedure InitializeWizard;
var
  ExistingDir: String;
begin
  SetupTypePage := CreateCustomPage(wpWelcome,
    'セットアップ方法',
    '新規セットアップか、既存環境の更新かを選択してください。');

  NewInstallRadio := TNewRadioButton.Create(WizardForm);
  NewInstallRadio.Parent := SetupTypePage.Surface;
  NewInstallRadio.Left := ScaleX(0);
  NewInstallRadio.Top := ScaleY(8);
  NewInstallRadio.Width := ScaleX(420);
  NewInstallRadio.Caption := '新規セットアップ';

  UpdateInstallRadio := TNewRadioButton.Create(WizardForm);
  UpdateInstallRadio.Parent := SetupTypePage.Surface;
  UpdateInstallRadio.Left := ScaleX(0);
  UpdateInstallRadio.Top := ScaleY(36);
  UpdateInstallRadio.Width := ScaleX(420);
  UpdateInstallRadio.Caption := '更新';

  if ExistingInstallDir(ExistingDir) then
  begin
    UpdateInstallRadio.Checked := True;
    WizardForm.DirEdit.Text := ExistingDir;
  end
  else
    NewInstallRadio.Checked := True;

  if IsTestMode then
  begin
    WizardForm.Caption := '{#MyAppName} {#MyAppVersion} テストモード セットアップ';
    ConfigPage := CreateCustomPage(wpSelectDir,
      'テストモード: 通知設定とCloudflare確認',
      '本番反映せず、セットアップ直前までの流れを確認します。');
  end
  else
  begin
    ConfigPage := CreateCustomPage(wpSelectDir,
      '通知設定とCloudflare連携',
      '通知を受け取るための情報を入力してください。');
  end;
  ConfigPage.OnActivate := @ConfigPageActivate;

  NoteLbl := TLabel.Create(WizardForm);
  NoteLbl.Parent := ConfigPage.Surface;
  NoteLbl.Left := ScaleX(0);
  NoteLbl.Top := ScaleY(0);
  NoteLbl.Width := ScaleX(400);
  if IsTestMode then
    NoteLbl.Caption := 'テストモードです。Cloudflareはトークン検証とアカウント確認だけ行います。' + #13#10 +
                       'D1作成、Workerアップロード、シークレット登録などの変更は行いません。'
  else
    NoteLbl.Caption := 'Cloudflare APIトークンを入力すると、サーバーが自動構築されます。' + #13#10 +
                       '最新のプログラムおよびブラウザ拡張機能は GitHub より自動取得されます。';

  ApiTokenLabel := TLabel.Create(WizardForm);
  ApiTokenLabel.Parent := ConfigPage.Surface;
  ApiTokenLabel.Left := ScaleX(0);
  ApiTokenLabel.Top := ScaleY(42);
  if IsTestMode then
    ApiTokenLabel.Caption := 'Cloudflare APIトークン (テストでは確認のみ・変更なし):'
  else
    ApiTokenLabel.Caption := 'Cloudflare APIトークン (Workers/D1 編集権限):';

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

  NotifyLbl := TLabel.Create(WizardForm);
  NotifyLbl.Parent := ConfigPage.Surface;
  NotifyLbl.Left := ScaleX(0);
  NotifyLbl.Top := ScaleY(98);
  NotifyLbl.Caption := '通知先を追加 (任意):';

  NotifyTypeCombo := TNewComboBox.Create(WizardForm);
  NotifyTypeCombo.Parent := ConfigPage.Surface;
  NotifyTypeCombo.Left := ScaleX(0);
  NotifyTypeCombo.Top := ScaleY(116);
  NotifyTypeCombo.Width := ScaleX(160);
  NotifyTypeCombo.Style := csDropDownList;
  NotifyTypeCombo.Items.Add('Discord');
  NotifyTypeCombo.Items.Add('Telegram');
  NotifyTypeCombo.ItemIndex := 0;
  NotifyTypeCombo.OnChange := @NotifyTypeChanged;

  AddNotifyButton := TNewButton.Create(WizardForm);
  AddNotifyButton.Parent := ConfigPage.Surface;
  AddNotifyButton.Left := ScaleX(170);
  AddNotifyButton.Top := ScaleY(114);
  AddNotifyButton.Width := ScaleX(85);
  AddNotifyButton.Height := ScaleY(26);
  AddNotifyButton.Caption := '追加';
  AddNotifyButton.OnClick := @AddNotifyClicked;

  RemoveNotifyButton := TNewButton.Create(WizardForm);
  RemoveNotifyButton.Parent := ConfigPage.Surface;
  RemoveNotifyButton.Left := ScaleX(265);
  RemoveNotifyButton.Top := ScaleY(114);
  RemoveNotifyButton.Width := ScaleX(85);
  RemoveNotifyButton.Height := ScaleY(26);
  RemoveNotifyButton.Caption := '削除';
  RemoveNotifyButton.OnClick := @RemoveNotifyClicked;

  NotifyListBox := TNewListBox.Create(WizardForm);
  NotifyListBox.Parent := ConfigPage.Surface;
  NotifyListBox.Left := ScaleX(360);
  NotifyListBox.Top := ScaleY(134);
  NotifyListBox.Width := ScaleX(120);
  NotifyListBox.Height := ScaleY(86);

  NotifyListLabel := TLabel.Create(WizardForm);
  NotifyListLabel.Parent := ConfigPage.Surface;
  NotifyListLabel.Left := ScaleX(360);
  NotifyListLabel.Top := ScaleY(116);
  NotifyListLabel.Caption := '追加済み:';

  NotifyInputLabel := TLabel.Create(WizardForm);
  NotifyInputLabel.Parent := ConfigPage.Surface;
  NotifyInputLabel.Left := ScaleX(0);
  NotifyInputLabel.Top := ScaleY(150);
  NotifyInputLabel.Caption := '選択した通知先の設定:';

  DiscordUrlLabel := TLabel.Create(WizardForm);
  DiscordUrlLabel.Parent := ConfigPage.Surface;
  DiscordUrlLabel.Left := ScaleX(0);
  DiscordUrlLabel.Top := ScaleY(170);
  DiscordUrlLabel.Caption := 'Discord Webhook URL:';

  DiscordUrlEdit := TNewEdit.Create(WizardForm);
  DiscordUrlEdit.Parent := ConfigPage.Surface;
  DiscordUrlEdit.Left := ScaleX(0);
  DiscordUrlEdit.Top := ScaleY(188);
  DiscordUrlEdit.Width := ScaleX(340);

  TelegramBotTokenLabel := TLabel.Create(WizardForm);
  TelegramBotTokenLabel.Parent := ConfigPage.Surface;
  TelegramBotTokenLabel.Left := ScaleX(0);
  TelegramBotTokenLabel.Top := ScaleY(170);
  TelegramBotTokenLabel.Caption := 'Telegram Bot Token:';

  TelegramBotTokenEdit := TNewEdit.Create(WizardForm);
  TelegramBotTokenEdit.Parent := ConfigPage.Surface;
  TelegramBotTokenEdit.Left := ScaleX(0);
  TelegramBotTokenEdit.Top := ScaleY(188);
  TelegramBotTokenEdit.Width := ScaleX(340);

  TelegramChatIdLabel := TLabel.Create(WizardForm);
  TelegramChatIdLabel.Parent := ConfigPage.Surface;
  TelegramChatIdLabel.Left := ScaleX(0);
  TelegramChatIdLabel.Top := ScaleY(218);
  TelegramChatIdLabel.Caption := 'Telegram Chat ID:';

  TelegramChatIdEdit := TNewEdit.Create(WizardForm);
  TelegramChatIdEdit.Parent := ConfigPage.Surface;
  TelegramChatIdEdit.Left := ScaleX(0);
  TelegramChatIdEdit.Top := ScaleY(236);
  TelegramChatIdEdit.Width := ScaleX(340);

  TelegramWebhookSecretLabel := TLabel.Create(WizardForm);
  TelegramWebhookSecretLabel.Parent := ConfigPage.Surface;
  TelegramWebhookSecretLabel.Left := ScaleX(0);
  TelegramWebhookSecretLabel.Top := ScaleY(266);
  TelegramWebhookSecretLabel.Caption := 'Telegram Webhook Secret (任意):';

  TelegramWebhookSecretEdit := TNewEdit.Create(WizardForm);
  TelegramWebhookSecretEdit.Parent := ConfigPage.Surface;
  TelegramWebhookSecretEdit.Left := ScaleX(0);
  TelegramWebhookSecretEdit.Top := ScaleY(284);
  TelegramWebhookSecretEdit.Width := ScaleX(340);

  RefreshNotifyInputs;
end;

function ShouldCreateInstalledItems: Boolean;
begin
  Result := True;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  ApiToken: String;
  Params: String;
  Mode: String;
  ResultCode: Integer;
begin
  if CurStep = ssPostInstall then
  begin
    ApiToken := Trim(ApiTokenEdit.Text);

    if IsTestMode then
      Mode := 'Test'
    else if IsUpdateMode then
      Mode := 'Update'
    else
      Mode := 'Full';

    if Mode = 'Test' then
      WizardForm.StatusLabel.Caption := 'テストモードでセットアップを確認中...'
    else if Mode = 'Update' then
      WizardForm.StatusLabel.Caption := '最新プログラムを取得し、既存環境を更新中...'
    else
      WizardForm.StatusLabel.Caption := 'GitHub から最新プログラムを取得し、セットアップ中...';

    Params := Format('-ExecutionPolicy Bypass -NoProfile -File "%s\deploy-online.ps1" -Mode "%s" -ApiToken "%s" -DiscordWebhookUrl "%s" -TelegramBotToken "%s" -TelegramChatId "%s" -TelegramWebhookSecret "%s" -InstallDir "%s"', [
      ExpandConstant('{tmp}'),
      Mode,
      ApiToken,
      DiscordUrlValue,
      TelegramBotTokenValue,
      TelegramChatIdValue,
      TelegramWebhookSecretValue,
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
