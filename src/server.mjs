#!/usr/bin/env node
// server.mjs —— MCP（Model Context Protocol）服务端，stdio + JSON-RPC 2.0
//
// 实现能力：
//   - initialize / tools/list / tools/call / ping
//   - 3 个工具：list_cities、search_attractions、plan_itinerary、estimate_budget
//
// 运行: node src/server.mjs   （由 MCP 客户端以子进程方式拉起，走 stdin/stdout）
// 协议要点：每条消息一行 JSON；通知（无 id）不应答；错误用 JSON-RPC error 对象。

import { createInterface } from 'node:readline'
import { estimateBudget, listCities, planItinerary, searchAttractions } from './planner.mjs'

const PROTOCOL_VERSION = '2024-11-05'
const SERVER_INFO = { name: 'trip-planner-mcp', version: '1.0.0' }

export const TOOLS = [
  {
    name: 'list_cities',
    description: '列出当前支持规划的城市，以及每个城市的景点数与平均门票价格。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'search_attractions',
    description: '按城市、关键词、标签与门票上限检索景点，结果按评分降序。',
    inputSchema: {
      type: 'object',
      properties: {
        city: { type: 'string', description: '城市名，如 杭州' },
        keyword: { type: 'string', description: '名称/标签/区域关键词' },
        tags: { type: 'array', items: { type: 'string' }, description: '标签过滤，如 ["自然","徒步"]' },
        maxTicket: { type: 'number', description: '门票价格上限（元）' },
        limit: { type: 'number', description: '返回条数，默认 10' },
      },
      required: ['city'],
      additionalProperties: false,
    },
  },
  {
    name: 'plan_itinerary',
    description: '按天生成行程：评分优先装箱、同区域优先以减少折返，并给出分项预算。',
    inputSchema: {
      type: 'object',
      properties: {
        city: { type: 'string', description: '城市名' },
        days: { type: 'number', description: '行程天数，1-14，默认 3' },
        style: { type: 'string', enum: ['budget', 'comfort', 'luxury'], description: '预算档位，默认 comfort' },
        dailyHours: { type: 'number', description: '每天可游玩小时数，默认 8' },
        maxTicketPerDay: { type: 'number', description: '每天门票上限（元）' },
      },
      required: ['city'],
      additionalProperties: false,
    },
  },
  {
    name: 'estimate_budget',
    description: '按人数、天数、档位估算住宿/餐饮/交通花费。',
    inputSchema: {
      type: 'object',
      properties: {
        days: { type: 'number', description: '天数，1-30，默认 3' },
        style: { type: 'string', enum: ['budget', 'comfort', 'luxury'] },
        people: { type: 'number', description: '人数，1-20，默认 2' },
      },
      additionalProperties: false,
    },
  },
]

function callTool(name, args) {
  switch (name) {
    case 'list_cities':
      return { cities: listCities() }
    case 'search_attractions':
      return { items: searchAttractions(args ?? {}) }
    case 'plan_itinerary':
      return planItinerary(args ?? {})
    case 'estimate_budget':
      return estimateBudget(args ?? {})
    default: {
      const err = new Error(`unknown tool: ${name}`)
      err.code = 'UNKNOWN_TOOL'
      throw err
    }
  }
}

function send(payload) {
  process.stdout.write(JSON.stringify(payload) + '\n')
}

function respond(id, result) {
  send({ jsonrpc: '2.0', id, result })
}

function respondError(id, code, message, data) {
  send({ jsonrpc: '2.0', id, error: { code, message, ...(data ? { data } : {}) } })
}

/// 处理单条请求；返回是否应答（通知不应答）
export function handleMessage(msg) {
  if (!msg || msg.jsonrpc !== '2.0') {
    respondError(null, -32600, 'Invalid Request')
    return
  }
  const { id, method, params } = msg
  const isNotification = id === undefined || id === null

  try {
    switch (method) {
      case 'initialize':
        if (isNotification) return
        respond(id, {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
        })
        return
      case 'notifications/initialized':
      case 'initialized':
        return
      case 'ping':
        if (isNotification) return
        respond(id, {})
        return
      case 'tools/list':
        if (isNotification) return
        respond(id, { tools: TOOLS })
        return
      case 'tools/call': {
        const name = params?.name
        const args = params?.arguments ?? {}
        if (!name) {
          if (!isNotification) respondError(id, -32602, '缺少参数 name')
          return
        }
        try {
          const result = callTool(name, args)
          if (isNotification) return
          respond(id, {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            structuredContent: result,
            isError: false,
          })
        } catch (err) {
          if (isNotification) return
          respond(id, {
            content: [{ type: 'text', text: `工具执行失败: ${err.message}` }],
            isError: true,
          })
        }
        return
      }
      default:
        if (!isNotification) respondError(id, -32601, `Method not found: ${method}`)
    }
  } catch (err) {
    if (!isNotification) respondError(id, -32603, `Internal error: ${err.message}`)
  }
}

function main() {
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity })
  rl.on('line', (line) => {
    const text = line.trim()
    if (!text) return
    let msg
    try {
      msg = JSON.parse(text)
    } catch {
      respondError(null, -32700, 'Parse error')
      return
    }
    if (Array.isArray(msg)) {
      msg.forEach(handleMessage)
      return
    }
    handleMessage(msg)
  })
  rl.on('close', () => process.exit(0))
  // 就绪日志走 stderr，不能污染 stdout 的协议流
  console.error(`[trip-planner-mcp] ready (protocol ${PROTOCOL_VERSION})`)
}

if (process.argv[1] && process.argv[1].endsWith('server.mjs')) {
  main()
}
