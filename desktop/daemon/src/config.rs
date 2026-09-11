use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    #[serde(default = "default_server_url")]
    pub server_url: String,
    #[serde(default = "default_token")]
    pub token: String,
    #[serde(default = "default_poll_interval")]
    pub poll_interval_sec: u64,
    #[serde(default = "default_advance_sec")]
    pub notify_advance_sec: u64,
    #[serde(default = "default_sound")]
    pub play_sound: bool,
}

fn default_server_url() -> String {
    "http://127.0.0.1:8787".to_string()
}

fn default_token() -> String {
    "".to_string()
}

fn default_poll_interval() -> u64 {
    30
}

fn default_advance_sec() -> u64 {
    0 // 0 = ジャスト, 60 = 1分前
}

fn default_sound() -> bool {
    true
}

impl Default for Config {
    fn default() -> Self {
        Self {
            server_url: default_server_url(),
            token: default_token(),
            poll_interval_sec: default_poll_interval(),
            notify_advance_sec: default_advance_sec(),
            play_sound: default_sound(),
        }
    }
}

pub fn get_config_path() -> PathBuf {
    PathBuf::from("config.json")
}

pub fn load_config() -> Config {
    let path = get_config_path();
    if path.exists() {
        if let Ok(content) = fs::read_to_string(&path) {
            if let Ok(cfg) = serde_json::from_str::<Config>(&content) {
                return cfg;
            }
        }
    }
    let cfg = Config::default();
    save_config(&cfg).ok();
    cfg
}

pub fn save_config(cfg: &Config) -> std::io::Result<()> {
    let content = serde_json::to_string_pretty(cfg)?;
    fs::write(get_config_path(), content)
}

pub fn set_value(key: &str, val: &str) -> Result<Config, String> {
    let mut cfg = load_config();
    match key {
        "server_url" => cfg.server_url = val.to_string(),
        "token" => cfg.token = val.to_string(),
        "poll_interval_sec" | "poll_interval" | "interval" => {
            cfg.poll_interval_sec = val.parse::<u64>().map_err(|_| "有効な秒数（整数）を指定してください".to_string())?;
        }
        "notify_advance_sec" | "notify_advance" | "advance" => {
            cfg.notify_advance_sec = val.parse::<u64>().map_err(|_| "有効な秒数（整数）を指定してください".to_string())?;
        }
        "play_sound" | "sound" => {
            cfg.play_sound = match val.to_lowercase().as_str() {
                "true" | "1" | "yes" | "on" => true,
                "false" | "0" | "no" | "off" => false,
                _ => return Err("true または false を指定してください".to_string()),
            };
        }
        _ => return Err(format!("未知の設定キーです: {} (使用可能: server_url, token, poll_interval, notify_advance, play_sound)", key)),
    }
    save_config(&cfg).map_err(|e| format!("設定ファイルの保存に失敗しました: {}", e))?;
    Ok(cfg)
}
