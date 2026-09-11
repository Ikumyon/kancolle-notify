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
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;
use timer::check_and_notify;

fn print_usage() {
    println!("艦これ 超軽量常駐通知デーモン (kancolle-daemon)");
    println!();
    println!("使用法:");
    println!("  kancolle-daemon.exe <COMMAND>");
    println!();
    println!("コマンド:");
    println!("  run       フォアグラウンドで常駐実行（ログをコンソール出力）");
    println!("  start     バックグラウンドで常駐開始（不可視プロセス）");
    println!("  stop      バックグラウンドの常駐プロセスを安全に停止");
    println!("  status    現在の常駐状態と監視スロットをJSONで出力");
    println!("  test      デスクトップ通知の動作テストを実行");
    println!("  help      このヘルプを表示");
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
    println!("[INFO] Poll Interval: {}s", config.poll_interval_sec);

    while running.load(Ordering::SeqCst) {
        let cfg = load_config(); // 毎ループ設定リロード
        if let Err(e) = check_and_notify(&cfg, &mut state) {
            eprintln!("[WARN] Check failed: {}", e);
        }

        // 短いスパン（1秒）でスリープしつつ停止要求を即座に感知
        for _ in 0..cfg.poll_interval_sec {
            if !running.load(Ordering::SeqCst) {
                break;
            }
            thread::sleep(Duration::from_secs(1));
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
    let current_pid = read_pid();
    state.is_running = current_pid.is_some();
    state.pid = current_pid;

    let json = serde_json::to_string_pretty(&state).unwrap_or_else(|_| "{}".to_string());
    println!("{}", json);
}

fn main() {
    let args: Vec<String> = env::args().collect();
    let cmd = args.get(1).map(|s| s.as_str()).unwrap_or("help");

    match cmd {
        "run" => run_loop(),
        "start" => {
            match start_daemon_detached() {
                Ok(pid) => {
                    println!("[SUCCESS] Daemon started in background (PID: {}).", pid);
                }
                Err(e) => {
                    eprintln!("[ERROR] {}", e);
                    std::process::exit(1);
                }
            }
        }
        "stop" => {
            match stop_daemon() {
                Ok(_) => {
                    println!("[SUCCESS] Daemon stopped successfully.");
                }
                Err(e) => {
                    eprintln!("[ERROR] {}", e);
                    std::process::exit(1);
                }
            }
        }
        "status" => cmd_status(),
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
