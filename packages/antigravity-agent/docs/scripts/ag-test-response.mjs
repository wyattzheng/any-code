#!/usr/bin/env node
import https from 'node:https';

const port = 57480;
const csrf = '250b52cd-f01f-4811-bee9-c7cca15b9266';

function rpc(method, body = {}) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request({
      hostname: '127.0.0.1', port,
      path: `/exa.language_server_pb.LanguageServerService/${method}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-codeium-csrf-token': csrf, 'Content-Length': Buffer.byteLength(data), 'Connection': 'close' },
      rejectUnauthorized: false,
    }, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(d); } }); });
    req.on('error', reject);
    req.write(data); req.end();
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const prompt = process.argv[2] || 'say hello in chinese, one word only, nothing else';
  
  // Create cascade
  const start = await rpc('StartCascade');
  const cid = start.cascadeId;
  console.log(`Cascade: ${cid}\n`);

  // Send with requestedModel instead of planModel
  // The AI used MODEL_PLACEHOLDER_M26 in existing conversations.
  // Try using alias "auto" or model name directly.
  console.log(`💬 "${prompt}"\n`);
  const send = await rpc('SendUserCascadeMessage', {
    cascadeId: cid,
    items: [{ text: prompt }],
    cascadeConfig: {
      plannerConfig: {
        planModel: 1008,
        requestedModel: { alias: "auto" },
        conversational: { agenticMode: true },
        maxOutputTokens: 8192,
      },
      checkpointConfig: { maxOutputTokens: 8192 }
    }
  });
  
  if (send.code) { console.log(`❌ ${send.message}`); process.exit(1); }
  console.log('📨 Sent!\n');

  // Poll
  for (let i = 0; i < 60; i++) {
    await sleep(2000);
    const traj = await rpc('GetAllCascadeTrajectories');
    const info = traj.trajectorySummaries && traj.trajectorySummaries[cid];
    if (!info) continue;
    const idle = (info.status || '').includes('IDLE');
    process.stdout.write(idle ? '!' : '.');
    
    if (idle && (info.stepCount || 0) > 0) {
      console.log('\n');
      const stepsRes = await rpc('GetCascadeTrajectorySteps', { cascadeId: cid });
      for (const s of (stepsRes.steps || [])) {
        if (s.userInput) {
          const text = (s.userInput.items || []).map(x => x.text || '').join(' ');
          if (text) console.log(`👤 User: ${text}`);
        }
        if (s.plannerResponse) {
          console.log(`🤖 AI: ${(s.plannerResponse.response || '').substring(0, 1000)}`);
        }
      }
      break;
    }
  }
  process.exit(0);
}
main().catch(e => { console.error('Fatal:', e); process.exit(1); });
