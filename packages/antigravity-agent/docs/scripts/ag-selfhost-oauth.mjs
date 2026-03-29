#!/usr/bin/env node
/**
 * Mock Extension Server — minimal gRPC-compatible server
 * that serves OAuthTokenInfo via UnifiedStateSync.
 * 
 * The Go binary connects to this as ExtensionServerService.
 * Uses ConnectRPC protocol over HTTP/2 (same as language server).
 * 
 * This script:
 * 1. Starts a mock extension server
 * 2. Spawns Go binary with --extension_server_port
 * 3. Does OAuth flow
 * 4. Pushes token via USS subscription
 * 5. Tests AI
 */
import http2 from 'node:http2';
import https from 'node:https';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import { spawn, execSync } from 'node:child_process';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { URL, URLSearchParams } from 'node:url';
import { create, toBinary } from '@bufbuild/protobuf';
import { fileDesc, messageDesc } from '@bufbuild/protobuf/codegenv1';
import * as pbwkt from '@bufbuild/protobuf/wkt';

// ===== Load Proto Schemas from Antigravity extension.js =====
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
console.log('✅ Proto schemas loaded:', OAuthTokenInfoSchema.typeName);

// ===== Config =====
const BINARY = '/Applications/Antigravity.app/Contents/Resources/app/extensions/antigravity/bin/language_server_macos_arm';
const CLIENT_ID = '1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com';
const CLIENT_SECRET = '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';
const SCOPES = 'openid email profile https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/experimentsandconfigs';
const OAUTH_PORT = 19877;
const REDIRECT_URI = `http://localhost:${OAUTH_PORT}/oauth-callback`;

const PIPE_PATH = path.join(os.tmpdir(), `ag_mock_${crypto.randomBytes(4).toString('hex')}`);
const LS_CSRF = crypto.randomUUID();      // for language server
const EXT_CSRF = crypto.randomUUID();      // for extension server

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ===== ConnectRPC envelope helpers =====
function encodeEnvelope(jsonObj, flags = 0) {
  const body = Buffer.from(JSON.stringify(jsonObj));
  const header = Buffer.alloc(5);
  header.writeUInt8(flags, 0);
  header.writeUInt32BE(body.length, 1);
  return Buffer.concat([header, body]);
}

function decodeEnvelopes(buffer) {
  const frames = [];
  let offset = 0;
  while (offset + 5 <= buffer.length) {
    const flags = buffer.readUInt8(offset);
    const length = buffer.readUInt32BE(offset + 1);
    if (offset + 5 + length > buffer.length) break;
    frames.push({ flags, body: buffer.slice(offset + 5, offset + 5 + length) });
    offset += 5 + length;
  }
  return { frames, remaining: buffer.slice(offset) };
}

// ===== Minimal protobuf helpers =====
function protoDecodeString(buf) {
  // Decode a simple proto message with string fields (field 1)
  const result = {};
  let offset = 0;
  while (offset < buf.length) {
    const byte = buf[offset];
    const fieldNum = byte >> 3;
    const wireType = byte & 0x07;
    offset++;
    if (wireType === 2) { // LEN
      let len = 0, shift = 0;
      do { const b = buf[offset++]; len |= (b & 0x7f) << shift; shift += 7; if (!(b & 0x80)) break; } while (true);
      result[`field${fieldNum}`] = buf.slice(offset, offset + len).toString('utf8');
      offset += len;
    } else if (wireType === 0) { // VARINT
      let val = 0, shift = 0;
      do { const b = buf[offset++]; val |= (b & 0x7f) << shift; shift += 7; if (!(b & 0x80)) break; } while (true);
      result[`field${fieldNum}`] = val;
    } else {
      break;
    }
  }
  return result;
}

function protoEncodeString(fieldNum, str) {
  return protoEncodeBytes(fieldNum, Buffer.from(str, 'utf8'));
}

