import { Link } from 'react-router-dom'
import {
  hoursFor,
  localizePublicText,
  slopesClosedHint,
  statusLabel,
} from '../lib/data'
import { stripUrlsFromText } from '../lib/links'
import type { HoursSnapshot, ImportantItem, Resort } from '../types'

type Props = {
  resort: Resort
  hours: HoursSnapshot[]
  important?: ImportantItem[]
  compact?: boolean
}

export function ResortCard({
  resort,
  hours,
  important = [],
  compact = false,
}: Props) {
  const inactive = resort.status !== 'active'
  const h = hoursFor(resort.id, hours)
  const closed = slopesClosedHint(resort.id, h, important)

  // Active only: live hours. Prices live on the detail page, not on cards.
  // Дикие / неясные / закрытые — omit facts entirely.
  let hoursText: string | null = null
  if (!inactive) {
    const rawHours = h?.summary ? localizePublicText(h.summary) : null
    // Never show raw URLs/paths on cards — strip them, keep the human summary.
    hoursText = rawHours ? stripUrlsFromText(rawHours) || 'уточняйте на сайте' : 'нет данных'
  }

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
      {!inactive && hoursText ? (
        <dl className="resort-card__facts">
          <div>
            <dt>Часы</dt>
            <dd>{hoursText}</dd>
          </div>
        </dl>
      ) : null}
      {/* Single CTA: detail page owns site / cam / tariffs links. */}
      <div className="resort-card__links">
        <Link to={`/resort/${resort.id}`}>Подробнее</Link>
      </div>
    </article>
  )
}
