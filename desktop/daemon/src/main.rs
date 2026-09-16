mod client;
mod config;
mod platform;
mod process;
mod state;
mod timer;

use config::load_config;
use process::{read_pid, remove_pid, start_daemon_detached, stop_daemon, write_pid};
use state::{load_state, save_state};
use std::env;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::Duration;
use timer::handle_notify_event;

fn print_usage() {
    println!("艦これ 超軽量常駐通知デーモン (kancolle-daemon)");
    println!();
    println!("使用法:");
    println!("  kancolle-daemon.exe <COMMAND>");
    println!();
    println!("コマンド:");
    println!("  run                     フォアグラウンドで常駐実行（ログをコンソール出力）");
    println!("  start                   バックグラウンドで常駐開始（不可視プロセス）");
    println!("  stop                    バックグラウンドの常駐プロセスを安全に停止");
    println!("  status                  現在の常駐状態と監視タイマーをJSONで出力");
    println!("  offset [SEC]            中央の通知オフセット時間を表示または変更 (例: offset -60)");
    println!("  test                    デスクトップ通知の動作テストを実行");
    println!("  autostart [CMD]         PC起動時の自動起動を管理 (status | enable | disable)");
    println!("  config [CMD]            設定の一覧表示および変更 (list | set <key> <val> | --json)");
    println!("  help                    このヘルプを表示");
}

fn run_loop() {
    let pid = std::process::id();
    if let Err(e) = write_pid(pid) {
        eprintln!("[WARN] Failed to write PID file: {}", e);
    }

    println!("[INFO] Kancolle Daemon started with PID: {}", pid);

    let mut state = load_state();
    state.is_running = true;
    state.pid = Some(pid);
    let _ = save_state(&state);

    // Ctrl+C ハンドラ
    let running = Arc::new(AtomicBool::new(true));
    let r = running.clone();
    if let Err(e) = ctrlc::set_handler(move || {
        println!("\n[INFO] Stopping daemon...");
        r.store(false, Ordering::SeqCst);
    }) {
        eprintln!("[WARN] Failed to set Ctrl+C handler: {}", e);
    }

    let config = load_config();
    println!("[INFO] Target Server: {}", config.server_url);
    println!("[INFO] Listening for push notifications (SSE)...");

    while running.load(Ordering::SeqCst) {
        let cfg = load_config();
        let r_flag = running.clone();
        let listen_res = client::listen_events(&cfg, |event| {
            if !r_flag.load(Ordering::SeqCst) {
                return;
            }
            if let Err(err) = handle_notify_event(&cfg, &event) {
                eprintln!("[ERROR] Notification failed: {}", err);
            }
        });

        if let Err(e) = listen_res {
            if running.load(Ordering::SeqCst) {
                eprintln!("[WARN] Event stream disconnected: {}. Reconnecting in 3s...", e);
                thread::sleep(Duration::from_secs(3));
            }
        }
    }

    // 終了処理
    state.is_running = false;
    state.pid = None;
    let _ = save_state(&state);
    remove_pid();
    println!("[INFO] Kancolle Daemon cleanly stopped.");
}

fn cmd_status() {
    let mut state = load_state();
    let current_pid = read_pid().unwrap_or_else(|e| {
        eprintln!("[ERROR] {}", e);
        std::process::exit(1);
    });
    state.is_running = current_pid.is_some();
    state.pid = current_pid;

    let json = serde_json::to_string_pretty(&state).unwrap_or_else(|_| "{}".to_string());
    println!("{}", json);
}

fn cmd_offset(args: &[String]) {
    let cfg = load_config();
    let is_json = args.iter().any(|a| a == "--json");
    let sec_arg = args.get(2).filter(|s| *s != "--json");

    match sec_arg {
        Some(sec_str) => {
            let sec = match sec_str.parse::<i64>() {
                Ok(s) if (-3600..=3600).contains(&s) => s,
                _ => {
                    eprintln!("[ERROR] オフセット秒数は -3600 〜 3600 の整数で指定してください。");
                    std::process::exit(1);
                }
            };
            match client::patch_offset(&cfg, sec) {
                Ok(settings) => {
                    if is_json {
                        println!("{}", serde_json::json!({ "offsetSec": settings.offset_sec, "ok": true }));
                    } else {
                        println!("[SUCCESS] 中央の通知オフセットを {}秒 に設定しました。", settings.offset_sec);
                    }
                }
                Err(e) => {
                    eprintln!("[ERROR] 中央のオフセット変更に失敗しました: {}", e);
                    std::process::exit(1);
                }
            }
        }
        None => {
            match client::fetch_status(&cfg) {
                Ok(status) => {
                    if is_json {
                        println!("{}", serde_json::json!({ "offsetSec": status.settings.offset_sec }));
                    } else {
                        println!("中央の通知オフセット: {}秒", status.settings.offset_sec);
                    }
                }
                Err(e) => {
                    // 通信失敗時は最後に保存されたstateから返す
                    let state = load_state();
                    if is_json {
                        println!("{}", serde_json::json!({ "offsetSec": state.offset_sec, "warning": e }));
                    } else {
                        println!("中央の通知オフセット (キャッシュ): {}秒 (取得エラー: {})", state.offset_sec, e);
                    }
                }
            }
        }
    }
}

