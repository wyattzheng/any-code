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
const RowSchema = messageDesc(ussFile, 1);
const TopicSchema = messageDesc(ussFile, 0);

console.log('Row fields:');
for (const f of RowSchema.fields) {
  console.log(`  Field ${f.number} "${f.name}" - kind:${f.kind} scalar:${f.scalar} fieldKind:${f.fieldKind}`);
}

console.log('\nTopic fields:');
for (const f of TopicSchema.fields) {
  console.log(`  Field ${f.number} "${f.name}" - kind:${f.kind} scalar:${f.scalar} fieldKind:${f.fieldKind} mapKey:${f.mapKey} mapKind:${f.mapKind}`);
}

// Proto ScalarType enum: DOUBLE=1, FLOAT=2, INT64=3, UINT64=4, INT32=5, FIXED64=6, FIXED32=7, BOOL=8, STRING=9, GROUP=10, MESSAGE=11, BYTES=12, UINT32=13, ENUM=14, SFIXED32=15, SFIXED64=16, SINT32=17, SINT64=18
console.log('\nScalarType reference: STRING=9, BYTES=12, INT64=3, BOOL=8');
