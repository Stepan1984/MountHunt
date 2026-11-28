import { Link } from 'react-router-dom'
import { cardTagBadgeClass, liveCardTagsForResort } from '../lib/card-tags'
import { cardHoursText, hoursFor, slopesBadgeLabel } from '../lib/data'
import { seasonOpenBadgeLabel } from '../lib/season-open-badge'
import type { CardTagsDocument, HoursSnapshot, ImportantItem, Resort } from '../types'

type Props = {
  resort: Resort
  hours: HoursSnapshot[]
  important?: ImportantItem[]
  cardTags?: CardTagsDocument | null
}

export function ResortCard({
  resort,
  hours,
  important = [],
  cardTags = null,
}: Props) {
  const inactive = resort.status !== 'active'
  const h = hoursFor(resort.id, hours)
  // Slope open/closed badges only on active resorts; дикие/закрытые — no status badges.
  // Fail-soft: open only when scrape/important positively says so.
  const badge = !inactive ? slopesBadgeLabel(resort.id, h, important) : null
  const closed = badge === 'Склоны закрыты'
  // Future season start from scraped news (hide once the date has passed, MSK).
  // Krasnoe: opening postponed indefinitely — never show «Начало сезона» / season-open
  // (main-line cleanup is #128; this branch also hard-skips for the AI tags prototype).
  const seasonBadge =
    !inactive && resort.id !== 'krasnoe-ozero'
      ? seasonOpenBadgeLabel(resort.id, important)
      : null
  // AI/rule tags from scrape JSON (Krasnoe prototype). Never show «из новости».
  // Season kinds already filtered out for Krasnoe in liveCardTagsForResort.
  const aiTags = !inactive ? liveCardTagsForResort(cardTags, resort.id) : []
  const showSeason = Boolean(seasonBadge)

  const hasBadges = Boolean(badge || (showSeason && seasonBadge) || aiTags.length)
  // Active only: unified schedule line (no slope status prose — badges cover that).
  // Дикие / неясные / закрытые — omit facts entirely.
  // News-sourced caption («из новости») is detail-page only — not on home cards.
  const hoursText = !inactive ? cardHoursText(h) : null

  return (
    <article className={`resort-card resort-card--${resort.status}${closed ? ' resort-card--slopes-closed' : ''}`}>
      <Link to={`/resort/${resort.id}`} className="resort-card__hit" aria-label={`${resort.name} — подробнее`}>
        <span className="visually-hidden">{resort.name}</span>
      </Link>
      <div className="resort-card__top">
        <h3>
          <Link to={`/resort/${resort.id}`}>{resort.name}</Link>
        </h3>
        {!inactive && hasBadges ? (
          <div className="resort-card__badges">
            {badge ? (
              closed ? (
                <span className="badge badge--warn">{badge}</span>
              ) : (
                <span className="badge badge--open">{badge}</span>
              )
            ) : null}
            {showSeason && seasonBadge ? (
              <span className="badge badge--season">{seasonBadge}</span>
            ) : null}
            {aiTags.map((tag) => (
              <span key={tag.id} className={cardTagBadgeClass(tag)}>
                {tag.label}
              </span>
            ))}
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
