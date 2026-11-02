import type { CustomAttribute, CustomAttributeOption, CustomAttributeType } from './types'

export const CUSTOM_ATTRIBUTE_TYPES: readonly CustomAttributeType[] = [
  'text',
  'number',
  'radio',
  'checkbox',
  'date',
  'link',
  'email'
]

export const CUSTOM_ATTRIBUTE_TYPE_LABELS: Record<CustomAttributeType, string> = {
  text: '文本',
  number: '数字',
  radio: '单选',
  checkbox: '多选',
  date: '日期',
  link: '链接',
  email: '邮箱'
}

/** 选项的规范值：未填写 value 时回退到 label。 */
export function optionKey(option: Pick<CustomAttributeOption, 'label' | 'value'>): string {
  return option.value || option.label
}

export function isOptionValue(
  attribute: Pick<CustomAttribute, 'extra'>,
  raw: string
): boolean {
  return attribute.extra.some((option) => optionKey(option) === raw)
}

export function optionLabel(
  attribute: Pick<CustomAttribute, 'extra'>,
  raw: string
): string {
  return attribute.extra.find((option) => optionKey(option) === raw)?.label || raw
}
