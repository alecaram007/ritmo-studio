#pragma once
/*
    Ritmo Engine — built-in instruments and effects.

    Native ports of the Web Audio instruments and effects in src/js/audio.js of the web app.
    They are plain juce::AudioProcessors so the engine treats them exactly like hosted plug-ins.

    Contract with the engine
    - Instruments: no audio input, stereo output; they respond to MIDI in processBlock().
        note on            starts a voice; velocity 1..127 maps to v = velocity / 127
        note off           releases sustained types (synth, pad, epiano, supersaw, fm4, organ, acid, and sampler when
                           params.cut == "note" or params.loop != "off"); drums, bass808, pluck and a non-looping sampler
                           with cut == "full" play their natural length (the sampler: to the end of its start..end region)
        CC 120 (all sound off)  chokes every voice with a fast (~10 ms) fade; the engine sends it to
                           open hi-hats when a closed hi-hat plays, and on stop
        CC 123 (all notes off)  releases every voice as a note off would
      Mono types (bass808, ohat, crash) choke their previous voice when a new note starts.
      Channel mono / portamento (BuiltinContext::mono, ::porta; Engine.trigger + glideTo of the web app):
        mono || porta > 0  a new note first chokes every sounding voice of the instrument with the CC 120 fade (every type;
                           acid only when the note does not slide, see below)
        porta > 0          once any note has been played on the instrument, the new voice starts at the pitch of the
                           previous note (remembered after it ended; CC 120 / 123 do not forget it) and glides to its own
                           with a one-pole of time constant porta / 3 (AudioParam.setTargetAtTime): synth, pad, supersaw
                           (every oscillator), epiano (carrier and modulator), fm4 (every operator), organ (drawbars),
                           pluck (playback rate), bass808 (replaces its own pitch drop), sampler (playback rate, under the
                           pitch envelope). Drums and acid do not glide.
      acid is monophonic and LEGATO (INSTRUMENTS.acid.legato): a note on that arrives while the sounding note is still
      held (no note off yet) does not retrigger; the pitch glides to the new note (and a velocity above 0.8 re-strikes
      the accent / filter envelope). A note off for a note number other than the sounding (newest) note is ignored, so
      the engine may send overlapping note on / note off pairs exactly as the sequencer plays them. Send the note off
      of a note BEFORE the note on of the next one at the same sample position to retrigger instead of sliding.
      Drum types are pitched by (note - ctx.root) semitones on top of their own tune parameter;
      melodic types play the MIDI note itself (sampler: note - root + params.pitch).
      MIDI channels: notes play on every channel 1..16 (the note colour of the piano roll); a note off releases a voice
      of the same note number started on the same channel (acid: any channel, see above); CC 120 / 123 act on every voice.
      Per-note expression, SysEx F0 7D 52 01 <note> <pan> <fine> <mx> <my> <rel> <porta 0/1> F7 (writeExpressionSysEx):
        it applies to the next note on of that note number in the same processBlock() (the engine sends it just before).
        fine   pitch offset in semitones (-1..1)
        pan    StereoPannerNode after the voice (equal-power for mono voices, the stereo law for stereo ones)
        mx     filter cutoff ('cut', sampler 'fcut') x 2^((mx - 0.5) * 4), clamped to the parameter range
        my     resonance ('res', sampler 'fres') x 2^((my - 0.5) * 2), clamped to the parameter range
        rel    release time 'r' x 2^((rel - 0.5) * 2), not clamped (read at note on or at note off, as the type reads 'r')
        porta  the voice glides from the pitch of the previous note on (as channel portamento, time ctx.porta or 0.1 s;
               no choke); drums and acid ignore it, like ctx.porta
      Slide, SysEx F0 7D 52 02 <channel 0..15> <note> <duration ms> F7 (writeSlideSysEx): every sounding voice started on
        MIDI channel <channel> + 1 and not yet released glides from its current pitch to <note>, linearly in semitones,
        then stays there. Melodic types only (synth, pad, supersaw, epiano, fm4, organ drawbars, pluck, bass808, sampler,
        acid); drums ignore it.
    - Effects: stereo in, stereo out, processed in place; MIDI is ignored. Two exceptions:
        ducker  sidechain: it declares a second, stereo input bus ("Sidechain", enabled by default), so its processBlock()
                receives a 4-channel buffer: channels 0-1 are the track signal (processed in place), channels 2-3 the
                key signal of the source track (read only, left untouched). With fewer than 4 channels it passes the
                signal through unchanged. Its 'src' parameter (the source track) is for the engine's routing only.
        gate    tempo-synced: it reads getPlayHead()->getPosition() at the start of every processBlock() (ppq position,
                bpm, isPlaying; ctx.bpm when the host gives no tempo) and advances the position sample by sample. With no
                play head, no ppq position, or the transport stopped, its gain returns to 1 (pass-through).
    - setParams() is called on the message thread while the audio thread may be inside processBlock():
      implementations must hand values over safely (atomics or a lock-free swap), never block the audio thread.
    - setParamValue() is the real-time automation path (see below); both write the same parameter store, so the last
      write wins.
    - Parameter names, ranges and defaults are those of INSTRUMENTS / FXDEFS in src/js/core.js.
*/
#include <juce_audio_processors/juce_audio_processors.h>
#include <memory>

