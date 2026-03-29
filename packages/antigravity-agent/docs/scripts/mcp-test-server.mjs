#!/usr/bin/env node
/**
 * MCP server that handles BOTH newline-delimited JSON and Content-Length framing.
 * Go binary uses newline-delimited JSON (no Content-Length header).
 */
import fs from 'node:fs';
import { createInterface } from 'node:readline';

const LOG = '/tmp/mcp-test.log';
function log(msg) {
  fs.appendFileSync(LOG, `[${new Date().toISOString()}] ${msg}\n`);
}

log('MCP server started, PID=' + process.pid);

const TOOLS = [{
  name: 'get_weather',
  description: 'Get current weather for a city. Returns temperature and conditions.',
  inputSchema: {
    type: 'object',
    properties: { city: { type: 'string', description: 'City name' } },
    required: ['city'],
  },
}];

function handleRequest(req) {
  const { method, params, id } = req;
  log(`Handle: method=${method} id=${id}`);
  switch (method) {
    case 'initialize':
      return { jsonrpc: '2.0', id, result: { protocolVersion: '2025-06-18', capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'test-weather', version: '1.0.0' } } };
    case 'notifications/initialized':
      return null;
    case 'tools/list':
      return { jsonrpc: '2.0', id, result: { tools: TOOLS } };
    case 'tools/call': {
      const city = params?.arguments?.city || 'Unknown';
      log(`get_weather called: ${city}`);
      return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: `Weather in ${city}: 22°C, Sunny ☀️ (from custom MCP tool)` }] } };
    }
    default:
      log(`Unknown method: ${method}`);
      return { jsonrpc: '2.0', id, error: { code: -32601, message: `Unknown: ${method}` } };
  }
}

function sendResponse(resp) {
  const str = JSON.stringify(resp);
  log(`Response: ${str.substring(0, 300)}`);
  // Go binary uses newline-delimited JSON
  process.stdout.write(str + '\n');
}

// Read newline-delimited JSON from stdin
const rl = createInterface({ input: process.stdin });
rl.on('line', line => {
  log(`Line: ${line.substring(0, 300)}`);
  if (!line.trim()) return;
  try {
    const req = JSON.parse(line);
    const resp = handleRequest(req);
    if (resp) sendResponse(resp);
  } catch (e) {
    log(`Parse error: ${e.message}`);
  }
});

process.stdin.on('end', () => log('stdin ended'));
