import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ExternalLink, LinkedText } from '../components/LinkedText'
import { ResortMap } from '../components/ResortMap'
import { SkipassTables } from '../components/SkipassTables'
import { WebcamSection } from '../components/WebcamPlayer'
import {
  formatUpdatedAt,
  hoursFor,
  localizePublicText,
  pricesFor,
  publicPriceNote,
  publicResortNotes,
  scrapeStatusLabel,
  slopesClosedHint,
  statusLabel,
  yandexMapsUrl,
} from '../lib/data'
import { linkLabelForUrl } from '../lib/links'
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
  const tariffsUrl = prices?.sourceUrl || resort.prices_url || resort.website || undefined
  const hoursSourceUrl = hours?.sourceUrl || undefined
  const hoursSummary = hours?.summary ? localizePublicText(hours.summary) : 'Нет данных'
  const closed = slopesClosedHint(resort.id, hours, data.important)
  const visitorNotes = publicResortNotes(resort.notes)
  const visitorPriceNote = publicPriceNote(prices?.note)
  const priceItems = prices?.items ?? []
  const priceGroups = prices?.groups ?? []
  const hasSkipassTables = priceGroups.some((g) => g.rows?.length > 0)
  const webcamStreams = resolveWebcamPlayers(resort.webcam_url, resort.webcam_embeds)
  const webcamLink = webcamExternalLink(resort.webcam_url, resort.webcam_embeds)

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

      <div className="resort-detail__actions" role="group" aria-label="Быстрые ссылки">
        {resort.website && (
          <ExternalLink className="btn btn--primary" href={resort.website}>
            Сайт курорта
          </ExternalLink>
        )}
        {hasCoords && (
          <ExternalLink
            className="btn btn--ghost"
            href={yandexMapsUrl(resort.lat as number, resort.lon as number)}
          >
            Яндекс Карты
          </ExternalLink>
        )}
        {webcamLink && (
          <ExternalLink className="btn btn--ghost" href={webcamLink}>
            Открыть трансляцию
          </ExternalLink>
        )}
        {hoursSourceUrl && (
          <ExternalLink className="btn btn--ghost" href={hoursSourceUrl}>
            Часы работы
          </ExternalLink>
        )}
        {tariffsUrl && (
          <ExternalLink className="btn btn--ghost" href={tariffsUrl}>
            Тарифы на сайте
          </ExternalLink>
        )}
      </div>

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
          <h2>Часы работы</h2>
          <p className="detail-lead">
            <LinkedText text={hoursSummary} />
          </p>
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
          {hoursSourceUrl && (
            <p>
              <ExternalLink href={hoursSourceUrl}>Часы работы</ExternalLink>
            </p>
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
          <h2>Цены</h2>
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
          {tariffsUrl && (
            <p>
              <ExternalLink href={tariffsUrl}>Тарифы на сайте</ExternalLink>
            </p>
          )}
          {prices?.status === 'failed' && (
            <p className="muted">
              Последний сбор цен не удался — показан прошлый снимок, если он был.
            </p>
          )}
          <p className="muted">
            Актуальность: {formatUpdatedAt(prices?.scrapedAt)} · {scrapeStatusLabel(prices?.status)}
          </p>
        </section>

        <section className="detail-grid__wide">
          <h2>Локация</h2>
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

        <section>
          <h2>Ссылки</h2>
          <ul className="link-list">
            {resort.website && (
              <li>
                <ExternalLink href={resort.website}>Сайт курорта</ExternalLink>
              </li>
            )}
            {webcamLink && (
              <li>
                <ExternalLink href={webcamLink}>Открыть трансляцию</ExternalLink>
              </li>
            )}
            {hoursSourceUrl && (
              <li>
                <ExternalLink href={hoursSourceUrl}>Часы работы</ExternalLink>
              </li>
            )}
            {tariffsUrl && (
              <li>
                <ExternalLink href={tariffsUrl}>Тарифы на сайте</ExternalLink>
              </li>
            )}
            {resort.community_links?.map((url) => (
              <li key={url}>
                <ExternalLink href={url}>{linkLabelForUrl(url, 'Сообщество')}</ExternalLink>
              </li>
            ))}
            {!resort.website &&
              !webcamLink &&
              !hoursSourceUrl &&
              !tariffsUrl &&
              !resort.community_links?.length && (
                <li className="muted">Публичных ссылок пока нет</li>
              )}
          </ul>
        </section>
      </div>

      <p className="muted resort-detail__meta">
        Данные каталога: {formatUpdatedAt(data.meta.updatedAt)}. Цены и часы — с официальных
        публичных страниц (где парсер уже есть) либо заглушка со ссылкой на сайт курорта. Не оферта.
      </p>
    </article>
  )
}
