import { Link } from 'react-router-dom'

export function ContactsPage() {
  return (
    <section className="section page-narrow about-page" aria-labelledby="contacts-title">
      <p className="resort-detail__brand-kicker">MountHunt</p>
      <h1 id="contacts-title">Контакты</h1>
      <p className="about-page__lead">
        По вопросам о проекте MountHunt — напишите в Telegram или на почту.
      </p>

      <ul className="contact-list">
        <li>
          <span className="contact-list__label">Telegram</span>
          <a href="https://t.me/vinogradov_st" rel="noopener noreferrer" target="_blank">
            @vinogradov_st
          </a>
        </li>
        <li>
          <span className="contact-list__label">Почта</span>
          <a href="mailto:stpvng@ya.ru">stpvng@ya.ru</a>
        </li>
      </ul>

      <p className="muted contacts-page__privacy">
        Вопросы об обработке персональных данных — по тем же контактам. Текст политики:{' '}
        <Link to="/privacy">Политика конфиденциальности</Link>.
      </p>
    </section>
  )
}
