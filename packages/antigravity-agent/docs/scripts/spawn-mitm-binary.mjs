#!/usr/bin/env node
// Spawn Go binary connecting to MITM proxy for traffic capture
import net from 'net';
import { spawn } from 'child_process';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

const BINARY = '/Applications/Antigravity.app/Contents/Resources/app/extensions/antigravity/bin/language_server_macos_arm';
const PROXY_PORT = parseInt(process.argv[2] || '19400');
const EXT_CSRF = process.argv[3] || 'test-csrf';
const PIPE_PATH = path.join(os.tmpdir(), `ag_mitm_${crypto.randomBytes(4).toString('hex')}`);
const CSRF = crypto.randomUUID();

console.log('Starting pipe server at', PIPE_PATH);
const pipeServer = net.createServer(conn => {
  console.log('Pipe connected');
});

pipeServer.listen(PIPE_PATH, () => {
  console.log('Spawning binary → proxy port', PROXY_PORT);
  const child = spawn(BINARY, [
    `--csrf_token=${CSRF}`,
    `--workspace_id=test-workspace`,
    `--extension_server_port=${PROXY_PORT}`,
    `--extension_server_csrf_token=${EXT_CSRF}`,
    `--parent_pipe_path=${PIPE_PATH}`,
  ], { stdio: ['pipe', 'pipe', 'pipe'] });

  child.stdout.on('data', d => process.stdout.write(d));
  child.stderr.on('data', d => {
    const text = d.toString();
    for (const line of text.split('\n').filter(l => l.trim())) {
      console.log(`📝 ${line.trim().substring(0, 250)}`);
    }
  });

  child.stdin.write(Buffer.from([0x0a, 0x04, 0x74, 0x65, 0x73, 0x74]));
  child.stdin.end();

  child.on('exit', (code) => {
    console.log('Binary exited with code', code);
    pipeServer.close();
    process.exit(0);
  });

  // Keep alive for 60 seconds
  setTimeout(() => {
    console.log('Timeout - killing binary');
    child.kill();
  }, 60000);
});
