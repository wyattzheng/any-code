#!/usr/bin/env node
/**
 * MITM HTTP Proxy for Antigravity Extension Server traffic.
 * 
 * Usage:
 *   1. Start real Antigravity app (it starts extension server + Go binary)
 *   2. Find the real extension server port from Go binary's --extension_server_port arg
 *   3. Start this proxy: node mitm-proxy.mjs <real_ext_server_port>
 *   4. Start your own Go binary with --extension_server_port=<proxy_port>
 *   5. The proxy logs all traffic and forwards to real extension server
 */
import http from 'http';
import { Buffer } from 'buffer';

const REAL_PORT = parseInt(process.argv[2] || '0');
const PROXY_PORT = parseInt(process.argv[3] || '19400');

if (!REAL_PORT) {
  console.error('Usage: node mitm-proxy.mjs <real_extension_server_port> [proxy_port]');
  console.error('\nTo find the real port:');
  console.error('  ps aux | grep language_server_macos_arm | grep extension_server_port');
  process.exit(1);
}

function hexDump(buf, maxLen = 100) {
  return buf.subarray(0, maxLen).toString('hex').replace(/(.{2})/g, '$1 ').trim() + (buf.length > maxLen ? '...' : '');
}

function decodeConnectEnvelopes(buf) {
  const frames = [];
  let pos = 0;
  while (pos + 5 <= buf.length) {
    const flags = buf[pos];
    const len = buf.readUInt32BE(pos + 1);
    if (pos + 5 + len > buf.length) break;
    frames.push({ flags, body: buf.subarray(pos + 5, pos + 5 + len) });
    pos += 5 + len;
  }
  return frames;
}

function protoSummary(buf, depth = 0, maxDepth = 5) {
  if (depth > maxDepth) return ['  '.repeat(depth) + '...'];
  const lines = [];
  let pos = 0;
  while (pos < buf.length) {
    if (pos >= buf.length) break;
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
      lines.push('  '.repeat(depth) + `f${fieldNum}: varint(${val})`);
    } else if (wireType === 2) { // LEN
      let len = 0; let shift = 0;
      while (pos < buf.length) {
        const b = buf[pos++];
        len |= (b & 0x7f) << shift;
        if (!(b & 0x80)) break;
        shift += 7;
      }
      if (pos + len > buf.length) { lines.push('  '.repeat(depth) + `f${fieldNum}: TRUNCATED`); break; }
      const data = buf.subarray(pos, pos + len);
      pos += len;
      
      const isPrintable = data.length > 0 && data.length < 500 && data.every(b => (b >= 0x20 && b <= 0x7e) || b === 0x0a || b === 0x0d);
      
      if (isPrintable) {
        const str = data.toString('utf8').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
        lines.push('  '.repeat(depth) + `f${fieldNum}: "${str.substring(0, 120)}${str.length > 120 ? '...' : ''}"`);
      } else {
        lines.push('  '.repeat(depth) + `f${fieldNum}: bytes[${data.length}]`);
        try {
          const nested = protoSummary(data, depth + 1, maxDepth);
          if (nested.length > 0 && nested.length < 20) lines.push(...nested);
        } catch(e) {}
      }
    } else if (wireType === 5) { // 32-bit
      pos += 4;
      lines.push('  '.repeat(depth) + `f${fieldNum}: fixed32`);
    } else if (wireType === 1) { // 64-bit
      pos += 8;
      lines.push('  '.repeat(depth) + `f${fieldNum}: fixed64`);
    } else {
      lines.push('  '.repeat(depth) + `f${fieldNum}: wireType${wireType}(unknown)`);
      break;
    }
  }
  return lines;
}

let reqCounter = 0;