function protoEncodeVarint(fieldNum, val) {
  const bytes = [(fieldNum << 3) | 0];
  let v = typeof val === 'bigint' ? val : BigInt(val);
  while (v > 0x7fn) { bytes.push(Number(v & 0x7fn) | 0x80); v >>= 7n; }
  bytes.push(Number(v & 0x7fn));
  return Buffer.from(bytes);
}

function encodeEnvelopeProto(protoBuf, flags = 0) {
  const header = Buffer.alloc(5);
  header.writeUInt8(flags, 0);
  header.writeUInt32BE(protoBuf.length, 1);
  return Buffer.concat([header, protoBuf]);
}

// ===== RPC helper (to language server) =====
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
let subscribedStreams = []; // store active USS subscriptions

function createMockExtensionServer() {
  return new Promise((resolve) => {
    // Plain HTTP/1.1 — Electron uses connectNodeAdapter (ConnectRPC over HTTP/1.1)
    const server = http.createServer((req, res) => {
      const rpcPath = req.url || '';
      const ct = req.headers['content-type'] || '';
      console.log(`📥 ExtServer: ${req.method} ${rpcPath} [${ct}]`);
      
      let body = [];
      req.on('data', chunk => body.push(chunk));
      req.on('end', () => {
        const rawBody = Buffer.concat(body);
        
        if (rpcPath.includes('SubscribeToUnifiedStateSyncTopic')) {
          let topic = '';
          try {
            const { frames } = decodeEnvelopes(rawBody);
            if (frames.length > 0) {
              const decoded = protoDecodeString(frames[0].body);
              topic = decoded.field1 || '';  // field 1 = topic
            }
          } catch (e) {
            console.log(`   ⚠️ Parse error: ${e.message}`);
          }
          
          console.log(`   📋 USS Subscribe: topic="${topic}"`);
          
          // Respond with connect+proto (matching client's content-type)
          res.writeHead(200, {
            'Content-Type': 'application/connect+proto',
            'Transfer-Encoding': 'chunked',
          });
          res.flushHeaders();  // Force send headers immediately
          if (res.socket) res.socket.setNoDelay(true);  // Disable Nagle's algorithm
          
          subscribedStreams.push({ res, topic });
          
          // Send initial_state with token data if available
          if (topic === 'uss-oauth' && oauthTokenInfo) {
            // Build OAuthTokenInfo using @bufbuild/protobuf (correct field types!)
            const tokenObj = create(OAuthTokenInfoSchema, {
              accessToken: oauthTokenInfo.accessToken,
              tokenType: oauthTokenInfo.tokenType,
              refreshToken: oauthTokenInfo.refreshToken,
              // expiry is google.protobuf.Timestamp — set seconds (1 hour from now)
              expiry: { seconds: BigInt(Math.floor(Date.now() / 1000) + 3600), nanos: 0 },
              isGcpTos: false,
            });
            const tokenBin = toBinary(OAuthTokenInfoSchema, tokenObj);
            const tokenBase64 = Buffer.from(tokenBin).toString('base64');
            
            // Build full UnifiedStateSyncUpdate using library
            // KEY FINDING: the map key is "oauthTokenInfoSentinelKey" (NOT "oauthTokenInfo")
            const topicObj = create(TopicSchema, {
              data: {
                oauthTokenInfoSentinelKey: create(RowSchema, { value: tokenBase64 }),
              },
            });
            const updateObj = create(USSUpdateSchema, {
              updateType: { case: 'initialState', value: topicObj },
            });
            const updateBin = toBinary(USSUpdateSchema, updateObj);
            
            // Send as ConnectRPC envelope
            res.write(encodeEnvelopeProto(Buffer.from(updateBin)));
            console.log(`   📤 Sent initial_state (key=oauthTokenInfoSentinelKey, ${updateBin.length}b)`);
            console.log(`   📤 OAuthTokenInfo: ${tokenBin.length}b, base64: ${tokenBase64.substring(0, 40)}...`);
          } else {
            // Empty initial_state for topics without data
            const emptyInitial = protoEncodeBytes(1, Buffer.alloc(0));  // initial_state(1) = empty Topic
            res.write(encodeEnvelopeProto(emptyInitial));
            console.log(`   📤 Sent empty initial_state for "${topic}"`);
          }
          // Keep stream open
          return;
        }
        
        if (rpcPath.includes('Heartbeat') || rpcPath.includes('LanguageServerStarted')) {
          res.writeHead(200, { 'Content-Type': 'application/proto' });
          res.end(Buffer.alloc(0));
          return;
        }
        
        if (rpcPath.includes('PushUnifiedStateSyncUpdate')) {
          res.writeHead(200, { 'Content-Type': 'application/proto' });
          res.end(Buffer.alloc(0));
          return;
        }
        
        // Default: return empty proto for any unhandled RPC
        res.writeHead(200, { 'Content-Type': 'application/proto' });
        res.end(Buffer.alloc(0));
      });
    });

    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      console.log(`✅ Mock Extension Server on port ${port}`);
      resolve({ server, port });
    });
  });
}