namespace ritmo
{

struct BuiltinContext
{
    int root = 60;       // the channel's step note (ch.root)
    double bpm = 128.0;  // project tempo, used by tempo-synced effects (delay; gate without a host tempo)
    bool mono = false;   // ch.mono: one voice at a time (instruments only)
    double porta = 0.0;  // ch.porta: portamento time in seconds, 0 = off (instruments only; implies mono)
};

/** The per-note properties of the piano roll for one note of a built-in instrument. The defaults change nothing. */
struct NoteExpression
{
    float pan = 0.0f;   // -1..1
    float fine = 0.0f;  // -1..1 semitone
    float mx = 0.5f;    // 0..1, filter cutoff
    float my = 0.5f;    // 0..1, resonance
    float rel = 0.5f;   // 0..1, release time
    bool porta = false; // glide from the previous note

    bool isDefault() const noexcept { return pan == 0.0f && fine == 0.0f && mx == 0.5f && my == 0.5f && rel == 0.5f && ! porta; }
};

constexpr int expressionSysExSize = 17;
constexpr int slideSysExSize = 9;

/** F0 7D 52 01 <note> <pan> <fine> <mx> <my> <rel> <porta> F7: each value 14 bits as two 7-bit bytes, MSB first,
    -1..1 (pan, fine) or 0..1 (mx, my, rel) mapped linearly onto 0..16383; the code of a default value reads back exactly. */
void writeExpressionSysEx (juce::uint8* out, int note, const NoteExpression& e) noexcept;
bool readExpressionSysEx (const juce::uint8* data, int size, int& note, NoteExpression& e) noexcept;

/** F0 7D 52 02 <channel 0..15> <note> <duration in ms, 14 bits, 1..16383> F7. */
void writeSlideSysEx (juce::uint8* out, int channel, int note, double milliseconds) noexcept;
bool readSlideSysEx (const juce::uint8* data, int size, int& channel, int& note, double& milliseconds) noexcept;

class BuiltinProcessor : public juce::AudioProcessor
{
public:
    using juce::AudioProcessor::AudioProcessor;

    /** Applies the web app's parameter object (ch.params or slot.params) and the channel context. Message thread. */
    virtual void setParams (const juce::var& params, const BuiltinContext& ctx) = 0;

    /** Audio thread, real-time safe (no allocation, no locks): sets one NUMERIC parameter by its web-app key, e.g. "cut".
        Returns false for unknown or non-numeric keys. Values are clamped to the parameter range.

        Not automatable (returns false, the value is unchanged): select parameters (wave, w1, w2, alg, stages, pattern,
        mode, shape, type, time, pp, rev, and the sampler's cut, norm, loop, ftype, lshape), the delay's time (a select
        of beat fractions in the web app), the ducker's src (routing), and non-finite values.

        When the value is used
        - Effects: from the next processed sample (most gains and filter settings are smoothed over ~20 ms against
          zipper noise, exactly as after setParams()). The reverb's size rebuilds its impulse response on a background
          thread (generating it is not real-time work); the new impulse is crossfaded in some tens of ms later.
        - Instruments: like the web app, a voice reads the parameters when its note starts (the release parameters of
          epiano, fm4 and sampler - r and cut - when its note off arrives; acid's glide at every legato note, plus cut,
          env, decay, accent and gain when a legato note re-strikes the accent), so an automated value applies to the
          notes that start after the call, from the same sample on. Sounding notes keep their settings. */
    virtual bool setParamValue (const char* key, float value) noexcept
    {
        juce::ignoreUnused (key, value);
        return false;
    }

    /** Sampler only: the decoded sample. Other types ignore it. Message thread. */
    virtual void setSample (std::shared_ptr<const juce::AudioBuffer<float>> data, double dataSampleRate)
    {
        juce::ignoreUnused (data, dataSampleRate);
    }

    // Boilerplate shared by every built-in.
    const juce::String getName() const override { return name; }
    bool acceptsMidi() const override { return isInstrument; }
    bool producesMidi() const override { return false; }
    double getTailLengthSeconds() const override { return 0.0; }
    juce::AudioProcessorEditor* createEditor() override { return nullptr; }
    bool hasEditor() const override { return false; }
    int getNumPrograms() override { return 1; }
    int getCurrentProgram() override { return 0; }
    void setCurrentProgram (int) override {}
    const juce::String getProgramName (int) override { return {}; }
    void changeProgramName (int, const juce::String&) override {}
    void getStateInformation (juce::MemoryBlock&) override {}
    void setStateInformation (const void*, int) override {}

protected:
    juce::String name;
    bool isInstrument = true;
};

/** "kick", "snare", "clap", "hat", "ohat", "tom", "cowbell", "crash", "bass808",
    "synth", "pad", "pluck", "epiano", "sampler", "supersaw", "acid", "fm4", "organ".
    Returns nullptr for an unknown type. */
std::unique_ptr<BuiltinProcessor> createBuiltinInstrument (const juce::String& type);

/** "eq", "filter", "comp", "limiter", "dist", "delay", "reverb", "chorus",
    "phaser", "flanger", "bitcrush", "width", "gate", "tremolo", "ducker" (4-channel sidechain buffer, see above).
    Returns nullptr for an unknown type. */
std::unique_ptr<BuiltinProcessor> createBuiltinEffect (const juce::String& type);

} // namespace ritmo
