import { publicPriceNote } from '../lib/data'
import type { PriceItem, SkipassGroup } from '../types'
import { DataTable } from './DataTable'

function visitorNote(note: string | null | undefined): string | null {
  return publicPriceNote(note)
}

function formatRub(price: number | null | undefined): string {
  if (price == null) return '—'
  return `${price.toLocaleString('ru-RU')} ₽`
}

function hasDurationColumn(group: SkipassGroup): boolean {
  return group.rows.some((r) => Boolean(r.duration))
}

function isSinglePriceColumn(group: SkipassGroup): boolean {
  return group.columns.length === 1 && /^цена$/i.test(group.columns[0] ?? '')
}

/** Nested day×duration header when columnGroups spans match leaf columns. */
function hasNestedColumnGroups(group: SkipassGroup): boolean {
  const groups = group.columnGroups
  if (!groups?.length || !group.columns.length) return false
  const spanSum = groups.reduce((sum, g) => sum + (g.span || 0), 0)
  return spanSum === group.columns.length
}

/** Soften ALL-CAPS site headings (e.g. Igora) for readable RU titles. */
function displayCategory(category: string): string {
  const t = category.trim()
  if (t.length > 4 && t === t.toLocaleUpperCase('ru')) {
    return t.charAt(0) + t.slice(1).toLocaleLowerCase('ru')
  }
  return t
}

/**
 * Igora rental duration bands: break before «каждые» so
 * «После 1 часа каждые 30 минут» / «После 4 часов каждые 30 минут» stack like the site.
 * Used for nested columnGroups (снаряжение) and flat columns (одежда и аксессуары).
 * Other headers stay single-line.
 */
function formatDurationBandLabel(label: string) {
  const m = /^(После\s+\d+\s+час(?:а|ов))\s+(каждые\s+30\s+минут)$/iu.exec(label.trim())
  if (!m) return label
  return (
    <>
      {m[1]}
      <br />
      {m[2]}
    </>
  )
}

function isDurationBandWrap(label: string): boolean {
  return /^(После\s+\d+\s+час(?:а|ов))\s+(каждые\s+30\s+минут)$/iu.test(label.trim())
}

type Props = {
  groups: SkipassGroup[]
  /** Flat fallback when groups are empty. */
  items: PriceItem[]
  showAll: boolean
  previewLimit?: number
  onToggleShowAll: () => void
}

export function SkipassTables({
  groups,
  items,
  showAll,
  previewLimit = 8,
  onToggleShowAll,
}: Props) {
  const structured = groups.filter((g) => g.rows?.length > 0)

  if (structured.length > 0) {
    return (
      <div className="skipass">
        {structured.map((group, groupIdx) => {
          const nested = hasNestedColumnGroups(group)
          const showDuration = !nested && hasDurationColumn(group)
          const singleCol = isSinglePriceColumn(group)
          const title = displayCategory(group.category)
          return (
            <section key={`${title}-${groupIdx}`} className="skipass-group" aria-label={title}>
              <h3 className="skipass-group__title">{title}</h3>
              {visitorNote(group.note) ? (
                <p className="skipass-group__note">{visitorNote(group.note)}</p>
              ) : null}
              <DataTable aria-label={title}>
                {nested ? (
                  <>
                    <thead>
                      <tr>
                        <th scope="col" rowSpan={2}>
                          Тариф
                        </th>
                        {group.columnGroups!.map((cg) => (
                          <th
                            key={cg.label}
                            scope="colgroup"
                            colSpan={cg.span}
                            className={
                              isDurationBandWrap(cg.label)
                                ? 'mh-table__num mh-table__colgroup mh-table__band-wrap'
                                : 'mh-table__num mh-table__colgroup'
                            }
                          >
                            {formatDurationBandLabel(cg.label)}
                          </th>
                        ))}
                      </tr>
                      <tr>
                        {group.columns.map((col, ci) => (
                          <th key={`${col}-${ci}`} scope="col" className="mh-table__num">
                            {col}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {group.rows.map((row, idx) => (
                        <tr key={`${row.name}-${idx}`}>
                          <th scope="row">
                            {row.name}
                            {visitorNote(row.note) ? (
                              <span className="mh-table__note">{visitorNote(row.note)}</span>
                            ) : null}
                          </th>
                          {group.columns.map((col, ci) => {
                            const cell = row.prices[ci]
                            const cellNote = visitorNote(cell?.note)
                            return (
                              <td key={`${col}-${ci}`} className="mh-table__num">
                                <span className="mh-table__amount">{formatRub(cell?.price)}</span>
                                {cellNote ? <span className="mh-table__note">{cellNote}</span> : null}
                              </td>
                            )
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </>
                ) : (
                  <>
                    <thead>
                      <tr>
                        <th scope="col">Тариф</th>
                        {showDuration ? <th scope="col">Длительность</th> : null}
                        {singleCol ? (
                          <th scope="col" className="mh-table__num">
                            Цена
                          </th>
                        ) : (
                          group.columns.map((col) => (
                            <th
                              key={col}
                              scope="col"
                              className={
                                isDurationBandWrap(col)
                                  ? 'mh-table__num mh-table__band-wrap'
                                  : 'mh-table__num'
                              }
                            >
                              {formatDurationBandLabel(col)}
                            </th>
                          ))
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {group.rows.map((row, idx) => (
                        <tr key={`${row.name}-${row.duration ?? ''}-${idx}`}>
                          <th scope="row">
                            {row.name}
                            {visitorNote(row.note) ? (
                              <span className="mh-table__note">{visitorNote(row.note)}</span>
                            ) : null}
                          </th>
                          {showDuration ? <td>{row.duration || '—'}</td> : null}
                          {(singleCol ? [group.columns[0]] : group.columns).map((col, ci) => {
                            const cell = row.prices[ci]
                            const cellNote = visitorNote(cell?.note)
                            return (
                              <td key={col} className="mh-table__num">
                                <span className="mh-table__amount">{formatRub(cell?.price)}</span>
                                {cellNote ? <span className="mh-table__note">{cellNote}</span> : null}
                              </td>
                            )
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </>
                )}
              </DataTable>
            </section>
          )
        })}
      </div>
    )
  }

  // Fail soft: flat table when scrape only has unstructured items.
  const visible =
    showAll || items.length <= previewLimit ? items : items.slice(0, previewLimit)

  return (
    <>
      <DataTable aria-label="Цены">
        <thead>
          <tr>
            <th scope="col">Тариф</th>
            <th scope="col" className="mh-table__num">
              Цена
            </th>
          </tr>
        </thead>
        <tbody>
          {visible.map((item) => (
            <tr key={`${item.title}-${item.price}-${item.unit ?? ''}`}>
              <th scope="row">
                {item.title}
                {item.unit ? <span className="muted"> · {item.unit}</span> : null}
                {visitorNote(item.note) ? (
                  <span className="mh-table__note">{visitorNote(item.note)}</span>
                ) : null}
              </th>
              <td className="mh-table__num">
                <span className="mh-table__amount">
                  {item.price != null ? formatRub(item.price) : (item.rawText ?? '—')}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </DataTable>
      {items.length > previewLimit && (
        <button type="button" className="mh-table__more" onClick={onToggleShowAll}>
          {showAll ? 'Свернуть список' : `Показать ещё ${items.length - previewLimit}`}
        </button>
      )}
    </>
  )
}
