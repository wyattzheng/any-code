# Antigravity OAuth & USS Protocol — 逆向工程文档

> 本文档记录了脱离 Antigravity Electron 客户端、独立启动 Go 语言服务器 binary 并完成 OAuth 认证的完整协议细节，包含踩坑历史。

## 1. 架构概览

```
┌───────────────────────────────────────────┐
│   OAuth Provider (Google)                  │
│   accounts.google.com                      │
└───────────────┬───────────────────────────┘
                │ authorization_code → token
┌───────────────▼───────────────────────────┐
│   Self-hosted CLI / Mock Extension Server  │
│   (HTTP/1.1 ConnectRPC)                    │
│                                            │
│   • 接收 Go binary 的 USS 订阅请求          │
│   • 通过 initial_state 下发 OAuth token     │
│   • 维护 USS topic 长连接                   │
└───────────────┬───────────────────────────┘
                │ SubscribeToUnifiedStateSyncTopic
┌───────────────▼───────────────────────────┐
│   Go Binary (language_server_macos_arm)    │
│                                            │
│   • 读取 USS uss-oauth topic 获取 token    │
│   • 使用 token 调用 CloudCode API          │
│   • daily-cloudcode-pa.googleapis.com      │
└───────────────────────────────────────────┘
```

## 2. OAuth 配置

### Client 凭据

```js
CLIENT_ID     = '1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com'
CLIENT_SECRET = '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'
```

### Scopes（⚠️ 踩坑重点）

```
openid email profile
https://www.googleapis.com/auth/cloud-platform          ← 必须！缺少则 403
https://www.googleapis.com/auth/experimentsandconfigs
```

> **踩坑 #1**: 最初只用了 `openid email profile experimentsandconfigs`，Go binary 能认证但调 CloudCode API 时返回 `ACCESS_TOKEN_SCOPE_INSUFFICIENT`。必须加 `cloud-platform`。

### Redirect URI

```
http://localhost:19877/oauth-callback
```

Google OAuth console 中需要添加此 redirect URI 到 authorized redirect URIs。

---

## 3. USS（Unified State Sync）协议

USS 是 Antigravity 用来在 Extension Server 和 Go Binary 之间同步状态的协议。

### 3.1 订阅流程

Go binary 启动后通过 ConnectRPC（HTTP/1.1）调用：

```
POST /exa.extension_server_pb.ExtensionServerService/SubscribeToUnifiedStateSyncTopic
Content-Type: application/connect+proto
```

请求体是 ConnectRPC envelope（5 字节头 + protobuf body）：
```protobuf
message SubscribeToUnifiedStateSyncTopicRequest {
  string topic = 1;  // e.g. "uss-oauth"
}
```

### 3.2 响应格式

Server 返回 streaming response（chunked transfer），每个 chunk 是一个 ConnectRPC envelope：

```protobuf
message UnifiedStateSyncUpdate {
  oneof update_type {
    Topic initial_state = 1;   // 首次下发完整状态
    Topic applied_update = 2;  // 后续增量更新
  }
}

message Topic {
  map<string, Row> data = 1;   // key → Row
}

message Row {
  string value = 1;   // base64 编码的 protobuf binary
  int64 e_tag = 2;    // 版本号
}
```

### 3.3 ⚠️ USS Key（踩坑重点中的重点）

**正确的 map key 是 `oauthTokenInfoSentinelKey`，不是 `oauthTokenInfo`！**

```js
// ✅ 正确
data: { oauthTokenInfoSentinelKey: Row { value: base64(OAuthTokenInfo) } }

// ❌ 错误 — Go binary 报 "key not found"
data: { oauthTokenInfo: Row { value: base64(OAuthTokenInfo) } }
```

