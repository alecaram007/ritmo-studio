#pragma once
/*
    Ritmo Engine — the realtime engine.

    Threads
    - Message thread: receives the project from the UI, builds the graph and the note list, loads plug-ins,
      and publishes an immutable Snapshot through an atomic pointer.
    - Audio thread: reads the current Snapshot, runs the sequencer, the channels, the audio clips, the
      automation clips and the mixer. It never allocates, never locks the model and never deletes anything.
      Old snapshots (and the processors only they still reference) are destroyed on the message thread later.

    Mixer
    - 126 tracks: 0 is the master, 1..125 are inserts. Each insert has ten effect slots (with a dry/wet mix),
      a 3-band EQ, stereo tools (width, phase, swap), pan and volume, one main output and any number of
      post-fader sends. Tracks are processed in an order where every source comes before its destinations
      (sidechain sources included); tracks nothing reaches are skipped.
*/
#include <juce_audio_utils/juce_audio_utils.h>
#include "builtins/Builtins.h"
#include "PluginHost.h"
#include <array>
#include <atomic>
#include <map>
#include <memory>
#include <vector>

namespace ritmo
{

constexpr int numInserts = 126;  // 0 = master, 1..125 = inserts
constexpr int fxSlotsPerInsert = 10;
constexpr int maxBlock = 2048;
constexpr int maxAutoReports = 512;

/** One sound source or effect: a built-in or a hosted plug-in, with its preallocated work buffer. */
struct ProcessorSlot
{
    juce::String signature;  // "builtin:<type>" or "plugin:<identifier>"
    std::unique_ptr<juce::AudioProcessor> proc;
    BuiltinProcessor* builtin = nullptr;
    juce::AudioPluginInstance* plugin = nullptr;
    juce::AudioBuffer<float> work;
    int numChannels = 2;
    int minChannels = 2;  // 4 for the sidechain ducker: channels 2-3 carry the key signal

    void prepare (double sampleRate, int blockSize);
    /** Runs the processor on `numSamples` samples of `work`; the caller fills/reads channels 0 and 1. */
    void process (int numSamples, juce::MidiBuffer& midi);
};

struct LiveEvent
{
    uint8_t kind = 0;  // 0 note on, 1 note off, 2 all notes off
    uint8_t note = 60;
    float velocity = 0.8f;
};

struct ChannelNode
{
    juce::String id, type;
    bool isHat = false, isOhat = false;
    std::shared_ptr<ProcessorSlot> slot;  // message thread only; the audio thread uses the snapshot's copy
    juce::String loadingSignature;        // plug-in being instantiated for this channel
    juce::String sampleId;                // sample currently given to a built-in sampler
    int insertIndex = 0;                  // mixer insert, message thread
    std::atomic<float> vol { 0.78f }, pan { 0.0f };
    std::atomic<bool> audible { true }, flash { false }, cutSelf { false };
    std::atomic<int> cutGroup { 0 }, cutBy { 0 };  // choke groups: a note of group g silences channels "cut by" g
    std::atomic<bool> monoPlugin { false };         // mono hosted plug-in: a new note releases the previous one
    int lastNote = -1, lastChannel = 1;             // audio thread
    uint16_t midiChannels = 1;                      // audio thread: MIDI channels its notes have used (bit 0 = channel 1)
    float lastGain = 0.0f;                     // audio thread
    float autoVol = -1.0f, autoPan = -2.0f;    // audio thread: values set by automation clips (unset when out of range)
    juce::MidiBuffer midi;                     // audio thread
    juce::AbstractFifo fifo { 512 };
    std::array<LiveEvent, 512> fifoData;

    ChannelNode() { midi.ensureSize (8192); }
    void pushLive (LiveEvent e);
    /** CC 120 (all sound off) or 123 (all notes off) on every MIDI channel in midiChannels. Audio thread. */
    void controllerToAll (int controller, int offset);
};

struct InsertNode
{
    std::array<std::shared_ptr<ProcessorSlot>, fxSlotsPerInsert> fx;  // message thread
    std::array<bool, fxSlotsPerInsert> fxOn {};
    std::array<std::atomic<float>, fxSlotsPerInsert> fxMix;
    std::array<juce::String, fxSlotsPerInsert> loading;
    std::shared_ptr<ProcessorSlot> eq;  // the track EQ, only while it is not flat
    std::atomic<float> vol { 0.8f }, pan { 0.0f };
    std::atomic<bool> muted { false };
    std::atomic<float> peakL { 0.0f }, peakR { 0.0f };
    float lastGain = 0.0f;                    // audio thread
    float autoVol = -1.0f, autoPan = -2.0f;   // audio thread, set by automation clips
    juce::AudioBuffer<float> dry;             // audio thread: the signal before a slot with mix < 1

