下面是可直接丢给 **Claude Code** 的「开发任务书」。我按 **MVP→可用→可扩展** 的顺序写，包含：目标、范围、命令设计、配置 schema、SQLite 表、核心算法伪代码、验收标准与风险点。你把整段复制给 Claude Code 即可开工。

---

# Claude Code 开发任务书：Polymarket 跟单 CLI（PMX Copy）

## 0. 目标与定位

做一个本地 CLI 工具 **pmx**（无前端、无用户系统），让用户：

1. 选择要跟单的 Polymarket 地址（leader）
2. 拉取该地址历史交易/活动做回测（重点是“可复制性回测”）
3. 用户确认后配置跟单参数（比例或固定金额 + 过滤器 + 风控）
4. 启动跟单 Runner（默认 dry-run，显式开关 live 才真实下单）
5. 输出可审计日志与报告（JSON + Markdown）

### 核心原则

* 私钥/签名仅在用户本地（不托管）
* 默认 dry-run
* 跟单不是盲跟：必须通过“可复制条件”（滑点/深度/时效/风控）
* 先支持 mirror（逐笔信号），后续再加 portfolio（按净敞口对齐）

---

## 1) 技术栈与运行方式

### 推荐实现

* 语言：Node.js (TypeScript) **或** Rust（你选择你最熟的；Node 更快迭代）
* 本地持久化：SQLite（文件：`~/.pmx/pmx.db`）
* 配置：YAML（`~/.pmx/config.yml`）+ `pmx config set` 便捷写入
* 依赖官方 polymarket-cli：

  * 通过子进程调用 `polymarket` 命令并读取 `--output json`
  * 需要一个 adapter：`PolymarketCLIAdapter`

> 如果无法依赖用户已安装官方 CLI，则在 README 提供安装步骤；MVP 先假设已安装。

---

## 2) MVP 范围（必须实现）

### 功能清单（MVP 必做）

1. leader 管理（add/list/remove/inspect）
2. 数据拉取（leader trades/activity）写入 SQLite
3. backtest（“可复制性回测”）：输出频次、胜率、PnL、最大回撤、跳过率、平均滑点估计
4. follow dry-run runner（实时拉 leader 最新成交 → 生成信号 → 过滤/风控 → 模拟执行 → 记日志）
5. follow live runner（真实下单）：调用官方 CLI `clob create-order`/`market-order`；必须二次确认；必须有熔断

### 非 MVP（第二阶段）

* portfolio 复制（rebalance）
* Telegram 推送
* leader 排行榜/比较
* 多 leader 组合策略

---

## 3) CLI 命令设计（必须按这个实现）

### 3.1 leader 管理

* `pmx leader add <address> --name <alias> [--notes "..."]`
* `pmx leader list`
* `pmx leader remove <alias|address>`
* `pmx leader inspect <alias>`

  * 输出：市场偏好（tag 分布）、交易频次、平均持有时间（如可估）

### 3.2 数据同步

* `pmx sync <alias> --lookback 30d --limit 5000`

  * 拉取 leader trades/activity（通过官方 CLI 的 data 命令或等价方式）
  * 去重入库

### 3.3 回测（核心）

* `pmx backtest <alias> --lookback 30d --latency 10s --mode mirror --sizing fixed --fixed-usd 25`
* 可选参数（都要支持）：

  * `--poll-interval 10s`（回测中用作“你多频看到信号”的模拟）
  * `--signal-window 20s`（信号有效期）
  * `--min-usd 5 --max-usd 100`
  * `--tags-allow sports,crypto`
  * `--min-liquidity 5000`
  * `--max-spread 2%`
  * `--min-time-to-expiry 1h`
  * `--max-slippage 0.5%`
  * `--execution maker|taker|auto`（回测只需模拟 auto/taker，maker 可延后）
  * `--max-daily-loss 100`
  * `--max-drawdown 20%`
  * `--max-open-positions 15`
  * `--max-per-market 200`
* 输出：

  * 终端表格 summary
  * `backtest_<alias>_<timestamp>.json`
  * 可选 `backtest_<...>.md`

### 3.4 跟单配置

* `pmx follow init <alias> --profile conservative|balanced|aggressive`

  * 生成一个本地 profile：`~/.pmx/profiles/<alias>.yml`
* `pmx follow show-config <alias>`
* `pmx follow config set <alias> <key> <value>`

  * 例如：`pmx follow config set whale1 sizing.fixed_usd 20`

### 3.5 启动/停止跟单

* `pmx follow start <alias> [--dry-run]`
* `pmx follow start <alias> --live`

  * 必须二次确认：要求输入固定短语（例如 `I UNDERSTAND LIVE TRADING`）
