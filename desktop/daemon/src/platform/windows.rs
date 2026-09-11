use std::os::windows::process::CommandExt;
use std::process::{Command, Stdio};
use winrt_notification::{Duration, Sound, Toast};

const CREATE_NO_WINDOW: u32 = 0x08000000;
const DETACHED_PROCESS: u32 = 0x00000008;
const CREATE_NEW_PROCESS_GROUP: u32 = 0x00000200;
use windows_sys::Win32::Foundation::{
    CloseHandle, ERROR_INVALID_PARAMETER, GetLastError, WAIT_OBJECT_0, WAIT_TIMEOUT,
};
use windows_sys::Win32::System::Threading::{
    OpenProcess, PROCESS_SYNCHRONIZE, WaitForSingleObject,
};

pub fn show_notification(title: &str, message: &str, play_sound: bool) -> Result<(), String> {
    let mut toast = Toast::new(Toast::POWERSHELL_APP_ID)
        .title(title)
        .text1(message)
        .duration(Duration::Short);

    if play_sound {
        toast = toast.sound(Some(Sound::Default));
    }

    toast
        .show()
        .map_err(|e| format!("WinRT notification failed: {}", e))
}

pub fn test_notification() -> Result<(), String> {
    show_notification(
        "艦これ通知システム (Windows)",
        "デスクトップ通知のテストです。正常に動作しています。",
        true,
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
