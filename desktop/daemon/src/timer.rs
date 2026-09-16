use crate::client::NotifyEvent;
use crate::config::Config;
use crate::platform::show_notification;

pub fn format_notify_event(event: &NotifyEvent) -> (String, String) {
    let slot_num = event.slot.unwrap_or(0);
    let name_str = event.name.as_deref().unwrap_or("").trim();
    let name_display = if name_str.is_empty() {
        "".to_string()
    } else {
        format!("「{}」", name_str)
    };
    let kind = event.kind.as_deref().unwrap_or("");
    let phase = event.phase.as_deref().unwrap_or("complete");

    match kind {
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
        "akashi" => {
            if phase == "20min" || phase == "start" {
                (
                    format!("【艦これ】第{}艦隊 泊地修理（20分経過）", slot_num),
                    format!("第{}艦隊 {} 最初の20分が経過しました。", slot_num, name_display),
                )
            } else {
                (
                    format!("【艦これ】第{}艦隊 泊地修理 全回復見込み", slot_num),
                    format!("第{}艦隊 {} 全回復見込み時刻になりました。", slot_num, name_display),
                )
            }
        }
        "manual" => (
            "【艦これ】手動タイマー".to_string(),
            format!("手動タイマー {} の完了時刻になりました。", name_display),
        ),
        _ => (
            "【艦これ】予定完了".to_string(),
            format!("{} の予定時刻になりました。", if name_display.is_empty() { "タイマー" } else { &name_display }),
        ),
    }
}

pub fn handle_notify_event(config: &Config, event: &NotifyEvent) -> Result<(), String> {
    let (title, message) = format_notify_event(event);
    println!("[NOTIFY] {} - {}", title, message);
    show_notification(&title, &message, config.play_sound)
}
