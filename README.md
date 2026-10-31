# 智能行程规划 MCP Server

一个实现了 **MCP（Model Context Protocol）** 的行程规划服务端：走 stdio + JSON-RPC 2.0，任何支持 MCP 的 AI 客户端（CodeArts Agent / Claude Desktop / 自研 Agent）都能直接挂载它，获得「查景点、排行程、估预算」的能力。

## 能力（4 个工具）

| 工具 | 说明 |
|------|------|
| `list_cities` | 列出支持规划的城市、景点数与平均门票 |
| `search_attractions` | 按城市 / 关键词 / 标签 / 门票上限检索，按评分降序 |
| `plan_itinerary` | 按天排行程：评分优先装箱、同区域优先减少折返，并给出分项预算 |
| `estimate_budget` | 按人数 / 天数 / 档位（budget / comfort / luxury）估算住宿餐饮交通 |

## 协议实现

- `initialize` → 返回 `protocolVersion`、`capabilities.tools`、`serverInfo`
- `notifications/initialized` → 通知（无 `id`）不应答
- `tools/list` → 返回工具定义与 JSON Schema
- `tools/call` → 返回 `content[{type:"text"}]` + `structuredContent`，工具内部异常转 `isError: true`
- `ping` → 心跳
- 错误码：`-32700` 解析失败、`-32600` 非法请求、`-32601` 方法不存在、`-32602` 参数缺失、`-32603` 内部错误

> 关键约束：协议流只走 **stdout**，所有日志必须写 **stderr**，否则会污染 JSON-RPC 报文。

## 快速开始

```bash
# 跑一遍端到端演示（客户端自动拉起 server 子进程，完成握手 → 列工具 → 规划 → 估预算）
node src/client-demo.mjs --city 杭州 --days 3 --style comfort

# 单测
node --test tests/

# 直接当服务端挂到 MCP 客户端（客户端会自行 spawn，一般不用手动起）
node src/server.mjs
```

演示实测输出：

```
① 握手成功 —— server=trip-planner-mcp@1.0.0 protocol=2024-11-05
② 可用工具 4 个: list_cities, search_attractions, plan_itinerary, estimate_budget
③ 支持城市: 杭州(7) / 北京(5) / 成都(4)
④ 杭州 自然类景点 1 个: 九溪烟树
⑤ 杭州 3 天行程（comfort）:
   D1 [7.5h / ¥135] 西湖断桥 → 灵隐寺 → 雷峰塔 → 九溪烟树
   D2 [7h / ¥80] 西溪湿地 → 中国美院象山校区 → 河坊街
   D3 [0h / ¥0] 自由活动
⑥ 预算: 门票 ¥215 + 住宿 ¥1040 + 餐饮 ¥660 + 交通 ¥240 = ¥2155（日均 ¥718.33）
⑦ 双人 3 天总花费 ¥2840，人均 ¥1420
```

## 目录结构

```
mcp-trip-planner/
├─ package.json
├─ data/poi.json          # 景点库（城市 / 标签 / 门票 / 时长 / 区域 / 评分）
├─ src/
│  ├─ planner.mjs         # 纯函数核心：检索、装箱排程、预算估算
│  ├─ server.mjs          # MCP 服务端（stdio JSON-RPC 2.0）
│  └─ client-demo.mjs     # 最小 MCP 客户端 + 端到端演示
└─ tests/planner.test.mjs # node:test 单测（10 例）
```

## 排程算法

1. 按评分降序作为候选池；
2. 每天先取评分最高的景点做「锚点」，记下它的区域；
3. 在剩余景点里优先挑**同区域**的填充，再挑其它区域，直到 `dailyHours` 用满或门票超过 `maxTicketPerDay`；
4. 已安排的景点从池中移除，避免重复；
5. 预算：门票按实际选取求和；住宿 = 档位单价 ×（天数 − 1）；餐饮/交通 = 档位单价 × 天数。

## 测试覆盖

10 条单测全部通过，覆盖：城市列表、标签过滤与排序、门票上限、关键词、未知城市异常、天数正确性、景点不重复、每日时长上限、预算分项自洽（分项之和 == total）、住宿 n−1 晚、两人总价 = 人均 ×2、越界参数收敛。
