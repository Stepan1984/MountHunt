import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ResortMap } from '../components/ResortMap'
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
  const hoursSummary = hours?.summary ? localizePublicText(hours.summary) : 'Нет данных'
  const closed = slopesClosedHint(resort.id, hours, data.important)
  const visitorNotes = publicResortNotes(resort.notes)
  const visitorPriceNote = publicPriceNote(prices?.note)
  const priceItems = prices?.items ?? []
  const visiblePrices =
    showAllPrices || priceItems.length <= PRICE_PREVIEW
      ? priceItems
      : priceItems.slice(0, PRICE_PREVIEW)

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

      {visitorNotes && <p className="resort-detail__notes">{visitorNotes}</p>}

      <div className="resort-detail__actions" role="group" aria-label="Быстрые ссылки">
        {resort.website && (
          <a className="btn btn--primary" href={resort.website} target="_blank" rel="noreferrer">
            Официальный сайт
          </a>
        )}
        {hasCoords && (
          <a
            className="btn btn--ghost"
            href={yandexMapsUrl(resort.lat as number, resort.lon as number)}
            target="_blank"
            rel="noreferrer"
          >
            Яндекс Карты
          </a>
        )}
        {resort.webcam_url && (
          <a className="btn btn--ghost" href={resort.webcam_url} target="_blank" rel="noreferrer">
            Веб-камера
          </a>
        )}
        {tariffsUrl && (
          <a className="btn btn--ghost" href={tariffsUrl} target="_blank" rel="noreferrer">
            Тарифы на сайте
          </a>
        )}
      </div>

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
                {item.body && <p>{item.body}</p>}
                {item.sourceUrl && (
                  <a href={item.sourceUrl} target="_blank" rel="noreferrer">
                    Источник
                  </a>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="detail-grid">
        <section>
          <h2>Часы работы</h2>
          <p className="detail-lead">{hoursSummary}</p>
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

        <section>
          <h2>Цены</h2>
          {priceItems.length > 0 ? (
            <>
              <ul className="price-list">
                {visiblePrices.map((item) => (
                  <li key={`${item.title}-${item.price}-${item.unit ?? ''}`}>
                    <span>
                      {item.title}
                      {item.unit ? <span className="muted"> · {item.unit}</span> : null}
                      {item.note ? <span className="price-list__note">{item.note}</span> : null}
                    </span>
                    <strong>
                      {item.price != null
                        ? `${item.price.toLocaleString('ru-RU')} ₽`
                        : (item.rawText ?? '—')}
                    </strong>
                  </li>
                ))}
              </ul>
              {priceItems.length > PRICE_PREVIEW && (
                <button
                  type="button"
                  className="price-list__more"
                  onClick={() => setShowAllPrices((v) => !v)}
                >
                  {showAllPrices
                    ? 'Свернуть список'
                    : `Показать ещё ${priceItems.length - PRICE_PREVIEW}`}
                </button>
              )}
            </>
          ) : (
            <p>{visitorPriceNote ?? 'Цены появятся после ежедневного обновления данных.'}</p>
          )}
          {visitorPriceNote && priceItems.length > 0 && (
            <p className="muted">{visitorPriceNote}</p>
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
                <a href={resort.website} target="_blank" rel="noreferrer">
                  Официальный сайт
                </a>
              </li>
            )}
            {resort.webcam_url && (
              <li>
                <a href={resort.webcam_url} target="_blank" rel="noreferrer">
                  Веб-камера
                </a>
              </li>
            )}
            {resort.community_links?.map((url) => (
              <li key={url}>
                <a href={url} target="_blank" rel="noreferrer">
                  Сообщество
                </a>
              </li>
            ))}
            {!resort.website && !resort.webcam_url && !resort.community_links?.length && (
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
