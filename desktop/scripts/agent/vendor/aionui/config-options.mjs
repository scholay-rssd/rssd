/**
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 * Adapted from useAcpConfigOptions.ts at AionUi v2.2.2 (6744099b).
 * Today changes: standalone JS, ACP camelCase fields and grouped options.
 * Original license and source attribution are alongside this file.
 */
const optionLabel = option => option.name || option.label || option.value;
export function getOptionCurrentValue(option) {
 return option?.currentValue ?? option?.current_value ?? null;
}
export function findConfigOption(options, category, fallbackIds = []) {
 if (!options?.length) return null;
 return options.find(option => option.category === category) ||
  options.find(option => fallbackIds.includes(option.id)) || null;
}
export function deriveSelectOption(options, category, fallbackIds = []) {
 const option = findConfigOption(options, category, fallbackIds);
 if (!option || (option.option_type ?? option.type ?? 'select') !== 'select') return null;
 return {
  id: option.id, category, currentValue: getOptionCurrentValue(option),
  options: (option.options || []).flatMap(choice => choice.options || [choice]).map(choice => ({
   value: choice.value, label: optionLabel(choice), description: choice.description,
  })),
 };
}
