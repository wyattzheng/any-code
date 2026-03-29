# Antigravity Language Server RPC Protocol

## 服务器发现

Go 二进制路径：
```
/Applications/Antigravity.app/Contents/Resources/app/extensions/antigravity/bin/language_server_macos_arm
```

启动参数中包含 `--csrf_token <UUID>` 和 `--random_port`（或 `--server_port <N>`）。
通过 `ps aux | grep language_server_macos` 发现进程，提取 CSRF token；通过 `lsof -i -P -n -a -p <PID>` 发现 HTTPS 端口。

## 协议

- **传输**：HTTPS（HTTP/2），自签名证书（`CN=localhost; O=ENABLES HTTP2`）
- **框架**：ConnectRPC（Go `connectrpc.com/connect`）
- **Content-Type**：`application/json`（unary RPC 支持 JSON）
- **认证**：Header `x-codeium-csrf-token: <token>`
- **服务路径**：`/exa.language_server_pb.LanguageServerService/<MethodName>`

## 核心 RPC

### StartCascade

创建新的对话（cascade）。

```
POST /exa.language_server_pb.LanguageServerService/StartCascade
Body: {}
Response: {"cascadeId": "<UUID>"}
```

### SendUserCascadeMessage

发送用户消息。**必须**包含 `cascadeConfig`，否则 Go handler 在 `rpcs_cascade.go:515` nil pointer panic → RST_STREAM INTERNAL_ERROR。

```json
{
  "cascadeId": "<UUID>",
  "items": [{"text": "your message"}],
  "cascadeConfig": {
    "plannerConfig": {
      "planModel": 1026,
      "maxOutputTokens": 8192,
      "promptSectionCustomizationConfig": {
        "appendPromptSections": [
          {"title": "custom_rules", "content": "自定义系统提示词"}
        ]
      }
    }
  }
}
```

**Response**: `{}` (HTTP 200) — 消息被接受，AI 异步处理。

### GetAllCascadeTrajectories

获取所有对话列表及状态。

```
POST /exa.language_server_pb.LanguageServerService/GetAllCascadeTrajectories
Body: {}
```

Response 关键字段：
```json
{
  "trajectorySummaries": {
    "<cascadeId>": {
      "summary": "...",
      "stepCount": 5,
      "status": "CASCADE_RUN_STATUS_IDLE",
      "lastModifiedTime": "2026-03-29T...",
      "trajectoryId": "<UUID>"
    }
  }
}
```

`status` 值：`CASCADE_RUN_STATUS_IDLE`（完成）、`CASCADE_RUN_STATUS_RUNNING`（处理中）。

### GetCascadeTrajectorySteps

获取对话步骤内容。

```json
{"cascadeId": "<UUID>"}
```

Response `steps` 数组，每个 step 有 `type` 和对应的内容字段：

| type | 内容字段 | 说明 |
|------|----------|------|
| `CORTEX_STEP_TYPE_USER_INPUT` | `userInput.items[].text` | 用户输入 |
| `CORTEX_STEP_TYPE_PLANNER_RESPONSE` | `plannerResponse.response` | **AI 回复文本** |
| `CORTEX_STEP_TYPE_CODE_ACTION` | `metadata.toolCall` | 工具调用（文件操作等） |
| `CORTEX_STEP_TYPE_TASK_BOUNDARY` | `metadata.toolCall` | 任务边界 |
| `CORTEX_STEP_TYPE_EPHEMERAL_MESSAGE` | `ephemeralMessage.content` | 系统注入消息 |
| `CORTEX_STEP_TYPE_NOTIFY_USER` | `metadata.toolCall` | 通知用户 |

### 其他可用 RPC

- `GetCascadeTrajectory` — 获取单个 trajectory
- `SendAllQueuedMessages` — 刷新队列
- `SetWorkingDirectories` — 设置工作区目录
- `GetWorkingDirectories` — 获取工作区目录

## 模型 ID

`planModel` 是 proto enum `exa.codeium_common_pb.Model`，数值对应 `MODEL_PLACEHOLDER_M<N>` 其中 `N = planModel - 1000`。

| planModel | enum 名 | 状态 |
|-----------|---------|------|
| 1008 | MODEL_PLACEHOLDER_M8 (Gemini 3 Pro) | ❌ 已下线 |
| 1009-1012 | M9-M12 | ❌ not found |
| 1026 | MODEL_PLACEHOLDER_M26 | ✅ 可用 |

## 完整调用流程

```
StartCascade → cascadeId
    ↓
SendUserCascadeMessage(cascadeId, items, cascadeConfig)
    ↓
Poll: GetAllCascadeTrajectories → status == IDLE?
    ↓
GetCascadeTrajectorySteps(cascadeId) → find PLANNER_RESPONSE → response text
```
