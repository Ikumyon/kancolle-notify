import sys
import json
import os
import time
import urllib.request
from datetime import datetime
from pathlib import Path

from PySide6.QtCore import Qt, QTimer, QThread, Signal, QUrl
from PySide6.QtGui import QColor, QDesktopServices, QFont, QIcon, QPalette
from PySide6.QtWidgets import (
    QApplication,
    QCheckBox,
    QDialog,
    QFormLayout,
    QFrame,
    QHBoxLayout,
    QHeaderView,
    QLabel,
    QLineEdit,
    QMessageBox,
    QPushButton,
    QSpinBox,
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
    QWidget,
)

# 同一ディレクトリの controller を安全にインポート
current_dir = Path(__file__).resolve().parent
if str(current_dir) not in sys.path:
    sys.path.insert(0, str(current_dir))

from controller import DaemonController

try:
    import resources_rc
except ImportError:
    pass


class SseClientThread(QThread):
    """Cloudflare Workers の /api/events (SSE) を受信するバックグラウンドスレッド"""
    event_received = Signal(dict)
    connection_status = Signal(bool)

    def __init__(self, controller: DaemonController, parent=None):
        super().__init__(parent)
        self.controller = controller
        self._running = True

    def stop(self):
        self._running = False

    def run(self):
        while self._running:
            cfg = self.controller.load_config()
            server_url = (cfg.get("server_url") or "").strip().rstrip("/")
            token = (cfg.get("token") or "").strip()

            if not server_url:
                time.sleep(2)
                continue

            url = f"{server_url}/api/events"
            headers = {
                "Accept": "text/event-stream",
                "User-Agent": "kancolle-gui/0.9.3"
            }
            if token:
                headers["Authorization"] = f"Bearer {token}"

            req = urllib.request.Request(url, headers=headers)
            try:
                # 35秒タイムアウト（Cloudflareのキープアライブ等を考慮）
                with urllib.request.urlopen(req, timeout=35) as response:
                    self.connection_status.emit(True)
                    for line in response:
                        if not self._running:
                            break
                        decoded = line.decode("utf-8", errors="replace").strip()
                        if decoded.startswith("data:"):
                            data_str = decoded[5:].strip()
                            try:
                                payload = json.loads(data_str)
                                self.event_received.emit(payload)
                            except Exception:
                                pass
            except Exception:
                self.connection_status.emit(False)
                # 再接続待機（0.1秒単位で_runningをチェック）
                for _ in range(30):
                    if not self._running:
                        break
                    time.sleep(0.1)


