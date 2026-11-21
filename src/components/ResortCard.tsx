import { Link } from 'react-router-dom'
import { ExternalLink } from './LinkedText'
import {
  hoursFor,
  localizePublicText,
  priceHintFor,
  pricesFor,
  slopesClosedHint,
  statusLabel,
  truncateText,
} from '../lib/data'
import { stripUrlsFromText } from '../lib/links'
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
  // Never show raw URLs/paths on cards — strip them, keep a short human summary.
  const hoursPlain = rawHours ? stripUrlsFromText(rawHours) || 'уточняйте на сайте' : null
  const hoursText = hoursPlain ? truncateText(hoursPlain, compact ? 72 : 110) : 'нет данных'
  const closed = slopesClosedHint(resort.id, h, important)
  // When slopes are closed, don't advertise a live «от N ₽» next to the warn badge.
  const priceHint = closed ? 'сезон закрыт' : priceHintFor(p)

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
          <dd title={hoursPlain ?? undefined}>{hoursText}</dd>
        </div>
        <div>
          <dt>Цены</dt>
          <dd>{priceHint}</dd>
        </div>
      </dl>
      <div className="resort-card__links">
        <Link to={`/resort/${resort.id}`}>Подробнее</Link>
        {resort.website && (
          <ExternalLink href={resort.website}>Сайт курорта</ExternalLink>
        )}
        {resort.webcam_url && (
          <ExternalLink href={resort.webcam_url}>Открыть трансляцию</ExternalLink>
        )}
      </div>
    </article>
  )
}
