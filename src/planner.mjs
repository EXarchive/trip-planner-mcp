// 行程规划核心逻辑（纯函数，便于单测）
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const POI = JSON.parse(readFileSync(resolve(ROOT, 'data/poi.json'), 'utf8'))

export const CITIES = Object.keys(POI)

// 不同旅行风格的日均预算基准（元）
const STYLE_BASELINE = {
  budget: { hotel: 220, meal: 120, transport: 40 },
  comfort: { hotel: 520, meal: 220, transport: 80 },
  luxury: { hotel: 1200, meal: 480, transport: 200 },
}

export function listCities() {
  return CITIES.map((city) => ({
    city,
    attractions: POI[city].length,
    avgTicket: round(POI[city].reduce((a, b) => a + b.ticket, 0) / POI[city].length),
  }))
}

export function searchAttractions({ city, keyword = '', maxTicket = Infinity, tags = [], limit = 10 }) {
  const pool = POI[city]
  if (!pool) {
    const err = new Error(`unknown_city: ${city}（可选: ${CITIES.join(' / ')}）`)
    err.code = 'UNKNOWN_CITY'
    throw err
  }
  const kw = String(keyword).trim().toLowerCase()
  const wanted = Array.isArray(tags) ? tags.filter(Boolean) : []

  const matched = pool.filter((poi) => {
    if (poi.ticket > maxTicket) return false
    if (wanted.length > 0 && !wanted.some((t) => poi.tags.includes(t))) return false
    if (!kw) return true
    return (
      poi.name.toLowerCase().includes(kw) ||
      poi.tags.some((t) => t.toLowerCase().includes(kw)) ||
      poi.area.toLowerCase().includes(kw)
    )
  })

  return matched
    .sort((a, b) => b.rating - a.rating || a.ticket - b.ticket)
    .slice(0, Math.max(1, Math.min(50, Number(limit) || 10)))
}

/**
 * 制定多日行程：
 * - 按评分优先、单日总时长不超过 dailyHours 装箱
 * - 每日选 1 个主景点 + 尽量填充同区域景点，减少来回折返
 * - 同时给出按风格估算的住宿/餐饮/交通与门票合计
 */
export function planItinerary({ city, days = 3, style = 'comfort', dailyHours = 8, maxTicketPerDay = Infinity }) {
  const pool = POI[city]
  if (!pool) {
    const err = new Error(`unknown_city: ${city}（可选: ${CITIES.join(' / ')}）`)
    err.code = 'UNKNOWN_CITY'
    throw err
  }
  const dayCount = Math.max(1, Math.min(14, Number(days) || 3))
  const base = STYLE_BASELINE[style] ?? STYLE_BASELINE.comfort
  const sorted = [...pool].sort((a, b) => b.rating - a.rating)

  const used = new Set()
  const plan = []

  for (let d = 0; d < dayCount; d++) {
    const remaining = sorted.filter((p) => !used.has(p.name))
    if (remaining.length === 0) {
      plan.push({ day: d + 1, attractions: [], hours: 0, ticket: 0, note: '无更多可安排景点，建议自由活动' })
      continue
    }

    const picked = []
    let hours = 0
    let ticket = 0
    const anchorArea = remaining[0].area

    // 主景点：评分最高的一个
    const anchor = remaining[0]
    picked.push(anchor)
    used.add(anchor.name)
    hours += anchor.hours
    ticket += anchor.ticket

    // 填充：优先同区域，再按评分补，直到接近 dailyHours
    const sameArea = remaining.filter((p) => p.name !== anchor.name && p.area === anchorArea)
    const others = remaining.filter((p) => p.name !== anchor.name && p.area !== anchorArea)
    for (const cand of [...sameArea, ...others]) {
      if (hours + cand.hours > dailyHours) continue
      if (ticket + cand.ticket > maxTicketPerDay) continue
      picked.push(cand)
      used.add(cand.name)
      hours += cand.hours
      ticket += cand.ticket
    }

    plan.push({
      day: d + 1,
      attractions: picked.map((p) => ({ name: p.name, area: p.area, ticket: p.ticket, hours: p.hours, rating: p.rating, tags: p.tags })),
      hours: round(hours),
      ticket: round(ticket),
      note: hours < dailyHours * 0.5 ? '当天较轻松，可加入自由探索' : '',
    })
  }

  const totalTicket = round(plan.reduce((a, b) => a + b.ticket, 0))
  const nights = Math.max(0, dayCount - 1)
  const hotel = round(base.hotel * nights)
  const meal = round(base.meal * dayCount)
  const transport = round(base.transport * dayCount)
  const total = round(totalTicket + hotel + meal + transport)

  return {
    city,
    style,
    days: dayCount,
    plan,
    budget: {
      ticket: totalTicket,
      hotel,
      meal,
      transport,
      total,
      perDay: round(total / dayCount),
      currency: 'CNY',
      note: '住宿按每间夜计价，n 天行程计 n-1 晚',
    },
  }
}

export function estimateBudget({ days = 3, style = 'comfort', people = 2 }) {
  const base = STYLE_BASELINE[style] ?? STYLE_BASELINE.comfort
  const dayCount = Math.max(1, Math.min(30, Number(days) || 3))
  const p = Math.max(1, Math.min(20, Number(people) || 1))
  const nights = Math.max(0, dayCount - 1)
  const hotel = round(base.hotel * nights * Math.ceil(p / 2))
  const meal = round(base.meal * dayCount * p)
  const transport = round(base.transport * dayCount * p)
  const total = round(hotel + meal + transport)
  return {
    style,
    days: dayCount,
    people: p,
    hotel,
    meal,
    transport,
    total,
    perPerson: round(total / p),
    perDayPerPerson: round(total / p / dayCount),
    currency: 'CNY',
  }
}

function round(n) {
  return Math.round(n * 100) / 100
}

export { POI }
