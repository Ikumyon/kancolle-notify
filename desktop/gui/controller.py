import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Optional, Dict, Any

class DaemonController:
    """Rust製常駐デーモン (kancolle-daemon.exe) を制御・監視するコントローラー"""

    def __init__(self, base_dir: Path):
        self.base_dir = base_dir
        # Windowsは .exe、Linuxは拡張子なし
        exe_name = "kancolle-daemon.exe" if sys.platform == "win32" else "kancolle-daemon"
        release_exe = base_dir / "daemon" / "target" / "release" / exe_name
        debug_exe = base_dir / "daemon" / "target" / "debug" / exe_name
        
        if release_exe.exists():
            self.exe_path = release_exe
        elif debug_exe.exists():
            self.exe_path = debug_exe
        else:
            self.exe_path = release_exe  # デフォルト

        self.pid_file = self.base_dir / "daemon.pid"
        self.state_file = self.base_dir / "state.json"
        self.config_file = self.base_dir / "config.json"

    def is_installed(self) -> bool:
        return self.exe_path.exists()

    def get_status(self) -> Dict[str, Any]:
        """デーモンのステータスと監視スロットを取得"""
        if not self.is_installed():
            return {"is_running": False, "pid": None, "slots": {}, "error": "exe_not_found"}

        # CLI status コマンドで状態を取得（カレントディレクトリを base_dir に設定）
        try:
            res = subprocess.run(
                [str(self.exe_path), "status"],
                cwd=str(self.base_dir),
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0,
                timeout=3
            )
            if res.returncode == 0 and res.stdout.strip():
                return json.loads(res.stdout)
        except Exception:
            pass

        # フォールバック: state.json から直接読み込み
        if self.state_file.exists():
            try:
                with open(self.state_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    return data
            except Exception:
                pass

        return {"is_running": False, "pid": None, "slots": {}}

    def start(self) -> tuple[bool, str]:
        """バックグラウンドでデーモンを起動"""
        if not self.is_installed():
            return False, f"実行ファイルが見つかりません: {self.exe_path}"

        try:
            res = subprocess.run(
                [str(self.exe_path), "start"],
                cwd=str(self.base_dir),
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0,
                timeout=5
            )
            out = (res.stdout + res.stderr).strip()
            return res.returncode == 0, out
        except Exception as e:
            return False, str(e)

    def stop(self) -> tuple[bool, str]:
        """デーモンを停止"""
        if not self.is_installed():
            return False, "実行ファイルが見つかりません"

        try:
            res = subprocess.run(
                [str(self.exe_path), "stop"],
                cwd=str(self.base_dir),
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0,
                timeout=5
            )
            out = (res.stdout + res.stderr).strip()
            return res.returncode == 0, out
        except Exception as e:
            return False, str(e)

    def load_config(self) -> Dict[str, Any]:
        default_cfg = {
            "server_url": "http://127.0.0.1:8787",
            "token": "",
            "poll_interval_sec": 30,
            "notify_advance_sec": 0,
            "play_sound": True
        }
        if self.config_file.exists():
            try:
                with open(self.config_file, "r", encoding="utf-8") as f:
                    cfg = json.load(f)
                    default_cfg.update(cfg)
            except Exception:
                pass
        return default_cfg

    def save_config(self, cfg: Dict[str, Any]) -> bool:
        try:
            with open(self.config_file, "w", encoding="utf-8") as f:
                json.dump(cfg, f, indent=2, ensure_ascii=False)
            return True
        except Exception:
            return False
