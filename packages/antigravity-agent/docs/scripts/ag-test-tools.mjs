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

async function test(label, cascadeConfig, question) {
  const start = await rpc('StartCascade');
  const cid = start.cascadeId;
  console.log(`\n${'='.repeat(60)}\n🧪 ${label}\n${'='.repeat(60)}`);
  const send = await rpc('SendUserCascadeMessage', { cascadeId: cid, items: [{ text: question }], cascadeConfig });
  if (send.code) { console.log(`   ❌ ${send.message}`); return; }
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    const traj = await rpc('GetAllCascadeTrajectories');
    const info = traj.trajectorySummaries && traj.trajectorySummaries[cid];
    if (info && (info.status || '').includes('IDLE') && (info.stepCount || 0) > 0) {
      const stepsRes = await rpc('GetCascadeTrajectorySteps', { cascadeId: cid });
      for (const s of (stepsRes.steps || [])) {
        if (s.plannerResponse && s.plannerResponse.response)
          console.log(`🤖 ${s.plannerResponse.response.substring(0, 800)}`);
      }
      return;
    }
    process.stdout.write('.');
  }
  console.log('   ⏰ timeout');
}

const BASE = { planModel: 1026, maxOutputTokens: 8192 };
const Q = 'List ALL tool names. Output ONLY a numbered list.';

async function main() {
  // Test: customAgentConfigAbsoluteUri
  await test('customAgentConfigAbsoluteUri', {
    plannerConfig: {
      ...BASE,
      customAgentConfigAbsoluteUri: '/tmp/test-agent2.json',
    },
  }, Q);

  // Test: SdkCustomizationConfig approach — useOnlyOverrideTools
  // SdkCustomizationConfig might be a sub-message of customizationConfig
  // with toolOverrides and useOnlyOverrideTools
  await test('Customization with toolOverrides + useOnlyOverrideTools', {
    plannerConfig: {
      ...BASE,
      customizationConfig: {
        useOnlyOverrideTools: true,
        toolOverrides: {
          'get_weather': {
            nameOverride: 'get_weather',
            descriptionOverride: 'Get weather for a city',
          }
        },
        mcpServers: [{
          serverName: 'test-weather',
          command: 'node',
          args: ['/Users/zhenghuaiyu/any-code/.dev/mcp-test-server.mjs'],
        }],
      },
    },
  }, Q);

  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
