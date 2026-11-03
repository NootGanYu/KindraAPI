/** 类型标签统一配色；与 JSON 代码着色使用同一套视觉语言。 */
export function jsonTypeClass(type?: string): string {
  const key = String(type || 'any').toLowerCase()
  return `json-type json-type-${key}`
}
