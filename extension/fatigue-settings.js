import { fatigueSettings, emptyFatigueSettings } from './core/fatigue.js';
const form = document.querySelector('#fatigue-settings'), presets = document.querySelector('#fatigue-presets'),
  select = document.querySelector('#fatigue-default'), notice = document.querySelector('#fatigue-notice');
let saved = emptyFatigueSettings();
function values() {
  const parts = presets.value.trim() ? presets.value.trim().split(/[,、\s]+/) : [];
  if (!parts.every(p => /^\d{1,3}$/.test(p))) throw new Error('invalid');
  return parts.map(Number);
}
function options(selected = select.value) {
  let list; try { list = values(); } catch { return; }
  select.replaceChildren(new Option('未設定', ''), ...[...new Set(list)].filter(n => n <= 100).map(n => new Option(String(n), String(n))));
  select.value = list.includes(Number(selected)) && selected !== '' ? selected : '';
}
chrome.storage.local.get('fatigueSettings').then(r => {
  saved = r.fatigueSettings || saved; presets.value = saved.presets.join(', '); options(saved.defaultTarget === null ? '' : String(saved.defaultTarget));
}).catch(() => { notice.textContent = '設定を読み取れません。開き直してください。'; });
presets.addEventListener('input', () => { options(); notice.textContent = '未保存'; });
select.addEventListener('change', () => { notice.textContent = '未保存'; });
form.addEventListener('submit', async e => {
  e.preventDefault(); const button = form.querySelector('button'); button.disabled = true;
  try {
    const settings = fatigueSettings({ presets: values(), defaultTarget: select.value === '' ? null : Number(select.value), fleets: saved.fleets });
    const result = await chrome.runtime.sendMessage({ type: 'fatigue-settings', settings });
    if (result.error) throw new Error(result.error);
    saved = result.value; notice.textContent = '保存しました。登録した数字をポップアップで選べます。';
  } catch { notice.textContent = '保存できません。0～100の重複しない整数を12件以内で登録し、既定値を選択肢から選んでください。'; }
  finally { button.disabled = false; }
});
