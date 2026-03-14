# DUOLA Execution Contract

`duola follow start` 默认使用仓库内置的 Polymarket 官方 TypeScript SDK 直接下单。

如果你不想让 `duola` 直接下单，也可以通过环境变量 `DUOLA_EXECUTION_COMMAND` 指定外部命令，把真实下单交给你自己的执行器。

## 调用方式

`duola` 会把一段 JSON 通过 `stdin` 传给该命令。

输入结构：

```json
{
  "leaderAlias": "whale1",
  "sourceUid": "7f4d...",
  "conditionId": "0x...",
  "assetId": "1462414...",
  "side": "BUY",
  "requestedUsd": 25,
  "requestedPrice": 0.61,
  "requestedSize": 40.98,
  "maxSlippageBps": 50
}
```

## 返回要求

外部命令必须向 `stdout` 返回 JSON。

输出结构：

```json
{
  "orderId": "abc123",
  "status": "filled",
  "filledPrice": 0.61,
  "filledSize": 40.98
}
```

字段要求：

- `orderId`: 可为空，但建议返回真实订单 ID
- `status`: 例如 `placed`、`filled`、`partial`、`failed`
- `filledPrice`: 未成交时可为 `null`
- `filledSize`: 未成交时可为 `null`

## 错误处理

- 外部命令非零退出码：`duola` 记录为 `orders.status=failed`
- 外部命令返回非 JSON：`duola` 记录为 `orders.status=failed`
- 错误信息会写入 `orders.error`

## 推荐实现

外部命令应当：

1. 从 `stdin` 读取 JSON
2. 用你自己的本地私钥、agent、官方 CLI 或签名 SDK 下单
3. 把真实订单结果按上面的 JSON 格式输出

这样 `duola` 只负责跟单策略，不接触用户密钥。
