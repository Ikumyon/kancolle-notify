pub fn show_notification(_title: &str, _message: &str, _play_sound: bool) -> Result<(), String> {
    Err("Unsupported OS for desktop notifications".to_string())
}

pub fn test_notification() -> Result<(), String> {
    Err("Unsupported OS for desktop notifications".to_string())
}

pub fn is_process_running(_pid: u32) -> Result<bool, String> {
    Err("Unsupported platform".to_string())
}

pub fn stop_process(_pid: u32) -> Result<(), String> {
    Err("Unsupported OS".to_string())
}

pub fn start_daemon_detached() -> Result<u32, String> {
    Err("Unsupported OS".to_string())
}

pub fn enable_autostart() -> Result<(), String> {
    Err("Autostart not supported on this platform".to_string())
}

pub fn disable_autostart() -> Result<(), String> {
    Err("Autostart not supported on this platform".to_string())
}

pub fn is_autostart_enabled() -> Result<bool, String> {
    Ok(false)
}

pub fn ensure_icons_dir() -> std::path::PathBuf {
    std::path::PathBuf::from("icons")
}

pub fn ensure_sounds_dir() -> std::path::PathBuf {
    std::path::PathBuf::from("sounds")
}
