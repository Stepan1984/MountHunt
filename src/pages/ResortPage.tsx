import { Link, useParams } from 'react-router-dom'
import {
  formatUpdatedAt,
  hoursFor,
  pricesFor,
  statusLabel,
  yandexMapsUrl,
} from '../lib/data'
import type { SiteData } from '../types'

export function ResortPage({ data }: { data: SiteData }) {
  const { id } = useParams()
  const resort = data.resorts.find((r) => r.id === id)

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

  return (
    <article className="section page-narrow resort-detail">
      <p className="crumb">
        <Link to="/">Курорты</Link>
        <span aria-hidden="true"> / </span>
        <span>{resort.name}</span>
      </p>

      <header className="resort-detail__header">
        <div>
          <h1>{resort.name}</h1>
          <p className="resort-detail__area">{resort.area}</p>
        </div>
        <span className={`badge badge--${resort.status}`}>{statusLabel(resort.status)}</span>
      </header>

      {resort.notes && <p className="resort-detail__notes">{resort.notes}</p>}

      <div className="detail-grid">
        <section>
          <h2>Часы работы</h2>
          <p>{hours?.summary ?? 'Нет данных'}</p>
          {hours?.status === 'failed' && (
            <p className="muted">Последний сбор часов не удался — показаны прежние данные, если они были.</p>
          )}
          <p className="muted">
            Актуальность: {formatUpdatedAt(hours?.scrapedAt)} · статус:{' '}
            {hours?.status ?? 'pending'}
          </p>
        </section>

        <section>
          <h2>Цены</h2>
          {prices?.items && prices.items.length > 0 ? (
            <ul className="price-list">
              {prices.items.map((item) => (
                <li key={`${item.title}-${item.price}-${item.unit ?? ''}`}>
                  <span>{item.title}</span>
                  <strong>
                    {item.price != null
                      ? `${item.price.toLocaleString('ru-RU')} ₽`
                      : (item.rawText ?? '—')}
                  </strong>
                </li>
              ))}
            </ul>
          ) : (
            <p>{prices?.note ?? 'Цены появятся после ежедневного обновления данных.'}</p>
          )}
          {prices?.note && prices.items?.length > 0 && <p className="muted">{prices.note}</p>}
          {prices?.status === 'failed' && (
            <p className="muted">Последний сбор цен не удался — показан прошлый снимок, если он был.</p>
          )}
          <p className="muted">
            Актуальность: {formatUpdatedAt(prices?.scrapedAt)} · статус:{' '}
            {prices?.status ?? 'pending'}
          </p>
          {(prices?.sourceUrl || resort.prices_url || resort.website) && (
            <a
              href={prices?.sourceUrl || resort.prices_url || resort.website || undefined}
              target="_blank"
              rel="noreferrer"
            >
              Смотреть тарифы на сайте курорта
            </a>
          )}
        </section>

        <section>
          <h2>Локация</h2>
          <p>{resort.area}</p>
          {hasCoords ? (
            <>
              <p className="muted">
                {resort.lat}, {resort.lon}
                {resort.coords_precision === 'approximate' ? ' (приблизительно)' : ''}
              </p>
              <a
                href={yandexMapsUrl(resort.lat as number, resort.lon as number)}
                target="_blank"
                rel="noreferrer"
              >
                Открыть в Яндекс Картах
              </a>
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

      {important.length > 0 && (
        <section className="resort-detail__important">
          <h2>Важное по курорту</h2>
          <ul>
            {important.map((item) => (
              <li key={item.id}>
                <strong>{item.title}</strong>
                {item.body && <p>{item.body}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="muted resort-detail__meta">
        Данные каталога: {formatUpdatedAt(data.meta.updatedAt)}. Цены и часы — с официальных
        публичных страниц (где парсер уже есть) либо плейсхолдер со ссылкой на сайт курорта. Не
        оферта.
      </p>
    </article>
  )
}
