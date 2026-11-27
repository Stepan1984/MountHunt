import { Link } from 'react-router-dom'

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="site-footer__inner">
        <p>
          <strong>MountHunt</strong> — курорты СПБ и ЛО
        </p>
        <p className="site-footer__contacts">
          <a href="https://t.me/vinogradov_st" rel="noopener noreferrer" target="_blank">
            Telegram @vinogradov_st
          </a>
          <span aria-hidden="true"> · </span>
          <a href="mailto:stpvng@ya.ru">stpvng@ya.ru</a>
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
