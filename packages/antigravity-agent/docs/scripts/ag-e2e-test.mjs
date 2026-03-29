#!/usr/bin/env node
/**
 * Full E2E Test: OAuth → Mock ExtServer → Go Binary → MCP Tools → AI
 * 
 * Complete self-hosted Antigravity binary test:
 * 1. OAuth authentication (browser-based)
 * 2. Mock Extension Server with USS OAuth injection
 * 3. Go binary spawn with proper pipe handling
 * 4. MCP tool registration (get_weather)
 * 5. Send message that triggers tool call
 * 6. Poll and display full response with tool results
 * 
 * Usage: node ag-e2e-test.mjs
 */
import http2 from 'node:http2';
import https from 'node:https';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import { spawn, execSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { URL, URLSearchParams } from 'node:url';
import crypto from 'node:crypto';
import { create, toBinary } from '@bufbuild/protobuf';
import { fileDesc, messageDesc } from '@bufbuild/protobuf/codegenv1';
import * as pbwkt from '@bufbuild/protobuf/wkt';

// ===== Load Proto Schemas =====
const extSrc = fs.readFileSync('/Applications/Antigravity.app/Contents/Resources/app/extensions/antigravity/dist/extension.js', 'utf8');
const descRegex = /(\w+)=\(0,\w+\.fileDesc\)\("([A-Za-z0-9+/=]+)"(?:,\[([^\]]*)\])?\)/g;
let descMatch;
const allDescs = {};
while ((descMatch = descRegex.exec(extSrc)) !== null) {
  const name = descMatch[1], b64 = descMatch[2];
  const deps = (descMatch[3]||'').split(',').map(s => {
    const t = s.trim(); const i = t.lastIndexOf('.'); return i >= 0 ? t.substring(i+1) : t;
  }).filter(s => s.length > 0);
  allDescs[name] = { b64, deps, loaded: null };
}
const wktMap = {};
for (const [n,v] of Object.entries(pbwkt)) if (n.startsWith('file_')) wktMap[n] = v;
function loadProtoDesc(name) {
  if (wktMap[name]) return wktMap[name];
  if (!allDescs[name]) return null;
  if (allDescs[name].loaded) return allDescs[name].loaded;
  const df = [];
  for (const d of allDescs[name].deps) { const x = loadProtoDesc(d); if (x) df.push(x); }
  try { allDescs[name].loaded = fileDesc(allDescs[name].b64, df); return allDescs[name].loaded; } catch(e) { return null; }
}
const ussProtoFile = loadProtoDesc('file_exa_unified_state_sync_pb_unified_state_sync');
const extProtoFile = loadProtoDesc('file_exa_extension_server_pb_extension_server');
const lsProtoFile = loadProtoDesc('file_exa_language_server_pb_language_server');
const TopicSchema = messageDesc(ussProtoFile, 0);
const RowSchema = messageDesc(ussProtoFile, 1);
const USSUpdateSchema = messageDesc(extProtoFile, 101);
const OAuthTokenInfoSchema = messageDesc(lsProtoFile, 279);

// ===== Config =====
const BINARY = '/Applications/Antigravity.app/Contents/Resources/app/extensions/antigravity/bin/language_server_macos_arm';
const CLIENT_ID = '1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com';
const CLIENT_SECRET = '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';
const SCOPES = 'openid email profile https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/experimentsandconfigs';
const OAUTH_PORT = 19877;
const REDIRECT_URI = `http://localhost:${OAUTH_PORT}/oauth-callback`;
const MCP_SERVER_PATH = path.join(path.dirname(new URL(import.meta.url).pathname), 'mcp-test-server.mjs');

