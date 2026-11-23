import { ImportantSection } from '../components/ImportantSection'
import { Hero } from '../components/Hero'
import { ResortCard } from '../components/ResortCard'
import { ResortMap } from '../components/ResortMap'
import type { SiteData } from '../types'

export function HomePage({ data }: { data: SiteData }) {
  const active = data.resorts.filter((r) => r.status === 'active')
  const secondary = data.resorts.filter((r) => r.status !== 'active')

  return (
    <>
      <Hero activeCount={active.length} />

      <ImportantSection
        items={data.important}
        resorts={data.resorts}
        meta={data.meta}
        variant="strip"
      />

      <section className="section explore" id="explore" aria-labelledby="explore-title">
        <div className="section__head">
          <h2 id="explore-title">Карта и курорты</h2>
        </div>

        <div className="explore__layout">
          <div className="explore__map" id="map">
            <ResortMap resorts={data.resorts} embedded />
          </div>

          <div className="explore__list" id="resorts">
            <h3 className="explore__list-title">Список</h3>
            <div className="resort-grid resort-grid--stack">
              {active.map((resort) => (
                <ResortCard
                  key={resort.id}
                  resort={resort}
                  hours={data.hours}
                  prices={data.prices}
                  important={data.important}
                  compact
                />
              ))}
            </div>
          </div>
        </div>
      </section>

      {secondary.length > 0 && (
        <section
          className="section resorts resorts--secondary"
          id="secondary"
          aria-labelledby="secondary-title"
        >
          <div className="section__head">
            <h2 id="secondary-title">Дикие и закрытые склоны</h2>
            <p>
              Отдельная карта с серыми метками — только эти склоны (действующие остаются на карте
              выше). Статус или доступность могут быть сомнительны — уточняйте перед выездом.
            </p>
          </div>
          <div className="secondary-map" id="map-inactive">
            <ResortMap resorts={data.resorts} variant="inactive" embedded />
          </div>
          <div className="resort-grid">
            {secondary.map((resort) => (
              <ResortCard
                key={resort.id}
                resort={resort}
                hours={data.hours}
                prices={data.prices}
                important={data.important}
              />
            ))}
          </div>
        </section>
      )}
    </>
  )
}
