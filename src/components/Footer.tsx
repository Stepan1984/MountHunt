import { Link } from 'react-router-dom'

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="site-footer__inner">
        <p>
          <strong>MountHunt</strong> — курорты СПБ и ЛО
        </p>
        <p className="muted">
          Данные справочные. Уточняйте часы и цены на официальных сайтах.{' '}
          <Link to="/about">О проекте и источниках</Link>
        </p>
      </div>
    </footer>
  )
}
