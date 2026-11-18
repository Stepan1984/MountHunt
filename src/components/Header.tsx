import { Link, NavLink } from 'react-router-dom'

const homeHash = (hash: string) => `${import.meta.env.BASE_URL}${hash}`

export function Header() {
  return (
    <header className="site-header">
      <div className="site-header__inner">
        <Link to="/" className="site-logo" aria-label="MountHunt — на главную">
          MountHunt
        </Link>
        <nav className="site-nav" aria-label="Основная навигация">
          <NavLink to="/" end>
            Курорты
          </NavLink>
          <a href={homeHash('#map')}>Карта</a>
          <a href={homeHash('#important')}>Важное</a>
          <NavLink to="/about">О проекте</NavLink>
        </nav>
      </div>
    </header>
  )
}
