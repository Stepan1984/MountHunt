import type { PriceItem, SkipassGroup } from '../types'

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
        {structured.map((group) => {
          const showDuration = hasDurationColumn(group)
          const singleCol = isSinglePriceColumn(group)
          return (
            <section key={group.category} className="skipass-group" aria-label={group.category}>
              <h3 className="skipass-group__title">{group.category}</h3>
              {group.note ? <p className="skipass-group__note">{group.note}</p> : null}
              <div className="skipass-table-wrap">
                <table className="skipass-table">
                  <thead>
                    <tr>
                      <th scope="col">Тариф</th>
                      {showDuration ? <th scope="col">Длительность</th> : null}
                      {singleCol ? (
                        <th scope="col" className="skipass-table__price">
                          Цена
                        </th>
                      ) : (
                        group.columns.map((col) => (
                          <th key={col} scope="col" className="skipass-table__price">
                            {col}
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
                          {row.note ? <span className="skipass-table__row-note">{row.note}</span> : null}
                        </th>
                        {showDuration ? <td>{row.duration || '—'}</td> : null}
                        {(singleCol ? [group.columns[0]] : group.columns).map((col, ci) => {
                          const cell = row.prices[ci]
                          return (
                            <td key={col} className="skipass-table__price">
                              <span className="skipass-table__amount">{formatRub(cell?.price)}</span>
                              {cell?.note ? (
                                <span className="skipass-table__cell-note">{cell.note}</span>
                              ) : null}
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )
        })}
      </div>
    )
  }

  // Fail soft: flat list when scrape only has unstructured items.
  const visible =
    showAll || items.length <= previewLimit ? items : items.slice(0, previewLimit)

  return (
    <>
      <ul className="price-list">
        {visible.map((item) => (
          <li key={`${item.title}-${item.price}-${item.unit ?? ''}`}>
            <span>
              {item.title}
              {item.unit ? <span className="muted"> · {item.unit}</span> : null}
              {item.note ? <span className="price-list__note">{item.note}</span> : null}
            </span>
            <strong>
              {item.price != null ? formatRub(item.price) : (item.rawText ?? '—')}
            </strong>
          </li>
        ))}
      </ul>
      {items.length > previewLimit && (
        <button type="button" className="price-list__more" onClick={onToggleShowAll}>
          {showAll ? 'Свернуть список' : `Показать ещё ${items.length - previewLimit}`}
        </button>
      )}
    </>
  )
}
