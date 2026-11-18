import { Link } from 'react-router-dom'

const homeHash = (hash: string) => `${import.meta.env.BASE_URL}${hash}`

export function AboutPage() {
  return (
    <section className="section page-narrow about-page" aria-labelledby="about-title">
      <p className="resort-detail__brand-kicker">MountHunt</p>
      <h1 id="about-title">О проекте</h1>
      <p className="about-page__lead">
        Агрегатор горнолыжных курортов Санкт-Петербурга и Ленинградской области — чтобы быстро
        понять, куда ехать кататься, не обходя десятки сайтов.
      </p>

      <h2>Что вы найдёте</h2>
      <ul className="about-page__list">
        <li>Цены и ориентиры по ски-пассам</li>
        <li>Часы работы комплексов</li>
        <li>Карту курортов СПБ и ЛО</li>
        <li>Ссылки на камеры и официальные сайты</li>
        <li>Раздел «Важное» — статусы и заметки по склонам</li>
      </ul>

      <h2>О данных</h2>
      <p>
        Сведения собраны с публичных сайтов курортов и носят справочный характер. Перед выездом
        уточняйте режим и цены на официальном сайте комплекса. MountHunt не связан с операторами
        склонов и не продаёт ски-пассы.
      </p>

      <div className="about-page__actions hero__actions">
        <a className="btn btn--primary" href={homeHash('#explore')}>
          К карте и карточкам
        </a>
        <Link className="btn btn--ghost" to="/">
          На главную
        </Link>
      </div>
    </section>
  )
}
