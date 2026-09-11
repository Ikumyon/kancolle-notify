import math
import sys
import json
import os
import time
from datetime import datetime
from pathlib import Path

def calculate_akashi_progress(ship: dict, start: int, now: int) -> dict:
    """KC3準拠の明石修理（泊地修理）進捗計算"""
    hp = ship.get("hp", 0)
    max_hp = ship.get("max", hp)
    missing = max(1, max_hp - hp)
    repair = ship.get("repair", 0)
    mod = ship.get("mod", 1.0)

    base_repair = max(0, repair - 30000) * mod
    minute = math.ceil(base_repair / 60000.0) * 60000.0
    tick = math.ceil(minute / missing)

    min_repair = 1200000
    missing_num = max_hp - hp
    if missing_num == 1:
        end = start + min_repair
    else:
        end = start + max(min_repair, math.ceil(tick * missing_num / 60000.0) * 60000)

    elapsed = max(0, now - start)
    if elapsed < min_repair:
        healed = 0
    else:
        minutes_ms = (elapsed // 60000) * 60000
        count = math.floor(minutes_ms / tick) if tick > 0 else 0
        healed = min(missing_num, max(1, count))

    return {
        "hp": min(max_hp, hp + healed),
        "healed": healed,
        "end": int(end),
        "is_full": (hp + healed >= max_hp)
    }

from PySide6.QtCore import Qt, QTimer
from PySide6.QtGui import QColor, QFont, QIcon, QPalette
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

        self.url_edit = QLineEdit(self.cfg.get("server_url", "http://127.0.0.1:8787"))
        self.token_edit = QLineEdit(self.cfg.get("token", ""))
        self.token_edit.setEchoMode(QLineEdit.PasswordEchoOnEdit)
        self.token_edit.setPlaceholderText("DEVICE_TOKEN (空欄可)")

        self.interval_spin = QSpinBox()
        self.interval_spin.setRange(5, 600)
        self.interval_spin.setValue(self.cfg.get("poll_interval_sec", 30))
        self.interval_spin.setSuffix(" 秒")

        self.advance_spin = QSpinBox()
        self.advance_spin.setRange(0, 600)
        self.advance_spin.setValue(self.cfg.get("notify_advance_sec", 0))
        self.advance_spin.setSuffix(" 秒前 (0=ジャスト)")

        self.sound_check = QCheckBox("通知時にサウンドを鳴らす")
        self.sound_check.setChecked(self.cfg.get("play_sound", True))
        self.sound_check.setStyleSheet("color: #e0e6ed;")

        os_label = "Windows" if sys.platform == "win32" else "OS"
        self.autostart_check = QCheckBox(f"{os_label}起動時に自動起動する (常駐)")
        self.autostart_check.setChecked(self.controller.get_autostart())
        self.autostart_check.setStyleSheet("color: #e0e6ed;")

        form.addRow("Workers サーバーURL:", self.url_edit)
        form.addRow("端末認証トークン (Token):", self.token_edit)
        form.addRow("ステータス確認間隔:", self.interval_spin)
        form.addRow("事前通知タイミング:", self.advance_spin)
        form.addRow("", self.sound_check)
        form.addRow("", self.autostart_check)

        layout.addLayout(form)

        btn_layout = QHBoxLayout()
        btn_layout.addStretch()

        cancel_btn = QPushButton("キャンセル")
        cancel_btn.setObjectName("cancelBtn")
        cancel_btn.clicked.connect(self.reject)

        save_btn = QPushButton("保存")
        save_btn.clicked.connect(self.save_and_close)

        btn_layout.addWidget(cancel_btn)
        btn_layout.addWidget(save_btn)
        layout.addLayout(btn_layout)

    def save_and_close(self):
        self.cfg["server_url"] = self.url_edit.text().strip()
        self.cfg["token"] = self.token_edit.text().strip()
        self.cfg["poll_interval_sec"] = self.interval_spin.value()
        self.cfg["notify_advance_sec"] = self.advance_spin.value()
        self.cfg["play_sound"] = self.sound_check.isChecked()

        # 自動起動の変更を反映
        curr_autostart = self.controller.get_autostart()
        target_autostart = self.autostart_check.isChecked()
        if curr_autostart != target_autostart:
            ok, msg = self.controller.set_autostart(target_autostart)
            if not ok:
                QMessageBox.warning(self, "自動起動設定警告", f"自動起動の設定に失敗しました:\n{msg}")

        if self.controller.save_config(self.cfg):
            self.accept()
        else:
            QMessageBox.critical(self, "エラー", "設定ファイルの保存に失敗しました。")


class TimetableWindow(QWidget):
    """電光掲示板・発車標風 艦これ運行管理ダッシュボード"""

    def __init__(self, base_dir: Path):
        super().__init__()
        self.controller = DaemonController(base_dir)
        self.cached_slots = {}
        self._status_generation = 0
        self._active_action = None
        self.init_ui()

        # 毎秒カウントダウン＆時計更新用タイマー
        self.timer = QTimer(self)
        self.timer.timeout.connect(self.on_tick)
        self.timer.start(1000)

        # デーモンステータス確認用タイマー (5秒ごと)
        self.daemon_poll_timer = QTimer(self)
        self.daemon_poll_timer.timeout.connect(self.refresh_daemon_status)
        self.daemon_poll_timer.start(5000)

        self.refresh_daemon_status()

    def init_ui(self):
        self.setWindowTitle("艦これ 運行案内表示板 (Kancolle Timetable)")
        self.resize(850, 480)
        self.setMinimumSize(700, 360)

        # 発車案内標（Departures Board）風のダークスタイリング
        self.setStyleSheet("""
            QWidget {
                background-color: #0b0e14;
                color: #e5e9f0;
                font-family: 'Segoe UI', Meiryo, sans-serif;
            }
            QFrame#headerPanel {
                background-color: #121824;
                border-bottom: 2px solid #1e293b;
                padding: 10px 15px;
            }
            QLabel#boardTitle {
                font-size: 18px;
                font-weight: bold;
                letter-spacing: 2px;
                color: #f1f5f9;
            }
            QLabel#clockDisplay {
                font-family: Consolas, 'Courier New', monospace;
                font-size: 22px;
                font-weight: bold;
                color: #38bdf8;
                letter-spacing: 1px;
            }
            QLabel#statusIndicator {
                font-size: 13px;
                font-weight: bold;
                padding: 4px 10px;
                border-radius: 12px;
            }
            QTableWidget {
                background-color: #0a0d12;
                gridline-color: #1a2230;
                border: 1px solid #1e293b;
                selection-background-color: #1e293b;
                selection-color: #ffffff;
                font-size: 13px;
            }
            QHeaderView::section {
                background-color: #141b27;
                color: #94a3b8;
                font-weight: bold;
                font-size: 12px;
                padding: 8px;
                border: 1px solid #1e293b;
            }
            QFrame#controlPanel {
                background-color: #121824;
                border-top: 1px solid #1e293b;
                padding: 8px 12px;
            }
            QPushButton {
                background-color: #1e293b;
                border: 1px solid #334155;
                color: #f8fafc;
                border-radius: 4px;
                padding: 6px 14px;
                font-size: 13px;
                font-weight: 500;
            }
            QPushButton:hover {
                background-color: #334155;
                border-color: #475569;
            }
            QPushButton#startBtn {
                background-color: #065f46;
                border-color: #059669;
                color: #ecfdf5;
                font-weight: bold;
            }
            QPushButton#startBtn:hover {
                background-color: #047857;
            }
            QPushButton#stopBtn {
                background-color: #881337;
                border-color: #e11d48;
                color: #fff1f2;
                font-weight: bold;
            }
            QPushButton#stopBtn:hover {
                background-color: #9f1239;
            }
        """)

        main_layout = QVBoxLayout(self)
        main_layout.setContentsMargins(0, 0, 0, 0)
        main_layout.setSpacing(0)

        # 1. 発車案内ヘッダー
        header = QFrame()
        header.setObjectName("headerPanel")
        header_layout = QHBoxLayout(header)

        title_label = QLabel("⚓ 艦隊運行案内 (FLEET DEPARTURES)")
        title_label.setObjectName("boardTitle")

        self.status_label = QLabel("● 停止中")
        self.status_label.setObjectName("statusIndicator")
        self.status_label.setStyleSheet("background-color: #3f1d24; color: #f87171;")

        self.clock_label = QLabel("--:--:--")
        self.clock_label.setObjectName("clockDisplay")

        header_layout.addWidget(title_label)
        header_layout.addSpacing(15)
        header_layout.addWidget(self.status_label)
        header_layout.addStretch()
        header_layout.addWidget(self.clock_label)

        main_layout.addWidget(header)

        # 2. 時刻表テーブル (Timetable Table)
        self.table = QTableWidget()
        self.table.setColumnCount(6)
        self.table.setHorizontalHeaderLabels([
            "種別 (TYPE)",
            "艦隊 / ドック (SLOT)",
            "行先 / 対象 (DESTINATION)",
            "完了予定 (DUE)",
            "残り時間 (TIME LEFT)",
            "状態 (STATUS)"
        ])
        self.table.horizontalHeader().setSectionResizeMode(QHeaderView.Interactive)
        self.table.horizontalHeader().setSectionResizeMode(2, QHeaderView.Stretch)
        self.table.setColumnWidth(0, 100)
        self.table.setColumnWidth(1, 140)
        self.table.setColumnWidth(3, 110)
        self.table.setColumnWidth(4, 130)
        self.table.setColumnWidth(5, 110)
        self.table.verticalHeader().setVisible(False)
        self.table.setEditTriggers(QTableWidget.NoEditTriggers)
        self.table.setSelectionBehavior(QTableWidget.SelectRows)

        main_layout.addWidget(self.table)

        # 3. 下部コントロールパネル
        footer = QFrame()
        footer.setObjectName("controlPanel")
        footer_layout = QHBoxLayout(footer)

        self.start_btn = QPushButton("▶ 運行開始 (Start)")
        self.start_btn.setObjectName("startBtn")
        self.start_btn.clicked.connect(self.start_daemon)

        self.stop_btn = QPushButton("■ 運行停止 (Stop)")
        self.stop_btn.setObjectName("stopBtn")
        self.stop_btn.clicked.connect(self.stop_daemon)

        self.refresh_btn = QPushButton("🔄 再読み込み")
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

    def on_tick(self):
        """毎秒の時計更新 & テーブル内の残り時間カウントダウン更新"""
        now = datetime.now()
        self.clock_label.setText(now.strftime("%H:%M:%S"))
        self.update_remaining_times()

    def refresh_daemon_status(self):
        """デーモン状態とスロット情報の再取得"""
        if self._active_action is not None:
            return
        if not self.controller.is_installed():
            self.status_label.setText(f"▲ 常駐デーモン未検出 ({self.controller.exe_name})")
            self.status_label.setStyleSheet("background-color: #422006; color: #fbbf24;")
            self.start_btn.setEnabled(True)
            self.stop_btn.setEnabled(False)
            self.cached_slots = {}
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
            if not isinstance(status, dict) or not isinstance(status.get("slots", {}), dict):
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
            self.status_label.setText(f"● 運行中 (PID: {pid})")
            self.status_label.setStyleSheet("background-color: #064e3b; color: #34d399;")
            self.start_btn.setEnabled(False)
            self.stop_btn.setEnabled(True)
        else:
            self.status_label.setText("○ 運行停止中")
            self.status_label.setStyleSheet("background-color: #451a1a; color: #f87171;")
            self.start_btn.setEnabled(True)
            self.stop_btn.setEnabled(False)

        self.cached_slots = status.get("slots", {})
        self.rebuild_table()

    def rebuild_table(self):
        """スロット一覧を時刻表テーブルに反映"""
        self.table.setRowCount(0)

        if not self.cached_slots:
            return

        # スロットをソート（遠征 -> 入渠 -> 疲労 -> 建造 -> その他、同一種別内はスロット番号順）
        kind_order = {"expedition": 1, "repair": 2, "fatigue": 3, "build": 4, "akashi": 5, "manual": 6}
        sorted_keys = sorted(
            self.cached_slots.keys(),
            key=lambda k: (
                kind_order.get(self.cached_slots[k].get("kind", ""), 99),
                self.cached_slots[k].get("slot") or 0
            )
        )

        for row, key in enumerate(sorted_keys):
            item = self.cached_slots[key]
            kind = item.get("kind", "")
            slot_num = item.get("slot") or 0
            name = item.get("name") or "—"
            end_ms = item.get("end")
            state_str = item.get("state", "empty")

            # 泊地修理（明石修理）の詳細表示
            if kind == "akashi" and state_str == "active" and item.get("repair"):
                repair_data = item["repair"]
                start_ms = repair_data.get("start", 0)
                ships = repair_data.get("ships", [])
                now_ms = time.time() * 1000

                ship_parts = []
                latest_end = start_ms + 1200000
                for s in ships:
                    p = calculate_akashi_progress(s, start_ms, int(now_ms))
                    status_lbl = "全快" if p["is_full"] else f"残{max(0, math.ceil((p['end'] - now_ms) / 60000))}分"
                    ship_parts.append(f"{s.get('name')}: {s.get('hp')}→{p['hp']} (+{p['healed']}) {status_lbl}")
                    if p["end"] > latest_end:
                        latest_end = p["end"]
                name = " / ".join(ship_parts) if ship_parts else (name or "修理中")
                end_ms = latest_end if now_ms >= start_ms + 1200000 else (start_ms + 1200000)

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

            # 4. 完了予定時刻
            due_str = "—"
            if end_ms and end_ms > 0:
                due_dt = datetime.fromtimestamp(end_ms / 1000.0)
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

        for row in range(self.table.rowCount()):
            # 種別とスロットからキーを推定、または cached_slots から取得
            kind_item = self.table.item(row, 0)
            if not kind_item:
                continue

            # 行の予定時刻アイテムから end_ms を逆算するか、cached_slots から引く
            # ここではテーブル各行に対応するデータを順次参照
            keys = sorted(
                self.cached_slots.keys(),
                key=lambda k: (
                    {"expedition": 1, "repair": 2, "fatigue": 3, "build": 4, "akashi": 5, "manual": 6}.get(
                        self.cached_slots[k].get("kind", ""), 99
                    ),
                    self.cached_slots[k].get("slot") or 0
                )
            )
            if row >= len(keys):
                continue

            item = self.cached_slots[keys[row]]
            kind = item.get("kind", "")
            end_ms = item.get("end")
            state_str = item.get("state", "empty")

            rem_item = self.table.item(row, 4)
            status_item = self.table.item(row, 5)

            # --- 泊地修理（明石修理）の動的更新 ---
            if kind == "akashi" and state_str == "active" and item.get("repair"):
                repair_data = item["repair"]
                start_ms = repair_data.get("start", 0)
                ships = repair_data.get("ships", [])
                min_repair_due = start_ms + 1200000

                # 艦娘一覧表示と全回復判定の更新
                ship_parts = []
                latest_end = min_repair_due
                all_full = True
                for s in ships:
                    p = calculate_akashi_progress(s, start_ms, int(now_ms))
                    if not p["is_full"]:
                        all_full = False
                    status_lbl = "全快" if p["is_full"] else f"残{max(0, math.ceil((p['end'] - now_ms) / 60000))}分"
                    ship_parts.append(f"{s.get('name')}: {s.get('hp')}→{p['hp']} (+{p['healed']}) {status_lbl}")
                    if p["end"] > latest_end:
                        latest_end = p["end"]

                # 行先/対象カラムを最新HPで更新
                name_item = self.table.item(row, 2)
                if name_item and ship_parts:
                    name_item.setText(" / ".join(ship_parts))

                due_item = self.table.item(row, 3)

                if now_ms < min_repair_due:
                    # 20分到達前
                    if due_item:
                        due_dt = datetime.fromtimestamp(min_repair_due / 1000.0)
                        due_item.setText(due_dt.strftime("%H:%M:%S"))
                    diff_sec = int((min_repair_due - now_ms) / 1000)
                    minutes = diff_sec // 60
                    seconds = diff_sec % 60
                    if rem_item:
                        rem_item.setText(f"{minutes:02d}:{seconds:02d}")
                        rem_item.setForeground(QColor("#fbbf24"))
                    if status_item:
                        status_item.setText("20分待機")
                        status_item.setForeground(QColor("#c084fc"))
                else:
                    # 20分経過後
                    if due_item:
                        due_dt = datetime.fromtimestamp(latest_end / 1000.0)
                        due_item.setText(due_dt.strftime("%H:%M:%S"))
                    diff_sec = int((latest_end - now_ms) / 1000)
                    if all_full or diff_sec <= 0:
                        if rem_item:
                            rem_item.setText("00:00:00")
                            rem_item.setForeground(QColor("#4ade80"))
                        if status_item:
                            status_item.setText("★ 全回復")
                            status_item.setForeground(QColor("#4ade80"))
                    else:
                        hours = diff_sec // 3600
                        minutes = (diff_sec % 3600) // 60
                        seconds = diff_sec % 60
                        time_text = f"{hours:02d}:{minutes:02d}:{seconds:02d}" if hours > 0 else f"{minutes:02d}:{seconds:02d}"
                        if rem_item:
                            rem_item.setText(time_text)
                            rem_item.setForeground(QColor("#e2e8f0"))
                        if status_item:
                            status_item.setText("修理中")
                            status_item.setForeground(QColor("#c084fc"))
                continue

            if state_str == "empty":
                if rem_item: rem_item.setText("—")
                if status_item:
                    status_item.setText("待機中")
                    status_item.setForeground(QColor("#64748b"))
                continue

            if not end_ms or end_ms == 0:
                if rem_item: rem_item.setText("未定")
                if status_item:
                    status_item.setText("準備中")
                    status_item.setForeground(QColor("#94a3b8"))
                continue

            diff_sec = int((end_ms - now_ms) / 1000)

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
                    status_text, s_color = self.get_state_display(item.get("kind", ""))
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
            "expedition": ("航行中", "#38bdf8"),
            "repair": ("修復中", "#34d399"),
            "build": ("建造中", "#22d3ee"),
            "fatigue": ("回復待機", "#f472b6"),
            "akashi": ("修理中", "#c084fc"),
        }
        return states.get(kind, ("進行中", "#94a3b8"))

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


def main():
    # Windowsでタスクバーに個別アプリアイコンを表示させるためのID設定
    if sys.platform == "win32":
        try:
            import ctypes
            ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID("kancolle.notify.timetable")
        except Exception:
            pass

    app = QApplication(sys.argv)
    app.setStyle("Fusion")

    base_dir = get_base_dir()

    # Windows & Linux 両対応のアイコン設定 (.ico / .png のある方を採用)
    for icon_name in ["icon.ico", "icon.png"]:
        icon_file = base_dir / icon_name
        if icon_file.exists():
            app.setWindowIcon(QIcon(str(icon_file)))
            break

    window = TimetableWindow(base_dir)
    window.show()

    sys.exit(app.exec())


if __name__ == "__main__":
    main()
