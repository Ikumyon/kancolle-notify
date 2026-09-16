-- 新スキーマの完全初期化用。稼働Worker・DO Alarmを停止し、対象DBを確認してから手動実行する。
-- 旧スキーマの未知テーブルはこのSQLでは消えない。旧DB全体のパージはdocs/rework_instructions.mdを参照。
DELETE FROM audit_batches;
DELETE FROM account_state;