* `pmx follow stop <alias>`
* `pmx follow status <alias>`
* `pmx follow logs <alias> --tail 200`

---

## 4) 配置文件 Schema（YAML）

路径：`~/.pmx/profiles/<alias>.yml`

```yaml
leader:
  alias: whale1
  address: "0x..."
mode: mirror  # mirror | portfolio (future)
poll_interval_sec: 10
signal_window_sec: 20

filters:
  tags_allow: ["sports", "crypto"]
  tags_deny: []
  min_liquidity_usd: 5000
  max_spread_bps: 200   # 2%
  min_time_to_expiry_sec: 3600

sizing:
  type: fixed   # fixed | ratio
  fixed_usd: 25
  ratio: 0.2
  min_usd: 5
  max_usd: 100

execution:
  mode: auto    # taker | maker | auto
  max_slippage_bps: 50  # 0.5%
  maker_timeout_sec: 15

risk:
  max_daily_loss_usd: 100
  max_drawdown_pct: 20
  max_open_positions: 15
  max_per_market_usd: 200
  cooldown_sec: 1800
  allow_live: false
```

---

## 5) SQLite 数据库表设计（必须实现）

文件：`~/.pmx/pmx.db`

### tables

1. `leaders`

* `id` (pk)
* `alias` (unique)
* `address` (unique)
* `notes`
* `created_at`

2. `leader_trades`

* `id` (pk)
* `leader_id` (fk)
* `trade_id` (unique)  # 交易唯一标识（来自 API/CLI）
* `timestamp`
* `market_id`
* `condition_id`
* `token_id`           # outcome token
* `side`               # buy/sell
* `price`
* `size`
* `amount_usd`         # 若无则 null
* `raw_json` (text)

3. `signals`

* `id` (pk)
* `leader_id`
* `source_trade_id` (unique)
* `timestamp`
* `market_id`
* `token_id`
* `side`
* `leader_price`
* `estimated_usd`
* `status`  # new | skipped | approved | executed | failed
* `skip_reason` (nullable)
* `raw_json`

4. `orders`

* `id` (pk)
* `signal_id` (fk)
* `order_id` (nullable)    # live 才有
* `mode` (taker/maker/auto)
* `requested_price`
* `requested_size`
* `filled_price` (nullable)
* `filled_size` (nullable)
* `status`  # placed | partial | filled | cancelled | failed
* `error` (nullable)
* `created_at`

5. `pnl_daily`

* `date` (pk)
* `realized_pnl_usd`
* `unrealized_pnl_usd`
* `drawdown_pct`
* `num_trades`
* `num_skipped`

6. `runner_state`

* `alias` (pk)
* `is_running`
* `last_seen_trade_ts`
* `last_sync_ts`
* `cooldown_until_ts`
* `updated_at`

---

## 6) Polymarket CLI Adapter（必须实现）

创建模块 `adapter/polymarket_cli.ts`（或 rust mod）：

* `run(cmd: string[], json=true): Promise<any>`
* 必须所有调用加 `--output json` 并解析
* 失败要捕获 stderr，写入 orders.error

需要支持的调用（MVP）：

* 拉 leader trades/activity（若官方 CLI 支持 data trades/activity，就用它；否则用你已有的 pmxt 数据源也行，但先优先官方 CLI）
* 拉 market metadata（tags、expiry 等）用于过滤
* 拉 orderbook/price/spread 用于滑点与可复制判断
* 下单（live）：`clob create-order` 或 `clob market-order`

---

## 7) 核心逻辑与伪代码（照这个实现）

### 7.1 信号生成（mirror）

输入：新增的 leader_trades（按 timestamp 排序）
输出：signals（去重）

规则：

* 一笔 trade → 一个 signal
* 估算下注金额：

  * 若 trade.amount_usd 有值：用它
  * 否则 estimated_usd = min(max(fixed_usd), sizing.max_usd)（MVP：直接用 fixed）
  * ratio 模式：estimated_usd = clamp(trade.amount_usd * ratio, min, max)；若 trade.amount_usd 缺失，则回退 fixed

### 7.2 过滤器（filters）

对每个 signal：

* 获取 market metadata（tags、expiry）与 clob 指标（spread、mid）
* 若 tag 不在 allow 或在 deny → skipped
* 若 liquidity < min_liquidity → skipped
* 若 spread_bps > max_spread → skipped
* 若 time_to_expiry < min_time_to_expiry → skipped

### 7.3 可复制性检查（copy feasibility）

对每个 signal（买入为例）：

