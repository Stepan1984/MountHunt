import { useEffect, useMemo, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { Resort } from '../types'

type MapVariant = 'active' | 'inactive'

type Props = {
  resorts: Resort[]
  selectedId?: string | null
  /** When true, render only the map shell (no section chrome) for the home explore layout. */
  embedded?: boolean
  /** Taller/shorter canvas for detail pages. */
  size?: 'default' | 'detail'
  /**
   * active (default): pine/ice markers for действующих комплексов.
   * inactive: gray markers for диких / неясных / закрытых.
   */
  variant?: MapVariant
}

const brandMarkerIcon = L.divIcon({
  className: 'map-pin',
  html: '<span class="map-pin__dot"></span>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
})

const mutedMarkerIcon = L.divIcon({
  className: 'map-pin map-pin--muted',
  html: '<span class="map-pin__dot map-pin__dot--muted"></span>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
})

const resortPath = (id: string) => {
  const base = (import.meta.env.BASE_URL || '/').replace(/\/$/, '')
  return `${base}/resort/${id}`
}

/** Russian plural for «N точка/точки/точек». */
function pointsLabel(n: number): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return `${n} точка`
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return `${n} точки`
  return `${n} точек`
}

function matchesVariant(resort: Resort, variant: MapVariant): boolean {
  if (variant === 'active') return resort.status === 'active'
  return resort.status !== 'active'
}

export function ResortMap({
  resorts,
  selectedId,
  embedded = false,
  size = 'default',
  variant = 'active',
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)

  const mappable = useMemo(
    () =>
      resorts.filter(
        (r) => matchesVariant(r, variant) && r.lat != null && r.lon != null,
      ),
    [resorts, variant],
  )

  const mappableKey = `${variant}:${mappable.map((r) => r.id).join(',')}`
  const markerIcon = variant === 'inactive' ? mutedMarkerIcon : brandMarkerIcon

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = L.map(containerRef.current, {
      scrollWheelZoom: false,
      attributionControl: true,
    }).setView([60.2, 30.3], 8)

    // Leaflet 1.9+ injects a national-flag SVG into the default attribution prefix;
    // keep required Leaflet + OSM credit links, compact labels.
    map.attributionControl.setPrefix(
      '<a href="https://leafletjs.com" title="A JavaScript library for interactive maps">Leaflet</a>',
    )

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright" title="OpenStreetMap">OSM</a>',
    }).addTo(map)

    mapRef.current = map

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    // Leaflet needs a reflow when the container size changes (embedded side panel).
    const resize = () => map.invalidateSize()
    const timer = window.setTimeout(resize, 80)
    window.addEventListener('resize', resize)

    const layer = L.layerGroup().addTo(map)
    const bounds: L.LatLngExpression[] = []

    for (const resort of mappable) {
      const lat = resort.lat as number
      const lon = resort.lon as number
      bounds.push([lat, lon])
      const marker = L.marker([lat, lon], { icon: markerIcon })
      // Open popup on click (readable); navigate only via the link inside.
      marker.bindPopup(
        `<strong>${resort.name}</strong><br/><span>${resort.city_or_district}</span><br/><a class="map-popup__link" href="${resortPath(resort.id)}">Открыть карточку</a>`,
      )
      if (selectedId === resort.id) {
        marker.openPopup()
      }
      marker.addTo(layer)
    }

    if (bounds.length > 1) {
      map.fitBounds(bounds as L.LatLngBoundsExpression, { padding: [36, 36], maxZoom: 10 })
    } else if (bounds.length === 1) {
      map.setView(bounds[0], size === 'detail' ? 12 : 11)
    }

    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('resize', resize)
      layer.remove()
    }
    // mappableKey tracks resort identity changes without depending on array identity
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mappableKey, selectedId, size, variant])

  const canvas = (
    <div className={`map-shell${size === 'detail' ? ' map-shell--detail' : ''}`}>
      <div
        ref={containerRef}
        className={`map-canvas${size === 'detail' ? ' map-canvas--detail' : ''}`}
        role="presentation"
      />
    </div>
  )

  const hint =
    variant === 'inactive'
      ? `${pointsLabel(mappable.length)} · серые метки · подсказка ведёт в карточку`
      : `${pointsLabel(mappable.length)} · маркер открывает подсказку, оттуда — карточку`

  if (embedded) {
    return (
      <div className={`map-embedded${variant === 'inactive' ? ' map-embedded--inactive' : ''}`}>
        <p className="map-embedded__hint muted">{hint}</p>
        {canvas}
      </div>
    )
  }

  if (variant === 'inactive') {
    return (
      <section className="section map-section" id="map-inactive" aria-labelledby="map-inactive-title">
        <div className="section__head">
          <h2 id="map-inactive-title">Карта диких и закрытых</h2>
          <p>
            Отдельная карта — {mappable.length} склонов с координатами, серые метки. Действующие
            комплексы остаются на основной карте.
          </p>
        </div>
        {canvas}
      </section>
    )
  }

  return (
    <section className="section map-section" id="map" aria-labelledby="map-title">
      <div className="section__head">
        <h2 id="map-title">Карта курортов</h2>
        <p>
          На карте — {mappable.length} действующих комплексов с координатами. Дикие и закрытые —
          на отдельной карте ниже, серыми метками.
        </p>
      </div>
      {canvas}
    </section>
  )
}
