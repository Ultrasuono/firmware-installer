'use strict';
const byId = id => document.getElementById(id);
let catalog, device, transferSize = 1024, busy = false, loadId = 0;
let authorizedUsb, waitKey, waitTimer, checking = false, waitGeneration = 0;
const binaries = {};
const requestedMode = new URLSearchParams(location.search).get('mode');
document.querySelector(`input[value="${requestedMode === 'dev' ? 'dev' : 'live'}"]`).checked = true;
const selected = () => document.querySelector('input[name="variant"]:checked').value;
const status = message => { byId('status').textContent = message; };
function updateButtons() {
  const key = selected();
  byId('back').setAttribute('aria-disabled', String(busy || !!waitKey));
  const action = byId('primary');
  action.textContent = busy ? (authorizedUsb ? 'Installing…' : 'Authorizing…') : waitKey ? 'Cancel waiting' : authorizedUsb ? `Install ${key === 'live' ? 'LIVE mode' : 'DEV mode'}` : 'Authorize Daisyseed';
  action.disabled = busy || !navigator.usb || !catalog || (!!authorizedUsb && !binaries[key]);
  action.classList.toggle('ready', !!authorizedUsb);
  byId('boot').disabled = busy || !!waitKey || !authorizedUsb || !binaries.boot || !byId('boot-confirm').checked;
  document.querySelectorAll('input[name="variant"]').forEach(input => { input.disabled = busy || !!waitKey; });
  byId('boot-confirm').disabled = busy || !!waitKey;
}
async function loadBinary(key) {
  if (binaries[key]) return;
  const response = await fetch(catalog[key].file, {cache:'no-cache'});
  if (!response.ok) throw new Error('Firmware download failed. Reload the page.');
  const data = await response.arrayBuffer();
  await FlashCore.checkBinary(data, catalog[key]);
  binaries[key] = data;
}
async function selectVariant() {
  const revision = ++loadId, key = selected();
  byId('download').href = catalog[key].file;
  updateButtons();
  try {
    await loadBinary(key);
    if (revision === loadId && !device) status(authorizedUsb ? 'Firmware ready. Click Install, then hold the encoder for 5 seconds.' : 'Firmware ready. Authorize the Daisy using the button above.');
  } catch (error) { status(error.message); }
  updateButtons();
}
async function connect() {
  if (busy) return;
  busy = true; updateButtons();
  try {
    status('With the USB dialog open, hold the encoder for 5 seconds and select the Daisy when it appears.');
    authorizedUsb = await navigator.usb.requestDevice({filters:[{vendorId:0x0483, productId:0xdf11}]});
    status('Daisy authorized. Click Install, then hold the encoder for 5 seconds: the site will detect it automatically.');
  } catch (error) {
    status(error.name === 'NotFoundError' ? 'Authorization cancelled. Open the USB dialog again and repeat the encoder press.' : `Authorization failed: ${error.message || error}. On Windows, check the DFU WinUSB driver.`);
  } finally { busy = false; updateButtons(); }
}
async function openDevice(usb, key) {
  let candidate;
  try {
    const interfaces = dfu.findDeviceDfuInterfaces(usb).filter(i => i.alternate.interfaceProtocol === 2);
    if (!interfaces.length) throw new Error('The device is not in DFU mode. Hold the encoder for 5 seconds again.');
    if (interfaces.some(i => !i.name)) {
      const probe = new dfu.Device(usb, interfaces[0]);
      await probe.open();
      const names = await probe.readInterfaceNames();
      for (const i of interfaces) i.name ||= names[i.configuration.configurationValue]?.[i.interface.interfaceNumber]?.[i.alternate.alternateSetting];
      await probe.close();
    }
    const mapped = interfaces.filter(i => i.name?.startsWith('@')).map(i => ({settings:i, memory:dfuse.parseMemoryDescriptor(i.name)}));
    const target = mapped.find(i => FlashCore.region(i.memory, FlashCore.targets[key], binaries[key].byteLength));
    if (!target) {
      if (key !== 'boot' && mapped.some(i => FlashCore.region(i.memory, 0x08000000, 8))) {
        byId('boot-help').open = true;
        throw new Error('Internal memory detected: install the Daisy bootloader first. Nothing was written.');
      }
      throw new Error('Compatible Daisy memory not found. Nothing was written.');
    }
    candidate = new dfuse.Device(usb, target.settings);
    await candidate.open();
    const configIndex = usb.configurations.findIndex(c => c.configurationValue === target.settings.configuration.configurationValue);
    const descriptor = dfu.parseConfigurationDescriptor(await candidate.readConfigurationDescriptor(configIndex));
    const functional = descriptor.descriptors.find(d => d.bDescriptorType === 0x21 && d.bcdDFUVersion);
    if (!functional || functional.bcdDFUVersion !== 0x011a || !(functional.bmAttributes & 1) || functional.wTransferSize < 1)
      throw new Error('Incompatible programming protocol.');
    transferSize = functional.wTransferSize;
    candidate.logDebug = () => {};
    candidate.logInfo = message => { if (message.includes('Erasing')) status('Preparing memory…'); else if (message.includes('Copying')) status('Installing. Do not disconnect the cable.'); };
    candidate.logWarning = () => {};
    candidate.logError = () => {};
    candidate.logProgress = (done,total) => { byId('progress').value = total ? done / total * 100 : 0; };
    return candidate;
  } catch (error) {
    if (candidate) await candidate.close().catch(() => {});
    if (usb?.opened) await usb.close().catch(() => {});
    throw error;
  }
}
function stopWaiting(message) {
  clearInterval(waitTimer); waitTimer = null; waitKey = null; waitGeneration++;
  if (message) status(message);
  updateButtons();
}
async function detectDaisy(eventDevice) {
  if (!waitKey || checking) return;
  checking = true;
  const generation = waitGeneration, key = waitKey;
  let candidate;
  try {
    const devices = eventDevice && authorizedUsb.serialNumber ? [eventDevice] : await navigator.usb.getDevices();
    const matches = devices.filter(usb => usb.vendorId === 0x0483 && usb.productId === 0xdf11 && (!authorizedUsb.serialNumber || usb.serialNumber === authorizedUsb.serialNumber));
    if (matches.length > 1) throw new Error('Multiple Daisy devices found: connect only the device you want to update.');
    if (!matches.length || generation !== waitGeneration) return;
    candidate = await openDevice(matches[0], key);
    if (generation !== waitGeneration) { await candidate.close(); return; }
    device = candidate;
    stopWaiting();
    await install(key);
  } catch (error) {
    if (generation === waitGeneration) {
      if (['NetworkError','NotFoundError','InvalidStateError'].includes(error.name))
        status('Daisy connection window missed. Still waiting: hold the encoder for 5 seconds again.');
      else stopWaiting(`Connection failed: ${error.message || error}`);
    }
  } finally { checking = false; }
}
function waitAndInstall(key) {
  if (waitKey) { stopWaiting('Waiting cancelled. No new transfer started.'); return; }
  if (busy || !authorizedUsb || !binaries[key] || (key === 'boot' && !byId('boot-confirm').checked)) return;
  waitKey = key; waitGeneration++;
  status(key === 'boot' ? 'Waiting for the Daisy in ROM DFU (BOOT + RESET). The bootloader will install automatically.' : 'Waiting for the Daisy. Hold the encoder for 5 seconds: installation will start automatically.');
  updateButtons();
  waitTimer = setInterval(detectDaisy, 100);
  detectDaisy();
}
async function reuseAuthorization() {
  if (authorizedUsb || busy) return;
  try {
    const devices = (await navigator.usb.getDevices()).filter(usb => usb.vendorId === 0x0483 && usb.productId === 0xdf11);
    if (devices.length === 1 && !authorizedUsb && !busy) {
      authorizedUsb = devices[0];
      status('Daisy already authorized. Click Install: the site waits automatically for the device.');
      updateButtons();
    }
  } catch (error) { status(`USB authorization check failed: ${error.message || error}`); }
}
async function install(key) {
  if (busy || !device || !binaries[key] || (key === 'boot' && !byId('boot-confirm').checked)) return;
  busy = true; updateButtons();
  const activeDevice = device;
  byId('progress').value = 0;
  try {
    activeDevice.startAddress = FlashCore.validate(activeDevice.memoryInfo, key, binaries[key].byteLength);
    await FlashCore.checkBinary(binaries[key], catalog[key]);
    const state = await activeDevice.getStatus();
    if (state.state === dfu.dfuERROR) await activeDevice.clearStatus();
    await activeDevice.abortToIdle();
    await activeDevice.do_download(transferSize, binaries[key], false);
    byId('progress').value = 100;
    status(key === 'boot' ? 'Bootloader transferred. Press RESET, reconnect the Daisy and install the firmware.' : 'Transfer complete. If the device does not restart, press RESET. Check that it works before use.');
  } catch (error) { status(`Installation not confirmed: ${error.message || error}. Click Install and hold the encoder for 5 seconds again.`); }
  finally {
    await activeDevice.close().catch(() => {});
    device = null; busy = false; byId('boot-confirm').checked = false; updateButtons();
  }
}
byId('back').addEventListener('click', event => { if (busy || waitKey) event.preventDefault(); });
byId('primary').addEventListener('click', () => authorizedUsb ? waitAndInstall(selected()) : connect());
byId('boot').addEventListener('click', () => waitAndInstall('boot'));
byId('boot-confirm').addEventListener('change', updateButtons);
document.querySelectorAll('input[name="variant"]').forEach(input => input.addEventListener('change', selectVariant));
if (navigator.usb) navigator.usb.addEventListener('connect', async event => {
  await reuseAuthorization();
  detectDaisy(event.device);
});
(async () => {
  try {
    const response = await fetch('firmware/manifest.json', {cache:'no-cache'});
    if (!response.ok) throw new Error('Firmware list unavailable.');
    catalog = await response.json();
    byId('versions').textContent = `LIVE MODE: ${catalog.live.commit.slice(0,7)} · DEV MODE: ${catalog.dev.commit.slice(0,7)} · Built on ${catalog.date}.`;
    await Promise.all([selectVariant(), loadBinary('boot')]);
    if (navigator.usb) await reuseAuthorization();
    if (!navigator.usb) status('To install via USB, open this site in Chrome or Edge on a computer. You can still download the firmware.');
  } catch (error) { status(error.message); catalog = null; }
  updateButtons();
})();
