import { fileDesc, messageDesc } from '@bufbuild/protobuf/codegenv1';
import { create, toBinary, fromBinary } from '@bufbuild/protobuf';
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

// Load language_server proto to find OAuthTokenInfo schema
const lsFile = loadDesc('file_exa_language_server_pb_language_server');

if (!lsFile) {
  console.error('Failed to load language_server proto!');
  process.exit(1);
}

// Find OAuthTokenInfo message
let oauthSchema = null;
for (let i = 0; i < 400; i++) {
  try {
    const schema = messageDesc(lsFile, i);
    if (schema.typeName.includes('OAuthTokenInfo') && !schema.typeName.includes('Request') && !schema.typeName.includes('Response')) {
      oauthSchema = schema;
      console.log(`Found OAuthTokenInfo at index ${i}: ${schema.typeName}`);
      break;
    }
  } catch(e) { break; }
}

if (!oauthSchema) {
  console.error('OAuthTokenInfo schema not found!');
  process.exit(1);
}

// Show fields
console.log('\nOAuthTokenInfo fields:');
for (const f of oauthSchema.fields) {
  console.log(`  ${f.number}: ${f.name} (scalar:${f.scalar} kind:${f.kind} fieldKind:${f.fieldKind})`);
}

// Create and serialize
const tokenObj = create(oauthSchema, {
  accessToken: 'ya29.test_token_12345',
  tokenType: 'Bearer',
  refreshToken: '1//test_refresh',
  expiry: '2026-12-31T00:00:00Z',
  isGcpTos: false,
});

const tokenBin = toBinary(oauthSchema, tokenObj);
console.log('\nOAuthTokenInfo binary (', tokenBin.length, ' bytes):');
console.log('  hex:', Buffer.from(tokenBin).toString('hex'));
console.log('  base64:', Buffer.from(tokenBin).toString('base64'));

// Verify round-trip
const decoded = fromBinary(oauthSchema, tokenBin);
console.log('\nDecoded:');
console.log('  accessToken:', decoded.accessToken);
console.log('  tokenType:', decoded.tokenType);
console.log('  refreshToken:', decoded.refreshToken);

// Now compare with manual encoding
function protoEncodeBytes(fn, buf) {
  const tag = Buffer.from([(fn << 3) | 2]);
  let len = buf.length;
  const lb = [];
  while (len > 0x7f) { lb.push((len & 0x7f) | 0x80); len >>= 7; }
  lb.push(len & 0x7f);
  return Buffer.concat([tag, Buffer.from(lb), buf]);
}
function protoEncodeString(fn, str) { return protoEncodeBytes(fn, Buffer.from(str, 'utf8')); }

const manualBin = Buffer.concat([
  protoEncodeString(1, 'ya29.test_token_12345'),
  protoEncodeString(2, 'Bearer'),
  protoEncodeString(3, '1//test_refresh'),
  protoEncodeString(4, '2026-12-31T00:00:00Z'),
]);

console.log('\nManual OAuthTokenInfo binary (', manualBin.length, ' bytes):');
console.log('  hex:', manualBin.toString('hex'));

console.log('\n  MATCH:', Buffer.from(tokenBin).toString('hex') === manualBin.toString('hex'));

if (Buffer.from(tokenBin).toString('hex') !== manualBin.toString('hex')) {
  console.log('  !!! DIFFERENT !!!');
  console.log('  Correct:', Buffer.from(tokenBin).toString('hex'));
  console.log('  Manual: ', manualBin.toString('hex'));
}
