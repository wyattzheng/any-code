#!/usr/bin/env node
/**
 * Antigravity Language Server Client — Working Version
 * 
 * Key: SendUserCascadeMessage requires cascadeConfig.plannerConfig.planModel = 1026
 * Without it, the Go handler panics at rpcs_cascade.go:515 (nil pointer)
 * Model 1008 = Gemini 3 Pro (deprecated), 1026 = MODEL_PLACEHOLDER_M26 (working)
 * 
 * Usage: node ag-client.mjs "your message"
 */
import https from 'node:https';
import { execSync } from 'node:child_process';

function discoverServer() {
  try {
    const ps = execSync('ps aux | grep language_server_macos | grep csrf_token | grep -v grep', { encoding: 'utf8' });
    for (const line of ps.trim().split('\n')) {
      if (!line) continue;
      const csrf = line.match(/--csrf_token\s+(\S+)/)?.[1];
      if (!csrf) continue;
      const portMatch = line.match(/--server_port\s+(\d+)/);
      if (portMatch) return { port: +portMatch[1], csrfToken: csrf };
      const pid = line.trim().split(/\s+/)[1];
      if (pid) {
        try {
          const lsof = execSync(`lsof -i -P -n -a -p ${pid} 2>/dev/null | grep LISTEN`, { encoding: 'utf8' });
          const ports = [...lsof.matchAll(/:(\d+)\s+\(LISTEN\)/g)].map(m => +m[1]);
          if (ports.length > 0) return { port: ports[0], csrfToken: csrf, allPorts: ports };
        } catch {}
      }
    }
  } catch {}
  return null;
}

function rpc(server, method, body = {}) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request({
      hostname: '127.0.0.1', port: server.port,
      path: `/exa.language_server_pb.LanguageServerService/${method}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-codeium-csrf-token': server.csrfToken, 'Content-Length': Buffer.byteLength(data), 'Connection': 'close' },
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

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const prompt = process.argv[2] || 'say hello';
  const server = discoverServer();
  if (!server) { console.error('❌ No server found'); process.exit(1); }
  console.log(`🔍 Server: port ${server.port}, CSRF ${server.csrfToken.substring(0, 8)}...\n`);

  // List cascades
  const traj = await rpc(server, 'GetAllCascadeTrajectories');
  const entries = Object.entries(traj.trajectorySummaries || {})
    .sort((a, b) => new Date(b[1].lastModifiedTime) - new Date(a[1].lastModifiedTime));
  
  const idle = entries.find(([, v]) => v.status === 'CASCADE_RUN_STATUS_IDLE');
  if (!idle) { console.error('❌ No idle cascade found'); process.exit(1); }
  const [cascadeId, info] = idle;
  const initialSteps = info.stepCount;
  console.log(`📋 "${info.summary}" (steps: ${initialSteps})\n`);

  // Send message — MUST include cascadeConfig with planModel!
  console.log(`💬 Sending: "${prompt}"`);
  const sendResult = await rpc(server, 'SendUserCascadeMessage', {
    cascadeId,
    items: [{ text: prompt }],
    cascadeConfig: {
      plannerConfig: {
        planModel: 1026,
        conversational: { agenticMode: true },
        maxOutputTokens: 8192,
      },
      checkpointConfig: { maxOutputTokens: 8192 }
    }
  });
  
  if (sendResult.code) {
    console.log(`❌ Error: ${sendResult.message}`);
    process.exit(1);
  }
  console.log('📨 Sent! Polling for response...\n');

  // Poll for response
  for (let i = 0; i < 120; i++) {
    await sleep(2000);
    try {
      const status = await rpc(server, 'GetAllCascadeTrajectories');
      const cur = status.trajectorySummaries?.[cascadeId];
      if (!cur) { process.stdout.write('?'); continue; }
      
      if (cur.stepCount > initialSteps) {
        const newSteps = cur.stepCount - initialSteps;
        const isIdle = cur.status === 'CASCADE_RUN_STATUS_IDLE';
        console.log(`\n📝 ${newSteps} new step(s) [${isIdle ? 'done' : 'running'}]`);
        
        if (isIdle) {
          // Fetch new steps
          const stepsRes = await rpc(server, 'GetCascadeTrajectorySteps', {
            cascadeId,
            startIndex: initialSteps,
            endIndex: cur.stepCount,
          });
          
          let found = false;
          for (const step of (stepsRes.steps || [])) {
            const content = step.content || {};
            const type = step.type || '';
            
            if (type.includes('PLANNER_RESPONSE') && content.plannerResponse?.rawText) {
              console.log(`\n🤖 AI Response:\n${content.plannerResponse.rawText}`);
              found = true;
            }
            if (type.includes('USER_INPUT') && content.userInput?.items) {
              const text = content.userInput.items.map(i => i.text).join(' ');
              if (text) console.log(`👤 User: ${text}`);
            }
          }
          
          if (!found) {
            console.log('(No text response in steps — AI may have performed tool actions)');
          }
          
          console.log('\n✅ Complete!');
          break;
        }
      } else {
        process.stdout.write('.');
      }
    } catch { process.stdout.write('!'); }
  }
  
  process.exit(0);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
