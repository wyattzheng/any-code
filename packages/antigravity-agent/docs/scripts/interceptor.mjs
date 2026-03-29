#!/usr/bin/env node
/**
 * HTTP interceptor proxy for Antigravity extension server traffic.
 * Sits between the Go binary and a dummy HTTP server, logging all traffic.
 * 
 * Usage: Set up an actual Antigravity extension server, then proxy it.
 * Or: Just intercept the Go binary's requests to see what it sends/expects.
 */
import http from 'http';
import { Buffer } from 'buffer';

const PROXY_PORT = parseInt(process.argv[2] || '19315');
const TARGET_PORT = parseInt(process.argv[3] || '0');

function hexDump(buf, maxLen = 200) {
  const hex = buf.toString('hex').substring(0, maxLen * 2);
  return hex.replace(/(.{2})/g, '$1 ').trim();
}

function decodeEnvelope(buf) {
  if (buf.length < 5) return null;
  const flags = buf[0];
  const len = buf.readUInt32BE(1);
  if (buf.length < 5 + len) return null;
  return { flags, len, body: buf.subarray(5, 5 + len) };
}

// Simple proto decoder for human-readable output
function protoSummary(buf, depth = 0) {
  const lines = [];
  let pos = 0;
  while (pos < buf.length) {
    const byte = buf[pos];
    const fieldNum = byte >> 3;
    const wireType = byte & 0x07;
    pos++;
    
    if (wireType === 0) { // varint
      let val = 0n; let shift = 0n;
      while (pos < buf.length) {
        const b = buf[pos++];
        val |= BigInt(b & 0x7f) << shift;
        if (!(b & 0x80)) break;
        shift += 7n;
      }
      lines.push('  '.repeat(depth) + `field ${fieldNum}: varint ${val}`);
    } else if (wireType === 2) { // LEN
      let len = 0; let shift = 0;
      while (pos < buf.length) {
        const b = buf[pos++];
        len |= (b & 0x7f) << shift;
        if (!(b & 0x80)) break;
        shift += 7;
      }
      const data = buf.subarray(pos, pos + len);
      pos += len;
      
      // Try to detect if it's a nested message, string, or binary
      const isUtf8 = isValidUtf8(data);
      const isPrintable = data.every(b => (b >= 0x20 && b <= 0x7e) || b === 0x0a || b === 0x0d);
      
      if (isPrintable && data.length > 0 && data.length < 500) {
        lines.push('  '.repeat(depth) + `field ${fieldNum}: string "${data.toString('utf8').replace(/\n/g, '\\n')}"`);
      } else {
        lines.push('  '.repeat(depth) + `field ${fieldNum}: bytes[${data.length}]`);
        // Try nested proto
        try {
          const nested = protoSummary(data, depth + 1);
          if (nested.length > 0) {
            lines.push(...nested);
          }
        } catch(e) {}
      }
    } else {
      lines.push('  '.repeat(depth) + `field ${fieldNum}: wireType ${wireType} (unknown)`);
      break;
    }
  }
  return lines;
}

function isValidUtf8(buf) {
  try { new TextDecoder('utf-8', { fatal: true }).decode(buf); return true; } catch { return false; }
}

const server = http.createServer((req, res) => {
  const rpcPath = req.url || '';
  const ct = req.headers['content-type'] || '';
  console.log(`\n${'='.repeat(80)}`);
  console.log(`📥 ${req.method} ${rpcPath} [${ct}]`);
  
  let body = [];
  req.on('data', chunk => body.push(chunk));
  req.on('end', () => {
    const rawBody = Buffer.concat(body);
    console.log(`   Request body: ${rawBody.length} bytes`);
    
    // Decode request envelope
    const env = decodeEnvelope(rawBody);
    if (env) {
      console.log(`   Envelope: flags=${env.flags} len=${env.len}`);
      const summary = protoSummary(env.body);
      for (const line of summary) console.log(`   ${line}`);
    }
    
    if (rpcPath.includes('SubscribeToUnifiedStateSyncTopic')) {
      console.log('\n   🎯 USS SUBSCRIBE DETECTED!');
      res.writeHead(200, {
        'Content-Type': 'application/connect+proto',
        'Transfer-Encoding': 'chunked',
      });
      // Just keep the stream open, don't respond
      console.log('   Keeping stream open...');
      return;
    }
    
    // Return empty success for all other RPCs
    res.writeHead(200, { 'Content-Type': ct || 'application/proto' });
    res.end(Buffer.alloc(0));
    console.log(`   Responded: 200 (empty)`);
  });
});

server.listen(PROXY_PORT, () => {
  console.log(`🔍 Interceptor proxy on port ${PROXY_PORT}`);
  console.log(`   Start Go binary with --extension_server_port=${PROXY_PORT}`);
});