class SettingsDialog(QDialog):
    """設定変更ダイアログ"""

    def __init__(self, controller: DaemonController, parent=None):
        super().__init__(parent)
        self.controller = controller
        self.setWindowTitle("通知設定 (Settings)")
        self.resize(450, 260)
        self.setStyleSheet("""
            QDialog {
                background-color: #1a1e24;
                color: #e0e6ed;
            }
            QLabel {
                color: #c0cad6;
                font-size: 13px;
            }
            QLineEdit, QSpinBox {
                background-color: #0f1318;
                border: 1px solid #333d4b;
                border-radius: 4px;
                padding: 6px;
                color: #ffffff;
                font-family: Consolas, monospace;
            }
            QLineEdit:focus, QSpinBox:focus {
                border: 1px solid #3b82f6;
            }
            QPushButton {
                background-color: #2563eb;
                color: white;
                border: none;
                border-radius: 4px;
                padding: 8px 16px;
                font-weight: bold;
            }
            QPushButton:hover {
                background-color: #1d4ed8;
            }
            QPushButton#cancelBtn {
                background-color: #374151;
            }
            QPushButton#cancelBtn:hover {
                background-color: #4b5563;
            }
        """)

        layout = QVBoxLayout(self)
        form = QFormLayout()

        self.cfg = self.controller.load_config()
        self.initial_offset = 0

        self.url_edit = QLineEdit(self.cfg.get("server_url", "http://127.0.0.1:8787"))
        self.token_edit = QLineEdit(self.cfg.get("token", ""))
        self.token_edit.setEchoMode(QLineEdit.PasswordEchoOnEdit)
        self.token_edit.setPlaceholderText("DEVICE_TOKEN (空欄可)")

        self.offset_spin = QSpinBox()
        self.offset_spin.setRange(-3600, 3600)
        self.offset_spin.setValue(0)
        self.offset_spin.setSuffix(" 秒 (負=事前/正=事後)")

        self.sound_check = QCheckBox("通知時にサウンドを鳴らす")
        self.sound_check.setChecked(self.cfg.get("play_sound", True))
        self.sound_check.setStyleSheet("color: #e0e6ed;")

        os_label = "Windows" if sys.platform == "win32" else "OS"
        self.autostart_check = QCheckBox(f"{os_label}起動時に自動起動する (常駐)")
        self.autostart_check.setChecked(self.controller.get_autostart())
        self.autostart_check.setStyleSheet("color: #e0e6ed;")

        form.addRow("Workers サーバーURL:", self.url_edit)
        form.addRow("端末認証トークン (Token):", self.token_edit)
        form.addRow("中央通知オフセット:", self.offset_spin)
        form.addRow("", self.sound_check)
        form.addRow("", self.autostart_check)

        if sys.platform == "win32":
            self.appid_check = QCheckBox("通知の送信元を「艦これ通知」として登録する (推奨)")
            self.appid_check.setChecked(self.controller.get_custom_appid())
            self.appid_check.setStyleSheet("color: #e0e6ed;")
            self.appid_check.setToolTip("有効にするとWindows通知ヘッダーに「艦これ通知」とアイコンが表示されます。\n無効の場合はPowerShell通知として動作します。")
            form.addRow("", self.appid_check)

        layout.addLayout(form)

        # 中央から現在のオフセットをコマンドで非同期取得
        def on_offset_loaded(ok, output):
            if ok:
                try:
                    data = json.loads(output)
                    if "offsetSec" in data:
                        val = int(data["offsetSec"])
                        self.initial_offset = val
                        self.offset_spin.setValue(val)
                except Exception:
                    pass
        self.controller.run_command(["offset", "--json"], on_offset_loaded)

        icons_btn = QPushButton("📁 アイコンフォルダを開く...")
        icons_btn.setObjectName("cancelBtn")
        icons_btn.setToolTip("通知種別アイコン（遠征・入渠・建造等）の保存フォルダをエクスプローラーで開きます")
        icons_btn.clicked.connect(self.open_icons_folder)

        sounds_btn = QPushButton("🔊 通知音フォルダを開く...")
        sounds_btn.setObjectName("cancelBtn")
        sounds_btn.setToolTip("カスタム通知音（.wav）の保存フォルダをエクスプローラーで開きます")
        sounds_btn.clicked.connect(self.open_sounds_folder)

        btn_layout = QHBoxLayout()
        btn_layout.addWidget(icons_btn)
        btn_layout.addWidget(sounds_btn)
        btn_layout.addStretch()

        cancel_btn = QPushButton("キャンセル")
        cancel_btn.setObjectName("cancelBtn")
        cancel_btn.clicked.connect(self.reject)

        save_btn = QPushButton("保存")
        save_btn.clicked.connect(self.save_and_close)

        btn_layout.addWidget(cancel_btn)
        btn_layout.addWidget(save_btn)
        layout.addLayout(btn_layout)

    def open_icons_folder(self):
        folder = ensure_icons_dir(self.controller.base_dir)
        QDesktopServices.openUrl(QUrl.fromLocalFile(str(folder)))

    def open_sounds_folder(self):
        folder = ensure_sounds_dir(self.controller.base_dir)
        QDesktopServices.openUrl(QUrl.fromLocalFile(str(folder)))

    def save_and_close(self):
        self.cfg["server_url"] = self.url_edit.text().strip()
        self.cfg["token"] = self.token_edit.text().strip()
        self.cfg["play_sound"] = self.sound_check.isChecked()

        # 中央通知オフセットが変更されていればコマンドで送信
        new_offset = self.offset_spin.value()
        if new_offset != self.initial_offset:
            self.controller.run_command(["offset", str(new_offset)], lambda ok, out: None)

        # 自動起動の変更を反映
        curr_autostart = self.controller.get_autostart()
        target_autostart = self.autostart_check.isChecked()
        if curr_autostart != target_autostart:
            ok, msg = self.controller.set_autostart(target_autostart)
            if not ok:
                QMessageBox.warning(self, "自動起動設定警告", f"自動起動の設定に失敗しました:\n{msg}")

        # Windows通知アプリ名（AUMID）登録の変更を反映
        if sys.platform == "win32" and hasattr(self, "appid_check"):
            curr_appid = self.controller.get_custom_appid()
            target_appid = self.appid_check.isChecked()
            if curr_appid != target_appid:
                ok, msg = self.controller.set_custom_appid(target_appid)
                if not ok:
                    QMessageBox.warning(self, "通知設定警告", f"通知アプリ名の設定に失敗しました:\n{msg}")

        if self.controller.save_config(self.cfg):
            self.accept()
        else:
            QMessageBox.critical(self, "エラー", "設定ファイルの保存に失敗しました。")


