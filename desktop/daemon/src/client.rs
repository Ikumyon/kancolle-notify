use crate::config::Config;
use crate::state::StatusResponse;

pub fn fetch_status(config: &Config) -> Result<StatusResponse, String> {
    if config.server_url.is_empty() {
        return Err("Server URL is empty".to_string());
    }

    let url = format!("{}/v2/status", config.server_url.trim_end_matches('/'));
    
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
