import type { ReactNode } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'

function HomeHashNavLink({
  hash,
  children,
}: {
  hash: string
  children: ReactNode
}) {
  const location = useLocation()
  const targetHash = hash.startsWith('#') ? hash : `#${hash}`
  const onHome = location.pathname === '/' || location.pathname === ''
  const isHashActive = onHome && location.hash === targetHash

  return (
    <Link
      to={{ pathname: '/', hash: targetHash }}
      className={isHashActive ? 'active' : undefined}
      aria-current={isHashActive ? 'page' : undefined}
    >
      {children}
    </Link>
  )
}

export function Header() {
  return (
    <header className="site-header">
      <div className="site-header__inner">
        <Link to="/" className="site-logo" aria-label="MountHunt — на главную">
          MountHunt
        </Link>
        <nav className="site-nav" aria-label="Основная навигация">
          <HomeHashNavLink hash="#resorts">Курорты</HomeHashNavLink>
          <HomeHashNavLink hash="#map">Карта</HomeHashNavLink>
          <NavLink to="/news">Новости</NavLink>
          <NavLink to="/about">О проекте</NavLink>
        </nav>
      </div>
    </header>
  )
}
