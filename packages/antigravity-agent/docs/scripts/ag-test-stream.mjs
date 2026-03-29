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

async function test(label, cascadeConfig) {
  const start = await rpc('StartCascade');
  const cid = start.cascadeId;
  console.log(`\n${'='.repeat(60)}\n🧪 ${label}\n${'='.repeat(60)}`);
  console.log('cascade:', cid);

  await rpc('SendUserCascadeMessage', {
    cascadeId: cid,
    items: [{ text: 'List the files in /Users/zhenghuaiyu/any-code/packages/ directory using list_dir. Then say done.' }],
    cascadeConfig,
  });

  let seenTypes = new Set();
  for (let i = 0; i < 80; i++) {
    await sleep(250);
    const traj = await rpc('GetAllCascadeTrajectories');
    const info = traj.trajectorySummaries?.[cid];
    const status = info?.status || '';
    
    const stepsRes = await rpc('GetCascadeTrajectorySteps', { cascadeId: cid });
    for (const s of (stepsRes.steps || [])) {
      const type = (s.type || '').replace('CORTEX_STEP_TYPE_', '');
      const stepStatus = (s.status || '').replace('CORTEX_STEP_STATUS_', '');
      const key = `${type}-${stepStatus}`;
      if (!seenTypes.has(key)) {
        seenTypes.add(key);
        const ts = ((i+1)*250/1000).toFixed(1);
        console.log(`[${ts}s] ${type} → ${stepStatus}`);
        if (s.metadata?.toolCall) {
          console.log(`       🔧 ${s.metadata.toolCall.name}(${(s.metadata.toolCall.argumentsJson||'').substring(0, 100)})`);
        }
        if (type === 'LIST_DIRECTORY' && s.listDirectory?.result) {
          console.log(`       📁 result: ${JSON.stringify(s.listDirectory.result).substring(0, 150)}`);
        }
        if (s.plannerResponse?.response) {
          console.log(`       💬 ${s.plannerResponse.response.substring(0, 150)}`);
        }
      }
    }
    
    if (status.includes('IDLE') && (info?.stepCount || 0) > 0) {
      console.log(`✅ Done at ${((i+1)*250/1000).toFixed(1)}s`);
      return;
    }
  }
  console.log('⏰ Timeout');
}

async function main() {
  const BASE = { planModel: 1026, maxOutputTokens: 4096 };

  // Test: cascadeCanAutoRunCommands + allowAutoRunCommands
  await test('cascadeCanAutoRunCommands + allowAutoRunCommands', {
    plannerConfig: {
      ...BASE,
      cascadeCanAutoRunCommands: true,
      toolConfig: {
        runCommand: { allowAutoRunCommands: true, enableModelAutoRun: true },
      },
    },
  });

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