const LS_CSRF = crypto.randomUUID();
const EXT_CSRF = crypto.randomUUID();
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ===== Proto helpers =====
function protoEncodeBytes(fn, buf) {
  const tag = Buffer.from([(fn << 3) | 2]);
  let len = buf.length; const lb = [];
  while (len > 0x7f) { lb.push((len & 0x7f) | 0x80); len >>= 7; }
  lb.push(len & 0x7f);
  return Buffer.concat([tag, Buffer.from(lb), buf]);
}
function protoEncodeString(fn, str) { return protoEncodeBytes(fn, Buffer.from(str, 'utf8')); }
function encodeEnvelopeProto(protoBuf, flags = 0) {
  const header = Buffer.alloc(5);
  header.writeUInt8(flags, 0);
  header.writeUInt32BE(protoBuf.length, 1);
  return Buffer.concat([header, protoBuf]);
}
function decodeEnvelopes(buf) {
  const frames = []; let pos = 0;
  while (pos + 5 <= buf.length) {
    const flags = buf[pos]; const len = buf.readUInt32BE(pos + 1);
    if (pos + 5 + len > buf.length) break;
    frames.push({ flags, body: buf.subarray(pos + 5, pos + 5 + len) });
    pos += 5 + len;
  }
  return { frames, remaining: buf.subarray(pos) };
}
function protoDecodeString(buf) {
  const result = {};  let pos = 0;
  while (pos < buf.length) {
    const byte = buf[pos++]; const fn = byte >> 3; const wt = byte & 7;
    if (wt === 2) {
      let len = 0, shift = 0;
      while (pos < buf.length) { const b = buf[pos++]; len |= (b & 0x7f) << shift; if (!(b & 0x80)) break; shift += 7; }
      result[`field${fn}`] = buf.subarray(pos, pos + len).toString('utf8'); pos += len;
    } else if (wt === 0) {
      let v = 0n, shift = 0n;
      while (pos < buf.length) { const b = buf[pos++]; v |= BigInt(b & 0x7f) << shift; if (!(b & 0x80)) break; shift += 7n; }
      result[`field${fn}`] = Number(v);
    }
  }
  return result;
}

// ===== LS RPC =====
let lsPort = 0;
function rpc(method, body = {}) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request({
      hostname: '127.0.0.1', port: lsPort,
      path: `/exa.language_server_pb.LanguageServerService/${method}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-codeium-csrf-token': LS_CSRF, 'Content-Length': Buffer.byteLength(data), 'Connection': 'close' },
      rejectUnauthorized: false,
    }, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(d); } }); });
    req.on('error', reject);
    req.write(data); req.end();
  });
}

// ===== Mock Extension Server =====
let oauthTokenInfo = null;

let chromeDevtoolsCount = 0;
function createMockExtensionServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const rpcPath = req.url || '';
      const ct = req.headers['content-type'] || '';
      const rpcName = rpcPath.split('/').pop();
      // Suppress GetChromeDevtoolsMcpUrl spam (binary polls this every ~200ms)
      if (rpcName === 'GetChromeDevtoolsMcpUrl') {
        chromeDevtoolsCount++;
        if (chromeDevtoolsCount === 1) console.log('  📥 ExtSrv: GetChromeDevtoolsMcpUrl (suppressing further)');
      } else {
        console.log(`  📥 ExtSrv: ${rpcName}`);
      }
      
      let body = [];
      req.on('data', chunk => body.push(chunk));
      req.on('end', () => {
        const rawBody = Buffer.concat(body);
        
        if (rpcPath.includes('SubscribeToUnifiedStateSyncTopic')) {
          let topic = '';
          try {
            const { frames } = decodeEnvelopes(rawBody);
            if (frames.length > 0) topic = protoDecodeString(frames[0].body).field1 || '';
          } catch (e) {}
          console.log(`  📋 USS Subscribe: topic="${topic}"`);
          
          res.writeHead(200, { 'Content-Type': 'application/connect+proto', 'Transfer-Encoding': 'chunked' });
          res.flushHeaders();
          if (res.socket) res.socket.setNoDelay(true);
          
          if (topic === 'uss-oauth' && oauthTokenInfo) {
            const tokenObj = create(OAuthTokenInfoSchema, {
              accessToken: oauthTokenInfo.accessToken,
              tokenType: oauthTokenInfo.tokenType,
              refreshToken: oauthTokenInfo.refreshToken,
              expiry: { seconds: BigInt(Math.floor(Date.now() / 1000) + 3600), nanos: 0 },
              isGcpTos: false,
            });
            const tokenBin = toBinary(OAuthTokenInfoSchema, tokenObj);
            const tokenBase64 = Buffer.from(tokenBin).toString('base64');
            const topicObj = create(TopicSchema, {
              data: { oauthTokenInfoSentinelKey: create(RowSchema, { value: tokenBase64 }) },
            });
            const updateObj = create(USSUpdateSchema, {
              updateType: { case: 'initialState', value: topicObj },
            });
            const updateBin = toBinary(USSUpdateSchema, updateObj);
            res.write(encodeEnvelopeProto(Buffer.from(updateBin)));
          } else {
            const emptyInitial = protoEncodeBytes(1, Buffer.alloc(0));
            res.write(encodeEnvelopeProto(emptyInitial));
          }
          return; // Keep stream open
        }
        
        // All other RPCs: return empty proto
        res.writeHead(200, { 'Content-Type': 'application/proto' });
        res.end(Buffer.alloc(0));
      });
    });

    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port });
    });
  });
}

// ===== OAuth =====
function doOAuth() {
  return new Promise((resolve) => {
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
      client_id: CLIENT_ID, redirect_uri: REDIRECT_URI, response_type: 'code',
      scope: SCOPES, access_type: 'offline', prompt: 'consent',
    })}`;
    
    const srv = http.createServer((req, res) => {
      const u = new URL(req.url, `http://localhost:${OAUTH_PORT}`);
      if (u.pathname === '/oauth-callback' && u.searchParams.get('code')) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<h1>✅ Done! Return to terminal.</h1><script>window.close()</script>');
        srv.close();
        resolve(u.searchParams.get('code'));
      }
    });
    srv.listen(OAUTH_PORT, () => {
      console.log('\n🌐 Opening browser for OAuth...');
      try { execSync(`open "${authUrl}"`); } catch { console.log('   Open manually:', authUrl); }
    });
  });
}

