import { Link } from 'react-router-dom'
import { ExternalLink, LinkedText } from './LinkedText'
import { formatImportantDate, formatUpdatedAt, operationalImportant } from '../lib/data'
import { linkLabelForUrl } from '../lib/links'
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
      <div className="section__head">
        <h2 id="important-title">Важное</h2>
        {refreshedAt ? (
          <p>
            Обновлено:{' '}
            <time dateTime={refreshedAt}>{formatUpdatedAt(refreshedAt)}</time>
          </p>
        ) : null}
      </div>
      {visible.length === 0 ? (
        <p className="muted">Сейчас нет срочных заметок по склонам.</p>
      ) : (
        <ul className="important__list">
          {visible.map((item) => {
            const resortName = item.resortId ? nameById.get(item.resortId) : undefined
            return (
              <li key={item.id} className="important__item">
                {item.publishedAt ? (
                  <div className="important__meta">
                    <time dateTime={item.publishedAt}>{formatImportantDate(item.publishedAt)}</time>
                  </div>
                ) : null}
                <h3>
                  {item.resortId ? (
                    <Link to={`/resort/${item.resortId}`}>{item.title}</Link>
                  ) : (
                    item.title
                  )}
                </h3>
                {resortName && item.resortId && (
                  <p className="important__resort">
                    <Link to={`/resort/${item.resortId}`}>{resortName}</Link>
                  </p>
                )}
                {item.body && (
                  <p>
                    <LinkedText text={item.body} />
                  </p>
                )}
                {item.sourceUrl && (
                  <ExternalLink href={item.sourceUrl}>
                    {linkLabelForUrl(item.sourceUrl, 'Источник')}
                  </ExternalLink>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