// Send OAuth token as applied_update (after initial_state has been sent)
function sendOAuthAppliedUpdate(res) {
  if (!oauthTokenInfo) return;
  
  const oauthJson = JSON.stringify(oauthTokenInfo);
  
  // AppliedUpdate { key(1): string, new_row(2): Row }
  // Row { value(1): string }
  // Try multiple keys
  const keys = ['oauthTokenInfo', 'default', '', 'oauth'];
  for (const key of keys) {
    const rowBuf = protoEncodeString(1, oauthJson);  // Row { value: json }
    const appliedBuf = Buffer.concat([
      protoEncodeString(1, key),     // key
      protoEncodeBytes(2, rowBuf),   // new_row = Row
    ]);
    // UnifiedStateSyncUpdate { applied_update(2): AppliedUpdate }
    const updateMsg = protoEncodeBytes(2, appliedBuf);
    try {
      res.write(encodeEnvelopeProto(updateMsg));
    } catch (e) {
      console.log(`   ⚠️ Failed to push applied_update key=${key}:`, e.message);
    }
  }
  console.log(`   📤 Sent ${keys.length} applied_updates (keys: ${keys.join(', ')})`);
}

function protoEncodeBytes(fieldNum, buf) {
  const tag = Buffer.from([(fieldNum << 3) | 2]);
  // Encode length as varint
  let len = buf.length;
  const lenBytes = [];
  while (len > 0x7f) { lenBytes.push((len & 0x7f) | 0x80); len >>= 7; }
  lenBytes.push(len & 0x7f);
  return Buffer.concat([tag, Buffer.from(lenBytes), buf]);
}

