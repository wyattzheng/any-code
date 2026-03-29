# 工具控制

## 18 个内置工具

| # | 工具名 | CascadeToolConfig 字段 | Config 类型 |
|---|--------|----------------------|------------|
| 1 | `run_command` | `runCommand` | `RunCommandToolConfig` |
| 2 | `command_status` | `commandStatus` | 有 Config |
| 3 | `send_command_input` | (随 runCommand) | — |
| 4 | `view_file` | `viewFile` | `ViewFileToolConfig` |
| 5 | `write_to_file` | (code 子系统) | 空 struct |
| 6 | `replace_file_content` | (code 子系统) | 空 struct |
| 7 | `multi_replace_file_content` | (code 子系统) | 空 struct |
| 8 | `grep_search` | `grep` | `GrepToolConfig` |
| 9 | `find_by_name` | `find` | `FindToolConfig` |
| 10 | `list_dir` | `listDir` | `ListDirToolConfig` |
| 11 | `search_web` | `searchWeb` | 有 Config |
| 12 | `read_url_content` | (随 searchWeb) | — |
| 13 | `view_content_chunk` | (随 searchWeb) | — |
| 14 | `generate_image` | `generateImage` | 有 Config |
| 15 | `browser_subagent` | `browserSubagent` | `BrowserSubagentConfig` |
| 16 | `read_terminal` | — | 空 struct |
| 17 | `list_resources` | (mcp) | — |
| 18 | `read_resource` | (mcp) | — |

## 禁用工具

通过 `cascadeConfig.plannerConfig.toolConfig` 控制。

### `forceDisable: true`

仅部分工具 Config 有此字段：

```json
"toolConfig": {
  "runCommand": { "forceDisable": true },
  "searchWeb": { "forceDisable": true },
  "generateImage": { "forceDisable": true },
  "browserSubagent": { "forceDisable": true }
}
```

`runCommand.forceDisable` 同时移除 `command_status`、`send_command_input`。
`searchWeb.forceDisable` 同时移除 `read_url_content`、`view_content_chunk`。

### `disableSimpleResearchTools: true`

批量禁用搜索类工具：

```json
"toolConfig": { "disableSimpleResearchTools": true }
```

移除：`grep_search`, `find_by_name`, `list_dir`。

### 不可禁用的工具（5个）

以下工具的 ToolConfig 是空 proto message（无 `forceDisable` 等字段），Go binary 无条件注册：

- `view_file` — ViewFileToolConfig 有配置项但无禁用开关
- `write_to_file` — 空 struct
- `replace_file_content` — 空 struct
- `multi_replace_file_content` — 空 struct
- `read_terminal` — 空 struct

> 已穷尽测试以下方法均无效：`executorConfig.researchOnly`、`toolConfig.disableToolCalls`、`conversational.agenticMode: false`、`customAgentConfigAbsoluteUri`、`customizationConfig.useOnlyOverrideTools`。

### Maximum disable 示例

```json
"plannerConfig": {
  "planModel": 1026,
  "toolConfig": {
    "disableSimpleResearchTools": true,
    "runCommand": { "forceDisable": true },
    "commandStatus": { "forceDisable": true },
    "searchWeb": { "forceDisable": true },
    "generateImage": { "forceDisable": true },
    "browserSubagent": { "forceDisable": true },
    "antigravityBrowser": { "forceDisable": true },
    "notifyUser": { "forceDisable": true },
    "taskBoundary": { "forceDisable": true },
    "memory": { "forceDisable": true },
    "finish": { "forceDisable": true },
    "suggestedResponse": { "forceDisable": true },
    "intent": { "forceDisable": true },
    "viewCodeItem": { "forceDisable": true },
    "workspaceApi": { "forceDisable": true },
    "internalSearch": { "forceDisable": true },
    "knowledgeBaseSearch": { "forceDisable": true },
    "readKnowledgeBaseItem": { "forceDisable": true },
    "trajectorySearch": { "forceDisable": true },
    "invokeSubagent": { "forceDisable": true },
    "notebookEdit": { "forceDisable": true },
    "mquery": { "forceDisable": true },
    "codeSearch": { "forceDisable": true }
  }
}
```

→ 剩余 5 个不可禁用工具 + 你的 MCP 工具

## 自定义工具（MCP）

### 通过 RPC 注入（无需配置文件）

```json
"plannerConfig": {
  "planModel": 1026,
  "customizationConfig": {
    "mcpServers": [{
      "serverName": "my-tools",
      "command": "node",
      "args": ["my-mcp-server.js"]
    }]
  }
}
```

Go binary 在处理请求时自动 spawn MCP server 进程、完成握手、注册工具。

### MCP 协议要点

Go binary 使用的 MCP 协议：

| 项目 | 值 |
|------|---|
| 消息格式 | **换行分隔 JSON**（不是 Content-Length 帧） |
| protocolVersion | `2025-06-18` |
| clientInfo.name | `antigravity-client` |
| capabilities | `elicitation`, `roots.listChanged` |

MCP server 必须：
- 从 stdin 按行读取 JSON
- 响应写到 stdout 后加 `\n`
- 实现 `initialize`、`tools/list`、`tools/call`

### 工具命名

MCP 工具在 AI 端的名字：`mcp_<serverName>_<toolName>`

例：serverName=`test-weather`, toolName=`get_weather` → `mcp_test-weather_get_weather`

