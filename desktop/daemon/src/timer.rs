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
    let slot_num = item.slot.unwrap_or(0);
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
        "manual" => (
            "【艦これ】手動タイマー".to_string(),
            format!("手動タイマー {} の完了時刻になりました。", name_display),
        ),
        _ => (
            "【艦これ】予定完了".to_string(),
            format!("{} の予定時刻になりました。", if name_display.is_empty() { key.to_string() } else { name_display }),
        ),
    }
}

pub const MIN_REPAIR: u64 = 1_200_000; // 20分

fn ceil_minute(n: f64) -> u64 {
    ((n / 60_000.0).ceil() * 60_000.0) as u64
}

pub struct AkashiProgress {
    pub hp: u32,
    pub healed: u32,
    pub end: u64,
}

pub fn calculate_akashi_progress(ship: &crate::state::AkashiShip, start: u64, now: u64) -> AkashiProgress {
    let missing_u64 = ship.max.saturating_sub(ship.hp) as u64;
    let missing = (missing_u64.max(1)) as f64;
    let base_repair = (ship.repair.saturating_sub(30_000)) as f64 * ship.mod_val;
    let tick = (ceil_minute(base_repair) as f64 / missing).ceil() as u64;

    let end = start + if missing_u64 == 1 {
        MIN_REPAIR
    } else {
        MIN_REPAIR.max(ceil_minute((tick * missing_u64) as f64))
    };

    let elapsed = now.saturating_sub(start);
    let healed = if elapsed < MIN_REPAIR {
        0
    } else {
        let minutes_ms = (elapsed / 60_000) * 60_000;
        let count = if tick > 0 { minutes_ms / tick } else { 0 };
        (count.max(1) as u32).min(missing_u64 as u32)
    };

    AkashiProgress {
        hp: (ship.hp + healed).min(ship.max),
        healed,
        end,
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

        // --- 泊地修理（明石修理）専用の通知判定 ---
        if item.kind == "akashi" {
            if let Some(ref repair) = item.repair {
                let slot_num = item.slot.unwrap_or(1);

                // マイルストーン1: 20分経過（修理開始）通知
                let start_key = format!("{}:{}:start", key, repair.start);
                let start_due = repair.start + MIN_REPAIR;

                if !notified_set.contains(&start_key) && now + advance_ms >= start_due {
                    let title = format!("【艦これ】第{}艦隊 泊地修理開始（20分経過）", slot_num);
                    let mut lines = Vec::new();
                    lines.push("HP回復見込み:".to_string());
                    for ship in &repair.ships {
                        let p = calculate_akashi_progress(ship, repair.start, now);
                        let status_str = if now >= p.end {
                            "全回復".to_string()
                        } else {
                            let rem_min = (p.end.saturating_sub(now) as f64 / 60_000.0).ceil() as u64;
                            format!("あと{}分", rem_min)
                        };
                        lines.push(format!("{}: {}->{} +{}　{}", ship.name, ship.hp, p.hp, p.healed, status_str));
                    }
                    let message = lines.join("\n");
                    println!("[NOTIFY] {} - {}", title, message);
                    if let Err(err) = show_notification(&title, &message, config.play_sound) {
                        eprintln!("[ERROR] Toast notification failed: {}", err);
                    }
                    notified_set.insert(start_key);
                }

                // マイルストーン2: 各艦娘の全回復見込み通知
                for ship in &repair.ships {
                    let p = calculate_akashi_progress(ship, repair.start, now);
                    let ship_key = format!("{}:{}:ship:{}", key, repair.start, ship.id);

                    if !notified_set.contains(&ship_key) && now + advance_ms >= p.end {
                        let title = format!("【艦これ】第{}艦隊 泊地修理 全回復見込み", slot_num);
                        let message = format!("{} が全回復見込み時刻になりました！（推定HP {}/{}）", ship.name, p.hp, ship.max);
                        println!("[NOTIFY] {} - {}", title, message);
                        if let Err(err) = show_notification(&title, &message, config.play_sound) {
                            eprintln!("[ERROR] Toast notification failed: {}", err);
                        }
                        notified_set.insert(ship_key);
                    }
                }
                continue;
            }
        }

        // --- 通常スロット（遠征・入渠・建造・疲労・手動）の判定 ---
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
