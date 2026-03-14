# duola 实盘测试指南（小白版）

这份文档的目标很简单：

让你用最小金额，在自己的电脑上，把 `duola` 跑通一次真实的 Polymarket 跟单测试。

这不是“开发者文档”，而是按实际操作顺序写的。

---

## 1. 你要先知道的事

`duola` 是一个本地命令行工具。

它会做这些事：

1. 跟踪一个聪明钱地址（leader）
2. 拉取 leader 的公开交易
3. 根据你的配置，决定是否跟单
4. 如果满足条件，就用你的钱包在 Polymarket 下真实订单

你只需要提供两样东西：

1. 聪明钱地址
2. 你自己的钱包私钥

## 2. 实盘前的风险提醒

先看这个，不要跳过。

1. 这是实盘，不是模拟盘。
2. 一旦命令成功启动，后续发现符合条件的交易，就可能真实下单。
3. 第一次测试一定要用小额资金。
4. 先准备一个专门测试的钱包，不要用你的大额主钱包。
5. 确认你的钱包里有足够的资金和链上操作所需余额。

建议：

1. 第一次只放你能接受损失的小额资金。
2. 第一次测试先跟一个交易频率不高的地址。
3. 第一次启动后，盯着日志看，不要直接放后台很久不管。

---

## 3. 你需要准备什么

开始前，你需要准备：

1. 一台你自己的电脑
2. 已安装 Node.js（建议 Node 20 或更高）
3. 一个可用的 Polymarket 跟单钱包私钥
4. 一个你想跟踪的聪明钱地址
5. 可正常访问 Polymarket 的网络环境

如果你在中国大陆网络环境，通常还需要代理。

如果你已经有代理，例如本地 `http://127.0.0.1:7897`，后面会用到。

---

## 4. 第一次安装和构建

在项目目录里执行：

```bash
npm install
npm run build
```

如果没有报错，说明基础依赖装好了。

---

## 5. 先做环境自检

如果你还没有配置任何 leader，也可以先跑：

```bash
node dist/index.js doctor
```

如果你有代理，要带上代理环境变量，例如：

```bash
POLYMARKET_PROXY_URL="http://127.0.0.1:7897" node dist/index.js doctor
```

### 你要看什么

输出里重点看这几项：

1. `dataApi`
2. `gammaApi`
3. `clobApi`

理想情况：

- 这三项都 `ok: true`

如果不是：

1. `Could not resolve host`
   - 说明 DNS 或网络不通
   - 一般是你没开代理，或者代理没生效

2. `Connection timed out`
   - 说明能发请求，但目标访问不稳定
   - 先检查代理

3. `proxy` 是 `null`
   - 如果你本来就需要代理，这通常说明你忘了设置 `POLYMARKET_PROXY_URL`

### 建议

只有当 `doctor` 里的接口检查通过后，再进入实盘测试。

---

## 6. 找一个要跟的聪明钱地址

你需要一个 Polymarket 上公开活跃的钱包地址。

要求：

1. 是标准 `0x...` 地址
2. 最近有真实交易
3. 最好交易频率不要太高，方便你第一次观察

你后面会把它当成 `leader address`。

举例：

```text
0x1234...abcd
```

---

## 7. 准备你自己的测试钱包

你需要一个你自己控制的钱包私钥。

要求：

1. 这是你自己的钱包
2. 钱包里只放小额测试资金
3. 不要用你长期存大额资产的钱包

### 非常重要

不要把私钥直接写进命令行参数里。

因为：

1. shell 历史可能记录下来
2. 截图或录屏可能泄露
3. 复制粘贴容易出错

`duola` 已经支持从 `stdin` 读取私钥，所以你应该用这个方式。

---

## 8. 第一次接入（onboard）

这一步会自动完成：

1. 添加 leader
2. 保存你的私钥到本地
3. 初次同步 leader 历史
4. 自动生成配置
5. 自动开启实盘权限

命令格式：

```bash
printf '%s' '你的私钥' | node dist/index.js autopilot onboard 你的聪明钱地址 --name 你给他的名字 --private-key-stdin
```

例如：

```bash
printf '%s' '0xYOUR_PRIVATE_KEY' | node dist/index.js autopilot onboard 0xLEADER_ADDRESS --name whale1 --private-key-stdin
```

如果你需要代理：

```bash
printf '%s' '0xYOUR_PRIVATE_KEY' | POLYMARKET_PROXY_URL="http://127.0.0.1:7897" node dist/index.js autopilot onboard 0xLEADER_ADDRESS --name whale1 --private-key-stdin
```

### 成功后会发生什么

1. 会创建本地数据目录 `~/.duola/`
2. 私钥会保存到：

```text
~/.duola/secrets/whale1.json
```

3. 跟单配置会保存到：

