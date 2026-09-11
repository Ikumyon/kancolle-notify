use std::os::windows::process::CommandExt;
use std::process::Command;
use winrt_notification::{Duration, Sound, Toast};

const CREATE_NO_WINDOW: u32 = 0x08000000;
const DETACHED_PROCESS: u32 = 0x00000008;

pub fn show_notification(title: &str, message: &str, play_sound: bool) -> Result<(), String> {
    let mut toast = Toast::new(Toast::POWERSHELL_APP_ID)
        .title(title)
        .text1(message)
        .duration(Duration::Short);

    if play_sound {
        toast = toast.sound(Some(Sound::Default));
    }

    toast.show().map_err(|e| format!("WinRT notification failed: {}", e))
}

pub fn test_notification() -> Result<(), String> {
    show_notification(
        "艦これ通知システム (Windows)",
        "デスクトップ通知のテストです。正常に動作しています。",
        true,
    )
}

pub fn is_process_running(pid: u32) -> bool {
    let output = Command::new("tasklist")
        .args(["/FI", &format!("PID eq {}", pid), "/NH"])
        .output();

    if let Ok(out) = output {
        let text = String::from_utf8_lossy(&out.stdout);
        return text.contains(&pid.to_string());
    }
    false
}

pub fn stop_process(pid: u32) -> Result<(), String> {
    let res = Command::new("taskkill")
        .args(["/F", "/PID", &pid.to_string()])
        .output();

    match res {
        Ok(out) if out.status.success() => Ok(()),
        Ok(out) => Err(format!("taskkill failed: {}", String::from_utf8_lossy(&out.stderr))),
        Err(e) => Err(format!("Failed to execute taskkill: {}", e)),
    }
}

pub fn start_daemon_detached() -> Result<u32, String> {
    let exe = std::env::current_exe().map_err(|e| format!("Cannot find current exe: {}", e))?;

    let child = Command::new(exe)
        .arg("run")
        .creation_flags(CREATE_NO_WINDOW | DETACHED_PROCESS)
        .spawn()
        .map_err(|e| format!("Failed to spawn daemon process: {}", e))?;

    Ok(child.id())
}
