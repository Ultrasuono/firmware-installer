const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const crypto = require('node:crypto').webcrypto;
const root = __dirname + '/../docs/';
const core = require(root + 'flash-core.js');
const catalog = JSON.parse(fs.readFileSync(root + 'firmware/manifest.json'));
async function check(mode, expected = mode) {
  const ids = {};
  const element = id => ids[id] ||= {textContent:'', href:'', classList:{add(){},toggle(){}},addEventListener(){},setAttribute(){}};
  const radios = ['basic','dev','live','midi'].map(value => ({value,checked:false,addEventListener(){}}));
  const context = {URLSearchParams, crypto, FlashCore:core, location:{search:'?mode='+mode}, navigator:{}, setTimeout, clearTimeout,
    document:{getElementById:element, querySelectorAll:()=>radios, querySelector(selector){
      return selector.includes(':checked') ? radios.find(r=>r.checked) : radios.find(r=>selector.includes('"'+r.value+'"'));
    }}, fetch:async file=>({ok:true,json:async()=>catalog,arrayBuffer:async()=>{
      const bytes=fs.readFileSync(root+file); return bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
    }})};
  vm.runInNewContext(fs.readFileSync(root+'installer.js','utf8'),context);
  await new Promise(resolve=>setTimeout(resolve,100));
  assert.equal(radios.find(r=>r.checked).value,expected);
  assert.equal(element('primary').textContent,'Install '+expected.toUpperCase()+' mode');
  assert.equal(element('download').href,catalog[expected].file);
  assert(element('versions').textContent.includes(catalog.live.commit.slice(0,7)));
  assert(element('versions').textContent.includes(catalog.midi.commit.slice(0,7)));
  assert.equal(core.validate({segments:[{writable:true,erasable:true,start:0x90040000,end:0x90800000}]},expected,catalog[expected].size),0x90040000);
  assert.throws(()=>core.validate({segments:[{writable:true,erasable:true,start:0x08000000,end:0x08020000}]},expected,catalog[expected].size));
}
(async()=>{
  for(const mode of ['basic','dev','live','midi']) await check(mode);
  for(const entry of Object.values(catalog)) {
    if(!entry.file) continue;
    const bytes=fs.readFileSync(root+entry.file);
    await core.checkBinary(bytes,entry);
  }
  await check('', 'basic');
  await check('unknown', 'basic');
  assert(fs.readFileSync(root+'install.html','utf8').includes('aria-live="polite"'));
  assert(!fs.readFileSync(root+'index.html','utf8').includes('mode=unstable'));
  console.log('Four routes, labels, downloads, defaults, QSPI validation, accessibility and all hashes: OK');
})().catch(error=>{console.error(error);process.exitCode=1});
