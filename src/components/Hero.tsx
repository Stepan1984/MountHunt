export function Hero({ activeCount }: { activeCount: number }) {
  return (
    <section className="hero" aria-labelledby="hero-brand">
      <div className="hero__sky" aria-hidden="true">
        <svg className="hero__mountains" viewBox="0 0 1440 520" preserveAspectRatio="xMidYMax slice">
          <defs>
            <linearGradient id="skyGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#b7d2de" />
              <stop offset="42%" stopColor="#dce8ee" />
              <stop offset="100%" stopColor="#f4f7f9" />
            </linearGradient>
            {/* Bleached ice ridges — readable pine text without a fog scrim */}
            <linearGradient id="ridgeFar" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#d2e0e6" />
              <stop offset="100%" stopColor="#b7cdd5" />
            </linearGradient>
            <linearGradient id="ridgeMid" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#b8cfc8" />
              <stop offset="100%" stopColor="#95b3aa" />
            </linearGradient>
            <linearGradient id="ridgeNear" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#a8c9d4" />
              <stop offset="100%" stopColor="#87a89f" />
            </linearGradient>
          </defs>
          <rect width="1440" height="520" fill="url(#skyGrad)" />
          <circle cx="1180" cy="88" r="38" fill="#f7fafb" opacity="0.88" />
          {/* Ridges kept low in the frame so copy sits on open ice sky */}
          <path
            d="M0 415 L160 335 L280 375 L420 285 L560 360 L700 300 L860 365 L980 310 L1140 350 L1280 290 L1440 355 L1440 520 L0 520 Z"
            fill="url(#ridgeFar)"
            opacity="0.9"
          />
          <path
            d="M0 450 L140 380 L260 415 L400 345 L540 400 L700 360 L860 415 L1020 370 L1180 405 L1320 360 L1440 395 L1440 520 L0 520 Z"
            fill="url(#ridgeMid)"
            opacity="0.82"
          />
          <path
            d="M0 480 L120 440 L240 460 L380 415 L520 455 L680 425 L820 460 L980 430 L1140 455 L1300 425 L1440 445 L1440 520 L0 520 Z"
            fill="url(#ridgeNear)"
            opacity="0.75"
          />
          <path
            className="hero__trail"
            d="M420 285 C480 320, 520 345, 560 360"
            fill="none"
            stroke="#f4f7f9"
            strokeWidth="2.5"
            strokeLinecap="round"
            opacity="0.7"
          />
          <path
            className="hero__trail hero__trail--delayed"
            d="M980 310 C1040 335, 1080 345, 1140 350"
            fill="none"
            stroke="#f4f7f9"
            strokeWidth="2"
            strokeLinecap="round"
            opacity="0.55"
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
      </div>
    </section>
  )
}
