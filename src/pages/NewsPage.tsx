import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ImportantItemCard } from '../components/ImportantItemCard'
import { allImportantNews } from '../lib/data'
import type { SiteData } from '../types'

const ALL_RESORTS = 'all'
const RESORT_PARAM = 'resort'

export function NewsPage({ data }: { data: SiteData }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const nameById = useMemo(() => new Map(data.resorts.map((r) => [r.id, r.name])), [data.resorts])
  const items = useMemo(() => allImportantNews(data.important), [data.important])

  const resortParam = searchParams.get(RESORT_PARAM)
  const resortFilter =
    resortParam && nameById.has(resortParam) ? resortParam : ALL_RESORTS

  const resortOptions = useMemo(() => {
    const ids = new Set<string>()
    for (const item of items) {
      if (item.resortId) ids.add(item.resortId)
    }
    if (resortFilter !== ALL_RESORTS) ids.add(resortFilter)
    return [...ids]
      .map((id) => ({ id, name: nameById.get(id) ?? id }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'))
  }, [items, nameById, resortFilter])

  const filtered =
    resortFilter === ALL_RESORTS
      ? items
      : items.filter((item) => item.resortId === resortFilter)

  const showFilter = resortOptions.length > 0

  function selectResort(id: string) {
    if (id === ALL_RESORTS) {
      setSearchParams({}, { replace: true })
      return
    }
    setSearchParams({ [RESORT_PARAM]: id }, { replace: true })
  }

  return (
    <section className="section news-page" aria-labelledby="news-title">
      <p className="crumb">
        <Link to="/">Главная</Link>
        {' · '}
        Новости
      </p>
      <div className="section__head news-page__head">
        <h1 id="news-title">Новости курортов</h1>
      </div>

      {showFilter ? (
        <div className="news-page__filter">
          <p className="news-page__filter-label" id="news-resort-filter-label">
            Курорт
          </p>
          <div
            className="news-page__filter-tabs"
            role="radiogroup"
            aria-labelledby="news-resort-filter-label"
          >
            <button
              type="button"
              role="radio"
              aria-checked={resortFilter === ALL_RESORTS}
              className={`news-page__filter-tab${resortFilter === ALL_RESORTS ? ' is-active' : ''}`}
              onClick={() => selectResort(ALL_RESORTS)}
            >
              Все
            </button>
            {resortOptions.map((resort) => (
              <button
                key={resort.id}
                type="button"
                role="radio"
                aria-checked={resortFilter === resort.id}
                className={`news-page__filter-tab${resortFilter === resort.id ? ' is-active' : ''}`}
                onClick={() => selectResort(resort.id)}
              >
                {resort.name}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {items.length === 0 ? (
        <p className="muted">Пока нет новостей по склонам.</p>
      ) : filtered.length === 0 ? (
        <p className="muted">Пока нет новостей по этому курорту.</p>
      ) : (
        <ul className="important__list important__list--detail">
          {filtered.map((item) => (
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
