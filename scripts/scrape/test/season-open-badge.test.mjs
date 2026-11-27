/**
 * Season-open card badge from scraped news dates.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  extractSeasonOpenYmd,
  isSeasonOpeningAnnouncement,
  seasonOpenBadgeLabel,
} from '../lib/season-open-badge.mjs'

describe('season-open-badge', () => {
  it('detects Krasnoe TG 1849-style opening announcement', () => {
    const body =
      'Друзья, в эту субботу, 28.11 стартует зимний сезон! Снежная магия уже в процессе'
    assert.equal(isSeasonOpeningAnnouncement(body), true)
    assert.equal(extractSeasonOpenYmd(body, '2026-11-25T17:10:56Z'), '2026-11-28')
  })

  it('ignores contest posts that ask to guess the opening date', () => {
    const body =
      'Разыгрываем 2 ски‑пасса — для тех, кто первым угадает дату открытия сезона! Напиши в комментариях дату старта сезона 26/27'
    assert.equal(isSeasonOpeningAnnouncement(body), false)
    assert.equal(extractSeasonOpenYmd(body, '2026-11-19T15:49:41Z'), null)
  })

  it('parses Okhta-style «Открытие 22 ноября»', () => {
    const body = 'Открытие 22 ноября! С 22 ноября будет открыт первый склон'
    assert.equal(isSeasonOpeningAnnouncement(body), true)
    assert.equal(extractSeasonOpenYmd(body, '2026-11-10T00:00:00Z'), '2026-11-22')
  })

  it('shows badge while opening date is today or future (MSK)', () => {
    const items = [
      {
        id: 'krasnoe-tg-1849',
        resortId: 'krasnoe-ozero',
        title: 'Красное озеро: МЫ ОТКРЫВАЕМСЯ',
        body: 'Друзья, в эту субботу, 28.11 стартует зимний сезон!',
        publishedAt: '2026-11-25T17:10:56Z',
        updatedAt: '2026-11-27T02:01:26Z',
        severity: 'info',
      },
    ]
    assert.equal(
      seasonOpenBadgeLabel('krasnoe-ozero', items, new Date('2026-11-27T12:00:00+03:00')),
      'Начало сезона 28.11.2026',
    )
    assert.equal(
      seasonOpenBadgeLabel('krasnoe-ozero', items, new Date('2026-11-28T10:00:00+03:00')),
      'Начало сезона 28.11.2026',
    )
  })

  it('hides badge once opening date has passed (MSK)', () => {
    const items = [
      {
        id: 'krasnoe-tg-1849',
        resortId: 'krasnoe-ozero',
        title: 'Красное озеро: МЫ ОТКРЫВАЕМСЯ',
        body: 'Друзья, в эту субботу, 28.11 стартует зимний сезон!',
        publishedAt: '2026-11-25T17:10:56Z',
        updatedAt: '2026-11-27T02:01:26Z',
        severity: 'info',
      },
    ]
    assert.equal(
      seasonOpenBadgeLabel('krasnoe-ozero', items, new Date('2026-11-29T00:30:00+03:00')),
      null,
    )
  })

  it('does not invent a badge for other resorts or closed-season notes', () => {
    const items = [
      {
        id: 'lazurnye-season-closed',
        resortId: 'lazurnye-ozera',
        title: 'Лазурные озёра: сезон закрыт',
        body: 'На сайте курорта есть сообщение о закрытии сезона.',
        updatedAt: '2026-11-27T02:00:53Z',
        severity: 'warn',
      },
    ]
    assert.equal(
      seasonOpenBadgeLabel('lazurnye-ozera', items, new Date('2026-11-27T12:00:00+03:00')),
      null,
    )
    assert.equal(
      seasonOpenBadgeLabel('okhta-park', items, new Date('2026-11-27T12:00:00+03:00')),
      null,
    )
  })

  it('shows Drop Park «Начало сезона 27.11.2026» on open day (MSK)', () => {
    const items = [
      {
        id: 'drop-season-open',
        resortId: 'drop-park',
        title: 'Drop Park: открытие сезона',
        body: '27.11.2026 стартует зимний сезон на сноупарке Drop Park.',
        publishedAt: '2026-11-27T00:00:00Z',
        updatedAt: '2026-11-27T10:15:00Z',
        severity: 'info',
      },
    ]
    assert.equal(
      seasonOpenBadgeLabel('drop-park', items, new Date('2026-11-27T12:00:00+03:00')),
      'Начало сезона 27.11.2026',
    )
    assert.equal(
      seasonOpenBadgeLabel('drop-park', items, new Date('2026-11-28T00:30:00+03:00')),
      null,
    )
  })
})
