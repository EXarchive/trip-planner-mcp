#!/usr/bin/env node
// tests/planner.test.mjs —— 使用 node:test 的单测（无第三方依赖）
// 运行: node --test tests/

import test from 'node:test'
import assert from 'node:assert/strict'
import { estimateBudget, listCities, planItinerary, searchAttractions } from '../src/planner.mjs'

test('listCities 返回城市与景点数', () => {
  const cities = listCities()
  assert.ok(cities.length >= 3)
  const hz = cities.find((c) => c.city === '杭州')
  assert.ok(hz)
  assert.ok(hz.attractions >= 5)
  assert.ok(hz.avgTicket >= 0)
})

test('searchAttractions 按标签过滤且按评分降序', () => {
  const items = searchAttractions({ city: '杭州', tags: ['自然'] })
  assert.ok(items.length >= 1)
  for (let i = 1; i < items.length; i++) {
    assert.ok(items[i - 1].rating >= items[i].rating, '结果需按评分降序')
  }
})

test('searchAttractions 支持门票上限与关键词', () => {
  const free = searchAttractions({ city: '杭州', maxTicket: 0 })
  assert.ok(free.length >= 1)
  assert.ok(free.every((i) => i.ticket === 0))

  const kw = searchAttractions({ city: '杭州', keyword: '寺' })
  assert.ok(kw.some((i) => i.name.includes('寺')))
})

test('searchAttractions 未知城市抛 UNKNOWN_CITY', () => {
  assert.throws(
    () => searchAttractions({ city: '火星' }),
    (err) => err.code === 'UNKNOWN_CITY',
  )
})

test('planItinerary 天数正确且不重复安排同一景点', () => {
  const result = planItinerary({ city: '杭州', days: 3, style: 'comfort' })
  assert.equal(result.plan.length, 3)
  const names = result.plan.flatMap((d) => d.attractions.map((a) => a.name))
  assert.equal(new Set(names).size, names.length, '同一景点不应被安排多次')
})

test('planItinerary 遵守每日时长上限', () => {
  const result = planItinerary({ city: '杭州', days: 2, dailyHours: 4 })
  for (const day of result.plan) {
    assert.ok(day.hours <= 4 + 1e-9, `第 ${day.day} 天超时: ${day.hours}`)
  }
})

test('planItinerary 预算分项相加等于 total', () => {
  const { budget } = planItinerary({ city: '北京', days: 3, style: 'comfort' })
  const sum = Math.round((budget.ticket + budget.hotel + budget.meal + budget.transport) * 100) / 100
  assert.equal(sum, budget.total)
})

test('planItinerary 住宿按 n-1 晚计费', () => {
  const { budget } = planItinerary({ city: '北京', days: 1, style: 'comfort' })
  assert.equal(budget.hotel, 0)
})

test('estimateBudget 双人总价为人均的两倍', () => {
  const b = estimateBudget({ days: 3, style: 'budget', people: 2 })
  assert.equal(b.total, Math.round(b.perPerson * 2 * 100) / 100)
})

test('estimateBudget 对越界参数做收敛', () => {
  const b = estimateBudget({ days: 999, style: 'unknown', people: 0 })
  assert.equal(b.days, 30)
  assert.equal(b.people, 1)
  assert.ok(b.total > 0)
})
