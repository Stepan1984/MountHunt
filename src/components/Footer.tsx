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
          <Link to="/about">О проекте</Link>
          {' · '}
          <Link to="/contacts">Контакты</Link>
          {' · '}
          <Link to="/privacy">Политика конфиденциальности</Link>
        </p>
        <p className="muted site-footer__note">
          Внешние сайты курортов и соцсети живут по своим правилам; MountHunt за них не отвечает.
          Шрифты, карта и встроенные камеры могут загружаться со сторонних серверов — подробности в
          политике.
        </p>
      </div>
    </footer>
  )
}
