# Polymarket 跟单 CLI 技术方案（基于真实 API 验证）

## 1. 结论先行（已按此落地）

MVP 的实现方式应当固定为：

1. 语言选 `Node.js + TypeScript`
2. 读路径不依赖官方 `polymarket` CLI，直接调用 Polymarket 公开 REST API
3. 跟单信号源优先使用 `data-api` 的 `activity` 接口，而不是 `trades`
4. 行情与可复制性判断使用 `gamma-api` + `clob`
5. 最终执行模式只保留真实下单；`duola` 默认用官方 SDK 下单，外部 execution adapter 作为 fallback

原因很直接：当前环境里没有安装官方 `polymarket` CLI，而且从真实接口测试结果看，公开 REST 已足够覆盖 leader 同步、市场元数据、盘口、即时价格、历史价格这几条核心读链路。把核心依赖放在一个外部 CLI 上，会让可移植性、错误处理、字段稳定性都变差。

## 2. 已验证可用的真实接口

以下接口已在当前环境通过本地代理实际请求成功。

### 2.1 leader 活动流（核心同步源）

`GET https://data-api.polymarket.com/activity?user=<wallet>&limit=<n>&offset=<n>`

已验证：

- 需要 `user` 参数
- 支持 `limit` 和 `offset`
- 返回按时间倒序
- 返回的不只有 `TRADE`，也会有 `REDEEM`

关键字段：

- `timestamp`
- `type`
- `transactionHash`
- `conditionId`
- `asset`
- `side`
- `price`
- `size`
- `usdcSize`
- `title`
- `slug`
- `outcome`

结论：`activity` 比 `trades` 更适合作为 leader 同步源，因为它多了 `type` 和 `usdcSize`，更适合做过滤、回测和 sizing。

### 2.2 leader 成交流（可做补充）

`GET https://data-api.polymarket.com/trades?user=<wallet>&limit=<n>`

已验证：

- 可按 `user` 查询
- 返回公开成交
- 不包含 `usdcSize`

结论：保留为补充数据源，不作为主同步源。

### 2.3 市场元数据

`GET https://gamma-api.polymarket.com/markets?condition_ids=<conditionId>`

已验证：

- 可通过 `conditionId` 直接回查市场
- 返回市场状态、时间、流动性、价格刻度、token 列表、事件信息

关键字段：

- `conditionId`
- `endDate`
- `active`
- `closed`
- `liquidityNum`
- `clobTokenIds`
- `bestBid`
- `bestAsk`
- `spread`
- `events[0].series.slug`
- `events[0].series.title`

结论：过滤器里的 `min_liquidity`、`min_time_to_expiry` 可以直接落地。PRD 里的 “tags” 在公开返回里并不是稳定的一等字段，MVP 应降级为基于 `category`、`slug`、`series.slug` 的分类过滤。

### 2.4 盘口深度

`GET https://clob.polymarket.com/book?token_id=<asset>`

已验证：

- 返回整档 `bids` / `asks`
- 可直接拿来算 best bid/ask、深度加权成交价

关键字段：

- `asset_id`
- `bids`
- `asks`
- `min_order_size`
- `tick_size`
- `last_trade_price`

结论：MVP 不需要只用 mid/spread 近似，已经可以直接按档位做一个简化版的深度吃单计算。

### 2.5 即时报价

`GET https://clob.polymarket.com/midpoint?token_id=<asset>`
`GET https://clob.polymarket.com/price?token_id=<asset>&side=buy`

已验证：

- 两个接口都可用
- 返回非常轻，适合 runner 高频轮询

结论：runner 日常风控和 mark-to-market 优先用 `midpoint`，只有信号进入可执行阶段时再拉全量 `book`。

### 2.6 历史价格

`GET https://clob.polymarket.com/prices-history?market=<asset>&interval=1h&fidelity=60`

已验证：

- 可用
- 返回 `history: [{ t, p }]`

结论：MVP 回测可以做“历史价格近似版”，不需要等历史订单簿。

## 3. 需要修正 PRD 的地方

### 3.1 不要把官方 CLI 作为核心依赖

PRD 里写的是“通过子进程调用 `polymarket` 命令”。这个方向不建议保留为主路径。

固定方案：

- 读链路：直接 REST
- 写链路：预留 `ExecutionAdapter`
- 如果后续必须接官方 CLI，只作为可选 fallback，不作为主实现

### 3.2 `trade_id` 假设不成立

公开 `activity/trades` 返回里没有稳定的 `trade_id` 字段。

因此 `leader_trades` 表应改成：

- 增加 `transaction_hash`
- 增加 `event_type`
- 增加 `usdc_size`
- 唯一键改为 `source_uid`

`source_uid` 建议生成方式：

`sha256(transactionHash + "|" + asset + "|" + side + "|" + price + "|" + size + "|" + timestamp)`

这样即便未来一个交易哈希里出现多条事件，也能稳妥去重。

