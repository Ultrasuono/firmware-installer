'use strict';
const FlashCore = {
  targets: {live: 0x90040000, dev: 0x90040000, boot: 0x08000000},
  // ponytail: require one contiguous writable/erasable region; extend only for a bootloader with split regions.
  region(memory, address, size) {
    return memory?.segments?.find(s => s.writable && s.erasable && address >= s.start && address + size <= s.end);
  },
  validate(memory, key, size) {
    const address = this.targets[key];
    if (!Number.isSafeInteger(size) || size < 8 || !address || !this.region(memory, address, size))
      throw new Error('Firmware is incompatible with the selected memory. Nothing was written.');
    return address;
  },
  async checkBinary(data, entry) {
    if (data.byteLength !== entry.size) throw new Error('Invalid firmware size. Reload the page.');
    const digest = await crypto.subtle.digest('SHA-256', data);
    const hash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
    if (hash !== entry.sha256) throw new Error('Firmware verification failed. Reload the page.');
  }
};
if (typeof module !== 'undefined') module.exports = FlashCore;
