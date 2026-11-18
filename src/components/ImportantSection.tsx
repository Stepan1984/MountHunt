import { formatUpdatedAt } from '../lib/data'
import type { ImportantItem, Resort } from '../types'

type Props = {
  items: ImportantItem[]
  resorts: Resort[]
}

export function ImportantSection({ items, resorts }: Props) {
  const nameById = new Map(resorts.map((r) => [r.id, r.name]))

  return (
    <section className="section important" id="important" aria-labelledby="important-title">
      <div className="section__head">
        <h2 id="important-title">Важное</h2>
        <p>Статусы и заметки по курортам — без персональных уведомлений.</p>
      </div>
      <ul className="important__list">
        {items.map((item) => (
          <li
            key={item.id}
            className={`important__item important__item--${item.severity}`}
          >
            <div className="important__meta">
              <span className="important__severity">
                {item.severity === 'warn' ? 'Внимание' : 'Инфо'}
              </span>
              <time dateTime={item.updatedAt}>{formatUpdatedAt(item.updatedAt)}</time>
            </div>
            <h3>{item.title}</h3>
            {item.resortId && (
              <p className="important__resort">{nameById.get(item.resortId) ?? item.resortId}</p>
            )}
            {item.body && <p>{item.body}</p>}
            {item.sourceUrl && (
              <a href={item.sourceUrl} target="_blank" rel="noreferrer">
                Источник
              </a>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