### 3.3 “tags” 过滤需要降级

公开 market 返回并没有一个稳定、统一的 `tags` 列表可依赖。MVP 不应把 `tags_allow/tags_deny` 绑定到不存在的字段。

建议改成：

- `categories_allow`
- `categories_deny`
- 或 `slug_allow_regex`

内部映射来源：

- `category`
- `events[].series.slug`
- `slug`

### 3.4 runner 增量拉取不要依赖 `since`

当前已验证接口里没有明确的 `since` 参数可用。

固定方案：

- 每次拉最新 `N` 条 `activity`
- 本地按 `source_uid` 去重
- 只处理比 `last_seen_ts` 新的 `TRADE`

这是更稳的增量策略。

## 4. 最终推荐架构

```text
src/
  cli/
  config/
  db/
  adapters/
    polymarket/
      dataApi.ts
      gammaApi.ts
      clobApi.ts
      execution.ts
  leaders/
  sync/
  signals/
  follow/
  backtest/
  risk/
  report/
  utils/
```

模块职责：

- `dataApi.ts`: 拉 leader `activity/trades`
- `gammaApi.ts`: 拉市场元数据
- `clobApi.ts`: 拉 `book` / `midpoint` / `price` / `prices-history`
- `execution.ts`: `dry-run` 先落地；`live` 预留接口

## 5. 数据模型（按真实 API 调整后）

### 5.1 leaders

保持 PRD 设计即可。

### 5.2 leader_trades

建议字段：

- `id`
- `leader_id`
- `source_uid` (unique)
- `event_type`
- `transaction_hash`
- `timestamp`
- `condition_id`
- `asset_id`
- `side`
- `price`
- `size`
- `usdc_size`
- `title`
- `slug`
- `outcome`
- `raw_json`

说明：这里实际上存的是 leader 事件流里的可交易事件，虽然表名叫 `leader_trades`，但来源应是 `activity` 过滤后的 `TRADE`。

### 5.3 signals

建议用 `source_uid` 关联，不要再依赖不存在的 `source_trade_id`。

### 5.4 market_cache

建议新增一个缓存表，减少 runner 高频请求：

- `condition_id` (pk)
- `market_json`
- `fetched_at`

### 5.5 price_snapshots

建议新增，用于回测和审计：

- `asset_id`
- `ts`
- `mid`
- `best_bid`
- `best_ask`
- `raw_json`

## 6. 核心实现固定方案

### 6.1 `pmx sync`

实现方式：

1. 用 `activity?user=<wallet>&limit=<n>&offset=<n>` 分页拉取
2. 本地过滤 `type === "TRADE"`
3. 生成 `source_uid`
4. `INSERT OR IGNORE` 入库
5. 根据 `conditionId` 补拉 market metadata，写缓存

### 6.2 `pmx backtest`

固定成“近似可复制回测”：

1. 读取历史 `leader_trades`
2. 按 `latency/poll_interval` 模拟看到信号的时间
3. 用 `prices-history` 拉每个 `asset` 的历史价格序列
4. 用历史价格近似 entry/exit
5. 用当前或缓存的 market metadata 做时效/流动性过滤
6. 输出明确标注为 `estimated_backtest`

MVP 不做：

- 历史 orderbook 重建
- 精确 maker 模拟
- 精确结算对账

### 6.3 `pmx follow start --dry-run`

固定主循环：

1. 轮询 leader 最新 `activity`
2. 本地去重
3. 对新 `TRADE` 生成 signal
4. 拉 `midpoint` 做快速风控检查
5. 只有进入候选后再拉 `book`
6. 按深度估算 `p_now`
7. 通过则写一笔 simulated order

### 6.4 `pmx follow start --live`

MVP 阶段建议只保留命令壳，不默认实现真实下单。

原因：

- 当前没有可复用的本地签名配置
- 没有在本机验证过账户认证流程
- 风险比 dry-run 高一个数量级

因此 live 的固定路线应是：

1. 第一版把 `--live` 做成显式报错，提示“execution adapter not configured”
2. 第二版再接本地私钥签名与下单

这样能先把同步、信号、回测、dry-run 跑通，不把项目卡死在写链路上。

## 7. MVP 开发顺序

按这个顺序做，最稳：

1. 初始化 TypeScript CLI 骨架（建议 `commander` + `better-sqlite3` + `zod` + `yaml`）
2. 建 SQLite schema
3. 实现 `dataApi/gammaApi/clobApi`
4. 先做 `leader add/list`
5. 实现 `sync`
6. 实现 `backtest` 的近似版
7. 实现 `follow init/show-config/config set`
8. 实现 `follow start --dry-run`
9. 最后补 `logs/status/report`

## 8. 一句话定版

这个项目的 MVP 应固定为：**用 TypeScript 直接对接 `data-api + gamma-api + clob`，先完成 leader 同步、近似回测和 dry-run 跟单闭环，不把官方 CLI 或真实下单放在第一阶段的关键路径上。**