async function exchangeCode(code) {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams({
      code, client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI, grant_type: 'authorization_code',
    });
    const req = https.request('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { reject(new Error(d)); } });
    });
    req.on('error', reject);
    req.write(params.toString()); req.end();
  });
}

// ===== Spawn Binary =====
function spawnBinary(extPort) {
  return new Promise((resolve) => {
    const pipePath = path.join(os.tmpdir(), `ag_e2e_${crypto.randomBytes(4).toString('hex')}`);
    const pipeServer = net.createServer(() => {});
    pipeServer.listen(pipePath, () => {
      const child = spawn(BINARY, [
        '--csrf_token', LS_CSRF,
        '--random_port',
        '--workspace_id', 'e2e-test',
        '--cloud_code_endpoint', 'https://daily-cloudcode-pa.googleapis.com',
        '--app_data_dir', 'antigravity',
        '--extension_server_port', String(extPort),
        '--extension_server_csrf_token', EXT_CSRF,
        '--parent_pipe_path', pipePath,
      ], { stdio: ['pipe', 'pipe', 'pipe'] });

      child.stdin.write(Buffer.from([0x0a, 0x04, 0x74, 0x65, 0x73, 0x74]));
      child.stdin.end();

      child.stderr.on('data', d => {
        const text = d.toString();
        const m = text.match(/listening on random port at (\d+) for HTTPS/);
        if (m) {
          lsPort = parseInt(m[1]);
          console.log(`  ✅ Language Server HTTPS port: ${lsPort}`);
          resolve({ child, pipeServer });
        }
        for (const line of text.split('\n').filter(l => l.trim())) {
          // Only log important lines to reduce noise
          const t = line.trim();
          if (t.includes('Error') || t.includes('error') || t.includes('Failed') || 
              t.includes('planner') || t.includes('streamGenerate') || t.includes('initialized') ||
              t.includes('MCP') || t.includes('mcp') || t.includes('tool')) {
            console.log(`  📝 ${t.substring(0, 200)}`);
          }
        }
      });
    });
  });
}

