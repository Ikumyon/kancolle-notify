use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StatusResponse {
    pub now: u64,
    pub slots: HashMap<String, SlotItem>,
    #[serde(default)]
    pub auth_blocked: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlotItem {
    pub kind: String,
    pub slot: u32,
    pub state: String,
    #[serde(default)]
    pub end: Option<u64>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub subject: Option<serde_json::Value>,
    #[serde(default)]
    pub generation: Option<u64>,
    #[serde(default)]
    pub revision: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct DaemonState {
    pub updated_at: u64,
    pub is_running: bool,
    pub pid: Option<u32>,
    pub slots: HashMap<String, SlotItem>,
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