class TimetableWindow(QWidget):
    """電光掲示板・発車標風 艦これ運行管理ダッシュボード"""

    def __init__(self, base_dir: Path):
        super().__init__()
        self.base_dir = base_dir
        app_icon = get_app_icon(base_dir)
        if not app_icon.isNull():
            self.setWindowIcon(app_icon)
        self.controller = DaemonController(base_dir)
        self.cached_timers = []
        self.offset_sec = 0
        self._status_generation = 0
        self._active_action = None
        self.init_ui()

        # 毎秒カウントダウン＆時計更新用タイマー
        self.timer = QTimer(self)
        self.timer.timeout.connect(self.on_tick)
        self.timer.start(1000)

        # ストリーミング (SSE) 受信スレッド起動: Cloudflareからのプッシュのみを受信
        self.sse_worker = SseClientThread(self.controller, self)
        self.sse_worker.event_received.connect(self.on_sse_event)
        self.sse_worker.start()

        # デーモン常駐状態の確認タイマー (外部HTTP通信なし・ローカルPID確認のみ・5秒ごと)
        self.daemon_poll_timer = QTimer(self)
        self.daemon_poll_timer.timeout.connect(self.check_local_daemon_status)
        self.daemon_poll_timer.start(5000)

        self.check_local_daemon_status()

    def init_ui(self):
        self.setWindowTitle("艦これ 通知管理 v0.9.3-beta")
        self.resize(850, 480)
        self.setMinimumSize(700, 360)

        self.setStyleSheet("""
            QWidget {
                color: #f8fafc;
                font-family: 'Segoe UI', Meiryo, sans-serif;
            }
            TimetableWindow {
                background-color: #0f172a;
            }
            QLabel {
                background-color: transparent;
            }
            QFrame#headerPanel {
                background-color: #1e293b;
                border-bottom: 1px solid #334155;
                padding: 10px 16px;
            }
            QLabel#boardTitle {
                font-size: 16px;
                font-weight: bold;
                color: #f8fafc;
                letter-spacing: 0.5px;
            }
            QLabel#clockDisplay {
                font-family: Consolas, 'Courier New', monospace;
                font-size: 20px;
                font-weight: bold;
                color: #38bdf8;
            }
            QLabel#statusIndicator {
                font-size: 12px;
                font-weight: 600;
                padding: 4px 10px;
                border-radius: 10px;
            }
            QTableWidget {
                background-color: #0f172a;
                gridline-color: #1e293b;
                border: none;
                selection-background-color: #1e293b;
                selection-color: #ffffff;
                font-size: 13px;
            }
            QHeaderView::section {
                background-color: #1e293b;
                color: #94a3b8;
                font-weight: 600;
                font-size: 12px;
                padding: 8px;
                border: 1px solid #334155;
            }
            QFrame#controlPanel {
                background-color: #1e293b;
                border-top: 1px solid #334155;
                padding: 8px 16px;
            }
            QPushButton {
                background-color: #334155;
                border: 1px solid #475569;
                color: #f8fafc;
                border-radius: 4px;
                padding: 6px 14px;
                font-size: 13px;
                font-weight: 500;
            }
            QPushButton:hover {
                background-color: #475569;
            }
            QPushButton#startBtn {
                background-color: #2563eb;
                border: 1px solid #3b82f6;
                color: #ffffff;
                font-weight: bold;
            }
            QPushButton#startBtn:hover {
                background-color: #1d4ed8;
            }
            QPushButton#stopBtn {
                background-color: #dc2626;
                border: 1px solid #ef4444;
                color: #ffffff;
                font-weight: bold;
            }
            QPushButton#stopBtn:hover {
                background-color: #b91c1c;
            }
        """)

        main_layout = QVBoxLayout(self)
        main_layout.setContentsMargins(0, 0, 0, 0)
        main_layout.setSpacing(0)

        # 1. ヘッダー
        header = QFrame()
        header.setObjectName("headerPanel")
        header_layout = QHBoxLayout(header)

        title_label = QLabel("⚓ 艦これ 通知ステータス")
        title_label.setObjectName("boardTitle")

        self.status_label = QLabel("○ 停止中")
        self.status_label.setObjectName("statusIndicator")
        self.status_label.setStyleSheet("background-color: #451a1a; color: #f87171;")

        self.offset_label = QLabel("通知オフセット: 0秒")
        self.offset_label.setStyleSheet("color: #94a3b8; font-size: 13px;")

        self.clock_label = QLabel("--:--:--")
        self.clock_label.setObjectName("clockDisplay")

        header_layout.addWidget(title_label)
        header_layout.addSpacing(15)
        header_layout.addWidget(self.status_label)
        header_layout.addSpacing(15)
        header_layout.addWidget(self.offset_label)
        header_layout.addStretch()
        header_layout.addWidget(self.clock_label)

        main_layout.addWidget(header)

        # 2. タイマー一覧テーブル
        self.table = QTableWidget()
        self.table.setColumnCount(6)
        self.table.setHorizontalHeaderLabels([
            "種別",
            "艦隊 / ドック",
            "内容",
            "完了予定",
            "残り時間",
            "状態"
        ])
        self.table.horizontalHeader().setSectionResizeMode(QHeaderView.Interactive)
        self.table.horizontalHeader().setSectionResizeMode(2, QHeaderView.Stretch)
        self.table.setColumnWidth(0, 90)
        self.table.setColumnWidth(1, 130)
        self.table.setColumnWidth(3, 110)
        self.table.setColumnWidth(4, 120)
        self.table.setColumnWidth(5, 100)
        self.table.verticalHeader().setVisible(False)
        self.table.setEditTriggers(QTableWidget.NoEditTriggers)
        self.table.setSelectionBehavior(QTableWidget.SelectRows)

        main_layout.addWidget(self.table)

        # 3. 下部コントロールパネル
        footer = QFrame()
        footer.setObjectName("controlPanel")
        footer_layout = QHBoxLayout(footer)

        self.start_btn = QPushButton("▶ 常駐開始")
        self.start_btn.setObjectName("startBtn")
        self.start_btn.clicked.connect(self.start_daemon)

        self.stop_btn = QPushButton("■ 常駐停止")
        self.stop_btn.setObjectName("stopBtn")
        self.stop_btn.clicked.connect(self.stop_daemon)

        self.refresh_btn = QPushButton("🔄 更新")
        self.refresh_btn.clicked.connect(self.refresh_daemon_status)

        self.test_btn = QPushButton("🔔 通知テスト")
        self.test_btn.clicked.connect(self.test_notification)

        self.settings_btn = QPushButton("⚙ 設定")
        self.settings_btn.clicked.connect(self.open_settings)

        footer_layout.addWidget(self.start_btn)
        footer_layout.addWidget(self.stop_btn)
        footer_layout.addWidget(self.refresh_btn)
        footer_layout.addSpacing(10)
        footer_layout.addWidget(self.test_btn)
        footer_layout.addStretch()
        footer_layout.addWidget(self.settings_btn)

        main_layout.addWidget(footer)

    def on_sse_event(self, data: dict):
        """Cloudflareサーバーから届いたストリーミング（SSE）イベントの処理"""
        event_type = data.get("type")
        if event_type in ("sync", "update"):
            if "offsetSec" in data:
                self.offset_sec = data["offsetSec"]
                self.offset_label.setText(
                    f"通知オフセット: {self.offset_sec:+d}秒" if self.offset_sec != 0 else "通知オフセット: ±0秒"
                )
            self.cached_timers = data.get("timers", [])
            self.rebuild_table()

    def check_local_daemon_status(self):
        """外部HTTP通信を行わず、ローカルのPIDファイルのみでデーモン常駐状態を更新"""
        if not self.controller.is_installed():
            self.status_label.setText(f"▲ 常駐デーモン未検出 ({self.controller.exe_name})")
            self.status_label.setStyleSheet("background-color: #422006; color: #fbbf24;")
            self.start_btn.setEnabled(True)
            self.stop_btn.setEnabled(False)
            return

        st = self.controller.get_local_daemon_status()
        is_running = st.get("is_running", False)
        pid = st.get("pid")

        if is_running:
            self.status_label.setText(f"● 常駐中 (PID: {pid})")
            self.status_label.setStyleSheet("background-color: #064e3b; color: #34d399;")
            self.start_btn.setEnabled(False)
            self.stop_btn.setEnabled(True)
        else:
            self.status_label.setText("○ 停止中")
            self.status_label.setStyleSheet("background-color: #451a1a; color: #f87171;")
            self.start_btn.setEnabled(True)
            self.stop_btn.setEnabled(False)

    def closeEvent(self, event):
        """GUI終了時にSSE受信スレッドを安全に停止"""
        if hasattr(self, "sse_worker"):
            self.sse_worker.stop()
            self.sse_worker.wait(1000)
        super().closeEvent(event)

    def on_tick(self):
        """毎秒の時計更新 & テーブル内の残り時間カウントダウン更新"""
        now = datetime.now()
        self.clock_label.setText(now.strftime("%H:%M:%S"))
        self.update_remaining_times()

    def refresh_daemon_status(self):
        """デーモン状態とタイマー情報の再取得"""
        if self._active_action is not None:
            return
        if not self.controller.is_installed():
            self.status_label.setText(f"▲ 常駐デーモン未検出 ({self.controller.exe_name})")
            self.status_label.setStyleSheet("background-color: #422006; color: #fbbf24;")
            self.start_btn.setEnabled(True)
            self.stop_btn.setEnabled(False)
            self.cached_timers = []
            self.rebuild_table()
            return

        generation = self._status_generation
        def completed(ok, output):
            if generation != self._status_generation:
                self.refresh_daemon_status()
                return
            self.apply_daemon_status(ok, output)
        self.controller.run_command("status", completed)

    def apply_daemon_status(self, ok, output):
        try:
            if not ok:
                raise ValueError(output)
            status = json.loads(output)
            if not isinstance(status, dict):
                raise ValueError("不正なステータス応答")
        except (ValueError, TypeError) as error:
            self.status_label.setText("▲ 状態取得失敗")
            self.status_label.setToolTip(str(error))
            self.status_label.setStyleSheet("background-color: #422006; color: #fbbf24;")
            self.start_btn.setEnabled(True)
            self.stop_btn.setEnabled(True)
            return

        self.status_label.setToolTip("")
        is_running = status.get("is_running", False)
        pid = status.get("pid")

        if is_running:
            self.status_label.setText(f"● 常駐中 (PID: {pid})")
            self.status_label.setStyleSheet("background-color: #064e3b; color: #34d399;")
            self.start_btn.setEnabled(False)
            self.stop_btn.setEnabled(True)
        else:
            self.status_label.setText("○ 停止中")
            self.status_label.setStyleSheet("background-color: #451a1a; color: #f87171;")
            self.start_btn.setEnabled(True)
            self.stop_btn.setEnabled(False)

        self.offset_sec = status.get("offset_sec", 0)
        self.offset_label.setText(
            f"通知オフセット: {self.offset_sec:+d}秒" if self.offset_sec != 0 else "通知オフセット: ±0秒"
        )

        self.cached_timers = status.get("timers", [])
        self.rebuild_table()

    def rebuild_table(self):
        """タイマー一覧を時刻表テーブルに反映"""
        self.table.setRowCount(0)

        if not self.cached_timers:
            return

        # 種別順（遠征 -> 入渠 -> 疲労 -> 建造 -> 泊地 -> 手動）、同一種別内はスロット番号順
        kind_order = {"expedition": 1, "repair": 2, "fatigue": 3, "build": 4, "akashi": 5, "manual": 6}
        sorted_timers = sorted(
            self.cached_timers,
            key=lambda it: (kind_order.get(it.get("kind", ""), 99), it.get("slot") or 0, it.get("id", ""))
        )

        for row, item in enumerate(sorted_timers):
            kind = item.get("kind", "")
            slot_num = item.get("slot") or 0
            name = item.get("name") or "—"
            end_ms = item.get("endAt") if item.get("endAt") is not None else item.get("end_at")

            self.table.insertRow(row)

            # 1. 種別 (Type) バッジ
            type_item = QTableWidgetItem()
            type_label, color_code = self.get_type_badge(kind)
            type_item.setText(type_label)
            type_item.setTextAlignment(Qt.AlignCenter)
            type_item.setForeground(QColor(color_code))
            font = type_item.font()
            font.setBold(True)
            type_item.setFont(font)
            self.table.setItem(row, 0, type_item)

            # 2. スロット名
            slot_item = QTableWidgetItem(self.format_slot_name(kind, slot_num))
            slot_item.setTextAlignment(Qt.AlignCenter)
            self.table.setItem(row, 1, slot_item)

            # 3. 行先 / 対象
            name_item = QTableWidgetItem(name)
            name_item.setTextAlignment(Qt.AlignLeft | Qt.AlignVCenter)
            self.table.setItem(row, 2, name_item)

            # 4. 完了予定時刻（通知オフセットを反映）
            due_str = "—"
            if end_ms and end_ms > 0:
                effective_ms = end_ms + (self.offset_sec * 1000 if kind != "manual" else 0)
                due_dt = datetime.fromtimestamp(effective_ms / 1000.0)
                due_str = due_dt.strftime("%H:%M:%S")
            due_item = QTableWidgetItem(due_str)
            due_item.setTextAlignment(Qt.AlignCenter)
            due_item.setForeground(QColor("#38bdf8"))
            due_font = due_item.font()
            due_font.setFamily("Consolas")
            due_item.setFont(due_font)
            self.table.setItem(row, 3, due_item)

            # 5. 残り時間 (初期値)
            rem_item = QTableWidgetItem("—")
            rem_item.setTextAlignment(Qt.AlignCenter)
            rem_font = rem_item.font()
            rem_font.setFamily("Consolas")
            rem_font.setBold(True)
            rem_item.setFont(rem_font)
            self.table.setItem(row, 4, rem_item)

            # 6. 状態
            status_item = QTableWidgetItem()
            status_item.setTextAlignment(Qt.AlignCenter)
            self.table.setItem(row, 5, status_item)

        self.update_remaining_times()

    def update_remaining_times(self):
        """テーブル内のカウントダウンと状態表示を更新"""
        now_ms = time.time() * 1000

        kind_order = {"expedition": 1, "repair": 2, "fatigue": 3, "build": 4, "akashi": 5, "manual": 6}
        sorted_timers = sorted(
            self.cached_timers,
            key=lambda it: (kind_order.get(it.get("kind", ""), 99), it.get("slot") or 0, it.get("id", ""))
        )

        for row in range(self.table.rowCount()):
            if row >= len(sorted_timers):
                continue

            item = sorted_timers[row]
            kind = item.get("kind", "")
            end_ms = item.get("endAt") if item.get("endAt") is not None else item.get("end_at")
            state_str = item.get("state", "empty")
            events = item.get("events", [])

            rem_item = self.table.item(row, 4)
            status_item = self.table.item(row, 5)

            if state_str == "empty":
                if rem_item:
                    rem_item.setText("—")
                    rem_item.setForeground(QColor("#94a3b8"))
                if status_item:
                    status_item.setText("待機中")
                    status_item.setForeground(QColor("#64748b"))
                continue

            # 直近未到達のイベント（akashiの20分待機など）があれば取得（通知オフセットを反映）
            offset_ms = self.offset_sec * 1000 if kind != "manual" else 0
            target_ms = (end_ms + offset_ms) if end_ms else None
            phase_text = None
            if events:
                upcoming = [
                    e for e in events
                    if (e.get("endAt") or e.get("end_at")) and ((e.get("endAt") or e.get("end_at")) + offset_ms) > now_ms
                ]
                if upcoming:
                    upcoming.sort(key=lambda e: (e.get("endAt") or e.get("end_at") or 0) + offset_ms)
                    target_ev = upcoming[0]
                    target_ev_ms = target_ev.get("endAt") or target_ev.get("end_at")
                    if target_ev.get("phase") == "20min":
                        target_ms = target_ev_ms + offset_ms
                        phase_text = "20分待機"

            if not target_ms or target_ms == 0:
                if rem_item:
                    rem_item.setText("未定")
                    rem_item.setForeground(QColor("#94a3b8"))
                if status_item:
                    status_item.setText("準備中")
                    status_item.setForeground(QColor("#94a3b8"))
                continue

            diff_sec = int((target_ms - now_ms) / 1000)

            if diff_sec <= 0:
                if rem_item:
                    rem_item.setText("00:00:00")
                    rem_item.setForeground(QColor("#4ade80"))
                if status_item:
                    status_item.setText("★ 完了")
                    status_item.setForeground(QColor("#4ade80"))
            else:
                hours = diff_sec // 3600
                minutes = (diff_sec % 3600) // 60
                seconds = diff_sec % 60
                if hours > 0:
                    time_text = f"{hours:02d}:{minutes:02d}:{seconds:02d}"
                else:
                    time_text = f"{minutes:02d}:{seconds:02d}"

                if rem_item:
                    rem_item.setText(time_text)
                    if diff_sec <= 300:  # 残り5分以内
                        rem_item.setForeground(QColor("#fbbf24"))
                    else:
                        rem_item.setForeground(QColor("#e2e8f0"))

                if status_item:
                    if phase_text:
                        status_item.setText(phase_text)
                        status_item.setForeground(QColor("#c084fc"))
                    else:
                        status_text, s_color = self.get_state_display(kind)
                        status_item.setText(status_text)
                        status_item.setForeground(QColor(s_color))

    def get_type_badge(self, kind: str) -> tuple[str, str]:
        badges = {
            "expedition": ("遠征", "#f59e0b"),
            "repair": ("入渠", "#10b981"),
            "build": ("建造", "#06b6d4"),
            "fatigue": ("疲労回復", "#ec4899"),
            "akashi": ("泊地修理", "#8b5cf6"),
            "manual": ("手動予約", "#a855f7")
        }
        return badges.get(kind, ("一般", "#94a3b8"))

    def format_slot_name(self, kind: str, slot: int) -> str:
        if kind == "expedition":
            return f"第 {slot} 艦隊"
        elif kind in ("repair", "build"):
            return f"第 {slot} ドック"
        elif kind == "fatigue":
            return f"第 {slot} 艦隊"
        elif kind == "akashi":
            return "工作艦 明石"
        elif kind == "manual":
            return "手動タイマー"
        if not slot:
            return "—"
        return f"スロット {slot}"

    def get_state_display(self, kind: str) -> tuple[str, str]:
        states = {
            "expedition": ("遠征中", "#38bdf8"),
            "repair": ("入渠中", "#34d399"),
            "build": ("建造中", "#22d3ee"),
            "fatigue": ("回復待ち", "#f472b6"),
            "akashi": ("修理中", "#c084fc"),
            "manual": ("予約中", "#a855f7"),
        }
        return states.get(kind, ("待機中", "#94a3b8"))

    def start_daemon(self):
        self.run_action("start", "起動失敗")

    def stop_daemon(self):
        self.run_action("stop", "停止失敗")

    def test_notification(self):
        self.run_action("test", "通知テスト失敗")

    def run_action(self, command, title):
        if self._active_action is not None:
            return
        self._active_action = command
        self._status_generation += 1
        self.start_btn.setEnabled(False)
        self.stop_btn.setEnabled(False)
        self.test_btn.setEnabled(False)
        self.status_label.setText({"start": "◌ 起動中…", "stop": "◌ 停止中…", "test": "◌ 通知テスト中…"}[command])

        def completed(ok, message):
            self._active_action = None
            self.test_btn.setEnabled(True)
            if not ok:
                QMessageBox.warning(self, title, message or "コマンドが失敗しました。")
            self.refresh_daemon_status()
        self.controller.run_command(command, completed)

    def closeEvent(self, event):
        self.timer.stop()
        self.daemon_poll_timer.stop()
        self.controller.shutdown()
        super().closeEvent(event)

    def open_settings(self):
        dlg = SettingsDialog(self.controller, self)
        if dlg.exec():
            self.refresh_daemon_status()


