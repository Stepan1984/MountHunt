import { Link } from 'react-router-dom'
import { ImportantItemCard } from '../components/ImportantItemCard'
import { allImportantNews, formatUpdatedAt } from '../lib/data'
import type { SiteData } from '../types'

export function NewsPage({ data }: { data: SiteData }) {
  const nameById = new Map(data.resorts.map((r) => [r.id, r.name]))
  const items = allImportantNews(data.important)
  const refreshedAt = data.meta.importantScrapedAt || data.meta.updatedAt

  return (
    <section className="section news-page" aria-labelledby="news-title">
      <p className="crumb">
        <Link to="/">Главная</Link>
        {' · '}
        Новости
      </p>
      <div className="section__head news-page__head">
        <h1 id="news-title">Новости курортов</h1>
        <p>
          Все заметки со страниц курортов — свежие сверху.
          {refreshedAt ? (
            <>
              {' '}
              Обновлено:{' '}
              <time dateTime={refreshedAt}>{formatUpdatedAt(refreshedAt)}</time>.
            </>
          ) : null}
        </p>
      </div>

      {items.length === 0 ? (
        <p className="muted">Пока нет новостей по склонам.</p>
      ) : (
        <ul className="important__list important__list--detail">
          {items.map((item) => (
            <ImportantItemCard
              key={item.id}
              item={item}
              resortName={item.resortId ? nameById.get(item.resortId) : undefined}
            />
          ))}
        </ul>
      )}
    </section>
  )
}
