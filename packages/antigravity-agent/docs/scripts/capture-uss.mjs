#!/usr/bin/env node
/**
 * Directly subscribe to USS topic on real Antigravity extension server
 * and capture the response format.
 */
import http from 'http';
import { Buffer } from 'buffer';

const EXT_PORT = parseInt(process.argv[2] || '52858');
const EXT_CSRF = process.argv[3] || '39d23fe0-212a-4c39-b34e-f12ab22f2ab4';
const TOPIC = process.argv[4] || 'uss-oauth';

// Manual proto encoding
function protoEncodeBytes(fn, buf) {
  const tag = Buffer.from([(fn << 3) | 2]);
  let len = buf.length;
  const lb = [];
  while (len > 0x7f) { lb.push((len & 0x7f) | 0x80); len >>= 7; }
  lb.push(len & 0x7f);
  return Buffer.concat([tag, Buffer.from(lb), buf]);
}
function protoEncodeString(fn, str) { return protoEncodeBytes(fn, Buffer.from(str, 'utf8')); }

function encodeEnvelope(protoBuf, flags = 0) {
  const header = Buffer.alloc(5);
  header.writeUInt8(flags, 0);
  header.writeUInt32BE(protoBuf.length, 1);
  return Buffer.concat([header, protoBuf]);
}

function protoSummary(buf, depth = 0, maxDepth = 6) {
  if (depth > maxDepth) return ['  '.repeat(depth) + '...'];
  const lines = [];
  let pos = 0;
  while (pos < buf.length) {
    if (pos >= buf.length) break;
    const byte = buf[pos];
    const fieldNum = byte >> 3;
    const wireType = byte & 0x07;
    pos++;
    
    if (wireType === 0) {
      let val = 0n; let shift = 0n;
      while (pos < buf.length) {
        const b = buf[pos++];
        val |= BigInt(b & 0x7f) << shift;
        if (!(b & 0x80)) break;
        shift += 7n;
      }
      lines.push('  '.repeat(depth) + `field_${fieldNum}: varint(${val})`);
    } else if (wireType === 2) {
      let len = 0; let shift = 0;
      while (pos < buf.length) {
        const b = buf[pos++];
        len |= (b & 0x7f) << shift;
        if (!(b & 0x80)) break;
        shift += 7;
      }
      if (pos + len > buf.length) { lines.push('  '.repeat(depth) + `field_${fieldNum}: TRUNCATED`); break; }
      const data = buf.subarray(pos, pos + len);
      pos += len;
      
      const isPrintable = data.length > 0 && data.length < 1000 && data.every(b => (b >= 0x20 && b <= 0x7e) || b === 0x0a || b === 0x0d);
      
      if (isPrintable) {
        const str = data.toString('utf8').replace(/\n/g, '\\n');
        lines.push('  '.repeat(depth) + `field_${fieldNum}: "${str.substring(0, 200)}${str.length > 200 ? '...' : ''}"`);
        
        // Check if it's base64
        if (/^[A-Za-z0-9+/=]{12,}$/.test(str)) {
          try {
            const decoded = Buffer.from(str, 'base64');
            lines.push('  '.repeat(depth) + `  ↳ BASE64 DECODED (${decoded.length} bytes):`);
            const inner = protoSummary(decoded, depth + 2, maxDepth);
            lines.push(...inner);
          } catch(e) {}
        }
      } else {
        lines.push('  '.repeat(depth) + `field_${fieldNum}: bytes[${data.length}]`);
        const nested = protoSummary(data, depth + 1, maxDepth);
        if (nested.length > 0 && nested.length < 30) lines.push(...nested);
      }
    } else if (wireType === 5) { pos += 4; lines.push('  '.repeat(depth) + `field_${fieldNum}: fixed32`); }
    else if (wireType === 1) { pos += 8; lines.push('  '.repeat(depth) + `field_${fieldNum}: fixed64`); }
    else { lines.push('  '.repeat(depth) + `field_${fieldNum}: wireType${wireType}`); break; }
  }
  return lines;
}

console.log(`📡 Subscribing to topic "${TOPIC}" on extension server port ${EXT_PORT}`);

// Build request: SubscribeToUnifiedStateSyncTopicRequest { topic: "uss-oauth" }
const reqBody = protoEncodeString(1, TOPIC);
const envelope = encodeEnvelope(reqBody);

const req = http.request({
  hostname: '127.0.0.1',
  port: EXT_PORT,
  path: '/exa.extension_server_pb.ExtensionServerService/SubscribeToUnifiedStateSyncTopic',
  method: 'POST',
  headers: {
    'Content-Type': 'application/connect+proto',
    'Connect-Protocol-Version': '1',
    'x-codeium-csrf-token': EXT_CSRF,
  },
}, (res) => {
  console.log(`\n📥 Response: ${res.statusCode}`);
  for (const [k, v] of Object.entries(res.headers)) {
    console.log(`   ${k}: ${v}`);
  }
  
  let streamBuf = Buffer.alloc(0);
  let frameCount = 0;
  
  res.on('data', (chunk) => {
    streamBuf = Buffer.concat([streamBuf, chunk]);
    
    // Try to decode complete envelope frames
    let pos = 0;
    while (pos + 5 <= streamBuf.length) {
      const flags = streamBuf[pos];
      const len = streamBuf.readUInt32BE(pos + 1);
      if (pos + 5 + len > streamBuf.length) break;
      
      const frameBody = streamBuf.subarray(pos + 5, pos + 5 + len);
      frameCount++;
      console.log(`\n${'='.repeat(60)}`);
      console.log(`📦 Frame #${frameCount}: flags=${flags} len=${len}`);
      console.log(`   Hex: ${frameBody.toString('hex').substring(0, 200)}${len > 100 ? '...' : ''}`);
      
      const summary = protoSummary(frameBody);
      for (const line of summary) console.log(`   ${line}`);
      
      pos += 5 + len;
      
      // Stop after getting a few frames
      if (frameCount >= 3) {
        console.log('\n✅ Captured enough frames, closing...');
        req.destroy();
        process.exit(0);
      }
    }
    if (pos > 0) streamBuf = streamBuf.subarray(pos);
  });
  
  res.on('end', () => {
    console.log('\n📴 Stream ended');
    process.exit(0);
  });
});

req.on('error', (err) => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});

req.write(envelope);
req.end();

// Timeout after 10 seconds
setTimeout(() => {
  console.log('\n⏰ Timeout');
  process.exit(0);
}, 10000);
