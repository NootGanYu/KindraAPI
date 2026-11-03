export interface CandidateDiffRow {
  before?: string
  after?: string
  beforeNumber?: number
  afterNumber?: number
  changed: boolean
}
/** Sequence diff: duplicate lines retain their positions; large inputs use a conservative whole-block diff. */
export function candidateDiff(before: string[], after: string[]): CandidateDiffRow[] {
  const rows: CandidateDiffRow[] = []
  let i = 0, j = 0
  const flush = (deleted: number[], added: number[]): void => {
    for (let index = 0; index < Math.max(deleted.length, added.length); index++) {
      const left = deleted[index], right = added[index]
      rows.push({ before: left === undefined ? undefined : before[left], after: right === undefined ? undefined : after[right], beforeNumber: left === undefined ? undefined : left + 1, afterNumber: right === undefined ? undefined : right + 1, changed: true })
    }
  }
  if ((before.length + 1) * (after.length + 1) > 1_000_000) {
    flush(before.map((_, index) => index), after.map((_, index) => index))
    return rows
  }
  const width = after.length + 1
  const lengths = new Uint32Array((before.length + 1) * width)
  for (i = before.length - 1; i >= 0; i--) for (j = after.length - 1; j >= 0; j--) lengths[i * width + j] = before[i] === after[j] ? lengths[(i + 1) * width + j + 1] + 1 : Math.max(lengths[(i + 1) * width + j], lengths[i * width + j + 1])
  i = 0; j = 0
  while (i < before.length || j < after.length) {
    if (i < before.length && j < after.length && before[i] === after[j]) {
      rows.push({ before: before[i], after: after[j], beforeNumber: ++i, afterNumber: ++j, changed: false }); continue
    }
    const deleted: number[] = [], added: number[] = []
    while ((i < before.length || j < after.length) && !(i < before.length && j < after.length && before[i] === after[j])) {
      if (i < before.length && (j === after.length || lengths[(i + 1) * width + j] >= lengths[i * width + j + 1])) deleted.push(i++)
      else added.push(j++)
    }
    flush(deleted, added)
  }
  return rows
}
