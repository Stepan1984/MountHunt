import { Hero } from '../components/Hero'
import { ImportantSection } from '../components/ImportantSection'
import { ResortCard } from '../components/ResortCard'
import { ResortMap } from '../components/ResortMap'
import { formatUpdatedAt } from '../lib/data'
import type { SiteData } from '../types'

export function HomePage({ data }: { data: SiteData }) {
  const active = data.resorts.filter((r) => r.status === 'active')
  const secondary = data.resorts.filter((r) => r.status !== 'active')

  return (
    <>
      <Hero activeCount={active.length} />

      <ResortMap resorts={data.resorts} />

      <ImportantSection items={data.important} resorts={data.resorts} />

      <section className="section resorts" id="resorts" aria-labelledby="resorts-title">
        <div className="section__head">
          <h2 id="resorts-title">Курорты</h2>
          <p>
            Действующие комплексы СПБ и ЛО. Цены и часы — плейсхолдеры до ежедневного сбора данных
            (обновление данных: {formatUpdatedAt(data.meta.updatedAt)}).
          </p>
        </div>
        <div className="resort-grid">
          {active.map((resort) => (
            <ResortCard
              key={resort.id}
              resort={resort}
              hours={data.hours}
              prices={data.prices}
            />
          ))}
        </div>
      </section>

      {secondary.length > 0 && (
        <section className="section resorts resorts--secondary" aria-labelledby="secondary-title">
          <div className="section__head">
            <h2 id="secondary-title">Дикие, неясные и закрытые</h2>
            <p>
              Не показываются на карте по умолчанию. Статус или доступность могут быть сомнительны —
              уточняйте перед выездом.
            </p>
          </div>
          <div className="resort-grid resort-grid--compact">
            {secondary.map((resort) => (
              <ResortCard
                key={resort.id}
                resort={resort}
                hours={data.hours}
                prices={data.prices}
              />
            ))}
          </div>
        </section>
      )}
    </>
  )
}
