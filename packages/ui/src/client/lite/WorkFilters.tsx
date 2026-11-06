import type { ReactElement } from 'react'
import { useTabMarker } from './use-tab-marker.ts'
import css from './work-page.module.css'

export type WorkFilter = 'all' | 'attention' | 'active' | 'finished'

/** 展示真实工作分组数，切换仅影响列表显示。 */
export function WorkFilters({ value, counts, onChange }: { value: WorkFilter; counts: { attention: number; active: number; finished: number }; onChange(value: WorkFilter): void }): ReactElement {
  const filters: readonly [WorkFilter, string, number | undefined][] = [
    ['all', '全部', undefined], ['attention', '要你处理', counts.attention], ['active', '进行中', counts.active], ['finished', '已结束', counts.finished],
  ]
  const bar = useTabMarker(value)
  return <div ref={bar} className={css.filters} role="tablist" aria-label="后台工作筛选">
    <span className={css.tabMarker} aria-hidden="true" />
    {filters.map(([key, label, count]) => <button key={key} type="button" role="tab" aria-selected={value === key} onClick={() => onChange(key)}>{label}{count ? ` ${count}` : ''}</button>)}
  </div>
}
