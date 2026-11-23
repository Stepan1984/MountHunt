import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { Footer } from './components/Footer'
import { Header } from './components/Header'
import { ScrollToHash } from './components/ScrollToHash'
import { useSiteData } from './hooks/useSiteData'
import { AboutPage } from './pages/AboutPage'
import { HomePage } from './pages/HomePage'
import { NewsPage } from './pages/NewsPage'
import { NotFoundPage } from './pages/NotFoundPage'
import { ResortPage } from './pages/ResortPage'

const routerBasename = (() => {
  const base = import.meta.env.BASE_URL
  if (!base || base === '/') return undefined
  return base.replace(/\/$/, '')
})()

export default function App() {
  const state = useSiteData()
  const ready = state.status === 'ready'

  return (
    <BrowserRouter basename={routerBasename}>
      <ScrollToHash ready={ready} />
      <div className="app-shell">
        <Header />
        <main>
          {state.status === 'loading' && (
            <section className="section page-narrow">
              <p>Загружаем курорты…</p>
            </section>
          )}
          {state.status === 'error' && (
            <section className="section page-narrow">
              <h1>Не удалось загрузить данные</h1>
              <p>{state.message}</p>
            </section>
          )}
          {ready && (
            <Routes>
              <Route path="/" element={<HomePage data={state.data} />} />
              <Route path="/news" element={<NewsPage data={state.data} />} />
              <Route path="/resort/:id" element={<ResortPage data={state.data} />} />
              <Route path="/about" element={<AboutPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          )}
        </main>
        <Footer />
      </div>
    </BrowserRouter>
  )
}
