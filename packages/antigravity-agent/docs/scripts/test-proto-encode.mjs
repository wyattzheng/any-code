// Auto-load all proto file descriptors from extension.js with dependency resolution
import { create, toBinary, fromBinary } from '@bufbuild/protobuf';
import { fileDesc, messageDesc } from '@bufbuild/protobuf/codegenv1';
import * as wkt from '@bufbuild/protobuf/wkt';
import { readFileSync } from 'fs';

const extSrc = readFileSync('/Applications/Antigravity.app/Contents/Resources/app/extensions/antigravity/dist/extension.js', 'utf8');

// Extract ALL file descriptors with their dependency variable names
const regex = /(\w+)=\(0,\w+\.fileDesc\)\("([A-Za-z0-9+/=]+)"(?:,\[([^\]]*)\])?\)/g;
let match;
const allDescs = {};
while ((match = regex.exec(extSrc)) !== null) {
  const name = match[1];
  const b64 = match[2];
  const depsStr = match[3] || '';
  // Parse deps, strip module prefixes like "o." or "t."
  const deps = depsStr ? depsStr.split(',').map(s => {
    const trimmed = s.trim();
    // Remove module prefix (e.g., "o.file_exa_..." → "file_exa_...")
    const dotIdx = trimmed.lastIndexOf('.');
    return dotIdx >= 0 ? trimmed.substring(dotIdx + 1) : trimmed;
  }).filter(s => s.length > 0) : [];
  allDescs[name] = { b64, deps, loaded: null };
}

console.log(`Found ${Object.keys(allDescs).length} file descriptors`);

// Add google WKT file descriptors from @bufbuild/protobuf/wkt
const wktMap = {};
for (const [name, value] of Object.entries(wkt)) {
  if (name.startsWith('file_')) {
    wktMap[name] = value;
  }
}
console.log(`Available WKTs: ${Object.keys(wktMap).length}`);

// Load all descriptors with dependency resolution
function loadDesc(name) {
  if (wktMap[name]) return wktMap[name];
  if (!allDescs[name]) {
    console.log(`  ⚠️ Not found: ${name}`);
    return null;
  }
  if (allDescs[name].loaded) return allDescs[name].loaded;
  
  const depFiles = [];
  for (const depName of allDescs[name].deps) {
    const dep = loadDesc(depName);
    if (dep) depFiles.push(dep);
  }
  
  try {
    allDescs[name].loaded = fileDesc(allDescs[name].b64, depFiles);
    return allDescs[name].loaded;
  } catch (e) {
    console.log(`  ⚠️ Failed to load ${name}: ${e.message}`);
    return null;
  }
}

// Load USS proto
console.log('\n=== Loading USS proto ===');
const ussFile = loadDesc('file_exa_unified_state_sync_pb_unified_state_sync');
if (!ussFile) {
  console.error('Failed to load USS proto!');
  process.exit(1);
}

console.log('✅ USS proto loaded');

// Get schemas
const TopicSchema = messageDesc(ussFile, 0);
const RowSchema = messageDesc(ussFile, 1);
const AppliedUpdateSchema = messageDesc(ussFile, 2);

console.log('Topic:', TopicSchema.typeName);
console.log('Row:', RowSchema.typeName);

// Show fields
console.log('\nTopic fields:');
for (const f of TopicSchema.fields) {
  console.log(`  ${f.number}: ${f.name} (${f.kind}${f.mapKey ? ', map' : ''})`);
}
console.log('\nRow fields:');
for (const f of RowSchema.fields) {
  console.log(`  ${f.number}: ${f.name} (${f.kind})`);
}

// Build correct Topic
const topic = create(TopicSchema, {
  data: {
    oauthTokenInfo: create(RowSchema, { value: 'test_value' }),
  },
});

const topicBin = toBinary(TopicSchema, topic);

// My manual encoding
function protoEncodeBytes(fieldNum, buf) {
  const tag = Buffer.from([(fieldNum << 3) | 2]);
  let len = buf.length;
  const lenBytes = [];
  while (len > 0x7f) { lenBytes.push((len & 0x7f) | 0x80); len >>= 7; }
  lenBytes.push(len & 0x7f);
  return Buffer.concat([tag, Buffer.from(lenBytes), buf]);
}
function protoEncodeString(fieldNum, str) {
  return protoEncodeBytes(fieldNum, Buffer.from(str, 'utf8'));
}

const rowBuf = protoEncodeString(1, 'test_value');
const entry = Buffer.concat([protoEncodeString(1, 'oauthTokenInfo'), protoEncodeBytes(2, rowBuf)]);
const manualTopic = protoEncodeBytes(1, entry);

const correctHex = Buffer.from(topicBin).toString('hex');
const manualHex = manualTopic.toString('hex');

console.log('\n=== Encoding Comparison ===');
console.log('Correct:', correctHex);
console.log('Manual: ', manualHex);
console.log('MATCH:', correctHex === manualHex);

if (correctHex !== manualHex) {
  console.log('\n!!! MISMATCH - My encoding is WRONG !!!');
  // Show byte-by-byte comparison
  const correct = Buffer.from(topicBin);
  const manual = manualTopic;
  const maxLen = Math.max(correct.length, manual.length);
  for (let i = 0; i < maxLen; i++) {
    const cb = i < correct.length ? correct[i].toString(16).padStart(2, '0') : '--';
    const mb = i < manual.length ? manual[i].toString(16).padStart(2, '0') : '--';
    if (cb !== mb) {
      console.log(`  Byte ${i}: correct=${cb} manual=${mb} ← DIFF`);
    }
  }
} else {
  console.log('\n✅ My encoding is CORRECT!');
  console.log('The problem is NOT in the protobuf encoding!');
}

// Also load the extension server proto and find UnifiedStateSyncUpdate
console.log('\n=== Looking for UnifiedStateSyncUpdate in ExtServer proto ===');
const extFile = loadDesc('file_exa_extension_server_pb_extension_server');
if (extFile) {
  // Find the message index for UnifiedStateSyncUpdate
  // It's used by SubscribeToUnifiedStateSyncTopic as response type
  // Let's look at all message names
  for (let i = 0; i < 200; i++) {
    try {
      const schema = messageDesc(extFile, i);
      if (schema.typeName.includes('UnifiedStateSyncUpdate') || 
          schema.typeName.includes('Subscribe') ||
          schema.typeName.includes('SyncTopic')) {
        console.log(`  Msg ${i}: ${schema.typeName}`);
        for (const f of schema.fields) {
          console.log(`    ${f.number}: ${f.name} (${f.kind}, ${f.oneof ? 'oneof=' + f.oneof.name : ''})`);
        }
      }
    } catch (e) {
      // Out of range
      break;
    }
  }
}
