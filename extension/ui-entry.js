// 依存モジュールの読込失敗も初期表示のままにしない。
import('./ui.js').catch(() => {
  document.querySelector('#notice').textContent = '画面の初期化に失敗しました。拡張機能を再読み込みしてください。';
});
