pub fn show_notification(_title: &str, _message: &str, _play_sound: bool) -> Result<(), String> {
    Err("Unsupported OS for desktop notifications".to_string())
}

pub fn test_notification() -> Result<(), String> {
    Err("Unsupported OS for desktop notifications".to_string())
}

pub fn is_process_running(_pid: u32) -> bool {
    false
}

pub fn stop_process(_pid: u32) -> Result<(), String> {
    Err("Unsupported OS".to_string())
}

pub fn start_daemon_detached() -> Result<u32, String> {
    Err("Unsupported OS".to_string())
}