def get_base_dir() -> Path:
    """実行環境に応じたベースディレクトリを取得（exe化時は自身の隣、スクリプト時はdesktop/）"""
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent.parent


def get_app_icon(base_dir: Path) -> QIcon:
    """Qt内蔵リソースからアイコンを取得。フォールバックとして外部ファイルも参照。"""
    # 1. Qtリソースコンパイルによる内蔵アイコン
    icon = QIcon(":/icon.ico")
    if not icon.isNull():
        return icon

    # 2. 外部ファイルのフォールバック参照
    for icon_name in ["icon.ico", "icon.png", "icons/app.ico", "icons/default.png"]:
        icon_file = base_dir / icon_name
        if icon_file.exists():
            return QIcon(str(icon_file))

    return QIcon()


def ensure_icons_dir(base_dir: Path) -> Path:
    """iconsフォルダおよび通知種別PNGが存在しない場合に自動生成"""
    icons_dir = base_dir / "icons"
    try:
        if not icons_dir.exists():
            icons_dir.mkdir(parents=True, exist_ok=True)

        template_names = [
            "expedition.png",
            "repair.png",
            "build.png",
            "fatigue.png",
            "akashi.png",
            "default.png",
        ]
        app_icon = get_app_icon(base_dir)

        for name in template_names:
            target = icons_dir / name
            if not target.exists():
                # 内蔵専用アイコン（キャリーケース、バスタブ、クレーン等）
                res_icon = QIcon(f":/icons/{name}")
                if not res_icon.isNull():
                    res_icon.pixmap(128, 128).save(str(target), "PNG")
                elif not app_icon.isNull():
                    app_icon.pixmap(128, 128).save(str(target), "PNG")
    except Exception:
        pass
    return icons_dir


def ensure_sounds_dir(base_dir: Path) -> Path:
    """soundsフォルダが存在しない場合に自動生成"""
    sounds_dir = base_dir / "sounds"
    try:
        if not sounds_dir.exists():
            sounds_dir.mkdir(parents=True, exist_ok=True)
    except Exception:
        pass
    return sounds_dir


def main():
    # Windowsでタスクバーに個別アプリアイコンを表示させるためのID設定（AUMID統一）
    if sys.platform == "win32":
        try:
            import ctypes
            ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID("kancolle.notify")
        except Exception:
            pass

    app = QApplication(sys.argv)
    app.setStyle("Fusion")

    base_dir = get_base_dir()
    ensure_icons_dir(base_dir)
    ensure_sounds_dir(base_dir)
    app_icon = get_app_icon(base_dir)
    if not app_icon.isNull():
        app.setWindowIcon(app_icon)

    window = TimetableWindow(base_dir)
    if not app_icon.isNull():
        window.setWindowIcon(app_icon)
    window.show()

    sys.exit(app.exec())


if __name__ == "__main__":
    main()