// ===== Main E2E Test =====
async function main() {
  console.log('═'.repeat(60));
  console.log('  🚀 Full E2E Test: OAuth → MCP Tools → AI Tool Call');
  console.log('═'.repeat(60));

  // ---- Step 1: OAuth ----
  console.log('\n📌 Step 1: OAuth Authentication');
  const code = await doOAuth();
  const tokens = await exchangeCode(code);
  console.log(`  ✅ access_token: ${tokens.access_token?.substring(0, 20)}...`);
  console.log(`  ✅ refresh_token: ${tokens.refresh_token ? 'present' : 'none'}`);

  oauthTokenInfo = {
    accessToken: tokens.access_token,
    tokenType: tokens.token_type || 'Bearer',
    refreshToken: tokens.refresh_token || '',
  };

  // ---- Step 2: Start Mock Extension Server ----
  console.log('\n📌 Step 2: Mock Extension Server');
  const { server: extServer, port: extPort } = await createMockExtensionServer();
  console.log(`  ✅ Extension Server on port ${extPort}`);

  // ---- Step 3: Spawn Go Binary ----
  console.log('\n📌 Step 3: Spawn Go Binary');
  const { child, pipeServer } = await spawnBinary(extPort);
  await sleep(5000);  // Wait for initialization

  // ---- Step 4: Send Message with MCP Tool ----
  console.log('\n📌 Step 4: Send Message with MCP Tool');
  console.log(`  MCP server: ${MCP_SERVER_PATH}`);
  
  const startRes = await rpc('StartCascade');
  const cascadeId = startRes.cascadeId;
  console.log(`  Cascade: ${cascadeId}`);

  // Send message with MCP tool config — ask it to use the tool
  const sendResult = await rpc('SendUserCascadeMessage', {
    cascadeId,
    items: [{ text: 'What is the weather in Tokyo? Use the get_weather tool to check.' }],
    cascadeConfig: {
      plannerConfig: {
        planModel: 1026,
        maxOutputTokens: 4096,
        cascadeCanAutoRunCommands: true,
        customizationConfig: {
          mcpServers: [{
            serverName: 'test-weather',
            command: 'node',
            args: [MCP_SERVER_PATH],
          }],
        },
      },
    },
  });

  if (sendResult.code) {
    console.log(`  ❌ Send failed: ${sendResult.message}`);
    cleanup(child, pipeServer, extServer);
    return;
  }

  // ---- Step 5: Poll for Response ----
  console.log('\n📌 Step 5: Polling for AI Response...');
  let lastStepCount = 0;
  let done = false;

  for (let i = 0; i < 60; i++) {
    await sleep(2000);
    
    const traj = await rpc('GetAllCascadeTrajectories');
    const info = traj.trajectorySummaries?.[cascadeId];
    if (!info) { process.stdout.write('.'); continue; }

    const newSteps = (info.stepCount || 0) - lastStepCount;
    if (newSteps > 0) {
      lastStepCount = info.stepCount;
      
      const stepsRes = await rpc('GetCascadeTrajectorySteps', {
        cascadeId,
        startIndex: Math.max(0, lastStepCount - newSteps),
        endIndex: lastStepCount,
      });

      for (const step of (stepsRes.steps || [])) {
        // Show planner response (AI text)
        if (step.plannerResponse?.response) {
          console.log(`\n  🤖 AI: ${step.plannerResponse.response.substring(0, 500)}`);
        }
        // Show tool calls
        if (step.toolExecution) {
          const te = step.toolExecution;
          console.log(`\n  🔧 Tool: ${te.toolName || te.tool || 'unknown'}`);
          if (te.toolParameters) {
            const params = typeof te.toolParameters === 'string' 
              ? te.toolParameters.substring(0, 200) 
              : JSON.stringify(te.toolParameters).substring(0, 200);
            console.log(`     Params: ${params}`);
          }
          if (te.toolResult) {
            console.log(`     Result: ${te.toolResult.substring(0, 300)}`);
          }
        }
        // Show MCP tool calls specifically
        if (step.mcpToolCall) {
          console.log(`\n  🔧 MCP Tool: ${step.mcpToolCall.toolName}`);
          console.log(`     Server: ${step.mcpToolCall.serverName}`);
          if (step.mcpToolCall.arguments) console.log(`     Args: ${JSON.stringify(step.mcpToolCall.arguments).substring(0, 200)}`);
          if (step.mcpToolCall.result) console.log(`     Result: ${step.mcpToolCall.result.substring(0, 200)}`);
        }
        // Show any step type we haven't specifically handled
        const keys = Object.keys(step).filter(k => !['plannerResponse','toolExecution','mcpToolCall','type','stepNumber'].includes(k));
        if (keys.length > 0) {
          const otherData = {};
          for (const k of keys) otherData[k] = step[k];
          const s = JSON.stringify(otherData);
          if (s.length > 5) console.log(`  📋 Step data: ${s.substring(0, 300)}`);
        }
      }
    }

    if (info.status?.includes('IDLE') && lastStepCount > 0) {
      done = true;
      console.log('\n  ✅ Cascade completed!');
      break;
    }

    process.stdout.write('.');
  }

  if (!done) console.log('\n  ⏰ Timeout waiting for response');

  // ---- Step 6: Show MCP Log ----
  console.log('\n📌 Step 6: MCP Server Log');
  try {
    const log = fs.readFileSync('/tmp/mcp-test.log', 'utf8');
    const lines = log.split('\n').slice(-15);
    for (const line of lines) {
      if (line.trim()) console.log(`  ${line}`);
    }
  } catch { console.log('  (no log file)'); }

  // Cleanup
  console.log('\n' + '═'.repeat(60));
  console.log('  ✅ E2E Test Complete!');
  console.log('═'.repeat(60));
  cleanup(child, pipeServer, extServer);
}

function cleanup(child, pipeServer, extServer) {
  child.kill();
  pipeServer.close();
  extServer.close();
  process.exit(0);
}

main().catch(e => { console.error('💥', e); process.exit(1); });
