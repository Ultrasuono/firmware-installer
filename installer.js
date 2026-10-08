'use strict';
const byId = id => document.getElementById(id);
let catalog, device, transferSize = 1024, busy = false, loadId = 0;
let authorizedUsb, waitKey, waitTimer, checking = false, waitGeneration = 0;
const binaries = {};
const selected = () => document.querySelector('input[name="variant"]:checked').value;
const status = message => { byId('status').textContent = message; };
function updateButtons() {
  const key = selected();
  byId('connect').disabled = busy || !!waitKey || !navigator.usb || !catalog;
  byId('install').textContent = waitKey ? 'Annulla attesa' : `Installa ${key === 'live' ? 'LIVE MODE' : 'DEV MODE'}`;
  byId('install').disabled = busy || !navigator.usb || !binaries[key] || !authorizedUsb;
  byId('boot').disabled = busy || !!waitKey || !authorizedUsb || !binaries.boot || !byId('boot-confirm').checked;
  document.querySelectorAll('input[name="variant"]').forEach(input => { input.disabled = busy || !!waitKey; });
  byId('boot-confirm').disabled = busy || !!waitKey;
}
async function loadBinary(key) {
  if (binaries[key]) return;
  const response = await fetch(catalog[key].file, {cache:'no-cache'});
  if (!response.ok) throw new Error('Download firmware non riuscito. Ricarica la pagina.');
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
    if (revision === loadId && !device) status(authorizedUsb ? 'Firmware pronto. Premi Installa, poi tieni premuto l’encoder per 5 secondi.' : 'Firmware pronto. Autorizza prima la Daisy dal pulsante qui sopra.');
  } catch (error) { status(error.message); }
  updateButtons();
}
async function connect() {
  if (busy) return;
  busy = true; updateButtons();
  try {
    status('Con la finestra USB aperta, tieni premuto l’encoder per 5 secondi e seleziona la Daisy quando compare.');
    authorizedUsb = await navigator.usb.requestDevice({filters:[{vendorId:0x0483, productId:0xdf11}]});
    status('Daisy autorizzata. Premi Installa, poi tieni premuto l’encoder per 5 secondi: il sito la aggancerà automaticamente.');
  } catch (error) {
    status(error.name === 'NotFoundError' ? 'Autorizzazione non completata. Riapri la finestra USB e ripeti la pressione dell’encoder.' : `Autorizzazione non riuscita: ${error.message || error}. Su Windows verifica il driver DFU WinUSB.`);
  } finally { busy = false; updateButtons(); }
}
async function openDevice(usb, key) {
  let candidate;
  try {
    const interfaces = dfu.findDeviceDfuInterfaces(usb).filter(i => i.alternate.interfaceProtocol === 2);
    if (!interfaces.length) throw new Error('Il dispositivo non è in modalità DFU. Ripeti la pressione dell’encoder per 5 secondi.');
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
        throw new Error('Rilevata memoria interna: installa prima il bootloader Daisy. Non è stato scritto nulla.');
      }
      throw new Error('Memoria Daisy compatibile non trovata. Non è stato scritto nulla.');
    }
    candidate = new dfuse.Device(usb, target.settings);
    await candidate.open();
    const configIndex = usb.configurations.findIndex(c => c.configurationValue === target.settings.configuration.configurationValue);
    const descriptor = dfu.parseConfigurationDescriptor(await candidate.readConfigurationDescriptor(configIndex));
    const functional = descriptor.descriptors.find(d => d.bDescriptorType === 0x21 && d.bcdDFUVersion);
    if (!functional || functional.bcdDFUVersion !== 0x011a || !(functional.bmAttributes & 1) || functional.wTransferSize < 1)
      throw new Error('Protocollo di programmazione non compatibile.');
    transferSize = functional.wTransferSize;
    candidate.logDebug = () => {};
    candidate.logInfo = message => { if (message.includes('Erasing')) status('Preparazione memoria…'); else if (message.includes('Copying')) status('Installazione in corso. Non scollegare il cavo.'); };
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
    if (matches.length > 1) throw new Error('Più Daisy disponibili: lascia collegato solo il dispositivo da aggiornare.');
    if (!matches.length || generation !== waitGeneration) return;
    candidate = await openDevice(matches[0], key);
    if (generation !== waitGeneration) { await candidate.close(); return; }
    device = candidate;
    stopWaiting();
    await install(key);
  } catch (error) {
    if (generation === waitGeneration) {
      if (['NetworkError','NotFoundError','InvalidStateError'].includes(error.name))
        status('Daisy non agganciata in tempo. Resto in attesa: tieni di nuovo premuto l’encoder per 5 secondi.');
      else stopWaiting(`Collegamento non riuscito: ${error.message || error}`);
    }
  } finally { checking = false; }
}
function waitAndInstall(key) {
  if (waitKey) { stopWaiting('Attesa annullata. Nessun nuovo trasferimento avviato.'); return; }
  if (busy || !authorizedUsb || !binaries[key] || (key === 'boot' && !byId('boot-confirm').checked)) return;
  waitKey = key; waitGeneration++;
  status(key === 'boot' ? 'In attesa della Daisy in DFU ROM (BOOT + RESET). Il bootloader verrà installato automaticamente.' : 'In attesa della Daisy. Tieni premuto l’encoder per 5 secondi: l’installazione partirà automaticamente.');
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
      status('Daisy già autorizzata. Premi Installa: il sito attende automaticamente il dispositivo.');
      updateButtons();
    }
  } catch (error) { status(`Verifica autorizzazione USB non riuscita: ${error.message || error}`); }
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
    status(key === 'boot' ? 'Bootloader trasferito. Premi RESET, ricollega la Daisy e installa il firmware.' : 'Trasferimento completato. Se il dispositivo non riparte, premi RESET. Verifica il funzionamento prima di usarlo.');
  } catch (error) { status(`Installazione non confermata: ${error.message || error}. Premi Installa e ripeti la pressione dell’encoder per 5 secondi.`); }
  finally {
    await activeDevice.close().catch(() => {});
    device = null; busy = false; byId('boot-confirm').checked = false; updateButtons();
  }
}
byId('connect').addEventListener('click', connect);
byId('install').addEventListener('click', () => waitAndInstall(selected()));
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
    if (!response.ok) throw new Error('Elenco firmware non disponibile.');
    catalog = await response.json();
    byId('versions').textContent = `LIVE MODE: ${catalog.live.commit.slice(0,7)} · DEV MODE: ${catalog.dev.commit.slice(0,7)} · Compilati il ${catalog.date}.`;
    await Promise.all([selectVariant(), loadBinary('boot')]);
    if (navigator.usb) await reuseAuthorization();
    if (!navigator.usb) status('Per installare via USB apri questo sito in Chrome o Edge su computer. Puoi comunque scaricare il firmware.');
  } catch (error) { status(error.message); catalog = null; }
  updateButtons();
})();
