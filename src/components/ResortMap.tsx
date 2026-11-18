import { useEffect, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { Resort } from '../types'

type Props = {
  resorts: Resort[]
  selectedId?: string | null
  /** When true, render only the map shell (no section chrome) for the home explore layout. */
  embedded?: boolean
  /** Taller/shorter canvas for detail pages. */
  size?: 'default' | 'detail'
}

const markerIcon = L.divIcon({
  className: 'map-pin',
  html: '<span class="map-pin__dot"></span>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
})

export function ResortMap({
  resorts,
  selectedId,
  embedded = false,
  size = 'default',
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const navigate = useNavigate()

  const mappable = useMemo(
    () => resorts.filter((r) => r.status === 'active' && r.lat != null && r.lon != null),
    [resorts],
  )

  const mappableKey = mappable.map((r) => r.id).join(',')

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = L.map(containerRef.current, {
      scrollWheelZoom: false,
      attributionControl: true,
    }).setView([60.2, 30.3], 8)

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
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
      marker.bindPopup(
        `<strong>${resort.name}</strong><br/><span>${resort.city_or_district}</span><br/><em>Открыть карточку</em>`,
      )
      marker.on('click', () => {
        navigate(`/resort/${resort.id}`)
      })
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
  }, [mappableKey, navigate, selectedId, size])

  const canvas = (
    <div className={`map-shell${size === 'detail' ? ' map-shell--detail' : ''}`}>
      <div
        ref={containerRef}
        className={`map-canvas${size === 'detail' ? ' map-canvas--detail' : ''}`}
        role="presentation"
      />
    </div>
  )

  if (embedded) {
    return (
      <div className="map-embedded">
        <p className="map-embedded__hint muted">
          {mappable.length} точек · нажмите маркер, чтобы открыть курорт
        </p>
        {canvas}
      </div>
    )
  }

  return (
    <section className="section map-section" id="map" aria-labelledby="map-title">
      <div className="section__head">
        <h2 id="map-title">Карта курортов</h2>
        <p>
          На карте — {mappable.length} действующих комплексов с координатами. Дикие и закрытые
          склоны по умолчанию скрыты.
        </p>
      </div>
      {canvas}
    </section>
  )
}
