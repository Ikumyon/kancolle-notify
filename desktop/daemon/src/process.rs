use crate::platform;
use std::fs;
use std::path::PathBuf;

pub fn get_pid_path() -> PathBuf {
    PathBuf::from("daemon.pid")
}

pub fn read_pid() -> Result<Option<u32>, String> {
    let path = get_pid_path();
    let content = match fs::read_to_string(&path) {
        Ok(content) => content,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(format!("Cannot read PID file: {}", e)),
    };
    let pid = content
        .trim()
        .parse::<u32>()
        .map_err(|e| format!("Invalid PID file: {}", e))?;
    if platform::is_process_running(pid)? {
        Ok(Some(pid))
    } else {
        remove_pid();
        Ok(None)
    }
}

pub fn write_pid(pid: u32) -> std::io::Result<()> {
    fs::write(get_pid_path(), pid.to_string())
}

pub fn remove_pid() {
    let _ = fs::remove_file(get_pid_path());
}

pub fn stop_daemon() -> Result<(), String> {
    if let Some(pid) = read_pid()? {
        platform::stop_process(pid)?;
        remove_pid();
        Ok(())
    } else {
        Err("Daemon is not running (no valid PID found)".to_string())
    }
}

pub fn start_daemon_detached() -> Result<u32, String> {
    if let Some(pid) = read_pid()? {
        return Err(format!("Daemon is already running with PID {}", pid));
    }

    let pid = platform::start_daemon_detached()?;
    write_pid(pid).map_err(|e| format!("Failed to write PID file: {}", e))?;
    Ok(pid)
}