// ===== OAuth flow =====
function doOAuth() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://localhost:${OAUTH_PORT}`);
      if (url.pathname === '/oauth-callback') {
        const code = url.searchParams.get('code');
        if (code) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end('<h1>✅ OK</h1><p>Close this window.</p>');
          server.close();
          resolve(code);
        }
      }
    });
    server.listen(OAUTH_PORT, () => {
      const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
        client_id: CLIENT_ID, redirect_uri: REDIRECT_URI, response_type: 'code',
        scope: SCOPES, access_type: 'offline', prompt: 'consent',
      })}`;
      console.log('\n🌐 Opening browser for OAuth...');
      try { execSync(`open "${authUrl}"`); } catch {}
    });
  });
}

function exchangeCode(code) {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams({
      code, client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI, grant_type: 'authorization_code',
    });
    const data = params.toString();
    const req = https.request({
      hostname: 'oauth2.googleapis.com', path: '/token', method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(data) },
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        const json = JSON.parse(d);
        json.error ? reject(new Error(json.error_description)) : resolve(json);
      });
    });
    req.on('error', reject);
    req.write(data); req.end();
  });
}

// ===== Spawn binary =====
function spawnBinary(extPort) {
  return new Promise((resolve) => {
    const pipeServer = net.createServer(sock => {
      sock.on('data', () => {});
    });
    pipeServer.listen(PIPE_PATH, () => {
      const child = spawn(BINARY, [
        '--csrf_token', LS_CSRF,
        '--random_port',
        '--workspace_id', 'file_tmp_selfhost',
        '--cloud_code_endpoint', 'https://daily-cloudcode-pa.googleapis.com',
        '--app_data_dir', 'antigravity',
        '--parent_pipe_path', PIPE_PATH,
        '--extension_server_port', extPort.toString(),
        '--extension_server_csrf_token', EXT_CSRF,
      ], { stdio: ['pipe', 'pipe', 'pipe'] });
      
      child.stdin.write(Buffer.from([0x0a, 0x04, 0x74, 0x65, 0x73, 0x74]));
      child.stdin.end();
      
      child.stderr.on('data', d => {
        const text = d.toString();
        const m = text.match(/listening on random port at (\d+) for HTTPS/);
        if (m) {
          lsPort = parseInt(m[1]);
          console.log(`✅ Binary HTTPS port: ${lsPort}`);
          resolve({ child, pipeServer });
        }
        // Show ALL binary stderr for debugging
        for (const line of text.split('\n').filter(l => l.trim())) {
          console.log(`📝 Binary: ${line.trim().substring(0, 250)}`);
        }
      });
    });
  });
}

// ===== Main =====
async function main() {
  console.log('='.repeat(60));
  console.log('🚀 Self-hosted Binary + Mock Extension Server');
  console.log('='.repeat(60));

  // 1. OAuth FIRST (before starting binary)
  console.log('\n🔐 Step 1: OAuth flow...');
  const code = await doOAuth();
  const tokens = await exchangeCode(code);
  console.log(`   ✅ access_token: ${tokens.access_token?.substring(0, 20)}...`);
  console.log(`   ✅ refresh_token: ${tokens.refresh_token ? 'present' : 'none'}`);

  // 2. Set token (so it's available when binary subscribes)
  oauthTokenInfo = {
    accessToken: tokens.access_token,
    tokenType: tokens.token_type || 'Bearer',
    refreshToken: tokens.refresh_token || '',
    expiry: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
    isGcpTos: false,
  };
  console.log('   ✅ Token set in memory');

  // 3. Start mock extension server
  console.log('\n📦 Step 2: Starting mock extension server...');
  const { server: extServer, port: extPort } = await createMockExtensionServer();

  // 4. Spawn binary (it will subscribe to uss-oauth and get initial_state WITH token)
  console.log('\n📦 Step 3: Spawning Go binary...');
  const { child, pipeServer } = await spawnBinary(extPort);
  await sleep(5000);

  // 5. Test AI
  console.log('\n🤖 Step 4: Testing AI...');
  const start = await rpc('StartCascade');
  const cid = start.cascadeId;
  console.log(`   Cascade: ${cid}`);

  const sendResult = await rpc('SendUserCascadeMessage', {
    cascadeId: cid,
    items: [{ text: 'Say exactly: "Self-hosted works!" Nothing else.' }],
    cascadeConfig: {
      plannerConfig: { planModel: 1026, maxOutputTokens: 1024, cascadeCanAutoRunCommands: true },
    },
  });
  
  if (sendResult.code) {
    console.log(`   ❌ ${sendResult.message}`);
  } else {
    console.log('   Polling...');
    for (let i = 0; i < 30; i++) {
      await sleep(1000);
      const traj = await rpc('GetAllCascadeTrajectories');
      const info = traj.trajectorySummaries?.[cid];
      if (info?.status?.includes('IDLE') && (info?.stepCount || 0) > 0) {
        const stepsRes = await rpc('GetCascadeTrajectorySteps', { cascadeId: cid });
        for (const s of (stepsRes.steps || [])) {
          if (s.plannerResponse?.response) console.log(`\n   🎉 ${s.plannerResponse.response}`);
        }
        break;
      }
      process.stdout.write('.');
    }
  }

  console.log('\n\n✅ Done!');
  child.kill();
  pipeServer.close();
  extServer.close();
  process.exit(0);
}

main().catch(e => { console.error('💥', e.message); process.exit(1); });
