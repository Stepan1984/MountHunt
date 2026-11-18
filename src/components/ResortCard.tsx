import { Link } from 'react-router-dom'
import { hoursFor, pricesFor, statusLabel } from '../lib/data'
import type { HoursSnapshot, PriceSnapshot, Resort } from '../types'

type Props = {
  resort: Resort
  hours: HoursSnapshot[]
  prices: PriceSnapshot[]
}

export function ResortCard({ resort, hours, prices }: Props) {
  const h = hoursFor(resort.id, hours)
  const p = pricesFor(resort.id, prices)
  const priceHint =
    p?.items?.[0]?.price != null
      ? `от ${p.items[0].price.toLocaleString('ru-RU')} ₽`
      : 'цены уточняются'

  return (
    <article className={`resort-card resort-card--${resort.status}`}>
      <div className="resort-card__top">
        <h3>
          <Link to={`/resort/${resort.id}`}>{resort.name}</Link>
        </h3>
        <span className={`badge badge--${resort.status}`}>{statusLabel(resort.status)}</span>
      </div>
      <p className="resort-card__area">{resort.area}</p>
      <dl className="resort-card__facts">
        <div>
          <dt>Часы</dt>
          <dd>{h?.summary ?? 'нет данных'}</dd>
        </div>
        <div>
          <dt>Цены</dt>
          <dd>{priceHint}</dd>
        </div>
      </dl>
      <div className="resort-card__links">
        <Link to={`/resort/${resort.id}`}>Подробнее</Link>
        {resort.website && (
          <a href={resort.website} target="_blank" rel="noreferrer">
            Сайт
          </a>
        )}
        {resort.webcam_url && (
          <a href={resort.webcam_url} target="_blank" rel="noreferrer">
            Камера
          </a>
        )}
      </div>
    </article>
  )
}
