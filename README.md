# ULTRASUONO — Installer firmware

Questi firmware usano `System::ResetToBootloader(System::DAISY_INFINITE_TIMEOUT)` dopo una pressione encoder di 5 secondi. Prima del salto chiude un’eventuale registrazione. Il bootloader Daisy standard resta invariato. Per uscire senza installare, spegnere/riaccendere il dispositivo oppure premere RESET: il pulsante Annulla attesa ferma solo la pagina. La prima installazione dei nuovi binari usa ancora la finestra DFU del vecchio firmware.


## Contenuto

- `firmware/LIVE-MODE.bin` e `firmware/DEV-MODE.bin`: applicazioni QSPI, indirizzo `0x90040000`.
- `firmware/DAISY-BOOTLOADER.bin`: Daisy bootloader 6.2 extdfu, finestra DFU di 2000 ms, flash interna `0x08000000`.
- `firmware/manifest.json`: commit sorgenti, dimensioni e SHA-256 dei binari.
- `firmware/*-relink.zip`: sorgenti delle librerie usate, oggetti applicativi senza debug, archivi compilati, Makefile di ricomposizione e licenze. I sorgenti applicativi Ultrasuono restano nel repository privato.
- `vendor/dfu.js` e `vendor/dfuse.js`: implementazione USB riutilizzata dal programmatore Daisy, con licenza MIT in `vendor/LICENSE.txt`.

Il flasher verifica dimensione e SHA-256 prima della scrittura. Il firmware viene abilitato solo con memoria QSPI compatibile; l’installazione del bootloader richiede memoria interna compatibile e una conferma distinta.

Per l’aggiornamento ordinario, autorizzare prima il dispositivo DFU nella finestra USB del browser. Poi premere Installa e tenere premuto l’encoder per 5 secondi: il sito controlla i dispositivi autorizzati ogni 100 ms e ascolta gli eventi USB di collegamento, agganciando automaticamente la Daisy nella finestra breve del bootloader. Se l’apertura USB fallisce prima della scrittura, resta in attesa di un nuovo ingresso in DFU. Un errore durante la scrittura ferma l’operazione. L’attesa può essere annullata prima del trasferimento. La prima autorizzazione richiede la selezione manuale imposta dal browser e può richiedere di ripetere la pressione dell’encoder.

## Stato

Entrambe le varianti sono state compilate con GNU Arm Embedded Toolchain 10-2020-q4-major (GCC 10.2.1). La ricomposizione con i pacchetti inclusi produce binari identici. I controlli del browser hanno verificato scelta variante, indirizzi di scrittura, conferma bootloader, errore USB e layout mobile usando una Daisy simulata.

Il proprietario ha confermato sulla propria Daisy il funzionamento del flashing e dell’ingresso nel bootloader senza scadenza. Il collaudo completo di audio, controlli e registrazione per entrambe le varianti non è documentato.

## Sito pubblico e anteprima locale

[Apri Ultrasuono Firmware](https://ultrasuono.github.io/ultrasuono-installer/).

Per l’anteprima locale: `python -m http.server 8765`, quindi aprire `http://localhost:8765/`.
WebUSB richiede un contesto sicuro: localhost oppure HTTPS.

Per GitHub Pages, pubblicare la radice del branch `main`; `.nojekyll` evita la trasformazione dei file statici. Nessuna compilazione del sito o dipendenza remota è necessaria.

## Licenze

Le condizioni dei firmware sono in `FIRMWARE-TERMS.txt`. Il sito non trasferisce la proprietà dei sorgenti applicativi. Le licenze delle librerie, inclusa LGPL 2.1 per DaisySP-LGPL, restano in vigore e sono incluse nei pacchetti scaricabili. Gli avvisi Newlib e GCC runtime sono forniti insieme ai firmware.

Riferimenti: [programmatore Daisy](https://github.com/daisyaudio/Programmer), [programmatore ufficiale attuale](https://flash.daisy.audio/).
