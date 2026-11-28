import { Link } from 'react-router-dom'
import { cardHoursText, cardNewsHoursText, hoursFor, slopesBadgeLabel } from '../lib/data'
import { seasonOpenBadgeLabel } from '../lib/season-open-badge'
import type { HoursSnapshot, ImportantItem, Resort } from '../types'

type Props = {
  resort: Resort
  hours: HoursSnapshot[]
  important?: ImportantItem[]
}

export function ResortCard({
  resort,
  hours,
  important = [],
}: Props) {
  const inactive = resort.status !== 'active'
  const h = hoursFor(resort.id, hours)
  // Slope open/closed badges only on active resorts; дикие/закрытые — no status badges.
  // Fail-soft: open only when scrape/important positively says so.
  const badge = !inactive ? slopesBadgeLabel(resort.id, h, important) : null
  const closed = badge === 'Склоны закрыты'
  // Future season start from scraped news (hide once the date has passed, MSK).
  const seasonBadge = !inactive ? seasonOpenBadgeLabel(resort.id, important) : null

  // Active only: primary site schedule + optional highlighted news overlay.
  // Дикие / неясные / закрытые — omit facts entirely.
  // No «из новости» label on cards (prefs).
  // Primary + news share one <dd> so the news line is the same text flow /
  // left edge as «пн–пт» (separate <dd> + highlight chrome was shifting ink).
  const hoursText = !inactive ? cardHoursText(h) : null
  const newsHoursText = !inactive ? cardNewsHoursText(h) : null
  const hasPrimaryHours = Boolean(hoursText && hoursText !== 'нет данных')
  const showHours = !inactive && (hasPrimaryHours || newsHoursText)

  return (
    <article className={`resort-card resort-card--${resort.status}${closed ? ' resort-card--slopes-closed' : ''}`}>
      <Link to={`/resort/${resort.id}`} className="resort-card__hit" aria-label={`${resort.name} — подробнее`}>
        <span className="visually-hidden">{resort.name}</span>
      </Link>
      <div className="resort-card__top">
        <h3>
          <Link to={`/resort/${resort.id}`}>{resort.name}</Link>
        </h3>
        {!inactive && (badge || seasonBadge) ? (
          <div className="resort-card__badges">
            {badge ? (
              closed ? (
                <span className="badge badge--warn">{badge}</span>
              ) : (
                <span className="badge badge--open">{badge}</span>
              )
            ) : null}
            {seasonBadge ? (
              <span className="badge badge--season">{seasonBadge}</span>
            ) : null}
          </div>
        ) : null}
      </div>
      <p className="resort-card__area">{resort.city_or_district || resort.area}</p>
      {showHours ? (
        <dl className="resort-card__facts">
          <div>
            <dt>Часы</dt>
            <dd className="resort-card__hours">
              {hasPrimaryHours ? hoursText : null}
              {newsHoursText ? (
                <>
                  {hasPrimaryHours ? '\n' : null}
                  <span className="resort-card__hours-extra">{newsHoursText}</span>
                </>
              ) : null}
            </dd>
          </div>
        </dl>
      ) : null}
    </article>
  )
}