const server = http.createServer((proxyReq, proxyRes) => {
  const id = ++reqCounter;
  const rpcPath = proxyReq.url || '';
  const ct = proxyReq.headers['content-type'] || '';
  const isStream = rpcPath.includes('Subscribe') || rpcPath.includes('Stream');
  
  console.log(`\n${'─'.repeat(80)}`);
  console.log(`[${id}] ➡️  ${proxyReq.method} ${rpcPath}`);
  console.log(`[${id}]    Content-Type: ${ct}`);
  
  // Collect request body
  let reqBody = [];
  proxyReq.on('data', chunk => reqBody.push(chunk));
  proxyReq.on('end', () => {
    const reqBuf = Buffer.concat(reqBody);
    
    // Log request
    if (reqBuf.length > 0) {
      console.log(`[${id}]    Request body: ${reqBuf.length} bytes`);
      const frames = decodeConnectEnvelopes(reqBuf);
      for (let i = 0; i < frames.length; i++) {
        console.log(`[${id}]    Frame[${i}]: flags=${frames[i].flags} len=${frames[i].body.length}`);
        const summary = protoSummary(frames[i].body);
        for (const line of summary) console.log(`[${id}]      ${line}`);
      }
      if (frames.length === 0) {
        // Try raw proto
        const summary = protoSummary(reqBuf);
        for (const line of summary) console.log(`[${id}]      ${line}`);
      }
    }
    
    // Forward to real extension server
    const fwdReq = http.request({
      hostname: '127.0.0.1',
      port: REAL_PORT,
      path: rpcPath,
      method: proxyReq.method,
      headers: { ...proxyReq.headers, host: `127.0.0.1:${REAL_PORT}` },
    }, (fwdRes) => {
      console.log(`[${id}] ⬅️  Response: ${fwdRes.statusCode}`);
      for (const [k, v] of Object.entries(fwdRes.headers)) {
        console.log(`[${id}]    ${k}: ${v}`);
      }
      
      // Forward response headers
      proxyRes.writeHead(fwdRes.statusCode, fwdRes.headers);
      
      if (isStream) {
        console.log(`[${id}] 🔄 STREAMING response...`);
        let streamBuf = Buffer.alloc(0);
        
        fwdRes.on('data', chunk => {
          streamBuf = Buffer.concat([streamBuf, chunk]);
          
          // Try to decode complete envelope frames
          let pos = 0;
          while (pos + 5 <= streamBuf.length) {
            const flags = streamBuf[pos];
            const len = streamBuf.readUInt32BE(pos + 1);
            if (pos + 5 + len > streamBuf.length) break;  // Incomplete frame
            
            const frameBody = streamBuf.subarray(pos + 5, pos + 5 + len);
            console.log(`\n[${id}] 🔄 Stream frame: flags=${flags} len=${len}`);
            const summary = protoSummary(frameBody);
            for (const line of summary) console.log(`[${id}]      ${line}`);
            
            // SPECIAL: for USS updates, decode Row.value as base64 proto
            // Look for base64-like strings in the proto
            decodePossibleBase64Values(id, frameBody);
            
            pos += 5 + len;
          }
          if (pos > 0) streamBuf = streamBuf.subarray(pos);
          
          // Forward data to client
          proxyRes.write(chunk);
        });
        
        fwdRes.on('end', () => {
          console.log(`[${id}] 🔄 Stream ended`);
          proxyRes.end();
        });
      } else {
        // Non-streaming: collect full response
        let resBuf = [];
        fwdRes.on('data', chunk => resBuf.push(chunk));
        fwdRes.on('end', () => {
          const resBody = Buffer.concat(resBuf);
          if (resBody.length > 0) {
            console.log(`[${id}]    Response body: ${resBody.length} bytes`);
            const frames = decodeConnectEnvelopes(resBody);
            if (frames.length > 0) {
              for (let i = 0; i < frames.length; i++) {
                console.log(`[${id}]    Frame[${i}]: flags=${frames[i].flags} len=${frames[i].body.length}`);
                const summary = protoSummary(frames[i].body);
                for (const line of summary) console.log(`[${id}]      ${line}`);
              }
            } else {
              // Raw body
              const ct = fwdRes.headers['content-type'] || '';
              if (ct.includes('json')) {
                try { console.log(`[${id}]    JSON: ${resBody.toString('utf8').substring(0, 200)}`); } catch {}
              } else {
                const summary = protoSummary(resBody);
                for (const line of summary) console.log(`[${id}]      ${line}`);
              }
            }
          }
          proxyRes.end(resBody);
        });
      }
    });
    
    fwdReq.on('error', (err) => {
      console.log(`[${id}] ❌ Forward error: ${err.message}`);
      proxyRes.writeHead(502);
      proxyRes.end('Proxy error');
    });
    
    fwdReq.write(reqBuf);
    fwdReq.end();
  });
});

function decodePossibleBase64Values(id, buf) {
  // Walk the proto looking for string values that look like base64
  let pos = 0;
  while (pos < buf.length) {
    const byte = buf[pos];
    const fieldNum = byte >> 3;
    const wireType = byte & 0x07;
    pos++;
    
    if (wireType === 0) {
      while (pos < buf.length && buf[pos] & 0x80) pos++;
      pos++;
    } else if (wireType === 2) {
      let len = 0; let shift = 0;
      while (pos < buf.length) {
        const b = buf[pos++];
        len |= (b & 0x7f) << shift;
        if (!(b & 0x80)) break;
        shift += 7;
      }
      if (pos + len > buf.length) break;
      const data = buf.subarray(pos, pos + len);
      pos += len;
      
      // Check if it looks like base64
      const str = data.toString('utf8');
      if (/^[A-Za-z0-9+/=]{8,}$/.test(str)) {
        try {
          const decoded = Buffer.from(str, 'base64');
          console.log(`[${id}]    🔑 Base64 value (field ${fieldNum}): decoded ${decoded.length} bytes`);
          const innerSummary = protoSummary(decoded, 2);
          for (const line of innerSummary) console.log(`[${id}]      ${line}`);
        } catch(e) {}
      }
      
      // Recurse into nested messages
      decodePossibleBase64Values(id, data);
    } else {
      break;
    }
  }
}

server.listen(PROXY_PORT, () => {
  console.log(`🔍 MITM Proxy listening on port ${PROXY_PORT}`);
  console.log(`   Forwarding to real extension server at port ${REAL_PORT}`);
  console.log(`\n   Start Go binary with: --extension_server_port=${PROXY_PORT}`);
});
