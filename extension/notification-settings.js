export function settingsPatch(document) {
  const providers = Object.fromEntries([...document.querySelectorAll('[data-provider]')].map(i => [i.dataset.provider, i.checked]));
  const categories = Object.fromEntries([...document.querySelectorAll('[data-category]')].map(i => [i.dataset.category, i.checked]));
  return { offsetSec: Number(document.querySelector('#offset').value),
    hideBuildName: document.querySelector('#hide-build').checked, providers, categories };
}
