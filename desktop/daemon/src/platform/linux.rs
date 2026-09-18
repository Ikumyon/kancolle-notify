use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

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
    icons_dir
}

pub fn ensure_sounds_dir() -> PathBuf {
    let base = get_base_dir();
    let sounds_dir = base.join("sounds");
    let _ = std::fs::create_dir_all(&sounds_dir);
    sounds_dir
}

pub fn find_sound_path(kind: Option<&str>) -> Option<PathBuf> {
    let base = get_base_dir();
    let sounds_dir = ensure_sounds_dir();

    if let Some(k) = kind {
        for ext in &["wav", "WAV"] {
            let p = sounds_dir.join(format!("{}.{}", k, ext));
            if p.exists() {
                return Some(p);
            }
        }
    }

    for candidate in &[
        sounds_dir.join("default.wav"),
        sounds_dir.join("default.WAV"),
        base.join("default.wav"),
    ] {
        if candidate.exists() {
            return Some(candidate.clone());
        }
    }

    None
}

pub fn play_sound_file(path: &Path) {
    let players = ["pw-play", "paplay", "aplay", "canberra-gtk-play"];
    for player in &players {
        let mut cmd = Command::new(player);
        if *player == "canberra-gtk-play" {
            cmd.arg("-f");
        }
        cmd.arg(path)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());

        if let Ok(mut child) = cmd.spawn() {
            std::thread::spawn(move || {
                let _ = child.wait();
            });
            break;
        }
    }
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

    for candidate in &[
        icons_dir.join("default.png"),
        icons_dir.join("app.png"),
        base.join("icon.png"),
    ] {
        if candidate.exists() {
            return Some(candidate.clone());
        }
    }

    None
}

pub fn enable_custom_appid() -> Result<(), String> {
    Ok(()) // LinuxではAUMID不要
}

pub fn disable_custom_appid() -> Result<(), String> {
    Ok(())
}

pub fn is_custom_appid_enabled() -> Result<bool, String> {
    Ok(true)
}

pub fn show_notification(
    title: &str,
    message: &str,
    play_sound: bool,
    icon_kind: Option<&str>,
) -> Result<(), String> {
    let mut notification = notify_rust::Notification::new();
    notification
        .summary(title)
        .body(message)
        .appname("艦これ通知");

    if play_sound {
        if let Some(sound_path) = find_sound_path(icon_kind) {
            play_sound_file(&sound_path);
        } else {
            notification.sound_name("message-new-instant");
        }
    }

    if let Some(icon_path) = find_icon_path(icon_kind) {
        notification.icon(&icon_path.to_string_lossy());
    }

    notification
        .show()
        .map_err(|e| format!("D-Bus notification failed: {}", e))?;

    Ok(())
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
            "デスクトップ通知のテストです。正常に動作しています。（種別: {}）",
            kind.unwrap_or("default")
        ),
        true,
        kind,
    )
}

pub fn is_process_running(pid: u32) -> Result<bool, String> {
    let pid = i32::try_from(pid).map_err(|_| "Invalid PID".to_string())?;
    if pid <= 0 {
        return Err("Invalid PID".to_string());
    }
    if unsafe { libc::kill(pid, 0) } == 0 {
        return Ok(true);
    }
    let error = std::io::Error::last_os_error();
    match error.raw_os_error() {
        Some(libc::ESRCH) => Ok(false),
        _ => Err(format!("Cannot query PID {}: {}", pid, error)),
    }
}

pub fn stop_process(pid: u32) -> Result<(), String> {
    // SIGTERM (15) を送信
    let res = Command::new("kill")
        .args(["-15", &pid.to_string()])
        .output();

    match res {
        Ok(out) if out.status.success() => Ok(()),
        Ok(out) => Err(format!(
            "kill failed: {}",
            String::from_utf8_lossy(&out.stderr)
        )),
        Err(e) => Err(format!("Failed to execute kill: {}", e)),
    }
}

pub fn start_daemon_detached() -> Result<u32, String> {
    let exe = std::env::current_exe().map_err(|e| format!("Cannot find current exe: {}", e))?;

    // stdin/stdout/stderr を切り離してバックグラウンド起動
    let child = Command::new(exe)
        .arg("run")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to spawn daemon process: {}", e))?;

    Ok(child.id())
}

pub fn enable_autostart() -> Result<(), String> {
    let home = std::env::var("HOME").map_err(|_| "HOME variable not set".to_string())?;
    let autostart_dir = std::path::PathBuf::from(home).join(".config").join("autostart");
    std::fs::create_dir_all(&autostart_dir)
        .map_err(|e| format!("Failed to create autostart dir: {}", e))?;

    let exe = std::env::current_exe().map_err(|e| format!("Cannot find current exe: {}", e))?;
    let content = format!(
        "[Desktop Entry]\nType=Application\nName=Kancolle Notify Daemon\nExec=\"{}\" start\nHidden=false\nNoDisplay=false\nX-GNOME-Autostart-enabled=true\n",
        exe.to_string_lossy()
    );
    std::fs::write(autostart_dir.join("kancolle-daemon.desktop"), content)
        .map_err(|e| format!("Failed to write desktop entry: {}", e))
}

pub fn disable_autostart() -> Result<(), String> {
    let home = std::env::var("HOME").map_err(|_| "HOME variable not set".to_string())?;
    let desktop_file = std::path::PathBuf::from(home)
        .join(".config")
        .join("autostart")
        .join("kancolle-daemon.desktop");
    if desktop_file.exists() {
        std::fs::remove_file(&desktop_file)
            .map_err(|e| format!("Failed to remove desktop entry: {}", e))?;
    }
    Ok(())
}

pub fn is_autostart_enabled() -> Result<bool, String> {
    let home = std::env::var("HOME").map_err(|_| "HOME variable not set".to_string())?;
    let desktop_file = std::path::PathBuf::from(home)
        .join(".config")
        .join("autostart")
        .join("kancolle-daemon.desktop");
    Ok(desktop_file.exists())
}
