import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ExternalLink, LinkedText } from '../components/LinkedText'
import { ResortMap } from '../components/ResortMap'
import { SkipassTables } from '../components/SkipassTables'
import { WebcamSection } from '../components/WebcamPlayer'
import {
  formatImportantDate,
  formatUpdatedAt,
  hoursFor,
  hoursLeadText,
  localizePublicText,
  pricesFor,
  publicPriceNote,
  publicResortNotes,
  scrapeStatusLabel,
  slopesClosedHint,
  statusLabel,
  yandexMapsUrl,
} from '../lib/data'
import { linkLabelForUrl, sameExternalUrl } from '../lib/links'
import { resolveWebcamPlayers, webcamExternalLink } from '../lib/webcam'
import type { SiteData } from '../types'

const PRICE_PREVIEW = 8

export function ResortPage({ data }: { data: SiteData }) {
  const { id } = useParams()
  const resort = data.resorts.find((r) => r.id === id)
  const [showAllPrices, setShowAllPrices] = useState(false)

  if (!resort) {
    return (
      <section className="section page-narrow">
        <h1>Курорт не найден</h1>
        <p>Такой страницы нет в каталоге MountHunt.</p>
        <Link to="/">На главную</Link>
      </section>
    )
  }

  const hours = hoursFor(resort.id, data.hours)
  const prices = pricesFor(resort.id, data.prices)
  const important = data.important.filter((i) => i.resortId === resort.id)
  const hasCoords = resort.lat != null && resort.lon != null
  // Dedicated tariff page only — do not fall back to homepage (already «Сайт курорта»).
  const tariffsUrl = prices?.sourceUrl || resort.prices_url || undefined
  const hoursSourceUrl = hours?.sourceUrl || undefined
  // Skip section source links when they duplicate the official homepage button.
  const hoursLink =
    hoursSourceUrl && !sameExternalUrl(hoursSourceUrl, resort.website)
      ? hoursSourceUrl
      : undefined
  const tariffsLink =
    tariffsUrl && !sameExternalUrl(tariffsUrl, resort.website) ? tariffsUrl : undefined
  const hoursSummaryRaw = hours?.summary ? localizePublicText(hours.summary) : null
  const hoursLead = hoursLeadText(hoursSummaryRaw, hours?.periods)
  const hoursSummary = hoursLead ?? (hours?.periods?.length ? null : 'Нет данных')
  const closed = slopesClosedHint(resort.id, hours, data.important)
  const visitorNotes = publicResortNotes(resort.notes)
  const visitorPriceNote = publicPriceNote(prices?.note)
  const priceItems = prices?.items ?? []
  const priceGroups = prices?.groups ?? []
  const hasSkipassTables = priceGroups.some((g) => g.rows?.length > 0)
  const webcamStreams = resolveWebcamPlayers(resort.webcam_url, resort.webcam_embeds)
  const webcamLink = webcamExternalLink(resort.webcam_url, resort.webcam_embeds)
  const communityLinks = resort.community_links ?? []
  const mapsUrl = hasCoords
    ? yandexMapsUrl(resort.lat as number, resort.lon as number)
    : undefined

  return (
    <article className="section page-narrow resort-detail">
      <p className="crumb">
        <Link to="/">Курорты</Link>
        <span aria-hidden="true"> / </span>
        <span>{resort.name}</span>
      </p>

      <header className="resort-detail__header">
        <div>
          <p className="resort-detail__brand-kicker">MountHunt</p>
          <h1>{resort.name}</h1>
          <p className="resort-detail__area">{resort.area}</p>
        </div>
        {closed ? (
          <span className="badge badge--warn">Склоны закрыты</span>
        ) : (
          <span className={`badge badge--${resort.status}`}>{statusLabel(resort.status)}</span>
        )}
      </header>

      {visitorNotes && (
        <p className="resort-detail__notes">
          <LinkedText text={visitorNotes} />
        </p>
      )}

      {/* Top CTA: only the official site — hours / tariffs / cam live in their sections. */}
      {resort.website && (
        <div className="resort-detail__actions" role="group" aria-label="Сайт курорта">
          <ExternalLink className="btn btn--primary" href={resort.website}>
            Сайт курорта
          </ExternalLink>
        </div>
      )}

      {webcamLink && (
        <WebcamSection
          key={resort.id}
          resortName={resort.name}
          externalUrl={webcamLink}
          streams={webcamStreams}
        />
      )}

      {important.length > 0 && (
        <section className="resort-detail__important" aria-labelledby="resort-important-title">
          <h2 id="resort-important-title">Важное</h2>
          <ul className="important__list important__list--detail">
            {important.map((item) => (
              <li key={item.id} className="important__item">
                <div className="important__meta">
                  {item.publishedAt ? (
                    <time dateTime={item.publishedAt}>{formatImportantDate(item.publishedAt)}</time>
                  ) : null}
                </div>
                <h3>{item.title}</h3>
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
            ))}
          </ul>
        </section>
      )}

      <div className="detail-grid">
        <section>
          <div className="detail-section__head">
            <h2>Часы работы</h2>
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
            <ul className="period-list">
              {hours.periods.map((period) => (
                <li key={`${period.days}-${period.open}-${period.close}`}>
                  <span>{period.days}</span>
                  <strong>
                    {period.open}–{period.close}
                  </strong>
                </li>
              ))}
            </ul>
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

        <section className={hasSkipassTables ? 'detail-grid__wide' : undefined}>
          <div className="detail-section__head">
            <h2>Цены</h2>
            {tariffsLink && (
              <ExternalLink className="detail-section__source" href={tariffsLink}>
                Тарифы на сайте
              </ExternalLink>
            )}
          </div>
          {priceItems.length > 0 || hasSkipassTables ? (
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
          {visitorPriceNote && (priceItems.length > 0 || hasSkipassTables) && (
            <p className="muted">
              <LinkedText text={visitorPriceNote} />
            </p>
          )}
          {prices?.status === 'failed' && (
            <p className="muted">
              Последний сбор цен не удался — показаны прежние данные, если они были.
            </p>
          )}
          <p className="muted">
            Актуальность: {formatUpdatedAt(prices?.scrapedAt)} · {scrapeStatusLabel(prices?.status)}
          </p>
        </section>

        <section className="detail-grid__wide">
          <div className="detail-section__head">
            <h2>Локация</h2>
            {mapsUrl && (
              <ExternalLink className="detail-section__source" href={mapsUrl}>
                Яндекс Карты
              </ExternalLink>
            )}
          </div>
          <p>{resort.area}</p>
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
                />
              </div>
            </>
          ) : (
            <p className="muted">Точные координаты пока не указаны.</p>
          )}
        </section>

        {communityLinks.length > 0 && (
          <section>
            <h2>Ссылки</h2>
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
        Данные каталога: {formatUpdatedAt(data.meta.updatedAt)}. Цены и часы — с официальных
        публичных страниц курортов; где данных ещё нет — смотрите ссылку на сайт. Не оферта.
      </p>
    </article>
  )
}
