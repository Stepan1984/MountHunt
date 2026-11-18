import { useEffect, useId, useRef, useState } from 'react'
import type { ClassifiedWebcam } from '../lib/webcam'
import { WebcamErrorBoundary } from './WebcamErrorBoundary'

type Props = {
  stream: ClassifiedWebcam
  title: string
  onUnavailable: () => void
}

/**
 * Soft-fail player: iframe / native video (+ hls.js) / MJPEG img.
 * Errors call onUnavailable; parent shows link fallback.
 */
export function WebcamPlayer({ stream, title, onUnavailable }: Props) {
  if (stream.kind === 'iframe') {
    return (
      <IframePlayer
        src={stream.playUrl}
        title={title}
        onUnavailable={onUnavailable}
      />
    )
  }
  if (stream.kind === 'mjpeg') {
    return (
      <MjpegPlayer
        src={stream.playUrl}
        title={title}
        onUnavailable={onUnavailable}
      />
    )
  }
  if (stream.kind === 'hls') {
    return <HlsPlayer src={stream.playUrl} title={title} onUnavailable={onUnavailable} />
  }
  return null
}

function IframePlayer({
  src,
  title,
  onUnavailable,
}: {
  src: string
  title: string
  onUnavailable: () => void
}) {
  // Cross-origin iframes rarely report load errors; «Открыть трансляцию» always remains.
  return (
    <iframe
      className="webcam-player__frame"
      src={src}
      title={title}
      loading="lazy"
      allow="autoplay; fullscreen; picture-in-picture"
      allowFullScreen
      referrerPolicy="no-referrer-when-downgrade"
      onError={onUnavailable}
    />
  )
}

function MjpegPlayer({
  src,
  title,
  onUnavailable,
}: {
  src: string
  title: string
  onUnavailable: () => void
}) {
  return (
    <img
      className="webcam-player__mjpeg"
      src={src}
      alt={title}
      loading="lazy"
      onError={onUnavailable}
    />
  )
}

function HlsPlayer({
  src,
  title,
  onUnavailable,
}: {
  src: string
  title: string
  onUnavailable: () => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const unavailableRef = useRef(onUnavailable)

  useEffect(() => {
    unavailableRef.current = onUnavailable
  }, [onUnavailable])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    let destroyed = false
    let hls: { destroy: () => void } | null = null

    const fail = () => {
      if (!destroyed) unavailableRef.current()
    }

    const onVideoError = () => fail()
    video.addEventListener('error', onVideoError)

    ;(async () => {
      try {
        const native = video.canPlayType('application/vnd.apple.mpegurl')
        if (native) {
          video.src = src
          return
        }
        const { default: Hls } = await import('hls.js')
        if (destroyed) return
        if (!Hls.isSupported()) {
          fail()
          return
        }
        const instance = new Hls({
          enableWorker: true,
          // Keep lightweight — don't retry forever on dead streams.
          manifestLoadingMaxRetry: 2,
          levelLoadingMaxRetry: 2,
        })
        hls = instance
        instance.loadSource(src)
        instance.attachMedia(video)
        instance.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal) {
            instance.destroy()
            hls = null
            fail()
          }
        })
      } catch {
        fail()
      }
    })()

    return () => {
      destroyed = true
      video.removeEventListener('error', onVideoError)
      video.removeAttribute('src')
      video.load()
      hls?.destroy()
    }
  }, [src])

  return (
    <video
      ref={videoRef}
      className="webcam-player__video"
      controls
      playsInline
      muted
      autoPlay
      title={title}
      aria-label={title}
    />
  )
}

type SectionProps = {
  resortName: string
  externalUrl: string
  streams: ClassifiedWebcam[]
}

/** Resort detail webcam block: in-page player when embeddable, else / on fail → link. */
export function WebcamSection({ resortName, externalUrl, streams }: SectionProps) {
  const baseId = useId()
  const [active, setActive] = useState(0)
  const [playerFailed, setPlayerFailed] = useState(false)

  const safeIndex = Math.min(active, Math.max(0, streams.length - 1))
  const current = streams[safeIndex]
  const showPlayer = Boolean(current) && !playerFailed

  return (
    <section className="detail-grid__wide webcam-section" aria-labelledby={`${baseId}-title`}>
      <div className="webcam-section__head">
        <h2 id={`${baseId}-title`}>Веб-камера</h2>
        <a className="webcam-section__open" href={externalUrl} target="_blank" rel="noreferrer">
          Открыть трансляцию
        </a>
      </div>

      {streams.length > 1 && showPlayer && (
        <div className="webcam-section__tabs" role="tablist" aria-label="Камеры">
          {streams.map((s, i) => (
            <button
              key={s.playUrl}
              type="button"
              role="tab"
              aria-selected={i === safeIndex}
              className={`webcam-section__tab${i === safeIndex ? ' is-active' : ''}`}
              onClick={() => {
                setActive(i)
                setPlayerFailed(false)
              }}
            >
              Камера {i + 1}
            </button>
          ))}
        </div>
      )}

      {showPlayer && current ? (
        <WebcamErrorBoundary
          fallback={
            <p className="webcam-section__fallback muted">
              Трансляция сейчас недоступна для встраивания. Откройте её на сайте курорта.
            </p>
          }
        >
          <div className="webcam-player">
            <WebcamPlayer
              key={current.playUrl}
              stream={current}
              title={`${resortName}: камера ${safeIndex + 1}`}
              onUnavailable={() => setPlayerFailed(true)}
            />
          </div>
        </WebcamErrorBoundary>
      ) : (
        <p className="webcam-section__fallback muted">
          {streams.length > 0 && playerFailed
            ? 'Трансляция сейчас недоступна для встраивания. Откройте её на сайте курорта.'
            : 'Встроенный плеер недоступен — смотрите трансляцию по ссылке.'}
        </p>
      )}
    </section>
  )
}
