import { Link } from 'react-router-dom'
import {
  hoursFor,
  localizePublicText,
  priceHintFor,
  pricesFor,
  slopesClosedHint,
  statusLabel,
  truncateText,
} from '../lib/data'
import type { HoursSnapshot, ImportantItem, PriceSnapshot, Resort } from '../types'

type Props = {
  resort: Resort
  hours: HoursSnapshot[]
  prices: PriceSnapshot[]
  important?: ImportantItem[]
  compact?: boolean
}

export function ResortCard({
  resort,
  hours,
  prices,
  important = [],
  compact = false,
}: Props) {
  const h = hoursFor(resort.id, hours)
  const p = pricesFor(resort.id, prices)
  const rawHours = h?.summary ? localizePublicText(h.summary) : null
  const hoursText = rawHours ? truncateText(rawHours, compact ? 72 : 110) : 'нет данных'
  const priceHint = priceHintFor(p)
  const closed = slopesClosedHint(resort.id, h, important)

  return (
    <article className={`resort-card resort-card--${resort.status}${compact ? ' resort-card--compact' : ''}${closed ? ' resort-card--slopes-closed' : ''}`}>
      <Link to={`/resort/${resort.id}`} className="resort-card__hit" aria-label={`${resort.name} — подробнее`}>
        <span className="visually-hidden">{resort.name}</span>
      </Link>
      <div className="resort-card__top">
        <h3>
          <Link to={`/resort/${resort.id}`}>{resort.name}</Link>
        </h3>
        <div className="resort-card__badges">
          {closed ? (
            <span className="badge badge--warn">Склоны закрыты</span>
          ) : (
            <span className={`badge badge--${resort.status}`}>{statusLabel(resort.status)}</span>
          )}
        </div>
      </div>
      <p className="resort-card__area">{resort.city_or_district || resort.area}</p>
      <dl className="resort-card__facts">
        <div>
          <dt>Часы</dt>
          <dd title={rawHours ?? undefined}>{hoursText}</dd>
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