* leader_price = pL
* 读取当前 orderbook，计算在 `estimated_usd` 下你实际可成交的平均价格 `pNow`（按深度加权）
* 若 `pNow > pL + slippage_budget` → skipped（理由：price_moved）
* slippage_budget = max_slippage_bps * pL

> MVP 可简化：用 midpoint/spread 近似，后续再用全 book 深度。

### 7.4 风控（risk gate）

维护运行期状态：

* 今日累计 realized/unrealized（先用简化：只计算“执行价 vs 当前 mid”做 mark-to-market）
* 若触发：

  * daily loss > max_daily_loss
  * drawdown > max_drawdown
  * open positions > max_open_positions
  * per market exposure > max_per_market
    → 进入 cooldown：`cooldown_until_ts = now + cooldown_sec`，并把后续信号全部 skipped(reason=cooldown)

### 7.5 执行（execution）

* dry-run：写 orders 记录为 simulated filled（用 pNow/或 mid）并更新 pnl 估算
* live：

  * 若 execution.mode == taker：用 market-order（按 amount）
  * 若 auto：优先尝试 post-only maker（可选 MVP 后做），否则 fallback taker
  * 下单后轮询 order 状态（最多 N 秒），失败则记录

### 7.6 Runner 主循环

```pseudo
load profile(alias)
while running:
  if now < cooldown_until: sleep(poll_interval); continue

  new_trades = fetch_leader_trades_since(last_seen_trade_ts)
  store new_trades
  signals = trades_to_signals(new_trades)
  for s in signals:
     apply_filters(s)
     if skipped: continue
     feasibility_check(s)
     if skipped: continue
     risk_gate(s)
     if skipped: continue
     execute(s)  # dry-run or live
  update runner_state(last_seen_trade_ts=max_ts)
  sleep(poll_interval)
```

---

## 8) 回测实现要求（MVP 版可接受简化）

回测要输出“可复制性指标”，不是只算 leader 的历史胜率。

### 回测流程（mirror）

* 读取历史 leader_trades（lookback）
* 按你设定的 latency/poll_interval/signal_window 模拟“你何时看到信号”
* 每个信号用当时的历史 price/book（若拿不到历史 book，MVP 用 price-history + spread 近似）
* 应用相同 filters + feasibility + risk gate
* 计算：

  * PnL：简化为“开仓→到期结算价”若能获取；拿不到结算则用“持有到 lookback 末的 mark-to-market”并标注为估算
  * MDD：基于每日权益曲线（用估算权益也可）
  * skip_rate：跳过比例与原因分布
  * freq：每日/每小时信号数

> 先实现“结构正确”，数值可先近似；后续再加更精确结算/持仓对齐。

---

## 9) 验收标准（必须满足）

1. 用户在本机能完成全流程：

   * add leader → sync → backtest → follow init → start dry-run → report/logs
2. backtest 输出包含：trade count、win rate、PnL、MDD、skip rate、avg slippage（可近似）
3. follow runner 在 dry-run 模式稳定运行 30 分钟不崩，能持续写入 signals/orders
4. live 模式必须二次确认、必须有 max_daily_loss 熔断与 cooldown
5. 所有命令支持 `--output json|table`（至少对 backtest/report 支持）
6. README：安装 + 安全提示（早期、谨慎资金）+ 示例命令

---

## 10) 风险点与工程注意事项

* 官方 CLI 的某些 data 命令是否完整可用：若某些数据拉不到，先做 adapter fallback（例如直接调用公开 API 端点；但优先官方 CLI）
* trade_id 去重必须稳（避免重复信号）
* 时间戳统一用 UTC
* 对错误要可诊断：stderr 写入 orders.error，signals.skip_reason 清晰枚举
* 任何涉及私钥：仅调用官方 CLI 的本地签名方式，不在 pmx 内部保存私钥

---

## 11) Repo 结构建议

```
pmx/
  src/
    cli/                # 命令解析
    adapter/            # polymarket-cli wrapper
    db/                 # sqlite schema/migrations
    leaders/
    sync/
    backtest/
    follow/
    risk/
    execution/
    report/
    utils/
  scripts/
  README.md
```

---

## 12) 交付物

1. 可执行命令 `pmx`（开发阶段可 `npm link` 或 `cargo install --path .`）
2. SQLite migration + 自动初始化
3. profile YAML 生成与更新
4. 示例回测报告 JSON/MD
5. README（包含从 0 到跑起来的教程）

---

你给 Claude Code 的补充说明（建议你附一句）：

* **MVP 先固定只实现 fixed-usd sizing + taker/auto 执行 + 近似回测**，跑通闭环后再精细化 book 深度与结算逻辑。
* 目标是“能用、可扩展、可审计”，不是一次做到完美。