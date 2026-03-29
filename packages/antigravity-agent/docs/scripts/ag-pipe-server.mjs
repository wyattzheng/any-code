#!/usr/bin/env node
/**
 * Self-hosted Go binary - test SendUserCascadeMessage with various field combinations
 * to find which field fixes the nil pointer dereference at rpcs_cascade.go:515
 */
import net from 'node:net';
import https from 'node:https';
import http from 'node:http';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

const BINARY = '/Applications/Antigravity.app/Contents/Resources/app/extensions/antigravity/bin/language_server_macos_arm';
const PIPE_PATH = path.join(os.tmpdir(), `server_${crypto.randomBytes(8).toString('hex')}`);
const CSRF = crypto.randomUUID();

function rpcHttps(port, csrf, method, body = {}) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request({
      hostname: '127.0.0.1', port,
      path: `/exa.language_server_pb.LanguageServerService/${method}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-codeium-csrf-token': csrf, 'Content-Length': Buffer.byteLength(data), 'Connection': 'close' },
      rejectUnauthorized: false,
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(d); } });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// Also try HTTP (port+1)
function rpcHttp(port, csrf, method, body = {}) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({
      hostname: '127.0.0.1', port,
      path: `/exa.language_server_pb.LanguageServerService/${method}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-codeium-csrf-token': csrf, 'Content-Length': Buffer.byteLength(data), 'Connection': 'close' },
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(d); } });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

const server = net.createServer(sock => {
  console.log('✅ Pipe connected');
  sock.on('data', d => console.log(`📥 Pipe: ${d.length}b`));
});

server.listen(PIPE_PATH, () => {
  console.log(`CSRF: ${CSRF}\n`);

  const child = spawn(BINARY, [
    '--csrf_token', CSRF, '--random_port',
    '--workspace_id', 'file_tmp_test',
    '--cloud_code_endpoint', 'https://daily-cloudcode-pa.googleapis.com',
    '--app_data_dir', 'antigravity',
    '--parent_pipe_path', PIPE_PATH,
  ], { stdio: ['pipe', 'pipe', 'pipe'] });

  child.stdin.write(Buffer.from([0x0a, 0x04, 0x74, 0x65, 0x73, 0x74]));
  child.stdin.end();

  let httpsPort = null, httpPort = null;
  let panicLines = [];

  child.stderr.on('data', d => {
    const text = d.toString();
    const pm = text.match(/random port at (\d+) for HTTPS/);
    if (pm) { httpsPort = +pm[1]; httpPort = httpsPort + 1; }
    // Capture panic info
    for (const line of text.split('\n')) {
      if (line.includes('panic') || line.includes('nil pointer') || line.includes('rpcs_cascade')) {
        panicLines.push(line.trim());
      }
    }
  });

  child.on('exit', code => { console.log(`💀 Exit: ${code}`); server.close(); process.exit(0); });

  setTimeout(async () => {
    if (!httpsPort) { console.error('No port'); child.kill(); return; }
    console.log(`HTTPS: ${httpsPort}, HTTP: ${httpPort}\n`);

    // Create cascade
    const start = await rpcHttps(httpsPort, CSRF, 'StartCascade');
    const cid = start.cascadeId;
    console.log(`Cascade: ${cid}\n`);

    // Test payloads
    const tests = [
      { name: 'empty metadata obj', body: { cascadeId: cid, items: [{ text: 'hi' }], metadata: {} } },
      { name: 'with api_key', body: { cascadeId: cid, items: [{ text: 'hi' }], metadata: { apiKey: 'test' } } },
      { name: 'with cascadeConfig', body: { cascadeId: cid, items: [{ text: 'hi' }], metadata: {}, cascadeConfig: {} } },
      { name: 'with requestId', body: { cascadeId: cid, items: [{ text: 'hi' }], metadata: { requestId: 1 } } },
      { name: 'via HTTP (not HTTPS)', port: httpPort },
    ];

    for (const test of tests) {
      panicLines = [];
      console.log(`\n🧪 Test: ${test.name}`);
      
      try {
        let result;
        if (test.port) {
          // HTTP test
          result = await rpcHttp(test.port, CSRF, 'SendUserCascadeMessage', { cascadeId: cid, items: [{ text: 'hi' }], metadata: {} });
        } else {
          result = await rpcHttps(httpsPort, CSRF, 'SendUserCascadeMessage', test.body);
        }
        console.log(`   ✅ Result: ${JSON.stringify(result).substring(0, 300)}`);
      } catch (e) {
        console.log(`   ❌ Error: ${e.message}`);
        await sleep(500);
        if (panicLines.length) console.log(`   Panic: ${panicLines.join(' | ').substring(0, 300)}`);
      }
      
      await sleep(1000);
    }

    console.log('\n✅ Done');
    child.kill();
  }, 5000);

  setTimeout(() => { child.kill(); server.close(); process.exit(0); }, 60000);
});
