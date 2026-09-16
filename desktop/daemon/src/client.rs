use crate::config::Config;
use crate::state::{StatusResponse, StatusSettings};

pub fn fetch_status(config: &Config) -> Result<StatusResponse, String> {
    if config.server_url.is_empty() {
        return Err("Server URL is empty".to_string());
    }

    let url = format!("{}/api/status", config.server_url.trim_end_matches('/'));
    
    let mut req = ureq::get(&url);
    if !config.token.is_empty() {
        req = req.header("Authorization", &format!("Bearer {}", config.token));
    }

    let res = req
        .call()
        .map_err(|e| format!("HTTP request failed: {}", e))?;

    let body = res
        .into_body()
        .read_to_string()
        .map_err(|e| format!("Failed to read response body: {}", e))?;

    let status_res: StatusResponse = serde_json::from_str(&body)
        .map_err(|e| format!("Failed to parse status response: {} (Body: {})", e, body))?;

    Ok(status_res)
}

pub fn patch_offset(config: &Config, offset_sec: i64) -> Result<StatusSettings, String> {
    if config.server_url.is_empty() {
        return Err("Server URL is empty".to_string());
    }

    let url = format!("{}/api/settings", config.server_url.trim_end_matches('/'));
    let payload = serde_json::json!({ "offsetSec": offset_sec });

    let body_bytes = serde_json::to_vec(&payload)
        .map_err(|e| format!("Failed to serialize payload: {}", e))?;

    let mut req = ureq::patch(&url);
    if !config.token.is_empty() {
        req = req.header("Authorization", &format!("Bearer {}", config.token));
    }
    req = req.header("Content-Type", "application/json");

    let res = req
        .send(body_bytes)
        .map_err(|e| format!("HTTP request failed: {}", e))?;

    let body = res
        .into_body()
        .read_to_string()
        .map_err(|e| format!("Failed to read response body: {}", e))?;

    let settings: StatusSettings = serde_json::from_str(&body)
        .map_err(|e| format!("Failed to parse settings response: {} (Body: {})", e, body))?;

    Ok(settings)
}

use std::io::{BufRead, BufReader};

#[derive(Debug, Clone, serde::Deserialize)]
#[allow(dead_code)]
pub struct NotifyEvent {
    #[serde(rename = "type")]
    pub event_type: String,
    #[serde(default)]
    pub timer_id: Option<String>,
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub slot: Option<u32>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub phase: Option<String>,
    #[serde(default)]
    pub timestamp: Option<u64>,
}

pub fn listen_events<F>(config: &Config, mut on_notify: F) -> Result<(), String>
where
    F: FnMut(NotifyEvent),
{
    if config.server_url.is_empty() {
        return Err("Server URL is empty".to_string());
    }

    let url = format!("{}/api/events", config.server_url.trim_end_matches('/'));
    let mut req = ureq::get(&url);
    if !config.token.is_empty() {
        req = req.header("Authorization", &format!("Bearer {}", config.token));
    }
    req = req.header("Accept", "text/event-stream");

    let res = req.call().map_err(|e| format!("SSE connection failed: {}", e))?;
    let mut body = res.into_body();
    let reader = BufReader::new(body.as_reader());

    for line_res in reader.lines() {
        let line = match line_res {
            Ok(l) => l,
            Err(e) => return Err(format!("SSE stream read error: {}", e)),
        };
        let trimmed = line.trim();
        if let Some(data_str) = trimmed.strip_prefix("data:") {
            let json_str = data_str.trim();
            if let Ok(event) = serde_json::from_str::<NotifyEvent>(json_str) {
                if event.event_type == "notify" {
                    on_notify(event);
                }
            }
        }
    }

    Ok(())
}
