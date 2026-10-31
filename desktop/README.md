# Ritmo Studio — app desktop

Versione desktop (Electron) di Ritmo Studio per macOS, Windows e Linux.
L'app impacchetta il file `../RitmoStudio.html`: a ogni avvio o build viene
ricopiato in `app/index.html`, quindi dopo aver aggiornato `RitmoStudio.html`
basta rilanciare `npm run dist`.

## Requisiti

- Node.js 20 o successivo (con npm)
- Per i pacchetti macOS serve un Mac (firma ad-hoc con `codesign`)

```bash
cd desktop
npm install
```

## Avvio in sviluppo

```bash
npm start
```

## Creare gli installer

| Comando              | Risultato                                                    |
| -------------------- | ------------------------------------------------------------ |
| `npm run dist:mac`   | macOS Apple Silicon (arm64) e Intel (x64): `.dmg` e `.zip`   |
| `npm run dist:win`   | Windows x64: installer NSIS `-setup.exe` e `.zip` portabile  |
| `npm run dist:linux` | Linux x64: `.AppImage` e `.deb`                              |
| `npm run dist`       | tutti i precedenti                                           |

Gli installer finiscono in `desktop/release/`. Le build Windows e Linux si
possono creare anche da un Mac (senza Wine). L'icona si rigenera con
`python3 scripts/make-icon.py` (serve Pillow).

## Primo avvio

**macOS** — L'app ha una firma ad-hoc ma non è notarizzata da Apple, quindi al
primo avvio Gatekeeper la blocca. Dopo averla copiata in Applicazioni:

- clic destro sull'app → **Apri** → **Apri**; su macOS 15 e successivi, se non
  compare l'opzione, vai in Impostazioni di Sistema → Privacy e sicurezza →
  **Apri comunque**;
- oppure, da Terminale:

  ```bash
  xattr -cr "/Applications/Ritmo Studio.app"
  ```

**Windows** — L'installer non ha una firma digitale: se compare SmartScreen
("Windows ha protetto il PC"), clicca **Ulteriori informazioni → Esegui comunque**.

**Linux** — Rendi eseguibile l'AppImage (`chmod +x RitmoStudio-*.AppImage`).
Se su Ubuntu 24.04 o successivi non si avvia per via della sandbox, usa il
pacchetto `.deb` (`sudo apt install ./ritmo-studio_*.deb`) oppure avviala con
`--no-sandbox`.

## Note

- Il MIDI (Web MIDI) è abilitato: collega il controller prima di aprire l'app.
- Esportazioni `.wav` e progetti `.json` aprono la finestra di salvataggio nativa.
- La finestra ricorda dimensione e posizione tra un avvio e l'altro.
- Scorciatoie dell'app: `Ctrl/Cmd+Maiusc+R` ricarica la pagina,
  `Alt+Ctrl/Cmd+I` apre gli strumenti per sviluppatori.