### MCP 工具暴露方式

MCP 工具通过 **LLM API 的 `tools` function calling 参数**暴露，不注入系统提示词 sections。AI 通过 tool schema（name + description + inputSchema）了解如何调用。

### 最小 MCP Server 示例

```javascript
import { createInterface } from 'node:readline';

const TOOLS = [{
  name: 'my_tool',
  description: 'Does something useful',
  inputSchema: {
    type: 'object',
    properties: { input: { type: 'string' } },
    required: ['input'],
  },
}];

function handle(req) {
  switch (req.method) {
    case 'initialize':
      return { jsonrpc: '2.0', id: req.id, result: {
        protocolVersion: '2025-06-18',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'my-server', version: '1.0.0' },
      }};
    case 'notifications/initialized':
      return null;
    case 'tools/list':
      return { jsonrpc: '2.0', id: req.id, result: { tools: TOOLS } };
    case 'tools/call':
      return { jsonrpc: '2.0', id: req.id, result: {
        content: [{ type: 'text', text: 'result here' }],
      }};
  }
}

const rl = createInterface({ input: process.stdin });
rl.on('line', line => {
  if (!line.trim()) return;
  const resp = handle(JSON.parse(line));
  if (resp) process.stdout.write(JSON.stringify(resp) + '\n');
});
```

## 跳过工具执行确认

默认情况下，工具调用（如 `list_dir`、`run_command`）会卡在 `CORTEX_STEP_STATUS_WAITING`，等待客户端确认（文件权限、命令执行等）。

### `cascadeCanAutoRunCommands: true`

在 `plannerConfig` 中设置，**跳过所有确认**：

```json
"plannerConfig": {
  "planModel": 1026,
  "cascadeCanAutoRunCommands": true
}
```

效果：
```
之前: LIST_DIRECTORY → WAITING（卡住，等待确认）
之后: LIST_DIRECTORY → DONE（直接执行）
```

### 其他相关字段

| 字段 | 位置 | 说明 |
|------|------|------|
| `cascadeCanAutoRunCommands` | `plannerConfig` (field 22) | **主开关**，跳过所有工具执行确认 |
| `allowAutoRunCommands` | `RunCommandToolConfig` (field 2/7) | 仅控制命令执行的自动运行 |
| `enableModelAutoRun` | `RunCommandToolConfig` (field 1) | 允许模型判断是否自动运行 |

分发时必须设置 `cascadeCanAutoRunCommands: true`，否则无人确认时工具调用会永远 WAITING。

## 流式响应（轮询）

Go binary 没有可用的 server-streaming RPC（`StreamCascadeSummariesReactiveUpdates` 返回 `reactive state is disabled`），但 `GetCascadeTrajectorySteps` **支持增量响应**。

### 轮询方式

```
1. StartCascade → cascadeId
2. SendUserCascadeMessage(cascadeId, ...)
3. 每 200ms 轮询:
   a. GetAllCascadeTrajectories → 检查 status
   b. GetCascadeTrajectorySteps → 获取步骤列表
4. status == CASCADE_RUN_STATUS_IDLE → 完成
```

### 步骤类型（Step Types）

| type | 说明 |
|------|------|
| `USER_INPUT` | 用户消息 |
| `CONVERSATION_HISTORY` | 对话历史注入 |
| `EPHEMERAL_MESSAGE` | 系统临时消息 |
| `PLANNER_RESPONSE` | AI 响应（文本生成） |
| `LIST_DIRECTORY` | list_dir 工具 |
| `VIEW_FILE` | view_file 工具 |
| `RUN_COMMAND` | run_command 工具 |
| `CHECKPOINT` | 检查点 |

### 步骤状态（Step Status）

| status | 说明 |
|--------|------|
| `GENERATING` | AI 正在生成（可读到部分文本） |
| `DONE` | 步骤完成 |
| `WAITING` | 等待确认（需要 `cascadeCanAutoRunCommands` 跳过） |
| `RUNNING` | 正在执行 |

### 增量文本

`PLANNER_RESPONSE` 步骤的 `plannerResponse.response` 在 `GENERATING` 状态时**实时增长**：

```
[1.8s] response(30ch):  "Here's a poem about the ocean:"
[2.0s] response(80ch):  + 更多文本...
[2.4s] response(174ch): + 继续增长...
[3.8s] DONE — 生成完成
```

### 工具调用事件

工具调用步骤包含结构化数据：

```javascript
step.metadata.toolCall = {
  name: "list_dir",                                    // 工具名
  argumentsJson: '{"DirectoryPath": "/path/to/dir"}'   // 参数
}
step.listDirectory = {
  directoryPathUri: "file:///path/to/dir",             // 工具特定字段
  result: { ... }                                       // 执行结果
}
```

## 逆向方法

通过 `strings` 提取 Go 二进制中的符号和 proto struct tag：

```bash
# 列出某个 proto message 的所有 getter 方法（即字段）
strings language_server_macos_arm | grep 'cortex_go_proto.*CascadeToolConfig)\.Get' | sort -u

# 查找 proto struct tag（字段号、类型、JSON 名）
strings language_server_macos_arm | grep 'protobuf:.*json:' | grep 'force_disable'
```

Go 编译后保留了 proto 反射元数据（struct tag + 方法名），`strings` + `grep` 即可还原 proto schema。
