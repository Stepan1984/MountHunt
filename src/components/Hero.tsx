export function Hero({ activeCount }: { activeCount: number }) {
  return (
    <section className="hero" aria-labelledby="hero-brand">
      <div className="hero__sky" aria-hidden="true">
        <svg className="hero__mountains" viewBox="0 0 1440 520" preserveAspectRatio="xMidYMax slice">
          <defs>
            <linearGradient id="skyGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#9ec4d4" />
              <stop offset="55%" stopColor="#d7e6ee" />
              <stop offset="100%" stopColor="#f4f7f9" />
            </linearGradient>
            <linearGradient id="ridgeA" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#2f5a4a" />
              <stop offset="100%" stopColor="#1b3a2f" />
            </linearGradient>
            <linearGradient id="ridgeB" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#4d7a6a" />
              <stop offset="100%" stopColor="#274a3d" />
            </linearGradient>
          </defs>
          <rect width="1440" height="520" fill="url(#skyGrad)" />
          <circle cx="1180" cy="96" r="42" fill="#f7fafb" opacity="0.9" />
          <path
            d="M0 360 L180 220 L280 300 L420 160 L560 290 L700 190 L860 310 L980 200 L1140 280 L1280 180 L1440 300 L1440 520 L0 520 Z"
            fill="url(#ridgeA)"
          />
          <path
            d="M0 420 L140 320 L260 380 L400 280 L540 360 L700 300 L860 380 L1020 310 L1180 370 L1320 300 L1440 360 L1440 520 L0 520 Z"
            fill="url(#ridgeB)"
            opacity="0.92"
          />
          <path
            className="hero__trail"
            d="M420 160 C480 220, 520 260, 560 290"
            fill="none"
            stroke="#e8f1f5"
            strokeWidth="3"
            strokeLinecap="round"
            opacity="0.55"
          />
          <path
            className="hero__trail hero__trail--delayed"
            d="M980 200 C1040 240, 1080 260, 1140 280"
            fill="none"
            stroke="#e8f1f5"
            strokeWidth="2.5"
            strokeLinecap="round"
            opacity="0.4"
          />
        </svg>
        <div className="hero__mist" />
      </div>

      <div className="hero__content">
        <p className="hero__brand" id="hero-brand">
          MountHunt
        </p>
        <h1 className="hero__title">Склоны рядом с Петербургом — в одном месте</h1>
        <p className="hero__lead">
          Карта и карточки {activeCount} действующих курортов СПБ и Ленинградской области: где
          кататься, часы, цены и ссылки на камеры.
        </p>
        <div className="hero__actions">
          <a className="btn btn--primary" href="#explore">
            Карта и список
          </a>
          <a className="btn btn--ghost" href="#important">
            Важное сейчас
          </a>
        </div>
      </div>
    </section>
  )
}
