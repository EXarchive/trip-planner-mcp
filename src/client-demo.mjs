#!/usr/bin/env node
// client-demo.mjs —— 最小 MCP 客户端：拉起 server.mjs，完成握手并跑一次真实规划
//
// 用法: node src/client-demo.mjs [--city 杭州] [--days 3] [--style comfort]

import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const getArg = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}

const city = getArg('city', '杭州')
const days = Number(getArg('days', '3'))
const style = getArg('style', 'comfort')

class McpClient {
  constructor(command, cmdArgs) {
    this.proc = spawn(command, cmdArgs, { stdio: ['pipe', 'pipe', 'pipe'] })
    this.pending = new Map()
    this.nextId = 1
    this.stderr = ''
    this.proc.stderr.on('data', (d) => (this.stderr += d.toString()))

    const rl = createInterface({ input: this.proc.stdout, crlfDelay: Infinity })
    rl.on('line', (line) => {
      const text = line.trim()
      if (!text) return
      let msg
      try {
        msg = JSON.parse(text)
      } catch {
        return
      }
      if (msg.id != null && this.pending.has(msg.id)) {
        const { resolve: res, reject } = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        if (msg.error) reject(new Error(`${msg.error.code}: ${msg.error.message}`))
        else res(msg.result)
      }
    })
  }

  request(method, params) {
    const id = this.nextId++
    const payload = { jsonrpc: '2.0', id, method, params }
    return new Promise((res, reject) => {
      this.pending.set(id, { resolve: res, reject })
      this.proc.stdin.write(JSON.stringify(payload) + '\n')
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          reject(new Error(`timeout: ${method}`))
        }
      }, 10000)
    })
  }

  notify(method, params) {
    this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n')
  }

  async callTool(name, toolArgs) {
    const result = await this.request('tools/call', { name, arguments: toolArgs })
    return result.structuredContent ?? result.content
  }

  close() {
    this.proc.stdin.end()
    this.proc.kill()
  }
}

async function main() {
  const client = new McpClient(process.execPath, [resolve(ROOT, 'src/server.mjs')])

  try {
    const init = await client.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'trip-planner-demo', version: '1.0.0' },
    })
    console.log(`① 握手成功 —— server=${init.serverInfo.name}@${init.serverInfo.version} protocol=${init.protocolVersion}`)
    client.notify('notifications/initialized', {})

    const listed = await client.request('tools/list', {})
    console.log(`② 可用工具 ${listed.tools.length} 个: ${listed.tools.map((t) => t.name).join(', ')}`)

    const cities = await client.callTool('list_cities', {})
    console.log(`③ 支持城市: ${cities.cities.map((c) => `${c.city}(${c.attractions})`).join(' / ')}`)

    const found = await client.callTool('search_attractions', { city, tags: ['自然'], limit: 3 })
    console.log(`④ ${city} 自然类景点 ${found.items.length} 个: ${found.items.map((i) => i.name).join('、')}`)

    const plan = await client.callTool('plan_itinerary', { city, days, style })
    console.log(`⑤ ${city} ${days} 天行程（${style}）:`)
    for (const d of plan.plan) {
      console.log(`   D${d.day} [${d.hours}h / ¥${d.ticket}] ${d.attractions.map((a) => a.name).join(' → ') || '自由活动'}`)
    }
    console.log(
      `⑥ 预算: 门票 ¥${plan.budget.ticket} + 住宿 ¥${plan.budget.hotel} + 餐饮 ¥${plan.budget.meal} + 交通 ¥${plan.budget.transport} = ¥${plan.budget.total}（日均 ¥${plan.budget.perDay}）`,
    )

    const budget = await client.callTool('estimate_budget', { days, style, people: 2 })
    console.log(`⑦ 双人 ${days} 天总花费 ¥${budget.total}，人均 ¥${budget.perPerson}`)
  } catch (err) {
    console.error(`❌ 演示失败: ${err.message}`)
    if (client.stderr) console.error(client.stderr.slice(0, 500))
    process.exitCode = 1
  } finally {
    client.close()
  }
}

main()
