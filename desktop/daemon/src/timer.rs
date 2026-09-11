use crate::client::fetch_status;
use crate::config::Config;
use crate::platform::show_notification;
use crate::state::{save_state, DaemonState, SlotItem};
use std::collections::HashSet;
use std::time::{SystemTime, UNIX_EPOCH};

pub fn current_time_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

pub fn format_slot_notification(key: &str, item: &SlotItem) -> (String, String) {
    let slot_num = item.slot;
    let name_str = item.name.as_deref().unwrap_or("").trim();
    let name_display = if name_str.is_empty() {
        "".to_string()
    } else {
        format!("「{}」", name_str)
    };

    match item.kind.as_str() {
        "expedition" => (
            "【艦これ】遠征帰投".to_string(),
            format!("第{}艦隊 {} が遠征より帰投しました！", slot_num, name_display),
        ),
        "repair" => (
            "【艦これ】入渠完了".to_string(),
            format!("第{}ドック {} の修復が完了しました！", slot_num, name_display),
        ),
        "build" => (
            "【艦これ】建造完了".to_string(),
            format!("第{}ドック {} の建造が完了しました！", slot_num, name_display),
        ),
        "fatigue" => (
            "【艦これ】疲労回復".to_string(),
            format!("第{}艦隊 {} の疲労回復見込み時刻になりました。", slot_num, name_display),
        ),
        "akashi" => (
            "【艦これ】泊地修理".to_string(),
            format!("泊地修理 {} のタイマー完了時刻です。", name_display),
        ),
        _ => (
            "【艦これ】予定完了".to_string(),
            format!("{} の予定時刻になりました。", key),
        ),
    }
}

pub fn check_and_notify(
    config: &Config,
    state: &mut DaemonState,
) -> Result<(), String> {
    let now = current_time_ms();
    let mut notified_set: HashSet<String> = state.notified_keys.iter().cloned().collect();

    // 1. APIから最新ステータスを取得
    match fetch_status(config) {
        Ok(status_res) => {
            state.slots = status_res.slots;
            state.last_error = None;
        }
        Err(e) => {
            state.last_error = Some(e.clone());
            // API取得失敗時でも、既存のstate.slotsから判定は継続
        }
    }

    state.updated_at = now;

    let advance_ms = config.notify_advance_sec * 1000;

    // 2. 各スロットの予定時刻を判定
    for (key, item) in &state.slots {
        if item.state != "active" {
            continue;
        }

        if let Some(end_ms) = item.end {
            let notification_id = format!("{}:{}", key, end_ms);

            if !notified_set.contains(&notification_id) {
                // 通知時刻に到達したか判定
                if now + advance_ms >= end_ms {
                    let (title, message) = format_slot_notification(key, item);
                    println!("[NOTIFY] {} - {}", title, message);

                    if let Err(err) = show_notification(&title, &message, config.play_sound) {
                        eprintln!("[ERROR] Toast notification failed: {}", err);
                    }

                    notified_set.insert(notification_id);
                }
            }
        }
    }

    // 古い通知IDを整理（最大100件保持）
    state.notified_keys = notified_set.into_iter().collect();
    if state.notified_keys.len() > 100 {
        state.notified_keys.drain(0..state.notified_keys.len() - 100);
    }

    save_state(state).map_err(|e| format!("Failed to save state: {}", e))?;

    Ok(())
}
