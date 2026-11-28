import { Hero } from '../components/Hero'
import { ResortCard } from '../components/ResortCard'
import { ResortMap } from '../components/ResortMap'
import { sortResortsForCards } from '../lib/resort-card-sort'
import type { SiteData } from '../types'

export function HomePage({ data }: { data: SiteData }) {
  const active = sortResortsForCards(
    data.resorts.filter((r) => r.status === 'active'),
    data.hours,
    data.important,
  )
  const secondary = data.resorts.filter((r) => r.status !== 'active')

  return (
    <>
      <Hero />

      <section className="section explore" id="explore" aria-labelledby="explore-title">
        <div className="section__head">
          <h2 id="explore-title">Действующие курорты</h2>
        </div>
        <div className="explore__map" id="map">
          <ResortMap resorts={data.resorts} embedded />
        </div>
        <div className="resort-grid" id="resorts">
          {active.map((resort) => (
            <ResortCard
              key={resort.id}
              resort={resort}
              hours={data.hours}
              important={data.important}
              cardTags={data.cardTags}
            />
          ))}
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
                important={data.important}
                cardTags={data.cardTags}
              />
            ))}
          </div>
        </section>
      )}
    </>
  )
}
