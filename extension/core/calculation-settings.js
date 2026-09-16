export const defaultCalculationSettings = () => ({ fatigueTarget: 49, fatiguePresets: [40, 49], fatigueTargets: {} });
export function calculationSettings(current, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch) || Object.keys(patch).some(k => !Object.hasOwn(current, k))) throw new Error('invalid_calculation_settings');
  const next = structuredClone(current);
  const target = v => Number.isInteger(v) && v >= 0 && v <= 49;
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'fatigueTarget') { if (!target(value)) throw new Error('invalid_fatigue_target'); }
    if (key === 'fatiguePresets' && (!Array.isArray(value) || value.length < 1 || value.length > 12 || new Set(value).size !== value.length || !value.every(target))) throw new Error('invalid_fatigue_presets');
    if (key === 'fatigueTargets') {
      if (!value || typeof value !== 'object' || Array.isArray(value) || Object.entries(value).some(([id, v]) => !['1', '2', '3', '4'].includes(id) || v !== null && !target(v))) throw new Error('invalid_fatigue_targets');
      Object.assign(next[key], value);
    } else next[key] = structuredClone(value);
  }
  return next;
}