```text
~/.duola/profiles/whale1.yml
```

4. 本地数据库会写到：

```text
~/.duola/duola.db
```

### 如果你只想先做本地测试，不连网

你也可以先这样：

```bash
printf '%s' '0xYOUR_PRIVATE_KEY' | node dist/index.js autopilot onboard 0xLEADER_ADDRESS --name whale1 --private-key-stdin --sync-limit 0
```

这会跳过首轮联网同步，只测试本地初始化。

---

## 9. 检查是否 onboard 成功

执行：

```bash
node dist/index.js autopilot status whale1
```

如果你需要代理：

```bash
POLYMARKET_PROXY_URL="http://127.0.0.1:7897" node dist/index.js autopilot status whale1
```

你重点看：

1. `hasStoredPrivateKey`
   - 应该是 `true`

2. `follow.alias`
   - 应该是你刚才的名字，比如 `whale1`

3. `background.running`
   - 这时候通常还是 `false`
   - 因为你还没开始运行

---

## 10. 先看一下配置

执行：

```bash
node dist/index.js follow show-config whale1
```

你会看到一份默认配置。

小白第一次最需要关注的只有这几个字段：

1. `sizing.fixed_usd`
   - 每次最多按这个金额跟
   - 第一次建议改小

2. `risk.max_daily_loss_usd`
   - 单日最大亏损上限
   - 达到后应该停止继续下单

3. `risk.allow_live`
   - 必须是 `true`，否则不会启动实盘

### 建议你先把单笔金额调小

例如改成 5 美元：

```bash
node dist/index.js follow config set whale1 sizing.fixed_usd 5
```

也可以把日亏损上限先调小，比如 20：

```bash
node dist/index.js follow config set whale1 risk.max_daily_loss_usd 20
```

---

## 11. 启动前，再跑一次 doctor

现在你已经有 leader 和私钥了，再跑一次：

```bash
node dist/index.js doctor whale1
```

如果你需要代理：

```bash
POLYMARKET_PROXY_URL="http://127.0.0.1:7897" node dist/index.js doctor whale1
```

### 启动前你希望看到

1. `leaderExists: true`
2. `storedPrivateKey: true` 或 `envPrivateKey: true`
3. `dataApi.ok: true`
4. `gammaApi.ok: true`
5. `clobApi.ok: true`

如果这些不满足，不要直接启动实盘。

---

## 12. 第一次实盘启动（推荐前台短测）

第一次测试，不建议直接后台长期跑。

建议你先做一次“短时间前台测试”，只跑 1 个轮询周期。

命令：

```bash
node dist/index.js autopilot start whale1 --confirm-live "I UNDERSTAND LIVE TRADING" --max-cycles 1
```

如果你需要代理：

```bash
POLYMARKET_PROXY_URL="http://127.0.0.1:7897" node dist/index.js autopilot start whale1 --confirm-live "I UNDERSTAND LIVE TRADING" --max-cycles 1
```

### 为什么先这样做

因为：

1. 它会真的跑实盘流程
2. 但只跑 1 次轮询，不会一直挂着
3. 你可以先确认流程能走通

### 你可能看到的结果

1. 没有新交易
   - 很正常
   - 说明本次没有可处理信号

2. 有交易但被跳过
   - 也正常
   - 可能因为流动性、快到期、价格变动等原因

3. 成功创建订单
   - 说明实盘链路打通了

4. 失败
   - 一般会在日志里看到原因

---

## 13. 看日志（这是最重要的观察点）

执行：

```bash
node dist/index.js follow logs whale1 --tail 20
```

你会看到：

1. `signals`
2. `orders`

### 怎么看 signals

每一条 signal 表示：

leader 出现了一笔可被跟踪的交易事件。

常见状态：

1. `executed`
   - 说明已经进入真实下单流程

2. `skipped`
   - 说明被过滤掉了

3. `failed`
   - 说明尝试执行了，但下单失败

### 怎么看 orders

每一条 order 表示：

`duola` 对某个 signal 发起了一次真实下单。

常见状态：

1. `placed`
   - 已提交

2. `filled`
   - 已成交

3. `partial`
   - 部分成交

4. `failed`
   - 下单失败

如果是 `failed`，重点看：

1. `error`
2. `requested_price`
3. `requested_size`

---

## 14. 确认是否真的下单了

不要只看 CLI 输出。

你还应该去检查：

1. Polymarket 账户里是否真的有订单
2. 钱包余额是否发生变化
3. 对应市场里是否有你的仓位变化

只有这三点也对上了，才算真正实盘成功。

---

## 15. 确认没问题后，再用后台运行

如果前台短测没问题，再切后台：

```bash
node dist/index.js autopilot start whale1 --confirm-live "I UNDERSTAND LIVE TRADING" --detach
```

