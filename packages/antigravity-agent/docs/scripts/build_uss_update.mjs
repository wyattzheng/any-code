// Build full UnifiedStateSyncUpdate with @bufbuild/protobuf and export as a reusable module
import { create, toBinary, fromBinary } from '@bufbuild/protobuf';
import { fileDesc, messageDesc } from '@bufbuild/protobuf/codegenv1';
import * as wkt from '@bufbuild/protobuf/wkt';
import { readFileSync } from 'fs';

const extSrc = readFileSync('/Applications/Antigravity.app/Contents/Resources/app/extensions/antigravity/dist/extension.js', 'utf8');
const regex = /(\w+)=\(0,\w+\.fileDesc\)\("([A-Za-z0-9+/=]+)"(?:,\[([^\]]*)\])?\)/g;
let m;
const allDescs = {};
while ((m = regex.exec(extSrc)) !== null) {
  const n = m[1], b = m[2], d = (m[3]||'').split(',').map(s=>{const t=s.trim();const i=t.lastIndexOf('.');return i>=0?t.substring(i+1):t;}).filter(s=>s.length>0);
  allDescs[n] = {b64:b,deps:d,loaded:null};
}
const wktMap = {};
for (const [n,v] of Object.entries(wkt)) if (n.startsWith('file_')) wktMap[n]=v;
function loadDesc(name) {
  if (wktMap[name]) return wktMap[name];
  if (!allDescs[name]) return null;
  if (allDescs[name].loaded) return allDescs[name].loaded;
  const df=[];
  for (const d of allDescs[name].deps) {const x=loadDesc(d);if(x)df.push(x);}
  try{allDescs[name].loaded=fileDesc(allDescs[name].b64,df);return allDescs[name].loaded;}catch(e){return null;}
}

const ussFile = loadDesc('file_exa_unified_state_sync_pb_unified_state_sync');
const extFile = loadDesc('file_exa_extension_server_pb_extension_server');
const lsFile = loadDesc('file_exa_language_server_pb_language_server');

const TopicSchema = messageDesc(ussFile, 0);
const RowSchema = messageDesc(ussFile, 1);
const UpdateSchema = messageDesc(extFile, 101);
const OAuthSchema = messageDesc(lsFile, 279);

console.log('OAuthTokenInfo:', OAuthSchema.typeName);
console.log('Fields:');
for (const f of OAuthSchema.fields) {
  console.log(`  ${f.number}: ${f.name} scalar:${f.scalar} kind:${f.kind} fieldKind:${f.fieldKind} message:${f.message?.typeName}`);
}

// Build OAuthTokenInfo
const tokenObj = create(OAuthSchema, {
  accessToken: 'test_token_123',
  tokenType: 'Bearer',
  refreshToken: 'ref_token_456',
  // The OAuthTokenInfo.expiry field type determines how to set it
});
console.log('\nOAuthTokenInfo object:', JSON.stringify(tokenObj, (k,v) => typeof v === 'bigint' ? v.toString() : v));

// Serialize OAuthTokenInfo  
const tokenBin = toBinary(OAuthSchema, tokenObj);
console.log('OAuthTokenInfo binary (', tokenBin.length, 'bytes):', Buffer.from(tokenBin).toString('hex'));

// protoFromBinaryBase64 in extension.js converts base64→bytes→proto
// protoToBinaryBase64 converts proto→bytes→base64
// Row.value stores the base64 string
const tokenBase64 = Buffer.from(tokenBin).toString('base64');
console.log('OAuthTokenInfo base64:', tokenBase64);

// Now build the full Topic with the token value
const topic = create(TopicSchema, {
  data: {
    oauthTokenInfo: create(RowSchema, {
      value: tokenBase64,
    }),
  },
});

// Build UnifiedStateSyncUpdate
const update = create(UpdateSchema, {
  updateType: {
    case: 'initialState',
    value: topic,
  },
});

const updateBin = toBinary(UpdateSchema, update);
console.log('\nUnifiedStateSyncUpdate binary (', updateBin.length, 'bytes):');
console.log('  hex:', Buffer.from(updateBin).toString('hex'));

// Now try to decode it back
const decoded = fromBinary(UpdateSchema, updateBin);
console.log('\nDecoded updateType:', decoded.updateType?.case);
const decodedTopic = decoded.updateType?.value;
console.log('Topic data keys:', Object.keys(decodedTopic?.data || {}));
const row = decodedTopic?.data?.oauthTokenInfo;
console.log('Row value length:', row?.value?.length);

// Decode the base64 value back to OAuthTokenInfo
if (row?.value) {
  const tokenBinDecoded = Buffer.from(row.value, 'base64');
  const tokenDecoded = fromBinary(OAuthSchema, tokenBinDecoded);
  console.log('\n=== Round-trip decoded ===');
  console.log('accessToken:', tokenDecoded.accessToken);
  console.log('tokenType:', tokenDecoded.tokenType);
  console.log('refreshToken:', tokenDecoded.refreshToken);
}

// Write the update binary to a file for reference
const { writeFileSync } = await import('fs');
writeFileSync('/tmp/uss_update.bin', Buffer.from(updateBin));
writeFileSync('/tmp/uss_update_hex.txt', Buffer.from(updateBin).toString('hex'));
console.log('\nWritten to /tmp/uss_update.bin and /tmp/uss_update_hex.txt');

// Create ConnectRPC envelope
const envelope = Buffer.alloc(5 + updateBin.length);
envelope.writeUInt8(0, 0);  // flags
envelope.writeUInt32BE(updateBin.length, 1);  // length
Buffer.from(updateBin).copy(envelope, 5);
writeFileSync('/tmp/uss_envelope.bin', envelope);
console.log('ConnectRPC envelope written to /tmp/uss_envelope.bin (', envelope.length, 'bytes)');
