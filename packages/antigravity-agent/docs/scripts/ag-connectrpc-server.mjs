#!/usr/bin/env node
// Proper ConnectRPC Extension Server with @bufbuild/protobuf & @connectrpc/connect-node
// Uses actual proto schemas from the Antigravity extension.js
import http from 'http';
import https from 'https';
import net from 'net';
import { exec } from 'child_process';
import { spawn } from 'child_process';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { readFileSync } from 'fs';
import { URL, URLSearchParams } from 'url';

import { create, toBinary, fromBinary } from '@bufbuild/protobuf';
import { fileDesc, messageDesc, serviceDesc } from '@bufbuild/protobuf/codegenv1';
import * as wkt from '@bufbuild/protobuf/wkt';
import { createConnectRouter } from '@connectrpc/connect';
import { connectNodeAdapter } from '@connectrpc/connect-node';

// ===== Config =====
const BINARY = '/Applications/Antigravity.app/Contents/Resources/app/extensions/antigravity/bin/language_server_macos_arm';
const CLIENT_ID = '1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com';
const CLIENT_SECRET = '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';
const SCOPES = 'openid email profile https://www.googleapis.com/auth/experimentsandconfigs';
const OAUTH_PORT = 19877;
const REDIRECT_URI = `http://localhost:${OAUTH_PORT}/oauth-callback`;

const PIPE_PATH = path.join(os.tmpdir(), `ag_mock_${crypto.randomBytes(4).toString('hex')}`);
const LS_CSRF = crypto.randomUUID();
const EXT_CSRF = crypto.randomUUID();
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ===== Load Proto Schemas =====
console.log('📦 Loading proto schemas...');

const extSrc = readFileSync('/Applications/Antigravity.app/Contents/Resources/app/extensions/antigravity/dist/extension.js', 'utf8');

const regex = /(\w+)=\(0,\w+\.fileDesc\)\("([A-Za-z0-9+/=]+)"(?:,\[([^\]]*)\])?\)/g;
let match;
const allDescs = {};
while ((match = regex.exec(extSrc)) !== null) {
  const name = match[1];
  const b64 = match[2];
  const depsStr = match[3] || '';
  const deps = depsStr ? depsStr.split(',').map(s => {
    const trimmed = s.trim();
    const dotIdx = trimmed.lastIndexOf('.');
    return dotIdx >= 0 ? trimmed.substring(dotIdx + 1) : trimmed;
  }).filter(s => s.length > 0) : [];
  allDescs[name] = { b64, deps, loaded: null };
}

const wktMap = {};
for (const [name, value] of Object.entries(wkt)) {
  if (name.startsWith('file_')) wktMap[name] = value;
}

function loadDesc(name) {
  if (wktMap[name]) return wktMap[name];
  if (!allDescs[name]) return null;
  if (allDescs[name].loaded) return allDescs[name].loaded;
  const depFiles = [];
  for (const depName of allDescs[name].deps) {
    const dep = loadDesc(depName);
    if (dep) depFiles.push(dep);
  }
  try {
    allDescs[name].loaded = fileDesc(allDescs[name].b64, depFiles);
    return allDescs[name].loaded;
  } catch (e) { return null; }
}

const ussFile = loadDesc('file_exa_unified_state_sync_pb_unified_state_sync');
const extFile = loadDesc('file_exa_extension_server_pb_extension_server');

if (!ussFile || !extFile) { console.error('❌ Failed to load protos!'); process.exit(1); }

const TopicSchema = messageDesc(ussFile, 0);
const RowSchema = messageDesc(ussFile, 1);
const AppliedUpdateSchema = messageDesc(ussFile, 2);
const UnifiedStateSyncUpdateSchema = messageDesc(extFile, 101);
const ExtensionServerServiceDesc = serviceDesc(extFile, 0);

console.log('✅ Proto schemas loaded');
console.log('  Service:', ExtensionServerServiceDesc.typeName);

// ===== OAuth State =====
let oauthTokenInfo = null;

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

