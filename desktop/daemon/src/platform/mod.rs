#[cfg(windows)]
pub mod windows;
#[cfg(windows)]
pub use windows as imp;

#[cfg(target_os = "linux")]
pub mod linux;
#[cfg(target_os = "linux")]
pub use linux as imp;

// フォールバック（他のOS用スタブ）
#[cfg(not(any(windows, target_os = "linux")))]
pub mod stub;
#[cfg(not(any(windows, target_os = "linux")))]
pub use stub as imp;

pub fn show_notification(
    title: &str,
    message: &str,
    play_sound: bool,
    icon_kind: Option<&str>,
) -> Result<(), String> {
    imp::show_notification(title, message, play_sound, icon_kind)
}

pub fn test_notification(kind: Option<&str>) -> Result<(), String> {
    imp::test_notification(kind)
}

pub fn is_process_running(pid: u32) -> Result<bool, String> {
    imp::is_process_running(pid)
}

pub fn stop_process(pid: u32) -> Result<(), String> {
    imp::stop_process(pid)
}

pub fn start_daemon_detached() -> Result<u32, String> {
    imp::start_daemon_detached()
}

pub fn enable_autostart() -> Result<(), String> {
    imp::enable_autostart()
}

pub fn disable_autostart() -> Result<(), String> {
    imp::disable_autostart()
}

pub fn is_autostart_enabled() -> Result<bool, String> {
    imp::is_autostart_enabled()
}

pub fn enable_custom_appid() -> Result<(), String> {
    imp::enable_custom_appid()
}

pub fn disable_custom_appid() -> Result<(), String> {
    imp::disable_custom_appid()
}

pub fn is_custom_appid_enabled() -> Result<bool, String> {
    imp::is_custom_appid_enabled()
}

pub fn ensure_icons_dir() -> std::path::PathBuf {
    imp::ensure_icons_dir()
}

pub fn ensure_sounds_dir() -> std::path::PathBuf {
    imp::ensure_sounds_dir()
}
