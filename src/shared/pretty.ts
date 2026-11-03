/** 尝试把文本格式化为 JSON；失败时保留原文并返回错误信息。 */
export function tryPrettyJson(raw: string | undefined | null): {
  text: string
  error?: string
} {
  const text = raw ?? ''
  if (!text.trim()) return { text: '' }
  try {
    return { text: JSON.stringify(JSON.parse(text), null, 2) }
  } catch (error) {
    return { text, error: (error as Error).message }
  }
}
