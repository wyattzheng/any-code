# 自启动 Go Binary

## 概述

可以独立于 Antigravity.app 启动 Go language server binary，实现完全自主的 AI Agent 分发。

## 启动流程

### 1. 创建 IPC Socket Server

```javascript
import net from 'node:net';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

const BINARY = '/Applications/Antigravity.app/Contents/Resources/app/extensions/antigravity/bin/language_server_macos_arm';
const PIPE_PATH = path.join(os.tmpdir(), `server_${crypto.randomBytes(8).toString('hex')}`);
const CSRF = crypto.randomUUID();

const server = net.createServer(sock => {
  console.log('Go binary connected');
  sock.on('data', d => console.log('Pipe data:', d.length, 'bytes'));
});

server.listen(PIPE_PATH, () => {
  const child = spawn(BINARY, [
    '--csrf_token', CSRF,
    '--random_port',
    '--workspace_id', 'file_tmp_test',
    '--cloud_code_endpoint', 'https://daily-cloudcode-pa.googleapis.com',
    '--app_data_dir', 'antigravity',
    '--parent_pipe_path', PIPE_PATH,
  ], { stdio: ['pipe', 'pipe', 'pipe'] });

  // 写入最小 ManagementMetadata protobuf
  child.stdin.write(Buffer.from([0x0a, 0x04, 0x74, 0x65, 0x73, 0x74]));
  child.stdin.end();

  child.stderr.on('data', d => {
    const m = d.toString().match(/listening on random port at (\d+) for HTTPS/);
    if (m) console.log('HTTPS port:', m[1]);
  });
});
```

### 2. Stdin Metadata

Go binary 从 stdin 读取 protobuf `ManagementMetadata`（`index.proto` message 9）。最小有效载荷：

```
0x0a 0x04 0x74 0x65 0x73 0x74
```

即 protobuf field 1 (api_key), LEN=4, value="test"。

### 3. CLI 参数

| 参数 | 说明 |
|------|------|
| `--csrf_token` | CSRF 认证 token |
| `--random_port` | 随机端口监听 |
| `--server_port` | 指定端口 |
| `--workspace_id` | 工作区 ID |
| `--cloud_code_endpoint` | AI 后端 URL |
| `--app_data_dir` | 应用数据目录名 |
| `--parent_pipe_path` | IPC socket 路径 |
| `--enable_lsp` | 启用 LSP |

## OAuth 认证

自启动实例默认无 OAuth token，无法调用 Google AI 后端（`Failed to get OAuth token: extension server client not initialized`）。需要自行完成 OAuth 流程并通过 RPC 注入 token。

### Google OAuth 参数

| 项目 | 值 |
|------|---|
| Client ID | `1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com` |
| Redirect URI | `http://localhost:<port>/oauth-callback` |
| Scopes | `openid`, `email`, `profile`, `https://www.googleapis.com/auth/experimentsandconfigs`（等） |
| Grant Type | `authorization_code` |

### OAuthTokenInfo 结构

```
message OAuthTokenInfo {
  string access_token = 1;      // OAuth access token
  string token_type = 2;        // 通常 "Bearer"
  string refresh_token = 3;     // 用于刷新 access token
  string expiry = 4;            // 过期时间
  bool   is_gcp_tos = 6;        // GCP ToS 状态
}
```

### SaveOAuthTokenInfo RPC

启动 binary 获得 HTTPS 端口后，通过 RPC 注入 token：

```javascript
const tokenInfo = {
  accessToken: '<your-access-token>',
  tokenType: 'Bearer',
  refreshToken: '<your-refresh-token>',
  expiry: '<expiry-timestamp>',
  isGcpTos: false,
};

await rpc('SaveOAuthTokenInfo', { tokenInfo });
```

### 完整 OAuth 流程

```
1. 启动本地 HTTP server 监听 /oauth-callback
2. 打开浏览器 → Google OAuth 授权页
   https://accounts.google.com/o/oauth2/v2/auth?
     client_id=1071006060591-...&
     redirect_uri=http://localhost:<port>/oauth-callback&
     response_type=code&
     scope=openid+email+profile+https://...&
     access_type=offline&
     prompt=consent
3. 用户授权 → Google 重定向到 localhost/oauth-callback?code=...
4. 用 code 换 token:
   POST https://oauth2.googleapis.com/token
     code=..., client_id=..., redirect_uri=..., grant_type=authorization_code
5. 拿到 access_token + refresh_token
6. 调用 SaveOAuthTokenInfo RPC 注入给 Go binary
7. 之后的 AI 调用就能正常工作
```

注意：Google OAuth 的 public client（desktop app）不需要 client_secret。

### Token 刷新

Go binary 内部有自动刷新逻辑（`Failed to refresh loaded token, re-authenticating`）。当 access_token 过期时，binary 会用 refresh_token 自动换取新 token。

## 完整分发要求

```javascript
// 1. 启动 binary → 获取 port 和 csrf
// 2. 注入 OAuth token
await rpc('SaveOAuthTokenInfo', { tokenInfo });

// 3. 发送消息（含自定义配置）
await rpc('SendUserCascadeMessage', {
  cascadeId: cid,
  items: [{ text: '...' }],
  cascadeConfig: {
    plannerConfig: {
      planModel: 1026,
      cascadeCanAutoRunCommands: true,    // 跳过确认
      promptSectionCustomizationConfig: { // 自定义系统提示词
        appendPromptSections: [{ sectionId: 'custom', content: '...' }],
      },
      customizationConfig: {              // 注入 MCP 工具
        mcpServers: [{ serverName: '...', command: '...', args: [] }],
      },
      toolConfig: {                       // 控制内置工具
        runCommand: { forceDisable: true },
        // ...
      },
    },
  },
});

// 4. 轮询获取流式结果
while (status !== 'IDLE') {
  const steps = await rpc('GetCascadeTrajectorySteps', { cascadeId: cid });
  // 处理增量文本 + 工具调用事件
}
```

## 调试技巧

自启动的最大价值是 **stderr 可见**。Go binary 的 panic stacktrace 会输出到 stderr：

```
panic serving: runtime error: invalid memory address or nil pointer dereference
  rpcs_cascade.go:515 +0x3c4
```
