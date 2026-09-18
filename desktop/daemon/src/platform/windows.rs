use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use windows_sys::Win32::Foundation::{
    CloseHandle, ERROR_INVALID_PARAMETER, GetLastError, WAIT_OBJECT_0, WAIT_TIMEOUT,
};
use windows_sys::Win32::System::Threading::{
    OpenProcess, PROCESS_SYNCHRONIZE, WaitForSingleObject,
};
use winrt_notification::{Duration, IconCrop, Sound, Toast};

const CREATE_NO_WINDOW: u32 = 0x08000000;
const DETACHED_PROCESS: u32 = 0x00000008;
const CREATE_NEW_PROCESS_GROUP: u32 = 0x00000200;
const AUMID_KEY: &str = r"HKCU\Software\Classes\AppUserModelId\kancolle.notify";
const AUMID: &str = "kancolle.notify";
const APP_DISPLAY_NAME: &str = "艦これ通知";

const ICON_EXPEDITION: &[u8] = include_bytes!("../../../icons/expedition.png");
const ICON_REPAIR: &[u8] = include_bytes!("../../../icons/repair.png");
const ICON_BUILD: &[u8] = include_bytes!("../../../icons/build.png");
const ICON_FATIGUE: &[u8] = include_bytes!("../../../icons/fatigue.png");
const ICON_AKASHI: &[u8] = include_bytes!("../../../icons/akashi.png");
const ICON_DEFAULT: &[u8] = include_bytes!("../../../icons/default.png");

fn get_base_dir() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."))
}

pub fn ensure_icons_dir() -> PathBuf {
    let base = get_base_dir();
    let icons_dir = base.join("icons");
    let _ = std::fs::create_dir_all(&icons_dir);

    let templates: &[(&str, &[u8])] = &[
        ("expedition.png", ICON_EXPEDITION),
        ("repair.png", ICON_REPAIR),
        ("build.png", ICON_BUILD),
        ("fatigue.png", ICON_FATIGUE),
        ("akashi.png", ICON_AKASHI),
        ("default.png", ICON_DEFAULT),
    ];

    for (name, bytes) in templates {
        let p = icons_dir.join(name);
        if !p.exists() {
            let _ = std::fs::write(&p, bytes);
        }
    }

    icons_dir
}

pub fn find_icon_path(kind: Option<&str>) -> Option<PathBuf> {
    let base = get_base_dir();
    let icons_dir = ensure_icons_dir();

    if let Some(k) = kind {
        for ext in &["png", "ico", "jpg"] {
            let p = icons_dir.join(format!("{}.{}", k, ext));
            if p.exists() {
                return Some(p);
            }
        }
    }

    // デフォルトまたはアプリアイコンへのフォールバック
    for candidate in &[
        icons_dir.join("default.png"),
        icons_dir.join("app.png"),
        icons_dir.join("app.ico"),
        base.join("icon.ico"),
        base.join("icon.png"),
    ] {
        if candidate.exists() {
            return Some(candidate.clone());
        }
    }

    None
}

pub fn enable_custom_appid() -> Result<(), String> {
    let base = get_base_dir();
    let icon_path = find_icon_path(None)
        .or_else(|| {
            let exe = base.join("kancolle-gui.exe");
            if exe.exists() { Some(exe) } else { None }
        })
        .unwrap_or_else(|| {
            std::env::current_exe().unwrap_or_else(|_| base.join("kancolle-daemon.exe"))
        });

    let res_name = Command::new("reg")
        .args(["add", AUMID_KEY, "/v", "DisplayName", "/t", "REG_SZ", "/d", APP_DISPLAY_NAME, "/f"])
        .creation_flags(CREATE_NO_WINDOW)
        .output();

    match res_name {
        Ok(out) if out.status.success() => {},
        Ok(out) => return Err(format!("reg add DisplayName failed: {}", String::from_utf8_lossy(&out.stderr))),
        Err(e) => return Err(format!("Failed to execute reg.exe: {}", e)),
    }

    let res_icon = Command::new("reg")
        .args(["add", AUMID_KEY, "/v", "IconUri", "/t", "REG_SZ", "/d", &icon_path.to_string_lossy(), "/f"])
        .creation_flags(CREATE_NO_WINDOW)
        .output();

    match res_icon {
        Ok(out) if out.status.success() => Ok(()),
        Ok(out) => Err(format!("reg add IconUri failed: {}", String::from_utf8_lossy(&out.stderr))),
        Err(e) => Err(format!("Failed to execute reg.exe: {}", e)),
    }
}

pub fn disable_custom_appid() -> Result<(), String> {
    let res = Command::new("reg")
        .args(["delete", AUMID_KEY, "/f"])
        .creation_flags(CREATE_NO_WINDOW)
        .output();

    match res {
        Ok(out) if out.status.success() => Ok(()),
        Ok(out) => {
            let stderr = String::from_utf8_lossy(&out.stderr);
            if stderr.is_empty() || stderr.contains("not find") || stderr.contains("見つかりません") {
                Ok(())
            } else {
                Err(format!("reg delete failed: {}", stderr))
            }
        }
        Err(e) => Err(format!("Failed to execute reg.exe: {}", e)),
    }
}

pub fn is_custom_appid_enabled() -> Result<bool, String> {
    let res = Command::new("reg")
        .args(["query", AUMID_KEY, "/v", "DisplayName"])
        .creation_flags(CREATE_NO_WINDOW)
        .output();

    match res {
        Ok(out) if out.status.success() => Ok(true),
        Ok(_) => Ok(false),
        Err(e) => Err(format!("Failed to execute reg.exe: {}", e)),
    }
}

