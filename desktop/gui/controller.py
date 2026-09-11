import json
import os
import subprocess
import sys
from contextlib import contextmanager
from pathlib import Path
from typing import Dict, Any

from PySide6.QtCore import QObject, QProcess, QProcessEnvironment, QTimer


@contextmanager
def external_dll_search_path():
    """外部CLIにonefileのDLL検索先を継承させず、GUI側の設定は復元する。"""
    if sys.platform != "win32" or not getattr(sys, "frozen", False):
        yield
        return

    import ctypes
    from ctypes import wintypes

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    get_directory = kernel32.GetDllDirectoryW
    get_directory.argtypes = [wintypes.DWORD, wintypes.LPWSTR]
    get_directory.restype = wintypes.DWORD
    set_directory = kernel32.SetDllDirectoryW
    set_directory.argtypes = [wintypes.LPCWSTR]
    set_directory.restype = wintypes.BOOL

    size = get_directory(0, None)
    directory = ctypes.create_unicode_buffer(size or 1)
    if size and not get_directory(len(directory), directory):
        raise ctypes.WinError(ctypes.get_last_error())
    if not set_directory(None):
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        yield
    finally:
        if not set_directory(directory.value if size else None):
            raise ctypes.WinError(ctypes.get_last_error())


class DaemonController(QObject):
    """Rust製常駐デーモン (kancolle-daemon.exe) を制御・監視するコントローラー"""

    def __init__(self, base_dir: Path):
        super().__init__()
        self.processes = {}
        self.base_dir = base_dir
        # Windowsは .exe、Linuxは拡張子なし
        self.exe_name = "kancolle-daemon.exe" if sys.platform == "win32" else "kancolle-daemon"
        # GUIと同じフォルダ（base_dir）に必ずあるとする
        self.exe_path = base_dir / self.exe_name

        self.pid_file = self.base_dir / "daemon.pid"
        self.state_file = self.base_dir / "state.json"
        self.config_file = self.base_dir / "config.json"

    def _get_clean_env(self) -> dict:
        """PyInstallerの一時フォルダ環境変数 (_MEIPASS 等) を除去したクリーンな環境変数を取得"""
        env = os.environ.copy()
        env.pop("_MEIPASS", None)
        env.pop("_MEIPASS2", None)
        env.pop("QT_PLUGIN_PATH", None)
        # Qt等のランタイムフックがPATHへ追加した同梱DLLの検索先も除外する。
        bundle_dir = getattr(sys, "_MEIPASS", None)
        if bundle_dir:
            bundle_path = Path(bundle_dir).resolve()
            env["PATH"] = os.pathsep.join(
                entry for entry in env.get("PATH", "").split(os.pathsep)
                if not Path(entry.strip('"')).resolve().is_relative_to(bundle_path)
            )
        return env

    def is_installed(self) -> bool:
        return self.exe_path.exists()

    def run_command(self, command, callback):
        """Qt のイベントループを止めずに CLI を実行。同じ操作は重複させない。"""
        if command in self.processes:
            return
        if not self.is_installed():
            callback(False, f"{self.exe_name} が見つかりません。")
            return
        process = QProcess(self)
        process.setWorkingDirectory(str(self.base_dir))

        # PyInstallerの一時フォルダ情報を引き継がせないためのクリーンな環境変数を設定
        q_env = QProcessEnvironment()
        for k, v in self._get_clean_env().items():
            q_env.insert(k, v)
        process.setProcessEnvironment(q_env)

        timer = QTimer(process)
        timer.setSingleShot(True)
        self.processes[command] = process
        timed_out = False
        completed = False

        def finish(ok, message):
            nonlocal completed
            if completed:
                return
            completed = True
            timer.stop()
            self.processes.pop(command, None)
            process.deleteLater()
            callback(ok, message)

        def finished(code, exit_status):
            output = bytes(process.readAllStandardOutput()).decode("utf-8", errors="replace")
            error = bytes(process.readAllStandardError()).decode("utf-8", errors="replace")
            ok = not timed_out and code == 0 and exit_status == QProcess.NormalExit
            finish(ok, "処理がタイムアウトしました。" if timed_out else (output + error).strip())

        def failed(error):
            if error == QProcess.FailedToStart:
                finish(False, process.errorString())

        def timeout():
            nonlocal timed_out
            timed_out = True
            process.kill()

        process.finished.connect(finished)
        process.errorOccurred.connect(failed)
        timer.timeout.connect(timeout)
        timer.start(3000 if command == "status" else 5000)
        try:
            with external_dll_search_path():
                # WindowsのQProcess.startはこの呼び出し中にCreateProcessする。
                process.start(str(self.exe_path), [command])
        except OSError as error:
            process.kill()
            finish(False, str(error))

    def shutdown(self):
        # 終了時は短命の CLI のみを停止。常駐デーモンは別プロセス。
        for process in list(self.processes.values()):
            for timer in process.findChildren(QTimer):
                timer.stop()
            process.blockSignals(True)
            process.kill()
            process.waitForFinished(1000)
            process.deleteLater()
        self.processes.clear()

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

    def get_autostart(self) -> bool:
        """自動起動（スタートアップ）が有効かどうか確認"""
        if not self.is_installed():
            return False
        try:
            res = self._run_external(
                [str(self.exe_path), "autostart", "status"],
                cwd=str(self.base_dir),
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                env=self._get_clean_env(),
                close_fds=True,
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0,
                timeout=3
            )
            if res.returncode == 0:
                data = json.loads(res.stdout)
                return bool(data.get("autostart", False))
        except Exception:
            pass
        return False

    def set_autostart(self, enable: bool) -> tuple[bool, str]:
        """自動起動（スタートアップ）を登録または解除"""
        if not self.is_installed():
            return False, f"{self.exe_name} が見つかりません。"
        cmd = "enable" if enable else "disable"
        try:
            res = self._run_external(
                [str(self.exe_path), "autostart", cmd],
                cwd=str(self.base_dir),
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                env=self._get_clean_env(),
                close_fds=True,
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0,
                timeout=5
            )
            out = (res.stdout + res.stderr).strip()
            return res.returncode == 0, out
        except Exception as e:
            return False, str(e)

    def _run_external(self, *args, **kwargs):
        with external_dll_search_path():
            return subprocess.run(*args, **kwargs)
