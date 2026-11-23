import { Link } from 'react-router-dom'
import { ImportantItemCard } from './ImportantItemCard'
import { formatUpdatedAt, operationalImportant } from '../lib/data'
import type { ImportantItem, Meta, Resort } from '../types'

type Props = {
  items: ImportantItem[]
  resorts: Resort[]
  meta?: Pick<Meta, 'importantScrapedAt' | 'updatedAt'>
  /** Compact strip after hero — operational items only. */
  variant?: 'full' | 'strip'
}

export function ImportantSection({ items, resorts, meta, variant = 'full' }: Props) {
  const nameById = new Map(resorts.map((r) => [r.id, r.name]))
  const visible = operationalImportant(items)
  const refreshedAt = meta?.importantScrapedAt || meta?.updatedAt

  return (
    <section
      className={`section important important--${variant}`}
      id="important"
      aria-labelledby="important-title"
    >
      <div className="section__head important__head">
        <div className="important__head-text">
          <h2 id="important-title">Важное</h2>
          {refreshedAt ? (
            <p>
              Обновлено:{' '}
              <time dateTime={refreshedAt}>{formatUpdatedAt(refreshedAt)}</time>
            </p>
          ) : null}
        </div>
        <Link className="important__all-link" to="/news">
          Все новости
        </Link>
      </div>
      {visible.length === 0 ? (
        <p className="muted">Сейчас нет срочных заметок по склонам.</p>
      ) : (
        <ul className="important__list">
          {visible.map((item) => (
            <ImportantItemCard
              key={item.id}
              item={item}
              resortName={item.resortId ? nameById.get(item.resortId) : undefined}
            />
          ))}
        </ul>
      )}
    </section>
  )
}