fn cmd_autostart(args: &[String]) {
    let sub = args.get(2).map(|s| s.as_str()).unwrap_or("status");
    match sub {
        "enable" | "on" => match platform::enable_autostart() {
            Ok(_) => println!("[SUCCESS] 自動起動を有効化しました。"),
            Err(e) => {
                eprintln!("[ERROR] 自動起動の登録に失敗しました: {}", e);
                std::process::exit(1);
            }
        },
        "disable" | "off" => match platform::disable_autostart() {
            Ok(_) => println!("[SUCCESS] 自動起動を無効化しました。"),
            Err(e) => {
                eprintln!("[ERROR] 自動起動の解除に失敗しました: {}", e);
                std::process::exit(1);
            }
        },
        "status" => match platform::is_autostart_enabled() {
            Ok(enabled) => {
                println!("{}", serde_json::json!({ "autostart": enabled }));
            }
            Err(e) => {
                eprintln!("[ERROR] 自動起動状態の確認に失敗しました: {}", e);
                std::process::exit(1);
            }
        },
        other => {
            eprintln!("Unknown autostart subcommand: {} (使用可能: status, enable, disable)", other);
            std::process::exit(1);
        }
    }
}

fn print_config_pretty(cfg: &config::Config) {
    let autostart = platform::is_autostart_enabled().unwrap_or(false);
    let token_display = if cfg.token.is_empty() {
        "(未設定)".to_string()
    } else if cfg.token.len() <= 8 {
        "********".to_string()
    } else {
        format!("{}...{} [設定済み]", &cfg.token[..4], &cfg.token[cfg.token.len()-4..])
    };

    println!("========================================");
    println!(" 艦これ通知デーモン 設定一覧 (Config)");
    println!("========================================");
    println!("  サーバーURL       : {}", cfg.server_url);
    println!("  端末トークン       : {}", token_display);
    println!("  サウンド通知       : {}", if cfg.play_sound { "有効 (true)" } else { "無効 (false)" });
    println!("  自動起動 (OS常駐)  : {}", if autostart { "有効 (true)" } else { "無効 (false)" });
    println!("========================================");
    println!("設定ファイル: config.json");
}

fn cmd_config(args: &[String]) {
    let sub = args.get(2).map(|s| s.as_str()).unwrap_or("list");
    match sub {
        "set" => {
            let key = args.get(3).map(|s| s.as_str()).unwrap_or("");
            let val = args.get(4).map(|s| s.as_str()).unwrap_or("");
            if key.is_empty() || val.is_empty() {
                eprintln!("使用法: kancolle-daemon config set <KEY> <VALUE>");
                eprintln!("使用可能なキー: server_url, token, play_sound");
                std::process::exit(1);
            }
            match config::set_value(key, val) {
                Ok(new_cfg) => {
                    println!("[SUCCESS] 設定を変更しました: {} = {}", key, val);
                    print_config_pretty(&new_cfg);
                }
                Err(e) => {
                    eprintln!("[ERROR] {}", e);
                    std::process::exit(1);
                }
            }
        }
        "list" | "get" => {
            let cfg = load_config();
            let is_json = args.iter().any(|a| a == "--json");
            if is_json {
                let autostart_enabled = platform::is_autostart_enabled().unwrap_or(false);
                let mut v = serde_json::to_value(&cfg).unwrap_or(serde_json::Value::Null);
                if let serde_json::Value::Object(ref mut map) = v {
                    map.insert("autostart".to_string(), serde_json::Value::Bool(autostart_enabled));
                }
                println!("{}", serde_json::to_string_pretty(&v).unwrap_or_default());
            } else {
                print_config_pretty(&cfg);
            }
        }
        "--json" => {
            let cfg = load_config();
            let autostart_enabled = platform::is_autostart_enabled().unwrap_or(false);
            let mut v = serde_json::to_value(&cfg).unwrap_or(serde_json::Value::Null);
            if let serde_json::Value::Object(ref mut map) = v {
                map.insert("autostart".to_string(), serde_json::Value::Bool(autostart_enabled));
            }
            println!("{}", serde_json::to_string_pretty(&v).unwrap_or_default());
        }
        other => {
            eprintln!("Unknown config subcommand: {} (使用可能: list, set, --json)", other);
            std::process::exit(1);
        }
    }
}

fn main() {
    let args: Vec<String> = env::args().collect();
    let cmd = args.get(1).map(|s| s.as_str()).unwrap_or("help");

    match cmd {
        "run" => run_loop(),
        "start" => match start_daemon_detached() {
            Ok(pid) => {
                println!("[SUCCESS] Daemon started in background (PID: {}).", pid);
            }
            Err(e) => {
                eprintln!("[ERROR] {}", e);
                std::process::exit(1);
            }
        },
        "stop" => match stop_daemon() {
            Ok(_) => {
                println!("[SUCCESS] Daemon stopped successfully.");
            }
            Err(e) => {
                eprintln!("[ERROR] {}", e);
                std::process::exit(1);
            }
        },
        "status" => cmd_status(),
        "offset" => cmd_offset(&args),
        "autostart" => cmd_autostart(&args),
        "config" => cmd_config(&args),
        "test" => {
            println!("[INFO] Sending test desktop notification...");
            match platform::test_notification() {
                Ok(_) => println!("[SUCCESS] Test notification sent!"),
                Err(e) => eprintln!("[ERROR] Failed to send toast: {}", e),
            }
        }
        "help" | "--help" | "-h" => print_usage(),
        other => {
            eprintln!("Unknown command: {}", other);
            print_usage();
            std::process::exit(1);
        }
    }
}