如果你需要代理：

```bash
POLYMARKET_PROXY_URL="http://127.0.0.1:7897" node dist/index.js autopilot start whale1 --confirm-live "I UNDERSTAND LIVE TRADING" --detach
```

### 后台运行后会发生什么

1. 跟单会在后台进程里继续跑
2. `duola` 会写一个 pid 文件
3. 日志会写到：

```text
~/.duola/runtime/whale1.log
```

---

## 16. 查看后台状态

执行：

```bash
node dist/index.js autopilot status whale1
```

你重点看：

1. `background.running`
   - `true` 说明后台进程还活着

2. `background.pid`
   - 当前后台进程号

3. `background.logPath`
   - 后台日志文件位置

---

## 17. 停止运行

如果你想停掉跟单：

```bash
node dist/index.js autopilot stop whale1
```

这会尝试：

1. 把跟单状态设为停止
2. 停掉后台进程

停掉后，再执行一次：

```bash
node dist/index.js autopilot status whale1
```

确认：

- `background.running` 是 `false`

---

## 18. 如果你想删除本地保存的私钥

执行：

```bash
node dist/index.js autopilot reset-secret whale1
```

这会删除本地托管的私钥文件。

删除后：

1. 再启动实盘会失败
2. 除非你重新 `onboard`
3. 或者临时使用 `DUOLA_PRIVATE_KEY`

---

## 19. 最常见错误和处理办法

### 错误 1：`Could not resolve host`

原因：

- 你的网络访问不到 Polymarket

处理：

1. 检查网络
2. 如果需要代理，设置：

```bash
export POLYMARKET_PROXY_URL="http://127.0.0.1:7897"
```

3. 然后再跑 `doctor`

### 错误 2：`Set DUOLA_PRIVATE_KEY for built-in execution or DUOLA_EXECUTION_COMMAND for external execution`

原因：

- 系统找不到可用的执行凭据

处理：

1. 先确认你是否成功执行过 `autopilot onboard`
2. 再执行 `autopilot status <alias>`，看 `hasStoredPrivateKey`
3. 如果是 `false`，重新 onboard

### 错误 3：`Invalid confirmation phrase`

原因：

- 你输入的确认短语不对

处理：

必须完全一致：

```bash
--confirm-live "I UNDERSTAND LIVE TRADING"
```

### 错误 4：订单失败

原因可能是：

1. 私钥无效
2. 钱包没有足够资金
3. 账户签名类型配置不对
4. 市场价格变化太快
5. Polymarket API 临时异常

处理：

1. 先看 `follow logs`
2. 看 `orders.error`
3. 用更小的金额重试

---

## 20. 小白首次实盘的推荐顺序

按这个顺序最稳：

1. `npm install`
2. `npm run build`
3. `doctor`
4. `autopilot onboard`
5. `autopilot status`
6. `follow show-config`
7. 把 `sizing.fixed_usd` 改成很小
8. 再跑一次 `doctor`
9. `autopilot start --max-cycles 1`
10. `follow logs`
11. 去 Polymarket 页面确认是否真的有订单
12. 没问题后再 `autopilot start --detach`

---

## 21. 今晚发布前，你至少要做一次这个最小验收

如果你要今晚发布，至少自己先完整做一遍：

1. 用测试钱包
2. 用极小金额（例如 5 美元）
3. 跑通一次 `autopilot onboard`
4. 跑通一次 `doctor`
5. 跑通一次 `autopilot start --max-cycles 1`
6. 确认 `follow logs` 里有真实执行结果
7. 去 Polymarket 页面确认订单真的存在
8. 再决定是否对外发布

如果第 7 步你没有亲眼确认到真实订单，就不要把它当成“已经完成实盘验证”。

---

## 22. 一条最推荐的最小实盘命令流程

如果你已经准备好，照着下面一条条执行：

```bash
npm install
npm run build
POLYMARKET_PROXY_URL="http://127.0.0.1:7897" node dist/index.js doctor
printf '%s' '0xYOUR_PRIVATE_KEY' | POLYMARKET_PROXY_URL="http://127.0.0.1:7897" node dist/index.js autopilot onboard 0xLEADER_ADDRESS --name whale1 --private-key-stdin
node dist/index.js follow config set whale1 sizing.fixed_usd 5
POLYMARKET_PROXY_URL="http://127.0.0.1:7897" node dist/index.js doctor whale1
POLYMARKET_PROXY_URL="http://127.0.0.1:7897" node dist/index.js autopilot start whale1 --confirm-live "I UNDERSTAND LIVE TRADING" --max-cycles 1
node dist/index.js follow logs whale1 --tail 20
```

如果这一套能跑通，而且你在 Polymarket 页面上也看到真实订单，那么就算通过了第一轮实盘测试。