> **踩坑 #2**: Go binary 字符串表中同时存在 `oauthTokenInfo` 和 `oauthTokenInfoSentinelKey`，最初误以为前者是数据 key、后者是哨兵 key。实际上只有 `oauthTokenInfoSentinelKey` 既是 USS map key 也承载数据。这个 bug 消耗了最多时间。最终通过直接向真实 Antigravity extension server 发送 `SubscribeToUnifiedStateSyncTopic` 请求抓取真实流量才确认。

### 3.4 Row.value 编码

Row.value 是 **base64 编码的 OAuthTokenInfo protobuf bytes**，存储在 proto `string` 字段中。

```
OAuthTokenInfo proto binary → base64 string → Row.value
```

> **踩坑 #3**: Row.value 尝试了以下格式，均失败：
>
> | 格式 | 错误 |
> |------|------|
> | JSON string | `key not found`（key 也错了所以是双重错误）|
> | Raw proto bytes | `string field contains invalid UTF-8` |
> | base64 + 错误的 key | `key not found` |
> | base64 + 正确 key ✅ | **成功** |
>
> Go protobuf 库对 `string` 类型字段强制 UTF-8 校验，所以不能放 raw bytes。

### 3.5 所有已知 USS Topics

Go binary 会订阅以下 topics：

| Topic | 用途 |
|-------|------|
| `uss-oauth` | OAuth token（必须包含数据）|
| `uss-enterprisePreferences` | 企业配置 |
| `uss-browserPreferences` | 浏览器偏好设置 |
| `uss-agentPreferences` | Agent 偏好设置 |
| `uss-overrideStore` | 覆盖配置 |
| `uss-modelCredits` | 模型额度信息 |

除 `uss-oauth` 外，其他 topic 返回空 initial_state 即可。

---

## 4. OAuthTokenInfo Proto

```protobuf
message OAuthTokenInfo {
  string access_token = 1;
  string token_type = 2;        // "Bearer"
  string refresh_token = 3;
  google.protobuf.Timestamp expiry = 4;   // ⚠️ 不是 string！
  bool is_gcp_tos = 6;
}
```

> **踩坑 #4**: `expiry` 字段是 `google.protobuf.Timestamp` 消息类型（包含 `seconds: int64` 和 `nanos: int32`），不是 ISO 8601 字符串。最初用 `protoEncodeString(4, "2026-12-31T00:00:00Z")` 编码，导致 Go binary 报 `proto: cannot parse invalid wire-format data`。

使用 `@bufbuild/protobuf` 库正确编码：

```js
import { create, toBinary } from '@bufbuild/protobuf';

const tokenObj = create(OAuthTokenInfoSchema, {
  accessToken: 'ya29.xxx',
  tokenType: 'Bearer',
  refreshToken: '1//xxx',
  expiry: { seconds: BigInt(Math.floor(Date.now() / 1000) + 3600), nanos: 0 },
  isGcpTos: false,
});
const tokenBin = toBinary(OAuthTokenInfoSchema, tokenObj);
const tokenBase64 = Buffer.from(tokenBin).toString('base64');
```

---

## 5. Mock Extension Server 要点

### CSRF Header

```
x-codeium-csrf-token: <token>
```

> **踩坑 #5**: 最初用 `x-csrf-token`，extension server 返回 403。正确的 header name 是 `x-codeium-csrf-token`。

### ConnectRPC Envelope 格式

```
[1 byte flags] [4 bytes big-endian length] [protobuf body]
```

- flags = 0 表示正常消息
- flags = 2 表示 end-of-stream (trailer)

### 必须处理的 RPC

| RPC | Content-Type | 必须 |
|-----|-------------|------|
| `LanguageServerStarted` | application/proto | ✅ 返回空 200 |
| `SubscribeToUnifiedStateSyncTopic` | application/connect+proto | ✅ streaming 响应 |
| `GetChromeDevtoolsMcpUrl` | application/proto | 返回空或 MCP URL |
| `Heartbeat` | application/proto | 返回空 200 |
| `CheckTerminalShellSupport` | application/proto | 返回空 proto |
| `PushUnifiedStateSyncUpdate` | application/proto | 返回空 proto |

