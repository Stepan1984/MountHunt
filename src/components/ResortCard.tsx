import { Link } from 'react-router-dom'
import { cardHoursText, hoursFor, slopesBadgeLabel } from '../lib/data'
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
  // Slope open/closed badges only on active resorts; дикие/закрытые — no status badges.
  // Fail-soft: open only when scrape/important positively says so.
  const badge = !inactive ? slopesBadgeLabel(resort.id, h, important) : null
  const closed = badge === 'Склоны закрыты'

  // Active only: unified schedule line (no slope status prose — badges cover that).
  // Дикие / неясные / закрытые — omit facts entirely.
  const hoursText = !inactive ? cardHoursText(h) : null

  return (
    <article className={`resort-card resort-card--${resort.status}${compact ? ' resort-card--compact' : ''}${closed ? ' resort-card--slopes-closed' : ''}`}>
      <Link to={`/resort/${resort.id}`} className="resort-card__hit" aria-label={`${resort.name} — подробнее`}>
        <span className="visually-hidden">{resort.name}</span>
      </Link>
      <div className="resort-card__top">
        <h3>
          <Link to={`/resort/${resort.id}`}>{resort.name}</Link>
        </h3>
        {!inactive && badge ? (
          <div className="resort-card__badges">
            {closed ? (
              <span className="badge badge--warn">{badge}</span>
            ) : (
              <span className="badge badge--open">{badge}</span>
            )}
          </div>
        ) : null}
      </div>
      <p className="resort-card__area">{resort.city_or_district || resort.area}</p>
      {!inactive && hoursText ? (
        <dl className="resort-card__facts">
          <div>
            <dt>Часы</dt>
            <dd className="resort-card__hours">{hoursText}</dd>
          </div>
        </dl>
      ) : null}
    </article>
  )
}
