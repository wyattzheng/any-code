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

async function testModel(modelId) {
  const start = await rpc('StartCascade');
  const cid = start.cascadeId;
  
  const send = await rpc('SendUserCascadeMessage', {
    cascadeId: cid,
    items: [{ text: 'say hi' }],
    cascadeConfig: { plannerConfig: { planModel: modelId, maxOutputTokens: 8192 } }
  });
  if (send.code) return `ERR: ${send.message}`;
  
  // Wait for response
  for (let i = 0; i < 15; i++) {
    await sleep(1000);
    const traj = await rpc('GetAllCascadeTrajectories');
    const info = traj.trajectorySummaries && traj.trajectorySummaries[cid];
    if (info && (info.status || '').includes('IDLE') && (info.stepCount || 0) > 0) {
      const stepsRes = await rpc('GetCascadeTrajectorySteps', { cascadeId: cid });
      for (const s of (stepsRes.steps || [])) {
        if (s.plannerResponse && s.plannerResponse.response) {
          return s.plannerResponse.response.substring(0, 100);
        }
      }
      return 'done (no text)';
    }
  }
  return 'timeout';
}

async function main() {
  // Try different model IDs: 1008 is Gemini 3 Pro
  // Try: 1009, 1010, 1011, 1012, 1026 (M26?)
  const ids = [1009, 1010, 1011, 1012, 1026];
  for (const id of ids) {
    process.stdout.write(`Model ${id}: `);
    try {
      const result = await testModel(id);
      console.log(result);
    } catch (e) {
      console.log(`error: ${e.message}`);
    }
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
