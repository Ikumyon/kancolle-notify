use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct StatusSettings {
    #[serde(default, rename = "offsetSec")]
    pub offset_sec: i64,
    #[serde(default)]
    pub providers: HashMap<String, bool>,
    #[serde(default)]
    pub categories: HashMap<String, bool>,
    #[serde(default, rename = "hideBuildName")]
    pub hide_build_name: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimerEvent {
    pub id: String,
    pub phase: String,
    #[serde(default, rename = "endAt")]
    pub end_at: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimerItem {
    pub id: String,
    pub kind: String,
    #[serde(default)]
    pub slot: Option<u32>,
    #[serde(default)]
    pub name: Option<String>,
    pub state: String,
    #[serde(default, rename = "endAt")]
    pub end_at: Option<u64>,
    #[serde(default, rename = "notifyAt")]
    pub notify_at: Option<u64>,
    #[serde(default)]
    pub revision: Option<u64>,
    #[serde(default)]
    pub events: Vec<TimerEvent>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StatusResponse {
    #[serde(default)]
    pub revision: Option<u64>,
    pub now: u64,
    pub settings: StatusSettings,
    #[serde(default)]
    pub timers: Vec<TimerItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct DaemonState {
    pub updated_at: u64,
    pub is_running: bool,
    pub pid: Option<u32>,
    #[serde(default)]
    pub offset_sec: i64,
    #[serde(default)]
    pub timers: Vec<TimerItem>,
    pub notified_keys: Vec<String>,
    pub last_error: Option<String>,
}

pub fn get_state_path() -> PathBuf {
    PathBuf::from("state.json")
}

pub fn load_state() -> DaemonState {
    let path = get_state_path();
    if path.exists() {
        if let Ok(content) = fs::read_to_string(&path) {
            if let Ok(state) = serde_json::from_str::<DaemonState>(&content) {
                return state;
            }
        }
    }
    DaemonState::default()
}

pub fn save_state(state: &DaemonState) -> std::io::Result<()> {
    let content = serde_json::to_string_pretty(state)?;
    fs::write(get_state_path(), content)
}