pub fn show_notification(
    title: &str,
    message: &str,
    play_sound: bool,
    icon_kind: Option<&str>,
) -> Result<(), String> {
    let is_custom = is_custom_appid_enabled().unwrap_or(false);
    let app_id = if is_custom {
        AUMID
    } else {
        Toast::POWERSHELL_APP_ID
    };

    let mut toast = Toast::new(app_id)
        .title(title)
        .text1(message)
        .duration(Duration::Short);

    if play_sound {
        toast = toast.sound(Some(Sound::Default));
    }

    if let Some(icon_path) = find_icon_path(icon_kind) {
        toast = toast.icon(&icon_path, IconCrop::Square, "icon");
    }

    toast
        .show()
        .map_err(|e| format!("WinRT notification failed: {}", e))
}

pub fn test_notification(kind: Option<&str>) -> Result<(), String> {
    let kind_name = match kind {
        Some("expedition") => "遠征帰投",
        Some("repair") => "入渠完了",
        Some("build") => "建造完了",
        Some("fatigue") => "疲労回復",
        Some("akashi") => "泊地修理",
        Some("manual") => "手動タイマー",
        Some(k) => k,
        None => "基本通知",
    };
    show_notification(
        &format!("【艦これ通知】動作テスト ({})", kind_name),
        &format!(
            "デスクトップ通知のテストです。アイコンと通知名を確認してください。（種別: {}）",
            kind.unwrap_or("default")
        ),
        true,
        kind,
    )
}

pub fn is_process_running(pid: u32) -> Result<bool, String> {
    unsafe {
        let handle = OpenProcess(PROCESS_SYNCHRONIZE, 0, pid);
        if handle == 0 {
            let error = GetLastError();
            return if error == ERROR_INVALID_PARAMETER {
                Ok(false)
            } else {
                Err(format!(
                    "Cannot query PID {} (Windows error {})",
                    pid, error
                ))
            };
        }
        let result = WaitForSingleObject(handle, 0);
        let error = GetLastError();
        CloseHandle(handle);
        match result {
            WAIT_TIMEOUT => Ok(true),
            WAIT_OBJECT_0 => Ok(false),
            _ => Err(format!(
                "Cannot query PID {} (Windows error {})",
                pid, error
            )),
        }
    }
}

pub fn stop_process(pid: u32) -> Result<(), String> {
    let res = Command::new("taskkill")
        .args(["/F", "/PID", &pid.to_string()])
        .output();

    match res {
        Ok(out) if out.status.success() => Ok(()),
        Ok(out) => Err(format!(
            "taskkill failed: {}",
            String::from_utf8_lossy(&out.stderr)
        )),
        Err(e) => Err(format!("Failed to execute taskkill: {}", e)),
    }
}

pub fn start_daemon_detached() -> Result<u32, String> {
    let exe = std::env::current_exe().map_err(|e| format!("Cannot find current exe: {}", e))?;
    let base_dir = exe.parent().unwrap_or_else(|| std::path::Path::new("."));

    let child = Command::new(&exe)
        .arg("run")
        .current_dir(base_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .creation_flags(CREATE_NO_WINDOW | DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP)
        .env_remove("_MEIPASS2")
        .env_remove("_MEIPASS")
        .spawn()
        .map_err(|e| format!("Failed to spawn daemon process: {}", e))?;

    Ok(child.id())
}

const REG_KEY: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
const REG_VALUE: &str = "KancolleNotifyDaemon";

pub fn enable_autostart() -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| format!("Cannot find current exe: {}", e))?;
    let cmd_str = format!("\"{}\" start", exe.to_string_lossy());

    let res = Command::new("reg")
        .args(["add", REG_KEY, "/v", REG_VALUE, "/t", "REG_SZ", "/d", &cmd_str, "/f"])
        .creation_flags(CREATE_NO_WINDOW)
        .output();

    match res {
        Ok(out) if out.status.success() => Ok(()),
        Ok(out) => Err(format!(
            "reg add failed: {}",
            String::from_utf8_lossy(&out.stderr)
        )),
        Err(e) => Err(format!("Failed to execute reg.exe: {}", e)),
    }
}

pub fn disable_autostart() -> Result<(), String> {
    let res = Command::new("reg")
        .args(["delete", REG_KEY, "/v", REG_VALUE, "/f"])
        .creation_flags(CREATE_NO_WINDOW)
        .output();

    match res {
        Ok(out) if out.status.success() => Ok(()),
        Ok(out) => {
            let stderr = String::from_utf8_lossy(&out.stderr);
            if stderr.is_empty() || stderr.contains("not find") || stderr.contains("見つかりません") {
                Ok(())
            } else {
                Err(format!("reg delete failed: {}", stderr))
            }
        }
        Err(e) => Err(format!("Failed to execute reg.exe: {}", e)),
    }
}

pub fn is_autostart_enabled() -> Result<bool, String> {
    let res = Command::new("reg")
        .args(["query", REG_KEY, "/v", REG_VALUE])
        .creation_flags(CREATE_NO_WINDOW)
        .output();

    match res {
        Ok(out) if out.status.success() => Ok(true),
        Ok(_) => Ok(false),
        Err(e) => Err(format!("Failed to execute reg.exe: {}", e)),
    }
}
