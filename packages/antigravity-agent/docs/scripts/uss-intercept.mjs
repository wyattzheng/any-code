#!/usr/bin/env node
// TCP proxy to intercept USS traffic between Antigravity binary and extension server
// Run this, then start Antigravity. It will capture the actual USS protobuf data.
import http from 'http';
import net from 'net';

const TARGET_PORT = parseInt(process.argv[2]) || 0;
const LISTEN_PORT = parseInt(process.argv[3]) || 19877;

if (!TARGET_PORT) {
  console.log('Usage: node uss-intercept.mjs <target_ext_server_port> [listen_port]');
  console.log('Run Antigravity first, then:');
  console.log('  1. Find the real extension server port from binary logs');
  console.log('  2. Run: node uss-intercept.mjs <port>');
  process.exit(1);
}

// HTTP proxy that forwards requests to the real extension server
const proxy = http.createServer((req, res) => {
  const rpcPath = req.url || '';
  const ct = req.headers['content-type'] || '';
  
  let body = [];
  req.on('data', chunk => body.push(chunk));
  req.on('end', () => {
    const rawBody = Buffer.concat(body);
    
    if (rpcPath.includes('SubscribeToUnifiedStateSyncTopic')) {
      console.log(`\n=== SUBSCRIBE ${rpcPath} ===`);
      console.log('Content-Type:', ct);
      console.log('Request hex:', rawBody.toString('hex'));
      
      // Forward to real server and capture response
      const proxyReq = http.request({
        hostname: '127.0.0.1',
        port: TARGET_PORT,
        path: req.url,
        method: 'POST',
        headers: req.headers,
      }, (proxyRes) => {
        console.log('Response status:', proxyRes.statusCode);
        console.log('Response headers:', JSON.stringify(proxyRes.headers));
        
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        
        proxyRes.on('data', chunk => {
          console.log(`\n--- USS Response chunk (${chunk.length}b) ---`);
          console.log('Hex:', chunk.toString('hex'));
          // Parse envelope
          if (chunk.length >= 5) {
            const flags = chunk[0];
            const len = chunk.readUInt32BE(1);
            console.log('Envelope: flags=', flags, 'len=', len);
            const msg = chunk.slice(5, 5 + len);
            console.log('Message hex:', msg.toString('hex'));
            // Decode top-level proto fields
            decodeAndPrint(msg, '  ');
          }
          res.write(chunk);
        });
        proxyRes.on('end', () => res.end());
      });
      proxyReq.write(rawBody);
      proxyReq.end();
      return;
    }
    
    // Forward other requests transparently
    const proxyReq = http.request({
      hostname: '127.0.0.1',
      port: TARGET_PORT,
      path: req.url,
      method: req.method,
      headers: req.headers,
    }, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    });
    proxyReq.write(rawBody);
    proxyReq.end();
  });
});

function decodeAndPrint(buf, indent = '') {
  let offset = 0;
  while (offset < buf.length) {
    if (offset >= buf.length) break;
    const tag = buf[offset++];
    const fieldNum = tag >> 3;
    const wireType = tag & 0x07;
    
    if (wireType === 2) {
      let len = 0, shift = 0;
      do { const b = buf[offset++]; len |= (b & 0x7f) << shift; shift += 7; if (!(b & 0x80)) break; } while (offset < buf.length);
      const data = buf.slice(offset, offset + len);
      offset += len;
      const isText = data.length < 200 && data.every(b => b >= 0x20 && b <= 0x7e);
      if (isText) {
        console.log(`${indent}field ${fieldNum} (LEN): "${data.toString('utf8').substring(0, 100)}"`);
      } else {
        console.log(`${indent}field ${fieldNum} (LEN, ${len}b):`);
        try { decodeAndPrint(data, indent + '  '); } catch(e) { console.log(indent + '  [parse error]'); }
      }
    } else if (wireType === 0) {
      let val = 0, shift = 0;
      do { const b = buf[offset++]; val |= (b & 0x7f) << shift; shift += 7; if (!(b & 0x80)) break; } while (offset < buf.length);
      console.log(`${indent}field ${fieldNum} (VARINT): ${val}`);
    } else {
      console.log(`${indent}field ${fieldNum} (wire=${wireType}): ???`);
      break;
    }
  }
}

proxy.listen(LISTEN_PORT, () => {
  console.log(`🔍 USS Intercept Proxy: ${LISTEN_PORT} → ${TARGET_PORT}`);
  console.log('Now start the binary with --extension_server_port=' + LISTEN_PORT);
});
