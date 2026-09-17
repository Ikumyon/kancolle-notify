export function readFatigueTarget(input) {
  const value = Number(input.value);
  if (!Number.isInteger(value) || value < 0 || value > 54) throw new Error('invalid_fatigue_target');
  return value;
}
export function readFatiguePresets(input) {
  const parts = input.value.trim().split(/[,、\s]+/);
  if (parts.some(value => !/^\d{1,2}$/.test(value))) throw new Error('invalid_fatigue_presets');
  const values = parts.map(Number);
  if (values.length < 1 || values.length > 12 || new Set(values).size !== values.length || values.some(value => value > 54)) throw new Error('invalid_fatigue_presets');
  return values;
}
