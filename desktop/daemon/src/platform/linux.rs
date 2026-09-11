use std::process::{Command, Stdio};

pub fn show_notification(title: &str, message: &str, play_sound: bool) -> Result<(), String> {
    let mut notification = notify_rust::Notification::new();
    notification
        .summary(title)
        .body(message)
        .appname("艦これ通知システム");

    if play_sound {
        notification.sound_name("message-new-instant");
    }

    notification
        .show()
        .map_err(|e| format!("D-Bus notification failed: {}", e))?;

    Ok(())
}

pub fn test_notification() -> Result<(), String> {
    show_notification(
        "艦これ通知システム (Linux)",
        "デスクトップ通知のテストです。正常に動作しています。",
        true,
    )
}

pub fn is_process_running(pid: u32) -> bool {
    // kill -0 <pid> でプロセスの存在確認
    let status = Command::new("kill")
        .args(["-0", &pid.to_string()])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();

    match status {
        Ok(s) => s.success(),
        Err(_) => false,
    }
}

pub fn stop_process(pid: u32) -> Result<(), String> {
    // SIGTERM (15) を送信
    let res = Command::new("kill")
        .args(["-15", &pid.to_string()])
        .output();

    match res {
        Ok(out) if out.status.success() => Ok(()),
        Ok(out) => Err(format!("kill failed: {}", String::from_utf8_lossy(&out.stderr))),
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