### 注意事项

- 部分 RPC 的 Content-Type 是 `application/proto`（不是 `application/connect+proto`），响应也必须用 `application/proto`，否则 Go binary 报 `invalid content-type: "application/json"; expecting "application/proto"`。
- USS streaming 响应需要 `Transfer-Encoding: chunked`，并尽早 flush headers。

---

## 6. Go Binary 启动参数

```bash
./language_server_macos_arm \
  --csrf_token <for_ls_auth>                    \
  --extension_server_port <mock_server_port>     \
  --extension_server_csrf_token <for_ext_auth>   \
  --workspace_id <workspace_name>                \
  --parent_pipe_path <named_pipe_path>           \
  --cloud_code_endpoint https://daily-cloudcode-pa.googleapis.com
```

- `--csrf_token`: 语言服务器自身的 CSRF token（用于客户端调 LS RPC 时校验）
- `--extension_server_csrf_token`: 发到 extension server 时带的 CSRF token
- `--parent_pipe_path`: 必须是一个可连接的 Unix domain socket / named pipe
- `--cloud_code_endpoint`: 可选，覆盖 API endpoint

---

## 7. Proto Schema 加载

OAuthTokenInfo 等 proto schema 嵌在 `extension.js` 的 `fileDesc()` 调用中，以 base64 编码的 FileDescriptorProto 形式存储：

```js
const regex = /(\w+)=\(0,\w+\.fileDesc\)\("([A-Za-z0-9+/=]+)"(?:,\[([^\]]*)\])?\)/g;
```

共提取了 24 个 proto file descriptors，通过依赖解析加载完整的 proto schema 后，可用 `@bufbuild/protobuf` 的 `messageDesc()` 获取具体 message schema。

关键 schema 索引：
- `messageDesc(ussFile, 0)` → Topic
- `messageDesc(ussFile, 1)` → Row
- `messageDesc(extFile, 101)` → UnifiedStateSyncUpdate
- `messageDesc(lsFile, 279)` → OAuthTokenInfo

---

## 8. 踩坑历史时间线

| # | 尝试 | 错误信息 | 原因 |
|---|------|---------|------|
| 1 | JSON 格式 Row.value + key=oauthTokenInfo | `key not found` | key 错 + value 格式错 |
| 2 | 手工 proto 编码 + key=oauthTokenInfo | `key not found` | key 错（值可能也有问题）|
| 3 | 添加 SentinelKey 作为独立 entry | `key not found` | key 仍然错 |
| 4 | base64 proto + key=oauthTokenInfo（expiry 用 string） | `cannot parse invalid wire-format data` | expiry 是 Timestamp msg |
| 5 | raw proto bytes 作为 Row.value | `string field contains invalid UTF-8` | Row.value 是 proto string 类型 |
| 6 | @bufbuild/protobuf 库编码 + key=oauthTokenInfo | `key not found` | key 错！编码终于对了 |
| 7 | 添加 TCP_NODELAY + flushHeaders | `key not found` | 不是 timing 问题 |
| 8 | **抓取真实流量** → 发现 key 是 `oauthTokenInfoSentinelKey` | — | 突破口！|
| 9 | 正确 key + base64 proto + Timestamp（scope 不足）| `ACCESS_TOKEN_SCOPE_INSUFFICIENT` | 缺 cloud-platform scope |
| 10 | 添加 cloud-platform scope | **✅ 成功** | 🎉 |

---

## 9. 验证结果

```
I0329 19:08:50 planner_generator.go:285] Requesting planner with 6 chat messages
I0329 19:08:52 URL: https://daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse
🎉 Self-hosted works!
```

Binary 成功：
- 通过 USS 读取 OAuth token ✅
- 使用 token 调用 CloudCode API ✅
- 执行 AI 推理请求 ✅