    InsertNode()
    {
        for (auto& m : fxMix)
            m = 1.0f;
        dry.setSize (2, maxBlock);
    }
};

struct SeqEvent
{
    double start = 0.0, length = 1.0;  // in steps (sixteenth notes)
    int channel = 0;                   // index into Snapshot::channels
    uint8_t note = 60;
    float velocity = 0.8f;
    NoteExpression expr;               // pan, fine, mx, my, rel (release velocity), porta
    uint8_t col = 0;                   // note colour = MIDI channel - 1
    bool slide = false;                // slide note: bends the sounding notes of its colour (built-ins only)
};

enum class AutoKind { chVol, chPan, chParam, mixVol, mixPan, fxParam, plugin };

struct Snapshot
{
    struct ChannelRun
    {
        ChannelNode* node = nullptr;
        ProcessorSlot* slot = nullptr;
        int insert = 0;
    };
    struct SendRun
    {
        int to = 0;
        float gain = 1.0f;  // level², like the web engine
    };
    struct InsertRun
    {
        InsertNode* node = nullptr;
        std::array<ProcessorSlot*, fxSlotsPerInsert> fx {};
        std::array<int, fxSlotsPerInsert> sidechain {};  // key source track of a ducker, -1 for other effects
        ProcessorSlot* eq = nullptr;
        int out = 0;
        std::vector<SendRun> sends;
        float width = 1.0f;
        bool phase = false, swap = false, used = false;
    };
    // An audio file placed on the playlist, playing into a mixer track.
    struct ClipRun
    {
        double start = 0.0, length = 0.0, offset = 0.0;  // steps
        float gain = 1.0f;
        int insert = 0;
        const juce::AudioBuffer<float>* data = nullptr;
        double dataRate = 44100.0;
        double fadeIn = 0.0, fadeOut = 0.0;  // steps, 0 = none
    };
    struct AutoPoint
    {
        double s = 0.0;
        float v = 0.0f;
    };
    // An automation clip on the playlist: a 0..1 curve mapped onto one parameter's range.
    struct AutoRun
    {
        double start = 0.0, length = 0.0, offset = 0.0;  // steps
        std::vector<AutoPoint> points;
        AutoKind kind = AutoKind::chVol;
        ChannelNode* channel = nullptr;
        int insert = 0;
        ProcessorSlot* slot = nullptr;              // chParam / fxParam built-ins
        juce::AudioProcessorParameter* param = nullptr;  // plug-in parameter
        std::array<char, 40> key {};
        float min = 0.0f, max = 1.0f, step = 0.0f;
        bool log = false;
        int report = -1;  // index into Engine::autoReport

