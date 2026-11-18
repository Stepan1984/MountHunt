import { Link } from 'react-router-dom'

export function NotFoundPage() {
  return (
    <section className="section page-narrow not-found">
      <p className="resort-detail__brand-kicker">MountHunt</p>
      <h1>Страница не найдена</h1>
      <p>
        Такой страницы нет. Возможно, ссылка устарела или курорт ещё не добавлен в каталог.
      </p>
      <div className="hero__actions">
        <Link className="btn btn--primary" to="/">
          На главную
        </Link>
        <Link className="btn btn--ghost" to="/about">
          О проекте
        </Link>
      </div>
    </section>
  )
}
