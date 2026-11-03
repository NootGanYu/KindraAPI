import { candidateDiff } from './candidateDiff'
export default function SnapshotDiff({ before, after }: { before: unknown; after: unknown }): JSX.Element {
  const rows = candidateDiff(JSON.stringify(before, null, 2).split('\n'), JSON.stringify(after, null, 2).split('\n'))
  return <div aria-label="候选双栏差异" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 8, marginTop: 16 }}>
    {(['before', 'after'] as const).map(side => <div key={side}><strong>{side === 'before' ? '基线' : 'Agent 提案'}</strong><pre style={{ overflow: 'auto', maxHeight: 420, fontSize: 12, background: '#fafafa', padding: 8 }}>{rows.map((row, index) => <div key={index} data-diff={row.changed && row[side] !== undefined ? (side === 'before' ? 'removed' : 'added') : 'same'} style={{ minHeight: '1.5em', background: row.changed && row[side] !== undefined ? (side === 'before' ? '#fff0ef' : '#edfaef') : undefined }}><span style={{ opacity: .4 }}>{String(row[side === 'before' ? 'beforeNumber' : 'afterNumber'] ?? '').padStart(3)} </span>{row.changed && row[side] !== undefined ? (side === 'before' ? '- ' : '+ ') : '  '}{row[side] ?? ' '}</div>)}</pre></div>)}
  </div>
}
