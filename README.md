# Ritmo Studio

DAW gratuita con Channel Rack, Piano Roll, Playlist e Mixer. Gira nel browser e come app desktop per macOS (Apple Silicon e Intel), Windows e Linux. Nell'app desktop un motore audio nativo carica i plugin VST3, AU (Mac) e LV2.

Sito: https://alecaram007.github.io/ritmo-studio/ — in 26 lingue, con download per tutti i sistemi e versione online.

## Funzioni principali

- **Mixer** con Master e 125 insert: 10 slot effetto per traccia (ognuno con mix dry/wet), EQ a 3 bande, separazione stereo, inversione di fase e scambio L/R, uscita su un'altra traccia e mandate post-fader. Le frecce in basso nelle strisce instradano la traccia selezionata; gli anelli di instradamento vengono rifiutati.
- **Clip di automazione**: clic destro su una manopola o un fader › *Crea clip di automazione*. La curva si disegna nel suo editor e la clip si dispone nella Playlist. Nell'app desktop si automatizzano anche i parametri dei plugin.
- **Clip audio**: trascina un file audio sulla griglia della Playlist; suona sulla traccia del mixer che gli viene assegnata.
- **Registrazione**: il pulsante a microfono sceglie se Rec registra note (nel pattern) o audio dall'ingresso (una clip nella Playlist, sulla traccia del mixer selezionata).
- **Esportazione**: WAV 16/24/32 bit, FLAC e OGG (app desktop), e tracce separate (un file per traccia del mixer).
- **Strumenti**: batteria sintetizzata, Basso 808, Synth sottrattivo, Pad, Pluck, E-Piano FM, Supersaw, Acid Bass (303, con slide), FM a 4 operatori (5 algoritmi), Organo a 9 registri, Campionatore, più i plugin.
- **Effetti**: EQ, Filtro, Compressore, Limiter, Distorsione, Delay, Riverbero, Chorus, Phaser, Flanger, Bitcrusher, Stereo, Gate ritmico, Tremolo/Auto-pan, Sidechain (ducking da un'altra traccia).
- **Impostazioni audio** (Opzioni): driver, uscita, ingresso, frequenza e buffer della scheda audio nell'app desktop.
- **Browser**: aggiungi le tue cartelle di campioni (restano tra una sessione e l'altra), cerca per nome, segna i preferiti con la stella, ascolta un suono con un clic, scorri i suoni della cartella nel canale selezionato con Maiusc+↑/↓, trascina suoni, strumenti, effetti e preset sul rack, sulla Playlist o sul mixer.
- **Preset**: salva e ricarica canali (con campione e stato del plugin), effetti e interi stati delle tracce del mixer.
- **Impostazioni del canale** a schede: Campione (inizio, fine, dissolvenze, normalizza, loop e ping-pong con segni trascinabili), Inviluppo (AHDSR, filtro a 6 tipi con inviluppo, inviluppo di intonazione), LFO (volume, pan, filtro, intonazione), Varie (mono, portamento, gruppi di taglio, arpeggiatore anche dal vivo, eco delle note).
- **Piano Roll**: corsia degli eventi per velocità, rilascio, pan, intonazione fine e Mod X/Y (filtro e risonanza); finestra delle proprietà della nota (doppio clic); 16 colori di nota, che sono anche i canali MIDI dei plugin; note Slide e Porta; strumenti Lazo, Zoom e Ascolta; Articolazione, LFO e Interpolazione sulla corsia, Claw machine, Taglio rapido; tastiera e MIDI allineabili alla scala.
- **Metro**: metro del progetto (2/4, 3/4, 6/8, 7/8, 12/8…) e cambi di metro nella Playlist; righelli, griglia, metronomo e indicatore di battuta li seguono. Il MIDI importato ed esportato porta il metro.
- **Playlist**: strumenti Disegna, Pennello, Cancella, Muta, Slip, Taglia, Seleziona, Zoom e Ascolta; marcatori con azioni (inizio del brano, punto di ritorno del loop, ripeti fino al marcatore successivo, salta, pausa); tracce con colore, altezza regolabile e gruppi comprimibili; inserisci ed elimina spazio; unisci le clip di pattern, rendi unico, renderizza un pattern o consolida le clip in audio; più arrangiamenti dello stesso progetto.
- **Clip audio**: dissolvenze in entrata e in uscita (maniglie trascinabili), dissolvenza incrociata, volume, intonazione che non cambia la durata, al contrario, time-stretch e adattamento al tempo del progetto.

## Struttura

| Cartella | Contenuto |
|---|---|
| `src/` | L'interfaccia: `index.html` e `js/` (sequencer, Piano Roll, Playlist, Mixer, motore Web Audio, ponte verso il motore nativo) |
| `fonts/` | Caratteri a licenza libera (SIL OFL), incorporati nel file finale |
| `build.py` | Genera `RitmoStudio.html` (file unico, funziona anche offline) e `dist/artifact.html` |
| `engine/` | Il motore nativo in C++ (JUCE 9): suona tutto e ospita i plugin |
| `engine/src/builtins/` | Gli strumenti e gli effetti interni, versione nativa |
| `desktop/` | L'app Electron che unisce interfaccia e motore, e crea gli installer |
| `.github/workflows/build.yml` | Compila motore e installer per Mac, Windows e Linux su GitHub Actions |
| `site/` | Il sito in 26 lingue: testi in `site/i18n/<lingua>.json` (controllo: `python3 site/i18n/check.py`), immagini social con `python3 site/make_og.py`; `python3 site/build.py --base <indirizzo>` lo crea in `site/_out`, il workflow `site.yml` lo pubblica su GitHub Pages |

## Compilare

```bash
python3 build.py
cmake -S engine -B engine/build-universal -G Ninja -DCMAKE_BUILD_TYPE=Release "-DCMAKE_OSX_ARCHITECTURES=arm64;x86_64"
cmake --build engine/build-universal --target RitmoEngine
cd desktop && npm install && npm run dist:mac
```

Gli installer finiscono in `desktop/release/`. Il motore va compilato su ogni sistema: per Windows e Linux usa il workflow di GitHub Actions oppure un computer con quel sistema (`build-win`, `build-linux`).

## Formati dei plugin

- **VST3**: Mac, Windows, Linux.
- **AU**: Mac.
- **LV2**: soprattutto Linux.
- **CLAP e VST2**: non ancora supportati. Per VST2 Steinberg non distribuisce più i file necessari.
- **Plugin solo Intel su Mac Apple Silicon**: richiedono un ponte sotto Rosetta, non ancora presente.

La scansione apre ogni plugin in un processo separato: un plugin difettoso viene saltato senza far cadere il programma.

## Licenze

L'interfaccia e l'app desktop sono MIT. Il motore nativo usa JUCE con licenza AGPLv3, quindi il motore è distribuito anch'esso come AGPLv3: chi riceve l'app deve poter avere il codice sorgente. Il VST3 SDK di Steinberg incluso in JUCE è MIT.