// ===== ConnectRPC Extension Server =====
function createMockExtensionServer() {
  return new Promise(resolve => {
    // Build router with ConnectRPC
    const routes = (router) => {
      router.service(ExtensionServerServiceDesc, {
        languageServerStarted: async (req) => {
          console.log('📥 LanguageServerStarted');
          return {};
        },
        
        subscribeToUnifiedStateSyncTopic: async function* (req, ctx) {
          const topic = req.topic;
          console.log(`📥 SubscribeToUnifiedStateSyncTopic: topic="${topic}"`);
          
          if (topic === 'uss-oauth' && oauthTokenInfo) {
            // Send initial state with OAuth token
            const topicData = create(TopicSchema, {
              data: {
                oauthTokenInfo: create(RowSchema, {
                  value: JSON.stringify(oauthTokenInfo),
                }),
              },
            });
            
            yield create(UnifiedStateSyncUpdateSchema, {
              updateType: {
                case: 'initialState',
                value: topicData,
              },
            });
            console.log('   📤 Sent initialState with oauthTokenInfo');
          } else {
            // Empty initial state
            const emptyTopic = create(TopicSchema, { data: {} });
            yield create(UnifiedStateSyncUpdateSchema, {
              updateType: {
                case: 'initialState',
                value: emptyTopic,
              },
            });
            console.log(`   📤 Sent empty initialState for "${topic}"`);
          }
          
          // Keep stream open — wait for updates
          const updatePromise = new Promise((resolve) => {
            if (topic === 'uss-oauth') {
              // Store a callback so we can push updates later
              oauthUpdateCallbacks.push(resolve);
            }
          });
          
          // Wait for an update or signal
          while (!ctx.signal.aborted) {
            await new Promise(r => setTimeout(r, 30000));
          }
        },
        
        launchBrowser: async (req) => {
          console.log('📥 LaunchBrowser:', req.url?.substring(0, 60));
          return {};
        },
        
        getChromeDevtoolsMcpUrl: async (req) => {
          return { url: '' };
        },
        
        getTerminalOutput: async (req) => {
          return { output: '' };
        },
        
        pushUnifiedStateSyncUpdate: async (req) => {
          console.log('📥 PushUnifiedStateSyncUpdate');
          return {};
        },
        
        heartbeat: async (req) => {
          return {};
        },
        
        smartFocusConversation: async (req) => {
          return {};
        },
      });
    };

    const handler = connectNodeAdapter({ routes });
    const server = http.createServer(handler);
    
    server.listen(0, () => {
      const port = server.address().port;
      console.log(`✅ Mock Extension Server (ConnectRPC) on port ${port}`);
      resolve({ server, port });
    });
  });
}

let oauthUpdateCallbacks = [];

// ===== OAuth Flow =====
function doOAuth() {
  return new Promise(resolve => {
    const oauthServer = http.createServer((req, res) => {
      if (req.url?.startsWith('/oauth-callback')) {
        const u = new URL(req.url, `http://localhost:${OAUTH_PORT}`);
        const code = u.searchParams.get('code');
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<h1>✅ OK! Close this tab.</h1>');
        oauthServer.close();
        resolve(code);
      }
    });
    oauthServer.listen(OAUTH_PORT, () => {
      console.log('\n🌐 Opening browser for OAuth...');
      const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=${encodeURIComponent(SCOPES)}&access_type=offline&prompt=consent`;
      exec(`open "${authUrl}"`);
    });
  });
}

async function exchangeCode(code) {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams({ code, client_id: CLIENT_ID, client_secret: CLIENT_SECRET, redirect_uri: REDIRECT_URI, grant_type: 'authorization_code' });
    const req = https.request({ hostname: 'oauth2.googleapis.com', path: '/token', method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
      res => { let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(JSON.parse(d))); });
    req.on('error', reject);
    req.write(params.toString()); req.end();
  });
}

// ===== Spawn Binary =====
function spawnBinary(extPort) {
  return new Promise((resolve, reject) => {
    const pipeServer = net.createServer(conn => {});
    pipeServer.listen(PIPE_PATH, () => {
      const child = spawn(BINARY, [
        `--csrf_token=${LS_CSRF}`,
        `--workspace_id=test-workspace`,
        `--extension_server_port=${extPort}`,
        `--extension_server_csrf_token=${EXT_CSRF}`,
        `--parent_pipe_path=${PIPE_PATH}`,
      ], { stdio: ['pipe', 'pipe', 'pipe'] });
      
      child.stdout.on('data', d => process.stdout.write(d));
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
        if (text.includes('OAuth') || text.includes('extension') || text.includes('state_sync') || text.includes('unified') || text.includes('key not found')) {
          console.log(`📝 Binary: ${text.trim().substring(0, 200)}`);
        }
      });
    });
  });
}

// ===== Main =====
async function main() {
  console.log('='.repeat(60));
  console.log('🚀 Proper ConnectRPC Extension Server');
  console.log('='.repeat(60));

  // 1. Start server
  const { server: extServer, port: extPort } = await createMockExtensionServer();

  // 2. Spawn binary
  console.log('\n📦 Spawning Go binary...');
  const { child, pipeServer } = await spawnBinary(extPort);

  // 3. OAuth
  console.log('\n🔐 OAuth flow...');
  const code = await doOAuth();
  const tokens = await exchangeCode(code);
  console.log(`   ✅ access_token: ${tokens.access_token?.substring(0, 20)}...`);
  console.log(`   ✅ refresh_token: ${tokens.refresh_token ? 'present' : 'none'}`);

  // 4. Set token
  oauthTokenInfo = {
    accessToken: tokens.access_token,
    tokenType: tokens.token_type || 'Bearer',
    refreshToken: tokens.refresh_token || '',
    expiry: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
    isGcpTos: false,
  };
  
  console.log('   Token set. Binary should pick it up on next USS read.');
  await sleep(3000);

  // 5. Test AI
  console.log('\n🤖 Testing AI...');
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
      const s = await rpc('GetCascadeState', { cascadeId: cid });
      const items = s.items || [];
      for (const item of items) {
        if (item.agentContent) {
          console.log(`   🤖 ${item.agentContent.substring(0, 100)}`);
        }
      }
      if (s.status?.state === 3 || s.status?.state === 4) break; // COMPLETE or ERROR
    }
  }

  // Cleanup
  child.kill();
  pipeServer.close();
  extServer.close();
}

main().catch(e => { console.error(e); process.exit(1); });
