import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { DataTable } from '../components/DataTable'
import { ExternalLink, LinkedText } from '../components/LinkedText'
import { ResortMap } from '../components/ResortMap'
import { SkipassTables } from '../components/SkipassTables'
import { WebcamSection } from '../components/WebcamPlayer'
import {
  formatUpdatedAt,
  hoursFor,
  hoursLeadText,
  localizePublicText,
  pricesFor,
  publicPriceNote,
  resortAddressQuery,
  scrapeStatusLabel,
  slopesBadgeLabel,
  yandexMapsUrl,
} from '../lib/data'
import { linkLabelForUrl, sameExternalUrl } from '../lib/links'
import { resolveWebcamPlayers, webcamExternalLink } from '../lib/webcam'
import type { SiteData } from '../types'

const PRICE_PREVIEW = 8

/**
 * Shared resort-detail section order:
 * header → site / news → webcam → [hours → prices if active] →
 * features → contacts → location → links
 * Hours / prices sections are omitted for дикие / неясные / закрытые (status !== active).
 * Address lives only under «Локация» (Yandex link); phone/email only under «Контакты».
 * Features (щётки, подушка…) are in-resort sections — never separate catalog entries.
 * News live on /news?resort=<id> — no inline «Важное» block on detail pages.
 */
export function ResortPage({ data }: { data: SiteData }) {
  const { id } = useParams()
  const resort = data.resorts.find((r) => r.id === id)
  const [showAllPrices, setShowAllPrices] = useState(false)

  function formatRub(price: number | null | undefined): string {
    if (price == null) return '—'
    return `${price.toLocaleString('ru-RU')} ₽`
  }

  function featureHoursCell(open: string, close: string): string {
    if (!open || open === '—') return close
    if (!close || close === '—') return open
    return `${open}–${close}`
  }

  if (!resort) {
    return (
      <section className="section page-narrow">
        <h1>Курорт не найден</h1>
        <p>Такой страницы нет в каталоге MountHunt.</p>
        <Link to="/">На главную</Link>
      </section>
    )
  }

  // Same inactive/secondary flag as catalog cards and gray map (PR #57).
  const inactive = resort.status !== 'active'
  const hours = hoursFor(resort.id, data.hours)
  const prices = inactive ? undefined : pricesFor(resort.id, data.prices)
  const hasCoords = resort.lat != null && resort.lon != null
  // Booking outbound link replaces the tariff table (no scraped prices).
  const bookingUrl = !inactive ? resort.booking_url || undefined : undefined
  const hasBookingLink = Boolean(bookingUrl)
  // Dedicated tariff page only — do not fall back to homepage (already «Сайт курорта»).
  const tariffsUrl = hasBookingLink
    ? undefined
    : prices?.sourceUrl || resort.prices_url || undefined
  const hoursSourceUrl = hours?.sourceUrl || undefined
  // Skip section source links when they duplicate the official homepage button.
  const hoursLink =
    !inactive &&
    hoursSourceUrl &&
    !sameExternalUrl(hoursSourceUrl, resort.website)
      ? hoursSourceUrl
      : undefined
  const tariffsLink =
    !inactive && tariffsUrl && !sameExternalUrl(tariffsUrl, resort.website)
      ? tariffsUrl
      : undefined
  const hoursSummaryRaw =
    !inactive && hours?.summary ? localizePublicText(hours.summary) : null
  const hoursLead = hoursLeadText(hoursSummaryRaw, hours?.periods)
  const hoursSummary = inactive
    ? null
    : (hoursLead ?? (hours?.periods?.length ? null : 'Нет данных'))
  // Slope badges only for active resorts; inactive detail pages show none.
  const badge = !inactive ? slopesBadgeLabel(resort.id, hours, data.important) : null
  const closed = badge === 'Склоны закрыты'
  const visitorPriceNote = inactive || hasBookingLink ? null : publicPriceNote(prices?.note)
  const priceItems = hasBookingLink ? [] : (prices?.items ?? [])
  const priceGroups = hasBookingLink ? [] : (prices?.groups ?? [])
  const hasSkipassTables = priceGroups.some((g) => g.rows?.length > 0)
  const webcamStreams = resolveWebcamPlayers(resort.webcam_url, resort.webcam_embeds)
  const webcamLink = webcamExternalLink(resort.webcam_url, resort.webcam_embeds)
  // Hide community URL when it already powers «Сайт курорта» (e.g. Putilovo → Telegram).
  const communityLinks = (resort.community_links ?? []).filter(
    (url) => !sameExternalUrl(url, resort.website),
  )
  const features = resort.features ?? []
  const phone = resort.phone?.trim() || null
  const email = resort.email?.trim() || null
  const hasContacts = Boolean(phone || email)
  const mapsUrl = yandexMapsUrl({
    lat: resort.lat,
    lon: resort.lon,
    query: resortAddressQuery(resort),
  })
  const telHref = phone ? `tel:${phone.replace(/[^\d+]/g, '')}` : undefined

  return (
    <article className="section page-narrow resort-detail">
      <p className="crumb">
        <Link to="/">Курорты</Link>
        <span aria-hidden="true"> / </span>
        <span>{resort.name}</span>
      </p>

      <header className="resort-detail__header">
        <h1>{resort.name}</h1>
        {!inactive && badge ? (
          closed ? (
            <span className="badge badge--warn">{badge}</span>
          ) : (
            <span className="badge badge--open">{badge}</span>
          )
        ) : null}
      </header>

      {/* Top CTAs: official site + filtered news feed. Hours / tariffs / cam live below. */}
      <div className="resort-detail__actions" role="group" aria-label="Ссылки курорта">
        {resort.website ? (
          <ExternalLink className="btn btn--primary" href={resort.website}>
            Сайт курорта
          </ExternalLink>
        ) : null}
        <Link
          className={`btn ${resort.website ? 'btn--ghost' : 'btn--primary'}`}
          to={`/news?resort=${encodeURIComponent(resort.id)}`}
        >
          Новости курорта
        </Link>
      </div>

      {webcamLink && (
        <WebcamSection
          key={resort.id}
          resortName={resort.name}
          externalUrl={webcamLink}
          streams={webcamStreams}
        />
      )}

      <div className="detail-grid">
        {/* Active only — same rule as ResortCard: no empty / stub hours·prices for secondary. */}
        {!inactive && (
          <section className="detail-grid__wide" aria-labelledby="resort-hours-title">
            <div className="detail-section__head">
              <h2 id="resort-hours-title">Часы работы</h2>
              {hoursLink && (
                <ExternalLink className="detail-section__source" href={hoursLink}>
                  Расписание на сайте
                </ExternalLink>
              )}
            </div>
            {hoursSummary && (
              <p className="detail-lead">
                <LinkedText text={hoursSummary} />
              </p>
            )}
            {hours?.periods && hours.periods.length > 0 && (
              <DataTable aria-label="Часы работы">
                <thead>
                  <tr>
                    <th scope="col">Дни</th>
                    <th scope="col" className="mh-table__num">
                      Часы
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {hours.periods.map((period) => (
                    <tr key={`${period.days}-${period.open}-${period.close}`}>
                      <th scope="row">{period.days}</th>
                      <td className="mh-table__num">
                        <span className="mh-table__amount">
                          {period.open}–{period.close}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
            )}
            {hours?.status === 'failed' && (
              <p className="muted">
                Последний сбор часов не удался — показаны прежние данные, если они были.
              </p>
            )}
            <p className="muted">
              Актуальность: {formatUpdatedAt(hours?.scrapedAt)} · {scrapeStatusLabel(hours?.status)}
            </p>
          </section>
        )}

        {!inactive && (
          <section
            className={hasSkipassTables ? 'detail-grid__wide' : undefined}
            aria-labelledby="resort-prices-title"
          >
            <div className="detail-section__head">
              <h2 id="resort-prices-title">Цены</h2>
              {tariffsLink && (
                <ExternalLink className="detail-section__source" href={tariffsLink}>
                  Тарифы на сайте
                </ExternalLink>
              )}
            </div>
            {hasBookingLink && bookingUrl ? (
              <p>
                <ExternalLink href={bookingUrl}>бронирование и оплата</ExternalLink>
              </p>
            ) : priceItems.length > 0 || hasSkipassTables ? (
              <SkipassTables
                groups={priceGroups}
                items={priceItems}
                showAll={showAllPrices}
                previewLimit={PRICE_PREVIEW}
                onToggleShowAll={() => setShowAllPrices((v) => !v)}
              />
            ) : (
              <p>
                {visitorPriceNote ? (
                  <LinkedText text={visitorPriceNote} />
                ) : (
                  'Цены появятся после ежедневного обновления данных.'
                )}
              </p>
            )}
            {!hasBookingLink && visitorPriceNote && (priceItems.length > 0 || hasSkipassTables) && (
              <p className="muted">
                <LinkedText text={visitorPriceNote} />
              </p>
            )}
            {!hasBookingLink && prices?.status === 'failed' && (
              <p className="muted">
                Последний сбор цен не удался — показаны прежние данные, если они были.
              </p>
            )}
            {!hasBookingLink && (
              <p className="muted">
                Актуальность: {formatUpdatedAt(prices?.scrapedAt)} · {scrapeStatusLabel(prices?.status)}
              </p>
            )}
          </section>
        )}

        {features.map((feature) => {
          const featureTel = feature.phone?.trim()
            ? `tel:${feature.phone.replace(/[^\d+]/g, '')}`
            : undefined
          const featurePrices = feature.prices ?? []
          const featurePeriods = feature.periods ?? []
          const titleId = `resort-feature-${feature.id}-title`
          return (
            <section
              key={feature.id}
              className="detail-grid__wide"
              aria-labelledby={titleId}
            >
              <div className="detail-section__head">
                <h2 id={titleId}>{feature.title}</h2>
                {feature.sourceUrl && (
                  <ExternalLink className="detail-section__source" href={feature.sourceUrl}>
                    {feature.sourceLabel || linkLabelForUrl(feature.sourceUrl, 'Подробнее')}
                  </ExternalLink>
                )}
              </div>
              {feature.season && <p className="feature-season">{feature.season}</p>}
              <p className="detail-lead">
                <LinkedText text={feature.summary} />
              </p>
              {feature.hoursSummary && localizePublicText(feature.hoursSummary) && (
                <p>
                  <LinkedText text={localizePublicText(feature.hoursSummary)} />
                </p>
              )}
              {featurePeriods.length > 0 && (
                <DataTable aria-label={`Часы: ${feature.title}`}>
                  <thead>
                    <tr>
                      <th scope="col">Дни</th>
                      <th scope="col" className="mh-table__num">
                        Часы
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {featurePeriods.map((period) => (
                      <tr key={`${feature.id}-${period.days}-${period.open}-${period.close}`}>
                        <th scope="row">{period.days}</th>
                        <td className="mh-table__num">
                          <span className="mh-table__amount">
                            {featureHoursCell(period.open, period.close)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </DataTable>
              )}
              {featurePrices.length > 0 && (
                <DataTable aria-label={`Цены: ${feature.title}`}>
                  <thead>
                    <tr>
                      <th scope="col">Тариф</th>
                      <th scope="col" className="mh-table__num">
                        Цена
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {featurePrices.map((row) => (
                      <tr key={`${feature.id}-${row.title}`}>
                        <th scope="row">
                          {row.title}
                          {row.unit ? (
                            <span className="muted"> · {row.unit}</span>
                          ) : null}
                        </th>
                        <td className="mh-table__num">
                          <span className="mh-table__amount">{formatRub(row.price)}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </DataTable>
              )}
              {featureTel && feature.phone && (
                <p className="feature-phone">
                  <span className="contact-list__label">Телефон спота </span>
                  <a href={featureTel}>{feature.phone}</a>
                </p>
              )}
              {feature.note && localizePublicText(feature.note) && (
                <p className="muted">
                  <LinkedText text={localizePublicText(feature.note)} />
                </p>
              )}
            </section>
          )
        })}

        {hasContacts && (
          <section aria-labelledby="resort-contacts-title">
            <div className="detail-section__head">
              <h2 id="resort-contacts-title">Контакты</h2>
            </div>
            <ul className="contact-list">
              {phone && telHref && (
                <li>
                  <span className="contact-list__label">Телефон</span>
                  <a href={telHref}>{phone}</a>
                </li>
              )}
              {email && (
                <li>
                  <span className="contact-list__label">Почта</span>
                  <a href={`mailto:${email}`}>{email}</a>
                </li>
              )}
            </ul>
          </section>
        )}

        <section className="detail-grid__wide" aria-labelledby="resort-location-title">
          <div className="detail-section__head">
            <h2 id="resort-location-title">Локация</h2>
          </div>
          {/* Address once here — hyperlink to Яндекс Карты (#37); not repeated in header. */}
          {mapsUrl ? (
            <p>
              <ExternalLink className="resort-detail__address" href={mapsUrl}>
                {resort.area}
              </ExternalLink>
            </p>
          ) : (
            <p>{resort.area}</p>
          )}
          {hasCoords ? (
            <>
              <p className="muted">
                {resort.lat}, {resort.lon}
                {resort.coords_precision === 'approximate' ? ' (приблизительно)' : ''}
              </p>
              <div className="resort-detail__map">
                <ResortMap
                  resorts={[resort]}
                  selectedId={resort.id}
                  embedded
                  size="detail"
                  variant={resort.status === 'active' ? 'active' : 'inactive'}
                />
              </div>
            </>
          ) : (
            <p className="muted">Точные координаты пока не указаны.</p>
          )}
        </section>

        {communityLinks.length > 0 && (
          <section aria-labelledby="resort-links-title">
            <h2 id="resort-links-title">Ссылки</h2>
            <ul className="link-list">
              {communityLinks.map((url) => (
                <li key={url}>
                  <ExternalLink href={url}>{linkLabelForUrl(url, 'Сообщество')}</ExternalLink>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <p className="muted resort-detail__meta">
        Данные каталога: {formatUpdatedAt(data.meta.updatedAt)}.
        {inactive
          ? ' Не оферта.'
          : ' Цены и часы — с официальных публичных страниц курортов; где данных ещё нет — смотрите ссылку на сайт. Не оферта.'}
      </p>
    </article>
  )
}