        float valueAt (double local) const;
        float map (float n) const;
    };
    // The playback map of the page (project.seq), in steps.
    struct Jump
    {
        double at = 0.0, to = 0.0;
        bool loop = false;  // a loop marker: not taken during an offline render
    };
    struct MeterRun
    {
        double s = 0.0, bar = 16.0, beat = 4.0;  // a metre from 's' on: steps per bar and per beat
    };
    std::vector<ChannelRun> channels;
    std::array<InsertRun, numInserts> inserts {};
    std::vector<int> order;  // tracks to process: sources before destinations, master last
    std::vector<SeqEvent> events;  // sorted by start
    std::vector<ClipRun> clips;
    std::vector<AutoRun> autos;
    // The music ends at loopLength; playback then continues at loopStart. A playhead before minPos moves to minPos
    // (minPos == loopStart, except in song mode with project.seq and no loop region: 0, so playing from 0 plays the intro).
    double loopStart = 0.0, loopLength = 16.0, minPos = 0.0;
    std::vector<Jump> jumps;        // song mode, sorted by 'at'
    std::vector<double> pauses;     // song mode, sorted
    std::vector<MeterRun> meter;    // sorted by 's'; empty: a click every 4 steps, accent every 16
    double bpm = 128.0;
    bool metronome = false, song = false;
    std::vector<std::shared_ptr<const void>> keepAlive;
};

class Engine final : public juce::AudioIODeviceCallback,
                     public juce::AudioPlayHead,
                     private juce::Timer
{
public:
    using Sender = std::function<void (const juce::var&)>;

    Engine (PluginHost& host, Sender send);
    ~Engine() override;

    juce::String startAudio();
    /** Name, sample rate and block size of the open audio device. */
    juce::var deviceInfo();
    void handleMessage (const juce::var& msg);

    // AudioIODeviceCallback
    void audioDeviceIOCallbackWithContext (const float* const* inputs, int numInputs, float* const* outputs, int numOutputs,
                                           int numSamples, const juce::AudioIODeviceCallbackContext&) override;
    void audioDeviceAboutToStart (juce::AudioIODevice*) override;
    void audioDeviceStopped() override;

    // AudioPlayHead (plug-ins and tempo-synced built-ins ask it for tempo and position from the audio thread)
    juce::Optional<PositionInfo> getPosition() const override;

private:
    PluginHost& host;
    Sender send;
    juce::AudioDeviceManager deviceManager;
    double sampleRate = 48000.0;
    int blockSize = 512;

    // ---- model (message thread)
    std::map<juce::String, std::shared_ptr<ChannelNode>> channels;
    std::array<std::shared_ptr<InsertNode>, numInserts> inserts;
    std::map<juce::String, std::shared_ptr<const juce::AudioBuffer<float>>> samples;
    std::map<juce::String, double> sampleRates;
    juce::var lastProject, lastUi;
    std::vector<juce::String> channelOrder;
    std::vector<SeqEvent> events;
    std::vector<Snapshot::ClipRun> clipRuns;
    std::vector<std::shared_ptr<const void>> clipData;
    std::vector<Snapshot::AutoRun> autoRuns;
    struct AutoTarget
    {
        juce::String channel;  // channel id (chVol, chPan, chParam)
        int slot = 0;          // effect slot (fxParam)
        juce::String plugin;   // "ch:<id>" or "fx:<insert>:<slot>" (plugin)
        int pid = -1;          // plug-in parameter index
    };
    std::vector<AutoTarget> autoTargets;  // one per autoRuns entry, resolved to processors in publish()
    std::vector<juce::String> autoIds;  // automation id of each report slot
    juce::var mixerModel;               // the project's mixer array, for routing and sidechains
    double loopStart = 0.0, loopLength = 16.0, minPos = 0.0, currentBpm = 128.0;
    std::vector<Snapshot::Jump> jumps;
    std::vector<double> pauses;
    std::vector<Snapshot::MeterRun> meter;
    bool metronomeOn = false, songMode = false;
    std::shared_ptr<int> lifeToken = std::make_shared<int> (0);  // async callbacks check it before touching the engine
    std::atomic<Snapshot*> current { nullptr };
    std::vector<std::pair<juce::uint32, std::unique_ptr<Snapshot>>> graveyard;
    std::vector<std::pair<juce::uint32, std::shared_ptr<ProcessorSlot>>> retiredSlots;

    // By value on purpose: callers pass lastProject / lastUi, which this function reassigns (remember = false: an offline
    // render's project, which leaves them alone).
    void applyProject (juce::var project, juce::var ui, bool remember = true);
    void applyMixer (const juce::var& mixer, double bpm);
    void buildClips (const juce::var& project);
    void buildAutomation (const juce::var& project);
    void publish();
    void retire (std::shared_ptr<ProcessorSlot> slot);
    std::shared_ptr<ProcessorSlot> makeBuiltin (const juce::String& type, bool instrument);
    void loadPluginFor (const juce::String& target, const juce::var& pluginInfo, const juce::String& state);
    void installPlugin (const juce::String& target, std::unique_ptr<juce::AudioPluginInstance>, const juce::String& state);
    ProcessorSlot* findSlot (const juce::String& target) const;
    void sendStates (const juce::var& req);
    void sendParams (const juce::var& msg);
    void loadSample (const juce::var& msg);
    void timerCallback() override;

    // ---- audio device settings
    juce::File settingsFile() const;
    void saveDeviceSettings();
    juce::var describeDevices();
    void setDevice (const juce::var& msg);
    bool enableInputs();

    // ---- transport (requests from the message thread, state owned by the audio thread)
    std::atomic<int> playRequest { 0 }, stopRequest { 0 };
    std::atomic<double> requestedStart { 0.0 };
    int seenPlay = 0, seenStop = 0;
    std::atomic<bool> playing { false };
    std::atomic<double> position { 0.0 };
    // audio thread (or the render thread while it holds renderLock)
    double pos = 0.0, currentBpmAudio = 128.0;
    bool playingAudio = false;
    juce::int64 sampleCounter = 0;
    struct PendingOff
    {
        juce::int64 at = 0;
        ChannelNode* node = nullptr;
        uint8_t note = 0, channel = 1;
        float velocity = 0.5f;  // release velocity
    };
    std::array<PendingOff, 4096> pendingOffs {};
    int numPendingOffs = 0;
    int renderEnd = -1;                         // offline render: offset in the block where the music ended, -1 not yet
    bool silenceVoices = false;                 // set by a render: the next block chokes every channel (CC 123 + 120)
    std::atomic<double> pausedAt { -1.0 };      // a pause marker stopped the transport here (the timer tells the page)
    struct Click
    {
        int offset = 0;
        bool accent = false;
    };
    std::array<Click, 16> clicks {};
    int numClicks = 0, clickRemaining = 0, clickTotal = 1;
    double clickPhase = 0.0, clickFreq = 1000.0;
    // the stretches of the song the current block plays (several when it wraps around the loop or jumps)
    struct Segment
    {
        int offset = 0, length = 0;
        double from = 0.0, to = 0.0;  // steps
    };
    std::array<Segment, 16> segments {};
    int numSegments = 0;
    juce::MidiBuffer fxMidi;
    std::array<std::atomic<float>, maxAutoReports> autoReport;

    // Audio Logger: the last 60 seconds of the master, always recorded
    juce::AudioBuffer<float> logBuffer;
    int logWrite = 0, logFilled = 0;
    bool logging = true;
    void saveAudioLog (const juce::var& msg);

    std::vector<juce::AudioBuffer<float>> busBuffers;
    std::array<float, 2048> scope {};
    std::atomic<int> scopeWrite { 0 };

    // ---- audio recording from the input of the sound card
    juce::TimeSliceThread recThread { "Ritmo recorder" };
    std::unique_ptr<juce::AudioFormatWriter::ThreadedWriter> recOwned;
    std::atomic<juce::AudioFormatWriter::ThreadedWriter*> recWriter { nullptr };
    std::atomic<int> recPair { 0 };
    std::atomic<bool> recStarted { false };
    juce::File recFile;
    double recFrom = 0.0;
    juce::var recReq;
    std::array<float, maxBlock> silence {};
    void startRecording (const juce::var& msg);
    void finishRecording();

    // ---- preview of a file from the browser, mixed after the master
    struct Preview
    {
        juce::AudioBuffer<float> data;
        double rate = 44100.0;
    };
    std::vector<std::pair<std::unique_ptr<Preview>, juce::uint32>> previews;  // message thread: owner; second = time retired (0 = live)
    std::atomic<Preview*> previewNext { nullptr };
    std::atomic<bool> previewStop { false }, previewPlaying { false };
    std::atomic<float> previewVol { 0.8f };
    Preview* previewCur = nullptr;  // audio thread
    double previewPos = 0.0;
    bool rendering = false, previewWasPlaying = false;
    void startPreview (const juce::var& msg);
    void mixPreview (float* const* outputs, int numOutputs, int n);
    void processLiveEvent (Snapshot& s, ChannelNode& node, const LiveEvent& e);
    static void noteChokes (Snapshot& s, ChannelNode& node, int note, int midiChannel, int offset);

    // ---- offline render
    juce::CriticalSection renderLock;
    std::unique_ptr<juce::Thread> renderThread;
    void startRender (const juce::var& msg);

    void processBlock (const float* const* inputs, int numInputs, float* const* outputs, int numOutputs, int numSamples);
    void runSequencer (Snapshot& s, int numSamples);
    void scheduleNotes (Snapshot& s, double from, double to, int offset, int length, double sps);
    void scheduleClicks (Snapshot& s, double from, double to, int offset, int length, double sps);
    void flushOffs (Snapshot& s, int upTo);
    void runAutomation (Snapshot& s);
    void renderClips (Snapshot& s);
    void runInsert (Snapshot& s, int i, int n);
    void allNotesOff (Snapshot& s, int offset = 0);
    void clearAutomationOverrides (Snapshot& s);
    static void applyGainPan (float* l, float* r, int n, float& lastGain, float gain, float pan);

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (Engine)
};

} // namespace ritmo
