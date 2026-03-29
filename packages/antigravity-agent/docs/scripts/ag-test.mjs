#!/usr/bin/env node
/**
 * Test SendUserCascadeMessage with grpc-web+json — the protocol it actually accepts!
 * 
 * gRPC-Web uses Length-Prefixed Message framing:
 * [1 byte: compression flag] [4 bytes: message length] [N bytes: message]
 * Trailer frame: flag byte = 0x80
 */
import http2 from 'node:http2';
import https from 'node:https';
import { execSync } from 'node:child_process';
import { Buffer } from 'node:buffer';

function discoverServer() {
  const ps = execSync('ps aux | grep language_server_macos | grep csrf_token | grep -v grep', { encoding: 'utf8' });
  for (const line of ps.trim().split('\n')) {
    if (line.includes('--server_port')) {
      const csrf = line.match(/--csrf_token\s+(\S+)/)?.[1];
      const port = line.match(/--server_port\s+(\d+)/)?.[1];
      if (csrf && port) return { port: +port, csrfToken: csrf };
    }
  }
  return null;
}

function rpc(server, method, body = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(`https://127.0.0.1:${server.port}/exa.language_server_pb.LanguageServerService/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-codeium-csrf-token': server.csrfToken },
      rejectUnauthorized: false,
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(d); } });
    });
    req.on('error', reject);
    req.write(JSON.stringify(body));
    req.end();
  });
}

// gRPC-Web frame: [flag:1][length:4][payload]
function encodeGrpcWebFrame(jsonObj, flag = 0x00) {
  const payload = Buffer.from(JSON.stringify(jsonObj));
  const frame = Buffer.alloc(5 + payload.length);
  frame[0] = flag;
  frame.writeUInt32BE(payload.length, 1);
  payload.copy(frame, 5);
  return frame;
}

function decodeGrpcWebFrames(buffer) {
  const frames = [];
  let offset = 0;
  while (offset + 5 <= buffer.length) {
    const flag = buffer[offset];
    const length = buffer.readUInt32BE(offset + 1);
    if (offset + 5 + length > buffer.length) break;
    const payload = buffer.subarray(offset + 5, offset + 5 + length);
    frames.push({ flag, isTrailer: !!(flag & 0x80), payload: payload.toString() });
    offset += 5 + length;
  }
  return frames;
}

function grpcWebRequest(server, method, body) {
  return new Promise((resolve) => {
    const client = http2.connect(`https://127.0.0.1:${server.port}`, { rejectUnauthorized: false });
    
    const frame = encodeGrpcWebFrame(body);
    const req = client.request({
      ':method': 'POST',
      ':path': `/exa.language_server_pb.LanguageServerService/${method}`,
      'content-type': 'application/grpc-web+json',
      'x-codeium-csrf-token': server.csrfToken,
      'x-grpc-web': '1',
    });

    let responseHeaders = {};
    let data = Buffer.alloc(0);
    
    const timeout = setTimeout(() => {
      resolve({ status: 'timeout', headers: responseHeaders, frames: decodeGrpcWebFrames(data), rawLen: data.length });
      req.close();
      client.close();
    }, 15000);

    req.on('response', h => { responseHeaders = { ...h }; });
    req.on('data', c => { data = Buffer.concat([data, c]); });
    req.on('end', () => {
      clearTimeout(timeout);
      resolve({ status: responseHeaders[':status'], headers: responseHeaders, frames: decodeGrpcWebFrames(data), rawLen: data.length });
      client.close();
    });
    req.on('error', e => {
      clearTimeout(timeout);
      resolve({ status: 'error', error: e.message });
      client.close();
    });

    req.write(frame);
    req.end();
  });
}

async function main() {
  const server = discoverServer();
  if (!server) { console.error('No server'); process.exit(1); }
  console.log(`Port ${server.port}, CSRF ${server.csrfToken.substring(0, 8)}...\n`);

  // Get idle cascade
  const ts = (await rpc(server, 'GetAllCascadeTrajectories')).trajectorySummaries || {};
  const idle = Object.entries(ts)
    .sort((a, b) => new Date(b[1].lastModifiedTime) - new Date(a[1].lastModifiedTime))
    .find(([, v]) => v.status === 'CASCADE_RUN_STATUS_IDLE');
  
  if (!idle) { console.error('No idle cascade'); process.exit(1); }
  const [cascadeId, info] = idle;
  const initialSteps = info.stepCount;
  console.log(`Cascade: "${info.summary}" (${cascadeId})`);
  console.log(`Steps: ${initialSteps}\n`);

  // Send message via grpc-web+json
  const prompt = process.argv[2] || 'say hi in chinese. one word only. nothing else.';
  console.log(`Sending: "${prompt}"\n`);

  const result = await grpcWebRequest(server, 'SendUserCascadeMessage', {
    cascadeId,
    items: [{ text: prompt }],
  });
  
  console.log(`Status: ${result.status}`);
  console.log(`Response size: ${result.rawLen} bytes`);
  console.log(`Frames: ${result.frames?.length || 0}`);
  for (const frame of (result.frames || [])) {
    console.log(`  [flag=0x${frame.flag.toString(16)}, trailer=${frame.isTrailer}]`);
    console.log(`  ${frame.payload.substring(0, 500)}`);
  }
  if (result.error) console.log(`Error: ${result.error}`);
  console.log(`\nHeaders:`, JSON.stringify(result.headers).substring(0, 500));

  // Poll for new steps
  console.log('\n⏳ Polling for response...');
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 2000));
    
    const newTs = (await rpc(server, 'GetAllCascadeTrajectories')).trajectorySummaries || {};
    const cur = newTs[cascadeId];
    if (!cur) continue;
    
    if (cur.stepCount > initialSteps) {
      console.log(`\n📝 ${cur.stepCount - initialSteps} new steps! Status: ${cur.status}`);
      
      const steps = await rpc(server, 'GetCascadeTrajectorySteps', {
        cascadeId,
        startIndex: initialSteps,
        endIndex: cur.stepCount,
      });
      
      for (const step of (steps.steps || [])) {
        console.log(`\n  [${step.type}]`);
        const s = JSON.stringify(step);
        console.log(`  ${s.substring(0, 800)}`);
      }
      
      if (cur.status === 'CASCADE_RUN_STATUS_IDLE') {
        console.log('\n✅ Done!');
        break;
      }
    } else {
      process.stdout.write('.');
    }
  }
  
  process.exit(0);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
