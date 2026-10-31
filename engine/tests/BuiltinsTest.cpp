// Offline test of every built-in instrument and effect (ritmo_builtins_test).
// Renders each processor at fixed settings, checks the output, and writes WAV files a human can listen to.
// Exit code 0 only if every check passes.
#include "builtins/Builtins.h"
#include <juce_audio_formats/juce_audio_formats.h>
#include <cmath>
#include <iostream>
#include <thread>
#include <vector>

namespace
{
using juce::String;
using Buffer = juce::AudioBuffer<float>;
using ProcessorPtr = std::unique_ptr<ritmo::BuiltinProcessor>;

constexpr double testRate = 48000.0;
constexpr int testBlock = 512;

int numPassed = 0, numFailed = 0;
juce::File renderDir;

bool check (bool ok, const String& what, const String& detail = {})
{
    if (ok)
        ++numPassed;
    else
        ++numFailed;

    std::cout << (ok ? "  PASS  " : "  FAIL  ") << what;

    if (detail.isNotEmpty())
        std::cout << "  [" << detail << "]";

    std::cout << std::endl;
    return ok;
}

String fmt (double v, int decimals = 4) { return String (v, decimals); }

//==============================================================================
// Parameter objects with the defaults of INSTRUMENTS / FXDEFS in src/js/core.js.
using Props = std::vector<std::pair<const char*, juce::var>>;

juce::var object (const Props& props)
{
    auto* obj = new juce::DynamicObject();

    for (const auto& prop : props)
        obj->setProperty (prop.first, prop.second);

    return juce::var (obj);
}

Props instrumentDefaults (const String& type)
{
    if (type == "kick")    return { { "tune", 0 }, { "decay", 0.5 }, { "punch", 0.55 }, { "click", 0.3 }, { "drive", 0.15 } };
    if (type == "snare")   return { { "tune", 0 }, { "decay", 0.22 }, { "tone", 0.45 }, { "snappy", 0.7 } };
    if (type == "clap")    return { { "tone", 1300 }, { "decay", 0.28 }, { "spread", 0.011 } };
    if (type == "hat")     return { { "tone", 0.6 }, { "decay", 0.07 } };
    if (type == "ohat")    return { { "tone", 0.55 }, { "decay", 0.42 } };
    if (type == "tom")     return { { "tune", 0 }, { "decay", 0.4 }, { "sweep", 0.5 } };
    if (type == "cowbell") return { { "tune", 0 }, { "decay", 0.3 } };
    if (type == "crash")   return { { "tone", 0.4 }, { "decay", 1.8 } };
    if (type == "bass808") return { { "decay", 1.2 }, { "glide", 0.3 }, { "drive", 0.3 }, { "tone", 2400 } };
    if (type == "synth")   return { { "w1", "sawtooth" }, { "w2", "square" }, { "mix", 0.35 }, { "det", 8 }, { "oct2", 0 }, { "cut", 2200 },
                                    { "res", 3 }, { "env", 0.4 }, { "a", 0.005 }, { "d", 0.35 }, { "s", 0.6 }, { "r", 0.25 }, { "gain", 0.6 } };
    if (type == "pad")     return { { "det", 22 }, { "cut", 1600 }, { "res", 1 }, { "a", 0.9 }, { "s", 0.8 }, { "r", 1.6 }, { "gain", 0.45 } };
    if (type == "pluck")   return { { "bright", 0.6 }, { "decay", 1.6 }, { "gain", 0.7 } };
    if (type == "epiano")  return { { "ratio", 1 }, { "index", 2.2 }, { "decay", 1.8 }, { "r", 0.35 }, { "trem", 0.2 }, { "gain", 0.55 } };
    if (type == "sampler") return { { "pitch", 0 }, { "gain", 1 }, { "cut", "full" }, { "rev", "fwd" }, { "start", 0 }, { "end", 1 },
                                    { "fin", 0 }, { "fout", 0 }, { "norm", "off" }, { "loop", "off" }, { "ls", 0 }, { "le", 1 },
                                    { "a", 0.002 }, { "h", 0 }, { "d", 0 }, { "s", 1 }, { "r", 0.05 }, { "ftype", "off" }, { "fcut", 20000 },
                                    { "fres", 0.7 }, { "fenv", 0 }, { "fa", 0.01 }, { "fd", 0.3 }, { "fs", 0 }, { "penv", 0 }, { "pd", 0.1 },
                                    { "lshape", "sine" }, { "lrate", 4 }, { "lvol", 0 }, { "lpan", 0 }, { "lcut", 0 }, { "lpit", 0 } };
    if (type == "supersaw") return { { "voices", 7 }, { "det", 25 }, { "mix", 0.6 }, { "width", 0.8 }, { "cut", 6000 }, { "res", 1 }, { "env", 0.2 },
                                     { "a", 0.01 }, { "d", 0.4 }, { "s", 0.75 }, { "r", 0.35 }, { "gain", 0.5 } };
    if (type == "acid")    return { { "wave", "sawtooth" }, { "cut", 500 }, { "res", 18 }, { "env", 0.6 }, { "decay", 0.35 }, { "accent", 0.5 },
                                    { "glide", 0.08 }, { "gain", 0.6 } };
    if (type == "fm4")     return { { "alg", "stack" }, { "r1", 1 }, { "r2", 2 }, { "r3", 3 }, { "r4", 1 }, { "i2", 2 }, { "i3", 1 }, { "i4", 0.5 },
                                    { "mdec", 0.6 }, { "msus", 0.3 }, { "a", 0.003 }, { "d", 0.8 }, { "s", 0.4 }, { "r", 0.3 }, { "gain", 0.5 } };
    if (type == "organ")   return { { "b1", 1 }, { "b2", 1 }, { "b3", 1 }, { "b4", 0 }, { "b5", 0 }, { "b6", 0 }, { "b7", 0 }, { "b8", 0 }, { "b9", 0 },
                                    { "perc", 0.3 }, { "vib", 0.3 }, { "click", 0.3 }, { "gain", 0.45 } };
    return {};
}

Props effectDefaults (const String& type)
{
    if (type == "eq")      return { { "low", 0 }, { "mid", 0 }, { "midf", 1000 }, { "high", 0 } };
    if (type == "filter")  return { { "type", "lowpass" }, { "freq", 8000 }, { "q", 0.7 } };
    if (type == "comp")    return { { "thr", -18 }, { "ratio", 4 }, { "att", 0.01 }, { "rel", 0.2 }, { "makeup", 4 } };
    if (type == "limiter") return { { "gain", 3 }, { "ceil", -1 } };
    if (type == "dist")    return { { "drive", 0.4 }, { "tone", 5000 }, { "mix", 1 }, { "out", 0.8 } };
    if (type == "delay")   return { { "time", "0.75" }, { "pp", "on" }, { "fb", 0.38 }, { "tone", 4000 }, { "mix", 0.3 } };
    if (type == "reverb")  return { { "size", 2.2 }, { "damp", 6000 }, { "pre", 0.02 }, { "mix", 0.25 } };
    if (type == "chorus")  return { { "rate", 0.8 }, { "depth", 0.5 }, { "mix", 0.45 } };
    if (type == "phaser")  return { { "rate", 0.5 }, { "depth", 0.6 }, { "freq", 800 }, { "stages", "6" }, { "fb", 0.4 }, { "mix", 0.5 } };
    if (type == "flanger") return { { "rate", 0.25 }, { "depth", 2 }, { "delay", 2.5 }, { "fb", 0.5 }, { "mix", 0.5 } };
    if (type == "bitcrush") return { { "bits", 8 }, { "down", 4 }, { "mix", 1 } };
    if (type == "width")   return { { "width", 1.4 }, { "gain", 1 } };
    if (type == "gate")    return { { "pattern", "16" }, { "depth", 1 }, { "smooth", 0.004 }, { "mix", 1 } };
    if (type == "tremolo") return { { "mode", "trem" }, { "shape", "sine" }, { "rate", 4 }, { "depth", 0.6 } };
    if (type == "ducker")  return { { "src", 1 }, { "thr", -30 }, { "range", 18 }, { "att", 0.005 }, { "rel", 0.2 } };
    return {};
}

Props with (Props props, const Props& changes)
{
    for (const auto& change : changes)
    {
        bool found = false;

        for (auto& prop : props)
        {
            if (String (prop.first) == change.first)
            {
                prop.second = change.second;
                found = true;
            }
        }

        if (! found)
            props.push_back (change);
    }

    return props;
}

const juce::StringArray instrumentTypes { "kick", "snare", "clap", "hat", "ohat", "tom", "cowbell", "crash",
                                          "bass808", "synth", "pad", "pluck", "epiano", "supersaw", "acid", "fm4", "organ" };
const juce::StringArray drumTypes { "kick", "snare", "clap", "hat", "ohat", "tom", "cowbell", "crash" };
const juce::StringArray sustainedTypes { "synth", "pad", "epiano", "supersaw", "acid", "fm4", "organ" };
const juce::StringArray effectTypes { "eq", "filter", "comp", "limiter", "dist", "delay", "reverb", "chorus",
                                      "phaser", "flanger", "bitcrush", "width", "gate", "tremolo", "ducker" };
const juce::StringArray newInstrumentTypes { "supersaw", "acid", "fm4", "organ" };
const juce::StringArray newEffectTypes { "phaser", "flanger", "bitcrush", "width", "gate", "tremolo", "ducker" };

ProcessorPtr makeInstrument (const String& type, const Props& props, int root = 60, double bpm = 120.0)
{
    auto p = ritmo::createBuiltinInstrument (type);

    if (p != nullptr)
        p->setParams (object (props), { root, bpm });

    return p;
}

/** With the channel context: mono / portamento. */
ProcessorPtr makeInstrument (const String& type, const Props& props, const ritmo::BuiltinContext& ctx)
{
    auto p = ritmo::createBuiltinInstrument (type);

    if (p != nullptr)
        p->setParams (object (props), ctx);

    return p;
}

ritmo::BuiltinContext channel (bool mono, double porta, int root = 60)
{
    ritmo::BuiltinContext ctx;
    ctx.root = root;
    ctx.bpm = 120.0;
    ctx.mono = mono;
    ctx.porta = porta;
    return ctx;
}

ProcessorPtr makeEffect (const String& type, const Props& props, double bpm = 120.0)
{
    auto p = ritmo::createBuiltinEffect (type);

    if (p != nullptr)
        p->setParams (object (props), { 60, bpm });

    return p;
}

//==============================================================================
struct Event
{
    enum Kind { on, off, cc };
    double time;
    Kind kind;
    int number;
    int value;
};

Event noteOn (double t, int note, int vel = 100) { return { t, Event::on, note, vel }; }
Event noteOff (double t, int note)               { return { t, Event::off, note, 0 }; }
Event controller (double t, int number)          { return { t, Event::cc, number, 0 }; }

juce::MidiMessage toMessage (const Event& e)
{
    switch (e.kind)
    {
        case Event::on:  return juce::MidiMessage::noteOn (1, e.number, (juce::uint8) e.value);
        case Event::off: return juce::MidiMessage::noteOff (1, e.number);
        case Event::cc:  return juce::MidiMessage::controllerEvent (1, e.number, e.value);
    }

    return {};
}

int toSample (double t, double rate) { return (int) std::lround (t * rate); }

/** Renders an instrument offline; events are placed sample-accurately in each block. */
Buffer renderInstrument (ritmo::BuiltinProcessor& p, double seconds, const std::vector<Event>& events,
                         double rate = testRate, int block = testBlock, bool prepare = true)
{
    if (prepare)
        p.prepareToPlay (rate, block);

    const int total = toSample (seconds, rate);
    Buffer out (2, total), buffer (2, block);
    juce::MidiBuffer midi;

    for (int pos = 0; pos < total; pos += block)
    {
        const int n = std::min (block, total - pos);
        buffer.setSize (2, n, false, false, true);
        midi.clear();

        for (const auto& e : events)
        {
            const int s = toSample (e.time, rate);

            if (s >= pos && s < pos + n)
                midi.addEvent (toMessage (e), s - pos);
        }

        p.processBlock (buffer, midi);

        for (int ch = 0; ch < 2; ++ch)
            out.copyFrom (ch, pos, buffer, ch, 0, n);
    }

    return out;
}

Buffer processEffect (ritmo::BuiltinProcessor& fx, const Buffer& input, double rate = testRate, int block = testBlock, bool prepare = true)
{
    if (prepare)
        fx.prepareToPlay (rate, block);

    const int total = input.getNumSamples();
    Buffer out (2, total), buffer (2, block);
    juce::MidiBuffer midi;

    for (int pos = 0; pos < total; pos += block)
    {
        const int n = std::min (block, total - pos);
        buffer.setSize (2, n, false, false, true);

        for (int ch = 0; ch < 2; ++ch)
            buffer.copyFrom (ch, 0, input, ch, pos, n);

        fx.processBlock (buffer, midi);

        for (int ch = 0; ch < 2; ++ch)
            out.copyFrom (ch, pos, buffer, ch, 0, n);
    }

    return out;
}

//==============================================================================
bool allFinite (const Buffer& b)
{
    for (int ch = 0; ch < b.getNumChannels(); ++ch)
        for (int i = 0; i < b.getNumSamples(); ++i)
            if (! std::isfinite (b.getSample (ch, i)))
                return false;

    return true;
}

float peak (const Buffer& b, int from = 0, int to = -1, int channel = -1)
{
    if (to < 0)
        to = b.getNumSamples();

    float m = 0.0f;

    for (int ch = 0; ch < b.getNumChannels(); ++ch)
        if (channel < 0 || channel == ch)
            for (int i = std::max (0, from); i < std::min (to, b.getNumSamples()); ++i)
                m = std::max (m, std::abs (b.getSample (ch, i)));

    return m;
}

double rms (const Buffer& b, int from, int to, int channel = -1)
{
    double sum = 0.0;
    int count = 0;

    for (int ch = 0; ch < b.getNumChannels(); ++ch)
    {
        if (channel >= 0 && channel != ch)
            continue;

        for (int i = std::max (0, from); i < std::min (to, b.getNumSamples()); ++i)
        {
            const double v = b.getSample (ch, i);
            sum += v * v;
            ++count;
        }
    }

    return count > 0 ? std::sqrt (sum / count) : 0.0;
}

int argMax (const Buffer& b, int channel, int from, int to)
{
    int best = from;

    for (int i = from; i < std::min (to, b.getNumSamples()); ++i)
        if (std::abs (b.getSample (channel, i)) > std::abs (b.getSample (channel, best)))
            best = i;

    return best;
}

int firstAbove (const Buffer& b, float threshold, int from = 0)
{
    for (int i = from; i < b.getNumSamples(); ++i)
        for (int ch = 0; ch < b.getNumChannels(); ++ch)
            if (std::abs (b.getSample (ch, i)) > threshold)
                return i;

    return -1;
}

int lastAbove (const Buffer& b, float threshold)
{
    for (int i = b.getNumSamples() - 1; i >= 0; --i)
        for (int ch = 0; ch < b.getNumChannels(); ++ch)
            if (std::abs (b.getSample (ch, i)) > threshold)
                return i;

    return -1;
}

float maxDifference (const Buffer& a, const Buffer& b, int from = 0)
{
    float m = 0.0f;

    for (int ch = 0; ch < std::min (a.getNumChannels(), b.getNumChannels()); ++ch)
        for (int i = from; i < std::min (a.getNumSamples(), b.getNumSamples()); ++i)
            m = std::max (m, std::abs (a.getSample (ch, i) - b.getSample (ch, i)));

    return m;
}

/** Frequency from upward zero crossings (linear interpolation between samples). */
double estimateFrequency (const Buffer& b, int channel, int from, int to, double rate)
{
    double first = -1.0, last = -1.0;
    int crossings = 0;

    for (int i = std::max (1, from); i < std::min (to, b.getNumSamples()); ++i)
    {
        const float x0 = b.getSample (channel, i - 1), x1 = b.getSample (channel, i);

        if (x0 < 0.0f && x1 >= 0.0f)
        {
            const double t = (double) (i - 1) + (double) (-x0 / (x1 - x0));

            if (first < 0.0)
                first = t;

            last = t;
            ++crossings;
        }
    }

    return crossings > 1 ? (double) (crossings - 1) * rate / (last - first) : 0.0;
}

/** Frequency from the normalised autocorrelation peak between fMin and fMax (parabolic interpolation of the peak);
    robust for harmonic-rich or noisy tones (pluck) where zero crossings are not one per period. */
double periodFrequency (const Buffer& b, int channel, int from, int to, double fMin, double fMax, double rate)
{
    const int minLag = std::max (2, (int) std::floor (rate / fMax)), maxLag = (int) std::ceil (rate / fMin);
    to = std::min (to, b.getNumSamples());
    from = std::max (0, from);

    if (to - from <= maxLag + 8)
        return 0.0;

    const float* x = b.getReadPointer (channel);
    std::vector<double> r ((size_t) maxLag + 2, -1.0);

    for (int lag = minLag - 1; lag <= maxLag + 1; ++lag)
    {
        double sxy = 0.0, sxx = 0.0, syy = 0.0;

        for (int i = from; i + lag < to; ++i)
        {
            sxy += (double) x[i] * x[i + lag];
            sxx += (double) x[i] * x[i];
            syy += (double) x[i + lag] * x[i + lag];
        }

        r[(size_t) lag] = sxy / std::sqrt (std::max (1.0e-30, sxx * syy));
    }

    // the shortest lag whose correlation peak is within 5 % of the best one (avoids octave errors at 2T, 3T)
    double highest = -1.0;

    for (int lag = minLag; lag <= maxLag; ++lag)
        highest = std::max (highest, r[(size_t) lag]);

    int best = minLag;

    for (int lag = minLag; lag <= maxLag; ++lag)
    {
        if (r[(size_t) lag] >= 0.95 * highest && r[(size_t) lag] >= r[(size_t) lag - 1] && r[(size_t) lag] >= r[(size_t) lag + 1])
        {
            best = lag;
            break;
        }
    }

    const double a = r[(size_t) best - 1], m = r[(size_t) best], c = r[(size_t) best + 1], denom = a - 2.0 * m + c;
    const double shift = std::abs (denom) > 1.0e-12 ? juce::jlimit (-0.5, 0.5, 0.5 * (a - c) / denom) : 0.0;
    return rate / ((double) best + shift);
}

/** Amplitude of the 'freq' component (Goertzel). */
double toneLevel (const Buffer& b, int channel, int from, int to, double freq, double rate)
{
    const double w = juce::MathConstants<double>::twoPi * freq / rate, coeff = 2.0 * std::cos (w);
    double s1 = 0.0, s2 = 0.0;
    int n = 0;

    for (int i = from; i < std::min (to, b.getNumSamples()); ++i, ++n)
    {
        const double s0 = (double) b.getSample (channel, i) + coeff * s1 - s2;
        s2 = s1;
        s1 = s0;
    }

    const double power = s1 * s1 + s2 * s2 - coeff * s1 * s2;
    return n > 0 ? 2.0 * std::sqrt (std::max (0.0, power)) / n : 0.0;
}

double toDb (double ratio) { return 20.0 * std::log10 (std::max (ratio, 1.0e-12)); }

Buffer sine (double freq, double amplitude, double seconds, double rate = testRate)
{
    Buffer b (2, toSample (seconds, rate));

    for (int i = 0; i < b.getNumSamples(); ++i)
    {
        const auto v = (float) (amplitude * std::sin (juce::MathConstants<double>::twoPi * freq * i / rate));
        b.setSample (0, i, v);
        b.setSample (1, i, v);
    }

    return b;
}

Buffer silence (double seconds, double rate = testRate)
{
    Buffer b (2, toSample (seconds, rate));
    b.clear();
    return b;
}

Buffer impulseAt (double t, double seconds, float amplitude = 1.0f, double rate = testRate)
{
    Buffer b (2, toSample (seconds, rate));
    b.clear();
    b.setSample (0, toSample (t, rate), amplitude);
    b.setSample (1, toSample (t, rate), amplitude);
    return b;
}

/** 100 ms noise bursts every 400 ms plus a full-scale impulse at 1.6 s. */
Buffer noiseBursts (double seconds, float amplitude, double rate = testRate)
{
    juce::Random random (1234);
    Buffer b (2, toSample (seconds, rate));
    b.clear();

    for (int i = 0; i < b.getNumSamples(); ++i)
    {
        const double t = i / rate;

        if (std::fmod (t, 0.4) < 0.1)
            for (int ch = 0; ch < 2; ++ch)
                b.setSample (ch, i, amplitude * (random.nextFloat() * 2.0f - 1.0f));
    }

    if (seconds > 1.7)
        for (int ch = 0; ch < 2; ++ch)
            b.setSample (ch, toSample (1.6, rate), 1.0f);

    return b;
}

void writeWav (const String& fileName, const Buffer& b, double rate = testRate)
{
    const auto file = renderDir.getChildFile (fileName);
    file.deleteFile();
    std::unique_ptr<juce::OutputStream> stream = std::make_unique<juce::FileOutputStream> (file);
    juce::WavAudioFormat wav;
    // 32-bit float, so levels above 0 dBFS are kept for analysis
    auto writer = wav.createWriterFor (stream, juce::AudioFormatWriterOptions{}.withSampleRate (rate)
                                                                              .withNumChannels (b.getNumChannels())
                                                                              .withBitsPerSample (32)
                                                                              .withSampleFormat (juce::AudioFormatWriterOptions::SampleFormat::floatingPoint));

    if (writer != nullptr)
        writer->writeFromAudioSampleBuffer (b, 0, b.getNumSamples());
    else
        std::cout << "  (could not write " << fileName << ")" << std::endl;
}

//==============================================================================
void testInstrument (const String& type)
{
    std::cout << "\n[instrument " << type << "]" << std::endl;
    const auto defaults = instrumentDefaults (type);
    const bool isDrum = drumTypes.contains (type);
    const bool sustains = sustainedTypes.contains (type);

    if (! check (makeInstrument (type, defaults) != nullptr, type + ": created"))
        return;

    // 1. a short phrase at 48 kHz / 512
    {
        auto inst = makeInstrument (type, defaults);
        const std::vector<Event> events { noteOn (0.0, 60), noteOff (0.25, 60), noteOn (0.5, isDrum ? 60 : 64, 70), noteOff (0.75, isDrum ? 60 : 64),
                                          noteOn (1.0, isDrum ? 63 : 67, 127), noteOff (1.3, isDrum ? 63 : 67) };
        const auto out = renderInstrument (*inst, 2.0, events);
        const float pk = peak (out);
        check (allFinite (out), type + ": output finite");
        check (pk > 0.01f && pk < 4.0f, type + ": peak in (0.01, 4)", "peak " + fmt (pk));
        writeWav ("inst_" + type + ".wav", out);
    }

    // 1b. twelve notes, one every 0.5 s (a chromatic run, or hits on the root for drums), for listening and level statistics
    {
        auto inst = makeInstrument (type, defaults);
        std::vector<Event> events;

        for (int i = 0; i < 12; ++i)
        {
            const int note = isDrum ? 60 : 48 + i;
            events.push_back (noteOn (i * 0.5, note, 100));
            events.push_back (noteOff (i * 0.5 + 0.4, note));
        }

        const auto out = renderInstrument (*inst, 6.5, events);
        check (allFinite (out) && peak (out) > 0.01f && peak (out) < 4.0f, type + ": twelve-note run", "peak " + fmt (peak (out)));
        writeWav ("inst_" + type + "_run.wav", out);
    }

    // 2. sample-accurate note start inside a block
    {
        auto inst = makeInstrument (type, defaults);
        const int at = 1000; // block 1, offset 488
        const auto out = renderInstrument (*inst, 0.1, { noteOn (at / testRate, 60) });
        const int first = firstAbove (out, 0.0f);
        check (first >= at && first <= at + 4, type + ": note starts on its sample", "first sample " + String (first) + ", expected " + String (at));
    }

    // 3. note off: shortens sustained types, ignored by the others
    {
        auto withOff = makeInstrument (type, defaults);
        auto withoutOff = makeInstrument (type, defaults);
        const auto a = renderInstrument (*withOff, 2.0, { noteOn (0.0, 60), noteOff (0.25, 60) });
        const auto b = renderInstrument (*withoutOff, 2.0, { noteOn (0.0, 60) });

        if (sustains)
        {
            const double ra = rms (a, toSample (1.5, testRate), toSample (2.0, testRate));
            const double rb = rms (b, toSample (1.5, testRate), toSample (2.0, testRate));
            check (rb > 1.0e-3 && ra < 0.1 * rb, type + ": note off shortens the note", "rms 1.5-2 s with off " + fmt (ra, 6) + ", held " + fmt (rb, 6));
        }
        else
        {
            const float diff = maxDifference (a, b);
            check (diff < 1.0e-6f, type + ": note off ignored (plays its natural length)", "max diff " + fmt (diff, 8));
        }
    }

    // 4. CC 120 chokes within ~10 ms; CC 123 releases like note off
    {
        auto inst = makeInstrument (type, defaults);
        const auto out = renderInstrument (*inst, 1.0, { noteOn (0.0, 60), controller (0.2, 120) });
        const float after = peak (out, toSample (0.2 + 0.012, testRate));
        check (after < 1.0e-6f, type + ": CC 120 silences within 12 ms", "peak after " + fmt (after, 8));

        if (sustains)
        {
            auto inst2 = makeInstrument (type, defaults);
            auto inst3 = makeInstrument (type, defaults);
            const auto released = renderInstrument (*inst2, 2.0, { noteOn (0.0, 60), noteOn (0.0, 64), controller (0.25, 123) });
            const auto held = renderInstrument (*inst3, 2.0, { noteOn (0.0, 60), noteOn (0.0, 64) });
            const double ra = rms (released, toSample (1.5, testRate), toSample (2.0, testRate));
            const double rb = rms (held, toSample (1.5, testRate), toSample (2.0, testRate));
            check (ra < 0.1 * rb, type + ": CC 123 releases held notes", "rms 1.5-2 s " + fmt (ra, 6) + " vs held " + fmt (rb, 6));
        }
    }

    // 5. other sample rates and odd block sizes
    for (auto [rate, block] : { std::pair<double, int> { 44100.0, 37 }, std::pair<double, int> { 96000.0, 1000 } })
    {
        auto inst = makeInstrument (type, defaults);
        const auto out = renderInstrument (*inst, 1.0, { noteOn (0.0, 60), noteOn (0.013, 67), noteOff (0.3, 60), noteOff (0.31, 67) }, rate, block);
        const float pk = peak (out);
        check (allFinite (out) && pk > 0.01f && pk < 4.0f, type + ": " + String (rate / 1000.0, 1) + " kHz, block " + String (block),
               "peak " + fmt (pk));
    }

    // 6. polyphony stress: 40 overlapping notes (voice stealing) stay finite
    {
        auto inst = makeInstrument (type, defaults);
        std::vector<Event> events;

        for (int i = 0; i < 40; ++i)
            events.push_back (noteOn (i * 0.01, 48 + (i * 7) % 36, 60 + i));

        const auto out = renderInstrument (*inst, 1.0, events);
        check (allFinite (out) && peak (out) < 16.0f, type + ": 40 overlapping notes (voice stealing)", "peak " + fmt (peak (out)));
    }
}

void testMonoChoke()
{
    std::cout << "\n[mono types choke their previous voice]" << std::endl;

    {
        auto a = makeInstrument ("bass808", instrumentDefaults ("bass808"));
        auto b = makeInstrument ("bass808", instrumentDefaults ("bass808"));
        const auto both = renderInstrument (*a, 1.5, { noteOn (0.0, 36, 127), noteOn (0.3, 43) });
        const auto second = renderInstrument (*b, 1.5, { noteOn (0.3, 43) });
        const float diff = maxDifference (both, second, toSample (0.3 + 0.016, testRate));
        check (diff < 1.0e-5f, "bass808: first note gone 15 ms after the second starts", "max diff " + fmt (diff, 8));
    }

    for (auto type : { "ohat", "crash" })
    {
        const auto props = with (instrumentDefaults (type), { { "decay", String (type) == "ohat" ? 1.5 : 4.0 } });
        auto a = makeInstrument (type, props);
        auto b = makeInstrument (type, props);
        const auto both = renderInstrument (*a, 1.0, { noteOn (0.0, 60, 127), noteOn (0.3, 60, 10) });
        const auto second = renderInstrument (*b, 1.0, { noteOn (0.3, 60, 10) });
        const int from = toSample (0.32, testRate), to = toSample (0.6, testRate);
        const double ratio = rms (both, from, to) / std::max (1.0e-12, rms (second, from, to));
        check (ratio > 0.85 && ratio < 1.15, String (type) + ": loud first note choked by a quiet second one", "rms ratio " + fmt (ratio));
    }
}

//==============================================================================
std::shared_ptr<const Buffer> makeSample (double rate, int channels)
{
    // 0.5 s; left 440 Hz, right 660 Hz; amplitude rising from 0.1 to 1 (to tell forward from reverse)
    auto b = std::make_shared<Buffer> (channels, toSample (0.5, rate));

    for (int i = 0; i < b->getNumSamples(); ++i)
    {
        const double t = i / rate, amp = 0.1 + 0.9 * (double) i / b->getNumSamples();

        for (int ch = 0; ch < channels; ++ch)
            b->setSample (ch, i, (float) (amp * std::sin (juce::MathConstants<double>::twoPi * (ch == 0 ? 440.0 : 660.0) * t)));
    }

    return b;
}

void testSampler()
{
    std::cout << "\n[instrument sampler]" << std::endl;
    const double sampleRate = 44100.0; // differs from the processing rate on purpose
    const auto mono = makeSample (sampleRate, 1);
    const auto stereo = makeSample (sampleRate, 2);
    const auto defaults = instrumentDefaults ("sampler");

    auto playOnce = [&] (const Props& props, std::shared_ptr<const Buffer> sample, const std::vector<Event>& events, double seconds)
    {
        auto inst = makeInstrument ("sampler", props);
        inst->prepareToPlay (testRate, testBlock);

        if (sample != nullptr)
            inst->setSample (sample, sampleRate);

        return renderInstrument (*inst, seconds, events, testRate, testBlock, false);
    };

    {
        const auto out = playOnce (defaults, nullptr, { noteOn (0.0, 60) }, 0.5);
        check (allFinite (out) && peak (out) < 1.0e-9f, "sampler: silent without a sample");
    }

    {
        const auto out = playOnce (defaults, mono, { noteOn (0.0, 60) }, 1.0);
        const double length = lastAbove (out, 1.0e-4f) / testRate;
        const double f = estimateFrequency (out, 0, toSample (0.05, testRate), toSample (0.45, testRate), testRate);
        check (allFinite (out) && std::abs (length - 0.5) < 0.01, "sampler: root note plays the whole sample", "length " + fmt (length) + " s");
        check (std::abs (f - 440.0) < 2.0, "sampler: root note at original pitch (44.1 kHz sample at 48 kHz)", fmt (f, 2) + " Hz");
        check (peak (out) > 0.3f && peak (out) < 1.0f, "sampler: mono sample level", "peak " + fmt (peak (out)));
        writeWav ("inst_sampler.wav", out);
    }

    {
        const auto out = playOnce (defaults, mono, { noteOn (0.0, 72) }, 1.0);
        const double length = lastAbove (out, 1.0e-4f) / testRate;
        const double f = estimateFrequency (out, 0, toSample (0.02, testRate), toSample (0.22, testRate), testRate);
        check (std::abs (length - 0.25) < 0.01 && std::abs (f - 880.0) < 4.0, "sampler: note +12 plays an octave up, half as long",
               fmt (f, 2) + " Hz, " + fmt (length) + " s");
    }

    {
        const auto out = playOnce (with (defaults, { { "pitch", -12 } }), mono, { noteOn (0.0, 60) }, 1.5);
        const double length = lastAbove (out, 1.0e-4f) / testRate;
        const double f = estimateFrequency (out, 0, toSample (0.1, testRate), toSample (0.9, testRate), testRate);
        check (std::abs (length - 1.0) < 0.01 && std::abs (f - 220.0) < 2.0, "sampler: pitch -12 plays an octave down, twice as long",
               fmt (f, 2) + " Hz, " + fmt (length) + " s");
    }

    {
        const auto fwd = playOnce (defaults, mono, { noteOn (0.0, 60) }, 0.6);
        const auto rev = playOnce (with (defaults, { { "rev", "rev" } }), mono, { noteOn (0.0, 60) }, 0.6);
        const int a0 = 0, a1 = toSample (0.1, testRate), b0 = toSample (0.38, testRate), b1 = toSample (0.48, testRate);
        const bool fwdRises = rms (fwd, a0, a1) < 0.5 * rms (fwd, b0, b1);
        const bool revFalls = rms (rev, a0, a1) > 2.0 * rms (rev, b0, b1);
        check (fwdRises && revFalls, "sampler: rev plays the sample backwards",
               "fwd " + fmt (rms (fwd, a0, a1)) + " -> " + fmt (rms (fwd, b0, b1)) + ", rev " + fmt (rms (rev, a0, a1)) + " -> " + fmt (rms (rev, b0, b1)));
        writeWav ("inst_sampler_reverse.wav", rev);
    }

    {
        const auto cut = playOnce (with (defaults, { { "cut", "note" } }), mono, { noteOn (0.0, 60), noteOff (0.1, 60) }, 0.6);
        const auto full = playOnce (defaults, mono, { noteOn (0.0, 60), noteOff (0.1, 60) }, 0.6);
        const float cutTail = peak (cut, toSample (0.1 + 0.05 * 2 + 0.02 + 0.002, testRate));
        const float fullTail = peak (full, toSample (0.3, testRate), toSample (0.45, testRate));
        check (cutTail < 1.0e-9f && fullTail > 0.1f, "sampler: cut=note releases on note off, cut=full ignores it",
               "after release " + fmt (cutTail, 8) + ", full " + fmt (fullTail));
    }

    {
        const auto out = playOnce (defaults, mono, { noteOn (0.0, 60), controller (0.2, 120) }, 0.5);
        check (peak (out, toSample (0.212, testRate)) < 1.0e-9f, "sampler: CC 120 chokes");
    }

    {
        const auto out = playOnce (defaults, stereo, { noteOn (0.0, 60, 127) }, 0.6);
        const double fl = estimateFrequency (out, 0, toSample (0.05, testRate), toSample (0.45, testRate), testRate);
        const double fr = estimateFrequency (out, 1, toSample (0.05, testRate), toSample (0.45, testRate), testRate);
        check (std::abs (fl - 440.0) < 2.0 && std::abs (fr - 660.0) < 3.0 && peak (out) > 0.9f, "sampler: stereo sample keeps its channels at unity",
               fmt (fl, 1) + " / " + fmt (fr, 1) + " Hz, peak " + fmt (peak (out)));
    }

    {
        // replacing the sample while it plays: old voices stop, the next note uses the new one
        auto inst = makeInstrument ("sampler", defaults);
        inst->prepareToPlay (testRate, testBlock);
        inst->setSample (mono, sampleRate);
        auto first = renderInstrument (*inst, 0.2, { noteOn (0.05, 60) }, testRate, testBlock, false);
        inst->setSample (stereo, sampleRate);
        auto second = renderInstrument (*inst, 0.5, { noteOn (0.1, 60, 127) }, testRate, testBlock, false);
        const double fr = estimateFrequency (second, 1, toSample (0.15, testRate), toSample (0.45, testRate), testRate);
        inst->setSample (nullptr, 0.0);
        auto third = renderInstrument (*inst, 0.2, { noteOn (0.0, 60) }, testRate, testBlock, false);
        check (allFinite (first) && allFinite (second) && std::abs (fr - 660.0) < 3.0 && peak (third) < 1.0e-9f,
               "sampler: sample replaced and cleared while running", "right channel " + fmt (fr, 1) + " Hz after the swap");
    }

    {
        auto inst = makeInstrument ("sampler", defaults);
        inst->prepareToPlay (44100.0, 37);
        inst->setSample (stereo, sampleRate);
        const auto out = renderInstrument (*inst, 1.0, { noteOn (0.0, 60), noteOn (0.1, 55), noteOff (0.3, 60) }, 44100.0, 37, false);
        check (allFinite (out) && peak (out) > 0.1f && peak (out) < 4.0f, "sampler: 44.1 kHz, block 37", "peak " + fmt (peak (out)));
    }
}

//==============================================================================
/** A constant-amplitude sine (right channel at 1.5 x the frequency). */
std::shared_ptr<const Buffer> toneSample (double rate, int channels, double seconds, double freq, double amplitude)
{
    auto b = std::make_shared<Buffer> (channels, toSample (seconds, rate));

    for (int i = 0; i < b->getNumSamples(); ++i)
        for (int ch = 0; ch < channels; ++ch)
            b->setSample (ch, i, (float) (amplitude * std::sin (juce::MathConstants<double>::twoPi * freq * (ch == 0 ? 1.0 : 1.5) * i / rate)));

    return b;
}

/** A band-limited sawtooth (additive, harmonics below 8 kHz), mono. */
std::shared_ptr<const Buffer> sawSample (double rate, double seconds, double freq, double amplitude)
{
    auto b = std::make_shared<Buffer> (1, toSample (seconds, rate));
    b->clear();

    for (int k = 1; k * freq < 8000.0; ++k)
        for (int i = 0; i < b->getNumSamples(); ++i)
            b->addSample (0, i, (float) (amplitude * 0.6 / k * std::sin (juce::MathConstants<double>::twoPi * freq * k * i / rate)));

    return b;
}

Buffer playSampler (const Props& props, std::shared_ptr<const Buffer> sample, double sampleRate, const std::vector<Event>& events,
                    double seconds, const ritmo::BuiltinContext& ctx = channel (false, 0.0), double rate = testRate, int block = testBlock)
{
    auto inst = makeInstrument ("sampler", props, ctx);
    inst->prepareToPlay (rate, block);

    if (sample != nullptr)
        inst->setSample (sample, sampleRate);

    return renderInstrument (*inst, seconds, events, rate, block, false);
}

/** The sampler as it was before the new parameters (pitch, gain, a, rev; one note at the root 60), sample for sample:
    Hermite playback at 2^((note - 60 + pitch) / 12) * sampleRate / rate, a linear attack to velocity * gain evaluated like
    SegEnv (repeated addition), the mono -3 dB per side. */
Buffer referenceSampler (const Buffer& smp, double smpRate, int note, int velocity, float pitch, float gain, float attack, bool reverse,
                         double seconds, double rate = testRate)
{
    const int length = smp.getNumSamples(), total = toSample (seconds, rate);
    const bool stereo = smp.getNumChannels() > 1;
    Buffer out (2, total);
    out.clear();
    const float vel = juce::jlimit (0.02f, 1.0f, (float) velocity / 127.0f);
    const double step = std::pow (2.0, ((double) (note - 60) + pitch) / 12.0) * smpRate / rate;
    const double peakValue = vel * gain;
    const auto n = (int64_t) std::llround (std::max (0.001, (double) attack) * rate);
    const double inc = peakValue / (double) n;
    double value = 0.0, pos = 0.0;

    const auto at = [&] (int ch, int i) { return i < 0 || i >= length ? 0.0f : smp.getSample (ch, reverse ? length - 1 - i : i); };
    const auto interpolate = [&] (int ch, int k, float t)
    {
        const float p0 = at (ch, k - 1), p1 = at (ch, k), p2 = at (ch, k + 1), p3 = at (ch, k + 2);
        const float c1 = 0.5f * (p2 - p0);
        const float c2 = p0 - 2.5f * p1 + 2.0f * p2 - 0.5f * p3;
        const float c3 = 0.5f * (p3 - p0) + 1.5f * (p1 - p2);
        return ((c3 * t + c2) * t + c1) * t + p1;
    };

    for (int i = 0; i < total && pos < (double) length; ++i)
    {
        const double whole = std::floor (pos);
        const int k = (int) whole;
        const auto t = (float) (pos - whole);
        const float g = (float) value * 1.0f;

        if (stereo)
        {
            out.setSample (0, i, interpolate (0, k, t) * g);
            out.setSample (1, i, interpolate (1, k, t) * g);
        }
        else
        {
            const float s = interpolate (0, k, t) * g;
            out.setSample (0, i, s * 0.70710678f);
            out.setSample (1, i, s * 0.70710678f);
        }

        if (i + 1 >= n)
            value = peakValue;
        else
            value += inc;

        pos += step;
    }

    return out;
}

void testSamplerOptions()
{
    std::cout << "\n[sampler: region, fades, normalise, loops, AHDSR, filter, pitch envelope, LFO]" << std::endl;
    const double sr = 44100.0;
    const auto rising = makeSample (sr, 1);          // 0.5 s, 440 Hz, amplitude 0.1 -> 1
    const auto risingStereo = makeSample (sr, 2);
    const auto tone = toneSample (sr, 1, 2.0, 440.0, 0.8);
    const auto tone220 = toneSample (sr, 1, 1.0, 220.0, 0.8);
    const auto saw = sawSample (sr, 2.0, 220.0, 0.8);
    const auto defaults = instrumentDefaults ("sampler");
    const auto ms = [] (double seconds) { return toSample (seconds, testRate); };

    // defaults reproduce the previous sampler exactly
    {
        bool ok = true;
        String detail;
        struct Case { std::shared_ptr<const Buffer> smp; int note, vel; float pitch, gain, attack; bool rev; };
        const Case cases[] = { { rising, 60, 100, 0.0f, 1.0f, 0.002f, false }, { rising, 67, 127, -5.0f, 0.8f, 0.02f, true },
                               { risingStereo, 55, 64, 3.0f, 1.3f, 0.002f, false }, { risingStereo, 72, 100, 0.0f, 0.5f, 0.3f, true } };

        for (const auto& c : cases)
        {
            const auto props = with (defaults, { { "pitch", c.pitch }, { "gain", c.gain }, { "a", c.attack }, { "rev", c.rev ? "rev" : "fwd" } });
            const auto out = playSampler (props, c.smp, sr, { noteOn (0.0, c.note, c.vel) }, 1.2);
            const auto ref = referenceSampler (*c.smp, sr, c.note, c.vel, c.pitch, c.gain, c.attack, c.rev, 1.2);
            const float diff = maxDifference (out, ref);
            const bool same = ! (diff > 0.0f);
            ok = ok && same && peak (ref) > 0.05f;

            if (! same)
                detail << "note " << c.note << ": max diff " << fmt (diff, 9) << " ";
        }

        check (ok, "sampler: default new parameters reproduce the previous output sample for sample", detail);
    }

    // every option renders finite, non-silent audio (mono and stereo samples, two rates / block sizes)
    {
        const std::vector<Props> options {
            { { "start", 0.3 } }, { { "end", 0.6 } }, { { "fin", 0.1 } }, { { "fout", 0.1 } }, { { "norm", "on" } },
            { { "loop", "fwd" }, { "ls", 0.2 }, { "le", 0.7 } }, { { "loop", "ping" }, { "ls", 0.2 }, { "le", 0.7 } },
            { { "loop", "ping" }, { "ls", 0.9 }, { "le", 0.2 }, { "start", 0.95 } },
            { { "a", 0.05 }, { "h", 0.05 }, { "d", 0.1 }, { "s", 0.4 }, { "r", 0.3 }, { "cut", "note" } },
            { { "ftype", "lp" }, { "fcut", 1500 } }, { { "ftype", "lp24" }, { "fcut", 1500 }, { "fres", 12 } },
            { { "ftype", "hp" }, { "fcut", 300 } }, { { "ftype", "bp" }, { "fcut", 440 }, { "fres", 4 } },
            { { "ftype", "notch" }, { "fcut", 2000 } }, { { "ftype", "lp" }, { "fcut", 400 }, { "fenv", 0.7 }, { "fs", 0.3 } },
            { { "ftype", "hp" }, { "fcut", 4000 }, { "fenv", -0.8 } }, { { "penv", 12 } }, { { "penv", -24 }, { "pd", 2 } },
            { { "lvol", 1 }, { "lshape", "triangle" } }, { { "lvol", 0.5 }, { "lshape", "square" } }, { { "lvol", 0.7 }, { "lshape", "sawtooth" } },
            { { "lpan", 1 }, { "lrate", 8 } }, { { "ftype", "lp" }, { "fcut", 800 }, { "lcut", 1 } }, { { "lpit", 2 }, { "lrate", 20 } },
            { { "loop", "ping" }, { "ftype", "lp24" }, { "fenv", 1 }, { "penv", 7 }, { "lvol", 1 }, { "lpan", 1 }, { "lcut", 1 }, { "lpit", 1 },
              { "fin", 0.2 }, { "norm", "on" }, { "a", 0.2 }, { "h", 0.1 }, { "d", 0.5 }, { "s", 0.5 }, { "start", 0.1 }, { "end", 0.9 } } };
        bool ok = true;
        String detail;
        int index = 0;

        for (const auto& option : options)
        {
            for (const auto& smp : { rising, risingStereo })
            {
                for (auto [rate, block] : { std::pair<double, int> { 48000.0, 512 }, std::pair<double, int> { 44100.0, 37 } })
                {
                    const auto out = playSampler (with (defaults, option), smp, sr, { noteOn (0.0, 60), noteOn (0.05, 67, 127), noteOff (0.4, 60),
                                                                                      noteOff (0.45, 67) },
                                                  1.0, channel (false, 0.0), rate, block);
                    const float pk = peak (out);
                    const bool good = allFinite (out) && pk > 0.01f && pk < 4.0f;
                    ok = ok && good;

                    if (! good)
                        detail << "option " << index << " (" << smp->getNumChannels() << " ch, " << String (rate) << "): peak " << fmt (pk) << " ";
                }
            }

            ++index;
        }

        check (ok, "sampler: every new option renders finite, non-silent audio (mono / stereo, 48 kHz / 512, 44.1 kHz / 37)", detail);
    }

    // start / end trim the region
    {
        const auto full = playSampler (defaults, rising, sr, { noteOn (0.0, 60) }, 1.0);
        const auto mid = playSampler (with (defaults, { { "start", 0.25 }, { "end", 0.75 } }), rising, sr, { noteOn (0.0, 60) }, 1.0);
        const auto late = playSampler (with (defaults, { { "start", 0.5 } }), rising, sr, { noteOn (0.0, 60) }, 1.0);
        const double lFull = lastAbove (full, 1.0e-4f) / testRate, lMid = lastAbove (mid, 1.0e-4f) / testRate, lLate = lastAbove (late, 1.0e-4f) / testRate;
        const bool louderStart = rms (late, 0, ms (0.05)) > 2.0 * rms (full, 0, ms (0.05));
        check (std::abs (lFull - 0.5) < 0.01 && std::abs (lMid - 0.25) < 0.01 && std::abs (lLate - 0.25) < 0.01 && louderStart,
               "sampler: start / end shorten the output to the region", fmt (lFull) + " / " + fmt (lMid) + " / " + fmt (lLate) + " s");
    }

    // fades: linear, in output seconds, starting and ending at 0
    {
        const auto plain = playSampler (with (defaults, { { "end", 0.25 } }), tone, sr, { noteOn (0.0, 60) }, 0.7);
        const auto faded = playSampler (with (defaults, { { "end", 0.25 }, { "fin", 0.1 }, { "fout", 0.1 } }), tone, sr, { noteOn (0.0, 60) }, 0.7);
        const double inRatio = rms (faded, ms (0.02), ms (0.03)) / rms (plain, ms (0.02), ms (0.03));
        const double outRatio = rms (faded, ms (0.47), ms (0.48)) / rms (plain, ms (0.47), ms (0.48));
        const double midRatio = rms (faded, ms (0.2), ms (0.3)) / rms (plain, ms (0.2), ms (0.3));
        const float head = peak (faded, 0, 24), tail = peak (faded, ms (0.4995), ms (0.5));
        check (std::abs (inRatio - 0.25) < 0.03 && std::abs (outRatio - 0.25) < 0.03 && std::abs (midRatio - 1.0) < 1.0e-3,
               "sampler: fade in / out are linear ramps over fin / fout", "25 ms " + fmt (inRatio) + ", 25 ms before the end " + fmt (outRatio));
        check (head < 1.0e-3f && tail < 0.01f && peak (faded, ms (0.501)) < 1.0e-6f, "sampler: fades start and end at 0",
               "first 0.5 ms " + fmt (head, 6) + ", last 0.5 ms " + fmt (tail, 6));

        // a short region clamps both fades to its length; a loop ignores fout
        const auto shortFade = playSampler (with (defaults, { { "end", 0.05 }, { "fin", 2 }, { "fout", 2 } }), tone, sr, { noteOn (0.0, 60) }, 0.3);
        const auto looped = playSampler (with (defaults, { { "loop", "fwd" }, { "end", 0.25 }, { "fout", 0.1 } }), tone, sr,
                                         { noteOn (0.0, 60), noteOff (1.0, 60) }, 1.2);
        check (allFinite (shortFade) && peak (shortFade) > 0.05f && lastAbove (shortFade, 1.0e-4f) < ms (0.101)
                   && rms (looped, ms (0.6), ms (0.9)) > 0.3,
               "sampler: fades are clamped to the played length; fout is ignored while looping");
    }

    // norm: gain x 1 / peak of the whole sample
    {
        const auto quiet = toneSample (sr, 2, 0.5, 440.0, 0.25);
        const auto off = playSampler (defaults, quiet, sr, { noteOn (0.0, 60, 127) }, 0.6);
        const auto on = playSampler (with (defaults, { { "norm", "on" } }), quiet, sr, { noteOn (0.0, 60, 127) }, 0.6);
        const auto half = playSampler (with (defaults, { { "norm", "on" }, { "gain", 0.5 } }), quiet, sr, { noteOn (0.0, 60, 127) }, 0.6);
        const auto soft = playSampler (with (defaults, { { "norm", "on" } }), quiet, sr, { noteOn (0.0, 60, 64) }, 0.6);
        const float v64 = 64.0f / 127.0f;
        check (std::abs (peak (off) - 0.25f) < 0.01f && std::abs (peak (on) - 1.0f) < 0.02f && std::abs (peak (half) - 0.5f) < 0.01f
                   && std::abs (peak (soft) - v64) < 0.02f,
               "sampler: norm raises the peak to gain x velocity", fmt (peak (off)) + " -> " + fmt (peak (on)) + ", gain 0.5 " + fmt (peak (half))
                   + ", velocity 64 " + fmt (peak (soft)));
    }

    // loops keep sounding while the note is held, release after note off (even with cut = full)
    {
        bool ok = true;
        String detail;

        for (auto mode : { "fwd", "ping" })
        {
            const auto props = with (defaults, { { "loop", mode }, { "ls", 0.2 }, { "le", 0.8 }, { "r", 0.05 } });
            const auto out = playSampler (props, rising, sr, { noteOn (0.0, 60), noteOff (1.5, 60) }, 2.0);
            const double held = rms (out, ms (1.0), ms (1.5));
            const float after = peak (out, ms (1.5 + 0.05 * 2.0 + 0.02 + 0.002));
            const bool good = allFinite (out) && held > 0.1 && after < 1.0e-9f && rms (out, ms (1.5), ms (1.52)) > 0.02;
            ok = ok && good;
            detail << mode << ": held rms " << fmt (held) << ", after release " << fmt (after, 9) << "  ";
        }

        check (ok, "sampler: fwd / ping loops sound while held and release on note off", detail);

        // the whole sample looped: forward jumps back to the quiet start, ping-pong turns around at the loud end
        const auto fwd = playSampler (with (defaults, { { "loop", "fwd" } }), rising, sr, { noteOn (0.0, 60) }, 1.2);
        const auto ping = playSampler (with (defaults, { { "loop", "ping" } }), rising, sr, { noteOn (0.0, 60) }, 1.2);
        const double fBefore = rms (fwd, ms (0.42), ms (0.49)), fAfter = rms (fwd, ms (0.51), ms (0.58));
        const double pBefore = rms (ping, ms (0.42), ms (0.49)), pAfter = rms (ping, ms (0.51), ms (0.58)), pEnd = rms (ping, ms (0.93), ms (0.99));
        check (fAfter < 0.4 * fBefore && pAfter > 0.85 * pBefore && pEnd < 0.4 * pBefore,
               "sampler: ping-pong plays the loop forwards then backwards",
               "fwd " + fmt (fBefore) + " -> " + fmt (fAfter) + ", ping " + fmt (pBefore) + " -> " + fmt (pAfter) + " -> " + fmt (pEnd));
        const double fl = estimateFrequency (ping, 0, ms (0.6), ms (0.9), testRate);
        check (std::abs (fl - 440.0) < 2.0, "sampler: the mirrored half keeps the pitch", fmt (fl, 2) + " Hz");
    }

    // AHDSR: linear attack, hold, exponential decay to sustain, release from the current level
    {
        const auto props = with (defaults, { { "a", 0.05 }, { "h", 0.1 }, { "d", 0.3 }, { "s", 0.25 }, { "r", 0.2 }, { "cut", "note" } });
        const auto out = playSampler (props, tone, sr, { noteOn (0.0, 60, 127), noteOff (1.3, 60) }, 2.0);
        const double attack = rms (out, ms (0.02), ms (0.03)), hold = rms (out, ms (0.06), ms (0.14)), sustain = rms (out, ms (1.0), ms (1.3));
        const double released = rms (out, ms (1.34), ms (1.36));
        const double expected = 0.8 * 0.70710678 / std::sqrt (2.0);
        check (std::abs (hold / expected - 1.0) < 0.02 && std::abs (attack / hold - 0.5) < 0.05 && std::abs (sustain / hold - 0.25) < 0.01,
               "sampler: attack / hold / decay to sustain", "attack " + fmt (attack / hold) + ", sustain " + fmt (sustain / hold));
        check (std::abs (released / sustain - std::exp (-1.0)) < 0.05 && peak (out, ms (1.3 + 0.2 * 2.0 + 0.02 + 0.002)) < 1.0e-9f,
               "sampler: release with time constant r / 4 from the sustain level", "after r / 4: " + fmt (released / sustain));
    }

    // filters: a highpass at 2 kHz silences a 220 Hz sine; lowpass, band pass and notch behave
    {
        const auto plain = playSampler (defaults, tone220, sr, { noteOn (0.0, 60) }, 0.6);
        const double ref = rms (plain, ms (0.1), ms (0.5));
        const auto level = [&] (const Props& changes)
        {
            return rms (playSampler (with (defaults, changes), tone220, sr, { noteOn (0.0, 60) }, 0.6), ms (0.1), ms (0.5)) / ref;
        };
        const double hp = level ({ { "ftype", "hp" }, { "fcut", 2000 } }), lp = level ({ { "ftype", "lp" }, { "fcut", 2000 } });
        const double bp = level ({ { "ftype", "bp" }, { "fcut", 220 } }), notch = level ({ { "ftype", "notch" }, { "fcut", 220 } });
        const double lp12 = level ({ { "ftype", "lp" }, { "fcut", 60 }, { "fres", 0 } }), lp24 = level ({ { "ftype", "lp24" }, { "fcut", 60 }, { "fres", 0 } });
        check (hp < 0.02, "sampler: highpass at 2 kHz on a 220 Hz sine is near-silent", fmt (toDb (hp), 1) + " dB");
        check (std::abs (lp - 1.0) < 0.05 && std::abs (bp - 1.0) < 0.05 && notch < 0.05,
               "sampler: lowpass above and band pass at the tone pass it, a notch at the tone removes it",
               "lp " + fmt (lp) + ", bp " + fmt (bp) + ", notch " + fmt (toDb (notch), 1) + " dB");
        check (lp24 < 0.3 * lp12 && lp12 < 0.2, "sampler: lp24 (two cascaded lowpasses) is steeper than lp",
               fmt (toDb (lp12), 1) + " dB vs " + fmt (toDb (lp24), 1) + " dB, an octave and a half above the cutoff");
    }

    // filter envelope: the cutoff sweeps from fcut * 2^(fenv * 6) back to the sustain cutoff
    {
        const int h10 = 10; // 2.2 kHz harmonic of the 220 Hz saw
        const auto swept = playSampler (with (defaults, { { "ftype", "lp" }, { "fcut", 300 }, { "fres", 0 }, { "fenv", 1 }, { "fa", 0.01 },
                                                          { "fd", 0.3 } }),
                                        saw, sr, { noteOn (0.0, 60) }, 1.1);
        const auto fixed = playSampler (with (defaults, { { "ftype", "lp" }, { "fcut", 300 }, { "fres", 0 } }), saw, sr, { noteOn (0.0, 60) }, 1.1);
        const double early = toneLevel (swept, 0, ms (0.01), ms (0.05), 220.0 * h10, testRate), late = toneLevel (swept, 0, ms (0.8), ms (1.0), 220.0 * h10, testRate);
        const double fixedEarly = toneLevel (fixed, 0, ms (0.01), ms (0.05), 220.0 * h10, testRate);
        const double fixedLate = toneLevel (fixed, 0, ms (0.8), ms (1.0), 220.0 * h10, testRate);
        check (early > 20.0 * late && early > 20.0 * fixedEarly && std::abs (toDb (fixedLate / late)) < 1.5,
               "sampler: filter envelope opens the filter at the start, then decays to fcut",
               "2.2 kHz: " + fmt (early, 5) + " -> " + fmt (late, 6) + " (no envelope " + fmt (fixedEarly, 6) + ")");

        // negative amount: the cutoff dips below fcut and comes back
        const auto dip = playSampler (with (defaults, { { "ftype", "lp" }, { "fcut", 4000 }, { "fres", 0 }, { "fenv", -0.5 }, { "fa", 0.01 },
                                                        { "fd", 1.0 } }),
                                      saw, sr, { noteOn (0.0, 60) }, 1.95);
        const double dipEarly = toneLevel (dip, 0, ms (0.01), ms (0.05), 220.0 * h10, testRate), dipLate = toneLevel (dip, 0, ms (1.5), ms (1.9), 220.0 * h10, testRate);
        check (dipLate > 5.0 * dipEarly, "sampler: a negative filter envelope closes the filter at the start",
               fmt (dipEarly, 6) + " -> " + fmt (dipLate, 5));
    }

    // pitch envelope: starts penv semitones away, returns with time constant pd / 3
    {
        const auto out = playSampler (with (defaults, { { "penv", 12 }, { "pd", 0.2 } }), tone, sr, { noteOn (0.0, 60) }, 1.0);
        const double f0 = estimateFrequency (out, 0, ms (0.002), ms (0.012), testRate), f1 = estimateFrequency (out, 0, ms (0.6), ms (0.8), testRate);
        check (f0 > 780.0 && std::abs (f1 - 440.0) < 1.5, "sampler: pitch envelope +12 starts an octave up and settles",
               fmt (f0, 1) + " Hz -> " + fmt (f1, 1) + " Hz");
    }

    // LFO: tremolo, auto-pan, filter and pitch modulation, phase 0 at the note start
    {
        const auto trem = playSampler (with (defaults, { { "lvol", 1 }, { "lrate", 4 } }), tone, sr, { noteOn (0.0, 60) }, 0.5);
        const double up = rms (trem, ms (0.0575), ms (0.0675)), down = rms (trem, ms (0.1825), ms (0.1925));
        const auto square = playSampler (with (defaults, { { "lvol", 1 }, { "lrate", 4 }, { "lshape", "square" } }), tone, sr, { noteOn (0.0, 60) }, 0.5);
        const double sqUp = rms (square, ms (0.02), ms (0.1)), sqDown = rms (square, ms (0.145), ms (0.23));
        check (up > 0.3 && down < 0.02 * up && sqDown < 0.15 * sqUp, "sampler: LFO -> volume (sine and square)",
               "sine peak " + fmt (up) + " / trough " + fmt (down, 6) + ", square " + fmt (sqUp) + " / " + fmt (sqDown));

        const auto pan = playSampler (with (defaults, { { "lpan", 1 }, { "lrate", 4 } }), tone, sr, { noteOn (0.0, 60) }, 0.5);
        const auto centred = playSampler (defaults, tone, sr, { noteOn (0.0, 60) }, 0.5);
        const double rightUp = rms (pan, ms (0.0575), ms (0.0675), 1), leftUp = rms (pan, ms (0.0575), ms (0.0675), 0);
        const double plain = rms (centred, ms (0.0575), ms (0.0675), 1); // -3 dB per side
        const double rightDown = rms (pan, ms (0.1825), ms (0.1925), 1), leftDown = rms (pan, ms (0.1825), ms (0.1925), 0);
        const double centreL = rms (pan, ms (0.12), ms (0.13), 0), centreR = rms (pan, ms (0.12), ms (0.13), 1);
        check (leftUp < 0.05 * rightUp && rightDown < 0.05 * leftDown && std::abs (rightUp / plain - std::sqrt (2.0)) < 0.01
                   && std::abs (centreL / centreR - 1.0) < 0.15,
               "sampler: LFO -> pan (mono sample through the equal-power panner)",
               "pan +1: L " + fmt (leftUp, 5) + " R " + fmt (rightUp) + ", pan -1: L " + fmt (leftDown) + " R " + fmt (rightDown, 5));

        const auto stereoPan = playSampler (with (defaults, { { "lpan", 1 }, { "lrate", 4 } }), toneSample (sr, 2, 1.0, 440.0, 0.5), sr,
                                            { noteOn (0.0, 60, 127) }, 0.5);
        check (rms (stereoPan, ms (0.0575), ms (0.0675), 0) < 0.02 && rms (stereoPan, ms (0.1825), ms (0.1925), 1) < 0.02,
               "sampler: LFO -> pan (stereo sample, stereo panner law)");

        const auto wah = playSampler (with (defaults, { { "ftype", "lp" }, { "fcut", 1000 }, { "fres", 0 }, { "lcut", 1 }, { "lrate", 2 } }),
                                      saw, sr, { noteOn (0.0, 60) }, 0.6);
        const double open = toneLevel (wah, 0, ms (0.1), ms (0.15), 1100.0, testRate), shut = toneLevel (wah, 0, ms (0.35), ms (0.4), 1100.0, testRate);
        check (open > 20.0 * shut, "sampler: LFO -> filter (cutoff +-4 octaves)", "1.1 kHz: " + fmt (open, 5) + " vs " + fmt (shut, 7));

        const auto vib = playSampler (with (defaults, { { "lpit", 1 }, { "lrate", 1 } }), tone, sr, { noteOn (0.0, 60) }, 1.0);
        const double fUp = estimateFrequency (vib, 0, ms (0.23), ms (0.27), testRate), fDown = estimateFrequency (vib, 0, ms (0.73), ms (0.77), testRate);
        check (std::abs (fUp - 440.0 * std::pow (2.0, 1.0 / 12.0)) < 2.0 && std::abs (fDown - 440.0 / std::pow (2.0, 1.0 / 12.0)) < 2.0,
               "sampler: LFO -> pitch (+-1 semitone)", fmt (fUp, 1) + " / " + fmt (fDown, 1) + " Hz");

        writeWav ("inst_sampler_lfo.wav", trem);
    }
}

//==============================================================================
void testMonoAndPortamento()
{
    std::cout << "\n[mono and portamento (BuiltinContext::mono, ::porta)]" << std::endl;
    const double sr = 44100.0;
    const auto tone = toneSample (sr, 1, 3.0, 220.0, 0.8); // 220 Hz at root 57
    const auto ms = [] (double seconds) { return toSample (seconds, testRate); };

    // instrument, parameter changes for a clean tone, and whether the voice is deterministic (no per-voice noise)
    struct Kind { const char* type; Props changes; bool exact; };
    const std::vector<Kind> kinds {
        { "synth", { { "w1", "sine" }, { "w2", "sine" }, { "mix", 0 }, { "env", 0 }, { "cut", 18000 }, { "res", 0 } }, true },
        { "pad", {}, true },
        { "supersaw", { { "voices", 1 }, { "env", 0 }, { "cut", 18000 }, { "res", 0 } }, true },
        { "epiano", { { "index", 0 }, { "trem", 0 }, { "decay", 6 } }, true },
        { "fm4", { { "alg", "add" }, { "i2", 0 }, { "i3", 0 }, { "i4", 0 } }, true },
        { "organ", { { "b1", 0 }, { "b2", 0 }, { "b3", 1 }, { "perc", 0 }, { "vib", 0 }, { "click", 0 } }, true },
        { "pluck", { { "bright", 0 }, { "decay", 6 } }, false },
        { "bass808", { { "drive", 0 }, { "tone", 8000 }, { "decay", 4 } }, true },
        { "sampler", { { "loop", "fwd" } }, true },
        { "tom", {}, true }, { "cowbell", {}, true }, { "kick", { { "click", 0 } }, true }, { "snare", {}, false }, { "hat", {}, false },
        { "acid", { { "wave", "square" }, { "cut", 8000 }, { "res", 0 }, { "env", 0 } }, true } };

    const auto sustained = juce::StringArray::fromTokens ("synth pad supersaw epiano fm4 organ sampler", false);
    const auto gliding = juce::StringArray::fromTokens ("synth supersaw epiano fm4 organ pluck bass808 sampler", false);

    const auto make = [&] (const Kind& k, bool mono, double porta)
    {
        const bool sampler = String (k.type) == "sampler";
        auto inst = makeInstrument (k.type, with (instrumentDefaults (k.type), k.changes), channel (mono, porta, sampler ? 57 : 60));
        inst->prepareToPlay (testRate, testBlock);

        if (sampler)
            inst->setSample (tone, sr);

        return inst;
    };

    // mono: a second overlapping note chokes the first, leaving one voice
    {
        bool ok = true;
        String detail;

        for (const auto& k : kinds)
        {
            const bool acid = String (k.type) == "acid";
            // acid slides into a held note: release it first so the second note is a new voice
            std::vector<Event> both { noteOn (0.0, 57, 127), noteOn (0.3, 64, 100) };

            if (acid)
                both.insert (both.begin() + 1, noteOff (0.29, 57));

            auto a = make (k, true, 0.0), b = make (k, true, 0.0), c = make (k, false, 0.0);
            const auto two = renderInstrument (*a, 1.0, both, testRate, testBlock, false);
            const auto one = renderInstrument (*b, 1.0, { noteOn (0.3, 64, 100) }, testRate, testBlock, false);
            const auto poly = renderInstrument (*c, 1.0, both, testRate, testBlock, false);
            const int from = ms (0.3 + 0.011), to = ms (0.7);
            bool good = true;

            if (k.exact)
            {
                const float diff = maxDifference (two, one, from);
                good = diff < 1.0e-5f;

                if (! good)
                    detail << k.type << ": diff " << fmt (diff, 7) << " ";
            }
            else
            {
                const double ratio = rms (two, from, to) / std::max (1.0e-12, rms (one, from, to));
                good = ratio > 0.8 && ratio < 1.25;

                if (! good)
                    detail << k.type << ": rms ratio " << fmt (ratio) << " ";
            }

            // the sustained types still hold the first note without mono
            if (sustained.contains (k.type))
            {
                const float polyDiff = maxDifference (poly, one, from);
                good = good && polyDiff > 1.0e-3f;

                if (polyDiff <= 1.0e-3f)
                    detail << k.type << ": no overlap without mono ";
            }

            ok = ok && good && allFinite (two);
        }

        check (ok, "mono: a new note chokes the sounding voices of every instrument (one voice left after ~10 ms)", detail);
    }

    // portamento: the new note starts at the previous pitch and glides to its own (time constant porta / 3)
    {
        bool ok = true;
        String detail;

        for (const auto& k : kinds)
        {
            const String type (k.type);

            if (! gliding.contains (type)) // pad: below; drums and acid do not glide
                continue;

            auto inst = make (k, false, 0.3);
            const auto out = renderInstrument (*inst, 1.4, { noteOn (0.0, 57, 100), noteOn (0.5, 69, 100) }, testRate, testBlock, false);
            const double f0 = periodFrequency (out, 0, ms (0.5), ms (0.52), 150.0, 600.0, testRate);
            const double fMid = periodFrequency (out, 0, ms (0.6), ms (0.62), 150.0, 600.0, testRate);
            const double f1 = periodFrequency (out, 0, ms (1.1), ms (1.3), 150.0, 600.0, testRate);
            const double first = periodFrequency (out, 0, ms (0.1), ms (0.3), 100.0, 600.0, testRate);
            const bool good = allFinite (out) && std::abs (first - 220.0) < 3.0 && f0 > 200.0 && f0 < 290.0 && fMid > f0 + 40.0 && fMid < 420.0
                              && std::abs (f1 - 440.0) < 4.0;
            ok = ok && good;
            detail << type << " " << fmt (f0, 0) << ">" << fmt (fMid, 0) << ">" << fmt (f1, 0) << (good ? "  " : " (FAIL)  ");
        }

        check (ok, "portamento: the second note starts near the first note's pitch and approaches its own (220 -> 440 Hz)", detail);
    }

    // pad: the glide changes the start of the note; without portamento it does not
    {
        const Kind pad { "pad", {}, true };
        auto glide = make (pad, false, 0.3), plain = make (pad, true, 0.0), solo = make (pad, false, 0.3);
        const std::vector<Event> notes { noteOn (0.0, 45, 100), noteOn (0.5, 57, 100) };
        const auto a = renderInstrument (*glide, 1.0, notes, testRate, testBlock, false);
        const auto b = renderInstrument (*plain, 1.0, notes, testRate, testBlock, false);
        const auto c = renderInstrument (*solo, 1.0, { noteOn (0.5, 57, 100) }, testRate, testBlock, false);
        check (allFinite (a) && maxDifference (a, b, ms (0.511)) > 1.0e-3f && maxDifference (b, c, ms (0.511)) < 1.0e-5f,
               "portamento: pad glides (mono alone does not change the new note)");
    }

    // the previous pitch is remembered after its note ended, through CC 120 / 123; the very first note does not glide
    {
        const auto& synth = kinds[0];
        auto inst = make (synth, false, 0.3);
        const auto out = renderInstrument (*inst, 1.6, { noteOn (0.0, 57), noteOff (0.2, 57), controller (0.5, 120), controller (0.6, 123),
                                                         noteOn (1.0, 69) },
                                           testRate, testBlock, false);
        const double first = estimateFrequency (out, 0, ms (0.01), ms (0.05), testRate);
        const double start = estimateFrequency (out, 0, ms (1.0), ms (1.02), testRate);
        check (std::abs (first - 220.0) < 2.0 && start > 200.0 && start < 290.0, "portamento: glides from the last note even after it ended",
               "first note " + fmt (first, 1) + " Hz, next note starts at " + fmt (start, 1) + " Hz");

        // porta implies mono: the first voice is choked
        auto poly = make (synth, false, 0.0);
        const auto overlap = renderInstrument (*inst, 1.0, { noteOn (0.0, 57), noteOn (0.3, 69) }, testRate, testBlock, false);
        const auto both = renderInstrument (*poly, 1.0, { noteOn (0.0, 57), noteOn (0.3, 69) }, testRate, testBlock, false);
        const double held220 = toneLevel (overlap, 0, ms (0.8), ms (1.0), 220.0, testRate), poly220 = toneLevel (both, 0, ms (0.8), ms (1.0), 220.0, testRate);
        check (held220 < 0.05 * poly220, "portamento: chokes the previous voice like mono", "220 Hz after the glide " + fmt (held220, 6) + " vs " + fmt (poly220));
    }

    // sampler: the pitch envelope rides on top of the glide (time constant min(porta, pd) / 3)
    {
        const Kind smp { "sampler", { { "loop", "fwd" }, { "penv", -12 }, { "pd", 0.3 } }, true };
        auto inst = make (smp, false, 0.3);
        const auto out = renderInstrument (*inst, 1.6, { noteOn (0.0, 57), noteOn (0.6, 69) }, testRate, testBlock, false);
        const double f0 = periodFrequency (out, 0, ms (0.6), ms (0.62), 80.0, 600.0, testRate);
        const double f1 = periodFrequency (out, 0, ms (1.3), ms (1.5), 80.0, 600.0, testRate);
        check (f0 > 100.0 && f0 < 200.0 && std::abs (f1 - 440.0) < 4.0, "portamento: sampler glide x pitch envelope (starts two octaves down)",
               fmt (f0, 1) + " Hz -> " + fmt (f1, 1) + " Hz");
    }

    // drums only get the choke; acid keeps sliding legato notes (no choke of the held note)
    {
        const Kind tom { "tom", {}, true };
        auto a = make (tom, false, 0.3), b = make (tom, false, 0.3);
        const auto two = renderInstrument (*a, 1.0, { noteOn (0.0, 60), noteOn (0.3, 72) }, testRate, testBlock, false);
        const auto one = renderInstrument (*b, 1.0, { noteOn (0.3, 72) }, testRate, testBlock, false);
        check (maxDifference (two, one, ms (0.311)) < 1.0e-5f, "portamento: drums do not glide (only the choke)");

        const Kind acidKind { "acid", { { "wave", "square" }, { "cut", 8000 }, { "res", 0 }, { "env", 0 } }, true };
        auto acid = make (acidKind, true, 0.3);
        const auto out = renderInstrument (*acid, 1.0, { noteOn (0.0, 45), noteOn (0.3, 57), noteOff (0.35, 45), noteOff (0.8, 57) },
                                           testRate, testBlock, false);
        double minWindow = 1.0e9;

        for (double t = 0.27; t < 0.40; t += 0.005)
            minWindow = std::min (minWindow, rms (out, ms (t), ms (t + 0.01), 0));

        check (minWindow > 0.5 * rms (out, ms (0.1), ms (0.29), 0), "mono / portamento: acid still slides legato notes without a choke");
    }
}

//==============================================================================
// Per-note expression and slide notes: the SysEx the engine sends (Builtins.h), and notes on any MIDI channel.
using TimedMidi = std::vector<std::pair<double, juce::MidiMessage>>;

Buffer renderMidi (ritmo::BuiltinProcessor& p, double seconds, const TimedMidi& events, double rate = testRate, int block = testBlock)
{
    p.prepareToPlay (rate, block);
    const int total = toSample (seconds, rate);
    Buffer out (2, total), buffer (2, block);
    juce::MidiBuffer midi;

    for (int pos = 0; pos < total; pos += block)
    {
        const int n = std::min (block, total - pos);
        buffer.setSize (2, n, false, false, true);
        midi.clear();

        for (const auto& [t, m] : events)
            if (const int s = toSample (t, rate); s >= pos && s < pos + n)
                midi.addEvent (m, s - pos);

        p.processBlock (buffer, midi);

        for (int ch = 0; ch < 2; ++ch)
            out.copyFrom (ch, pos, buffer, ch, 0, n);
    }

    return out;
}

juce::MidiMessage expressionMessage (int note, const ritmo::NoteExpression& e)
{
    juce::uint8 d[ritmo::expressionSysExSize];
    ritmo::writeExpressionSysEx (d, note, e);
    return juce::MidiMessage (d, ritmo::expressionSysExSize);
}

juce::MidiMessage slideMessage (int channel, int note, double milliseconds)
{
    juce::uint8 d[ritmo::slideSysExSize];
    ritmo::writeSlideSysEx (d, channel, note, milliseconds);
    return juce::MidiMessage (d, ritmo::slideSysExSize);
}

juce::MidiMessage on (int channel, int note, int vel = 100) { return juce::MidiMessage::noteOn (channel, note, (juce::uint8) vel); }
juce::MidiMessage off (int channel, int note) { return juce::MidiMessage::noteOff (channel, note); }

void testExpression()
{
    std::cout << "\n[per-note expression, slides and MIDI channels]" << std::endl;
    const double sr = 44100.0;
    const auto tone = toneSample (sr, 1, 3.0, 220.0, 0.8); // 220 Hz at root 57
    const auto ms = [] (double seconds) { return toSample (seconds, testRate); };
    const Props sineSynth = with (instrumentDefaults ("synth"), { { "w1", "sine" }, { "w2", "sine" }, { "mix", 0 }, { "env", 0 }, { "cut", 18000 }, { "res", 0 } });

    // clean tones of the melodic types (as in the portamento test)
    struct Kind { const char* type; Props changes; };
    const std::vector<Kind> kinds {
        { "synth", { { "w1", "sine" }, { "w2", "sine" }, { "mix", 0 }, { "env", 0 }, { "cut", 18000 }, { "res", 0 } } },
        { "pad", { { "a", 0.01 } } },
        { "supersaw", { { "voices", 1 }, { "env", 0 }, { "cut", 18000 }, { "res", 0 } } },
        { "epiano", { { "index", 0 }, { "trem", 0 }, { "decay", 6 } } },
        { "fm4", { { "alg", "add" }, { "i2", 0 }, { "i3", 0 }, { "i4", 0 } } },
        { "organ", { { "b1", 0 }, { "b2", 0 }, { "b3", 1 }, { "perc", 0 }, { "vib", 0 }, { "click", 0 } } },
        { "pluck", { { "bright", 0 }, { "decay", 6 } } },
        { "bass808", { { "drive", 0 }, { "tone", 8000 }, { "decay", 4 } } },
        { "sampler", { { "loop", "fwd" } } },
        { "acid", { { "wave", "square" }, { "cut", 8000 }, { "res", 0 }, { "env", 0 } } } };
    const auto make = [&] (const Kind& k)
    {
        const bool sampler = String (k.type) == "sampler";
        auto inst = makeInstrument (k.type, with (instrumentDefaults (k.type), k.changes), sampler ? 57 : 60);
        inst->prepareToPlay (testRate, testBlock);

        if (sampler)
            inst->setSample (tone, sr);

        return inst;
    };
    const auto pitchOf = [&] (const Buffer& b, double from, double to) { return periodFrequency (b, 0, ms (from), ms (to), 100.0, 600.0, testRate); };

    // the wire format: defaults read back exactly, other values within one 14-bit step
    {
        ritmo::NoteExpression e, back;
        juce::uint8 d[ritmo::expressionSysExSize];
        int note = -1, channel = -1;
        ritmo::writeExpressionSysEx (d, 64, e);
        const bool defaults = ritmo::readExpressionSysEx (d, ritmo::expressionSysExSize, note, back) && note == 64 && back.isDefault();
        e.pan = -0.3f;
        e.fine = 0.77f;
        e.mx = 0.1f;
        e.my = 0.9f;
        e.rel = 0.25f;
        e.porta = true;
        ritmo::writeExpressionSysEx (d, 64, e);
        const bool read = ritmo::readExpressionSysEx (d, ritmo::expressionSysExSize, note, back);
        const bool close = read && std::abs (back.pan - e.pan) < 1.3e-4f && std::abs (back.fine - e.fine) < 1.3e-4f && std::abs (back.mx - e.mx) < 7.0e-5f
                           && std::abs (back.my - e.my) < 7.0e-5f && std::abs (back.rel - e.rel) < 7.0e-5f && back.porta;
        juce::uint8 s[ritmo::slideSysExSize];
        double dur = 0.0;
        ritmo::writeSlideSysEx (s, 4, 70, 250.4);
        const bool slide = ritmo::readSlideSysEx (s, ritmo::slideSysExSize, channel, note, dur) && channel == 4 && note == 70 && std::abs (dur - 250.0) < 1.0e-9
                           && ! ritmo::readSlideSysEx (d, ritmo::expressionSysExSize, channel, note, dur);
        check (defaults && close && slide, "sysex: expression and slide round trip (default values read back exactly)");
    }

    // fine: +1 semitone on every melodic type, -0.5 on the synth; drums follow too
    {
        bool ok = true;
        String detail;
        ritmo::NoteExpression up;
        up.fine = 1.0f;

        for (const auto& k : kinds)
        {
            auto a = make (k), b = make (k);
            const auto plain = renderMidi (*a, 0.5, { { 0.0, on (1, 57) } });
            const auto fine = renderMidi (*b, 0.5, { { 0.0, expressionMessage (57, up) }, { 0.0, on (1, 57) } });
            const double ratio = pitchOf (fine, 0.2, 0.45) / pitchOf (plain, 0.2, 0.45);
            const bool good = std::abs (ratio / std::pow (2.0, 1.0 / 12.0) - 1.0) < 0.003;
            ok = ok && good && allFinite (fine);
            detail << k.type << " " << fmt (ratio, 4) << (good ? "  " : " (FAIL)  ");
        }

        check (ok, "fine: +1 semitone raises every melodic type by 2^(1/12)", detail);

        ritmo::NoteExpression down;
        down.fine = -0.5f;
        auto synth = makeInstrument ("synth", sineSynth);
        const auto out = renderMidi (*synth, 0.5, { { 0.0, expressionMessage (69, down) }, { 0.0, on (1, 69) } });
        const double f = estimateFrequency (out, 0, ms (0.1), ms (0.45), testRate);
        auto tom = makeInstrument ("tom", instrumentDefaults ("tom"));
        auto tomFine = makeInstrument ("tom", instrumentDefaults ("tom"));
        const auto t0 = renderMidi (*tom, 0.4, { { 0.0, on (1, 60) } });
        const auto t1 = renderMidi (*tomFine, 0.4, { { 0.0, expressionMessage (60, up) }, { 0.0, on (1, 60) } });
        const double tr = estimateFrequency (t1, 0, ms (0.25), ms (0.35), testRate) / estimateFrequency (t0, 0, ms (0.25), ms (0.35), testRate);
        check (std::abs (f - 440.0 * std::pow (2.0, -0.5 / 12.0)) < 0.5 && std::abs (tr / std::pow (2.0, 1.0 / 12.0) - 1.0) < 0.005,
               "fine: -0.5 semitone on the synth, +1 on a drum", fmt (f, 2) + " Hz, tom ratio " + fmt (tr, 4));
    }

    // the expression belongs to the next note on of its note number, in the same block only
    {
        ritmo::NoteExpression up;
        up.fine = 1.0f;
        auto a = makeInstrument ("synth", sineSynth), b = makeInstrument ("synth", sineSynth);
        const auto otherNote = renderMidi (*a, 0.4, { { 0.0, expressionMessage (60, up) }, { 0.0, on (1, 69) } });
        const auto nextBlock = renderMidi (*b, 0.4, { { 0.0, expressionMessage (69, up) }, { (double) testBlock / testRate, on (1, 69) } });
        const double f1 = estimateFrequency (otherNote, 0, ms (0.1), ms (0.35), testRate), f2 = estimateFrequency (nextBlock, 0, ms (0.1), ms (0.35), testRate);
        check (std::abs (f1 - 440.0) < 0.5 && std::abs (f2 - 440.0) < 0.5, "expression: ignored by another note number and by a later block",
               fmt (f1, 2) + " / " + fmt (f2, 2) + " Hz");
    }

    // pan: a mono voice through the equal-power law, a stereo voice (supersaw) through the stereo law
    {
        ritmo::NoteExpression left, right, half;
        left.pan = -1.0f;
        right.pan = 1.0f;
        half.pan = 0.5f;
        const auto render = [&] (const Props& props, const ritmo::NoteExpression& e, const char* type)
        {
            auto inst = makeInstrument (type, props);
            return renderMidi (*inst, 0.4, { { 0.0, expressionMessage (69, e) }, { 0.0, on (1, 69) } });
        };
        const auto centre = render (sineSynth, {}, "synth"), l = render (sineSynth, left, "synth"), r = render (sineSynth, right, "synth"),
                   h = render (sineSynth, half, "synth");
        const double c0 = rms (centre, ms (0.1), ms (0.3), 0);
        const bool monoOk = rms (l, ms (0.1), ms (0.3), 1) < 1.0e-6 && std::abs (rms (l, ms (0.1), ms (0.3), 0) / c0 - std::sqrt (2.0)) < 1.0e-3
                            && rms (r, ms (0.1), ms (0.3), 0) < 1.0e-6
                            && std::abs (rms (h, ms (0.1), ms (0.3), 0) / rms (h, ms (0.1), ms (0.3), 1) - std::tan (juce::MathConstants<double>::pi / 8.0)) < 1.0e-3;

        const auto saw = with (instrumentDefaults ("supersaw"), { { "voices", 5 }, { "width", 1 } });
        const auto sc = render (saw, {}, "supersaw"), sl = render (saw, left, "supersaw");
        Buffer folded (2, sc.getNumSamples());
        folded.copyFrom (0, 0, sc, 0, 0, sc.getNumSamples());
        folded.addFrom (0, 0, sc, 1, 0, sc.getNumSamples());
        folded.clear (1, 0, folded.getNumSamples());
        const bool stereoOk = maxDifference (sl, folded) < 1.0e-5f && peak (sc, 0, -1, 1) > 0.05f;
        check (monoOk && stereoOk, "pan: mono voice equal-power (-1: left x sqrt 2), stereo voice folded to one side",
               "L(-1)/L(0) " + fmt (rms (l, ms (0.1), ms (0.3), 0) / c0, 4));
    }

    // mx: brighter / darker (cutoff x 4 / x 1/4); my: more / less resonance at the cutoff
    {
        const auto render = [&] (const Props& props, const ritmo::NoteExpression& e)
        {
            auto inst = makeInstrument ("synth", props);
            return renderMidi (*inst, 0.5, { { 0.0, expressionMessage (45, e) }, { 0.0, on (1, 45) } });
        };
        const auto saw = with (instrumentDefaults ("synth"), { { "w1", "sawtooth" }, { "mix", 0 }, { "env", 0 }, { "cut", 1000 }, { "res", 0 } });
        ritmo::NoteExpression bright, dark;
        bright.mx = 1.0f;
        dark.mx = 0.0f;
        const auto level = [&] (const Buffer& b, double f) { return toneLevel (b, 0, ms (0.1), ms (0.45), f, testRate); };
        const double hb = level (render (saw, bright), 2200.0), hn = level (render (saw, {}), 2200.0), hd = level (render (saw, dark), 2200.0);

        const auto res = with (saw, { { "cut", 1100 }, { "res", 6 } });
        ritmo::NoteExpression more, less;
        more.my = 1.0f;
        less.my = 0.0f;
        const double rm = level (render (res, more), 1100.0), rn = level (render (res, {}), 1100.0), rl = level (render (res, less), 1100.0);
        check (hb > 3.0 * hn && hn > 3.0 * hd && rm > 1.3 * rn && rn > 1.2 * rl, "mx / my: cutoff and resonance per note",
               "2.2 kHz " + fmt (hd, 5) + " < " + fmt (hn, 5) + " < " + fmt (hb, 5) + ", 1.1 kHz " + fmt (rl, 4) + " < " + fmt (rn, 4) + " < " + fmt (rm, 4));
    }

    // rel: longer / shorter release, read at note on (synth) or at note off (epiano)
    {
        bool ok = true;
        String detail;

        for (const auto* type : { "synth", "epiano" })
        {
            const auto props = String (type) == "synth" ? sineSynth : with (instrumentDefaults ("epiano"), { { "decay", 6 }, { "r", 0.3 } });
            double tails[3] {};
            const float rels[3] { 0.0f, 0.5f, 1.0f };

            for (int i = 0; i < 3; ++i)
            {
                ritmo::NoteExpression e;
                e.rel = rels[i];
                auto inst = makeInstrument (type, props);
                const auto out = renderMidi (*inst, 1.0, { { 0.0, expressionMessage (69, e) }, { 0.0, on (1, 69) }, { 0.3, off (1, 69) } });
                tails[i] = rms (out, ms (0.45), ms (0.55));
            }

            const bool good = tails[2] > 1.5 * tails[1] && tails[1] > 1.5 * tails[0];
            ok = ok && good;
            detail << type << " " << fmt (tails[0], 5) << " < " << fmt (tails[1], 5) << " < " << fmt (tails[2], 5) << "  ";
        }

        check (ok, "rel: the release time follows the note's release velocity", detail);
    }

    // porta: the note glides from the previous note's pitch (0.1 s without channel portamento), without choking it
    {
        ritmo::NoteExpression porta;
        porta.porta = true;
        auto glide = makeInstrument ("synth", sineSynth), plain = makeInstrument ("synth", sineSynth);
        const TimedMidi first { { 0.0, on (1, 57) }, { 0.2, off (1, 57) } };
        auto withPorta = first, without = first;
        withPorta.push_back ({ 0.5, expressionMessage (69, porta) });
        withPorta.push_back ({ 0.5, on (1, 69) });
        without.push_back ({ 0.5, on (1, 69) });
        const auto a = renderMidi (*glide, 1.0, withPorta), b = renderMidi (*plain, 1.0, without);
        const double start = estimateFrequency (a, 0, ms (0.5), ms (0.51), testRate), end = estimateFrequency (a, 0, ms (0.8), ms (0.95), testRate);
        const double plainStart = estimateFrequency (b, 0, ms (0.5), ms (0.51), testRate);

        auto held = makeInstrument ("synth", sineSynth);
        const auto both = renderMidi (*held, 1.0, { { 0.0, on (1, 57) }, { 0.5, expressionMessage (69, porta) }, { 0.5, on (1, 69) } });
        check (start < 300.0 && std::abs (end - 440.0) < 1.0 && std::abs (plainStart - 440.0) < 5.0 && toneLevel (both, 0, ms (0.8), ms (0.95), 220.0, testRate) > 0.05,
               "porta: starts at the previous pitch and glides to its own (0.1 s), the previous note keeps sounding",
               fmt (start, 1) + " Hz -> " + fmt (end, 1) + " Hz (without porta " + fmt (plainStart, 1) + " Hz)");
    }

    // slide: every melodic type glides linearly in semitones over the duration, then stays; drums ignore it
    {
        bool ok = true;
        String detail;

        for (const auto& k : kinds)
        {
            auto inst = make (k);
            const auto out = renderMidi (*inst, 1.0, { { 0.0, on (1, 57) }, { 0.3, slideMessage (0, 69, 200.0) } });
            const double f0 = pitchOf (out, 0.15, 0.29), fMid = pitchOf (out, 0.38, 0.42), f1 = pitchOf (out, 0.6, 0.9);
            const bool good = allFinite (out) && std::abs (f1 / f0 - 2.0) < 0.01 && std::abs (fMid / f0 - std::sqrt (2.0)) < 0.05;
            ok = ok && good;
            detail << k.type << " " << fmt (f0, 0) << ">" << fmt (fMid, 0) << ">" << fmt (f1, 0) << (good ? "  " : " (FAIL)  ");
        }

        check (ok, "slide: 220 Hz -> 440 Hz over 200 ms, half way at +6 semitones", detail);

        auto a = makeInstrument ("tom", instrumentDefaults ("tom")), b = makeInstrument ("tom", instrumentDefaults ("tom"));
        const auto slid = renderMidi (*a, 0.5, { { 0.0, on (1, 60) }, { 0.1, slideMessage (0, 72, 100.0) } });
        const auto still = renderMidi (*b, 0.5, { { 0.0, on (1, 60) } });
        check (maxDifference (slid, still) < 1.0e-9f, "slide: drums ignore it");
    }

    // slide targets the voices of its MIDI channel that are still held
    {
        auto a = makeInstrument ("synth", sineSynth), b = makeInstrument ("synth", sineSynth);
        const auto other = renderMidi (*a, 0.8, { { 0.0, on (1, 57) }, { 0.2, slideMessage (3, 69, 50.0) } });
        const auto mine = renderMidi (*b, 0.8, { { 0.0, on (4, 57) }, { 0.2, slideMessage (3, 69, 50.0) } });
        auto c = makeInstrument ("synth", with (sineSynth, { { "r", 2.0 } }));
        const auto released = renderMidi (*c, 0.8, { { 0.0, on (1, 57) }, { 0.15, off (1, 57) }, { 0.2, slideMessage (0, 69, 50.0) } });
        const double f1 = estimateFrequency (other, 0, ms (0.4), ms (0.7), testRate), f2 = estimateFrequency (mine, 0, ms (0.4), ms (0.7), testRate);
        const double f3 = estimateFrequency (released, 0, ms (0.4), ms (0.7), testRate);
        check (std::abs (f1 - 220.0) < 0.5 && std::abs (f2 - 440.0) < 0.5 && std::abs (f3 - 220.0) < 0.5,
               "slide: only voices of its channel (4 here) that are not released", fmt (f1, 1) + " / " + fmt (f2, 1) + " / " + fmt (f3, 1) + " Hz");
    }

    // notes on channel 5: they play, and only a note off on channel 5 releases them
    {
        auto a = makeInstrument ("synth", sineSynth), b = makeInstrument ("synth", sineSynth);
        const auto wrong = renderMidi (*a, 0.8, { { 0.0, on (5, 69) }, { 0.2, off (1, 69) } });
        const auto right = renderMidi (*b, 0.8, { { 0.0, on (5, 69) }, { 0.2, off (5, 69) } });
        check (rms (wrong, ms (0.05), ms (0.15)) > 0.05 && rms (wrong, ms (0.6), ms (0.8)) > 0.05 && rms (right, ms (0.6), ms (0.8)) < 1.0e-4,
               "channels: a note on channel 5 plays and is released by its own note off");

        bool ok = true;
        String detail;

        for (const auto& type : instrumentTypes)
        {
            auto inst = makeInstrument (type, instrumentDefaults (type));
            const auto out = renderMidi (*inst, 0.3, { { 0.0, on (5, 60) } });

            if (! (allFinite (out) && peak (out) > 0.01f))
            {
                ok = false;
                detail << type << " ";
            }
        }

        check (ok, "channels: every instrument plays notes on channel 5", detail);
    }
}

//==============================================================================
Buffer drumLoop (double seconds)
{
    // a 120 BPM loop of the built-in drums and synth, used as listening material for the effects
    Buffer mix (2, toSample (seconds, testRate));
    mix.clear();
    const double beat = 0.5;
    const auto add = [&mix, seconds] (const String& type, const std::vector<Event>& events, float gain)
    {
        auto inst = makeInstrument (type, instrumentDefaults (type));
        const auto out = renderInstrument (*inst, seconds, events);

        for (int ch = 0; ch < 2; ++ch)
            mix.addFrom (ch, 0, out, ch, 0, mix.getNumSamples(), gain);
    };

    std::vector<Event> kick, snare, hat, synth;

    for (double t = 0.0; t < seconds - 0.5; t += beat)
    {
        kick.push_back (noteOn (t, 60));
        hat.push_back (noteOn (t + beat / 2, 60, 80));

        if (std::fmod (t, 2 * beat) > 0.1)
            snare.push_back (noteOn (t, 60));
    }

    for (int note : { 57, 60, 64 })
    {
        synth.push_back (noteOn (0.0, note, 80));
        synth.push_back (noteOff (1.5, note));
    }

    add ("kick", kick, 0.8f);
    add ("snare", snare, 0.6f);
    add ("hat", hat, 0.5f);
    add ("synth", synth, 0.5f);
    return mix;
}

double gainAt (const String& type, const Props& props, double freq)
{
    auto fx = makeEffect (type, props);
    const auto in = sine (freq, 0.25, 0.5);
    const auto out = processEffect (*fx, in);
    const int from = toSample (0.25, testRate), to = toSample (0.5, testRate);
    return toDb (rms (out, from, to, 0) / rms (in, from, to, 0));
}

void testEffect (const String& type)
{
    std::cout << "\n[effect " << type << "]" << std::endl;
    const auto defaults = effectDefaults (type);

    if (! check (makeEffect (type, defaults) != nullptr, type + ": created"))
        return;

    {
        auto fx = makeEffect (type, defaults);
        const auto out = processEffect (*fx, noiseBursts (2.0, 0.5f));
        check (allFinite (out) && peak (out) < 8.0f, type + ": noise bursts and impulse, defaults", "peak " + fmt (peak (out)));
    }

    {
        auto fx = makeEffect (type, defaults);
        const auto loop = drumLoop (4.0);
        const auto out = processEffect (*fx, loop);
        check (allFinite (out), type + ": drum loop, defaults");
        writeWav ("fx_" + type + ".wav", out);

        if (type == effectTypes[0])
            writeWav ("fx_input_loop.wav", loop); // the dry loop, for A/B listening
    }

    for (auto [rate, block] : { std::pair<double, int> { 44100.0, 100 }, std::pair<double, int> { 96000.0, 2048 } })
    {
        auto fx = makeEffect (type, defaults);
        const auto out = processEffect (*fx, noiseBursts (2.0, 0.5f, rate), rate, block);
        check (allFinite (out) && peak (out) < 8.0f, type + ": " + String (rate / 1000.0, 1) + " kHz, block " + String (block));
    }

    {
        // mono bus, and a block larger than the prepared maximum
        auto fx = makeEffect (type, defaults);
        fx->prepareToPlay (testRate, 256);
        Buffer monoBuffer (1, 1024);
        juce::Random random (7);

        for (int i = 0; i < monoBuffer.getNumSamples(); ++i)
            monoBuffer.setSample (0, i, random.nextFloat() - 0.5f);

        juce::MidiBuffer midi;
        fx->processBlock (monoBuffer, midi);
        check (allFinite (monoBuffer), type + ": mono buffer, block larger than prepared");
    }

    {
        // a NaN at the input never reaches the output, and the effect recovers
        auto fx = makeEffect (type, defaults);
        fx->prepareToPlay (testRate, testBlock);
        Buffer b (2, testBlock);
        juce::MidiBuffer midi;
        b.clear();
        b.setSample (0, 10, std::numeric_limits<float>::quiet_NaN());
        fx->processBlock (b, midi);
        const bool firstOk = allFinite (b);
        const auto after = processEffect (*fx, sine (440.0, 0.3, 0.3), testRate, testBlock, false);
        check (firstOk && allFinite (after), type + ": NaN input is contained");
    }

    if (type == "eq")
    {
        auto flat = makeEffect ("eq", defaults);
        const auto noise = noiseBursts (1.0, 0.5f);
        const auto out = processEffect (*flat, noise);
        check (maxDifference (out, noise) < 1.0e-5f, "eq: flat settings pass the signal unchanged", "max diff " + fmt (maxDifference (out, noise), 8));
        const double low = gainAt ("eq", with (defaults, { { "low", 12 } }), 50.0);
        const double mid = gainAt ("eq", with (defaults, { { "mid", 12 }, { "midf", 2000 } }), 2000.0);
        const double midOff = gainAt ("eq", with (defaults, { { "mid", 12 }, { "midf", 2000 } }), 150.0);
        const double high = gainAt ("eq", with (defaults, { { "high", 12 } }), 16000.0);
        const double cutHigh = gainAt ("eq", with (defaults, { { "high", -12 } }), 16000.0);
        check (low > 11.0 && low < 12.5, "eq: low +12 dB shelf at 50 Hz", fmt (low, 2) + " dB");
        check (std::abs (mid - 12.0) < 0.3, "eq: mid +12 dB peak at midf", fmt (mid, 2) + " dB");
        check (midOff < 2.0, "eq: mid peak leaves 150 Hz nearly untouched", fmt (midOff, 2) + " dB");
        check (high > 10.5 && high < 12.5 && cutHigh < -10.5, "eq: high +-12 dB shelf at 16 kHz", fmt (high, 2) + " / " + fmt (cutHigh, 2) + " dB");
    }
    else if (type == "filter")
    {
        const auto lp = with (defaults, { { "freq", 1000 } });
        const double lpStop = gainAt ("filter", lp, 10000.0), lpPass = gainAt ("filter", lp, 100.0);
        check (lpStop < -30.0 && std::abs (lpPass) < 1.0, "filter: lowpass 1 kHz cuts 10 kHz, passes 100 Hz", fmt (lpStop, 1) + " / " + fmt (lpPass, 2) + " dB");
        const auto hp = with (defaults, { { "type", "highpass" }, { "freq", 1000 } });
        const double hpStop = gainAt ("filter", hp, 100.0), hpPass = gainAt ("filter", hp, 10000.0);
        check (hpStop < -30.0 && std::abs (hpPass) < 1.0, "filter: highpass 1 kHz cuts 100 Hz, passes 10 kHz", fmt (hpStop, 1) + " / " + fmt (hpPass, 2) + " dB");
        const auto bp = with (defaults, { { "type", "bandpass" }, { "freq", 1000 }, { "q", 2 } });
        const double bpCentre = gainAt ("filter", bp, 1000.0), bpOff = gainAt ("filter", bp, 100.0);
        check (std::abs (bpCentre) < 0.5 && bpOff < -15.0, "filter: bandpass 1 kHz Q 2", fmt (bpCentre, 2) + " / " + fmt (bpOff, 1) + " dB");
        const auto res = with (defaults, { { "freq", 1000 }, { "q", 12 } });
        const double peakGain = gainAt ("filter", res, 1000.0);
        check (std::abs (peakGain - 12.0) < 0.5, "filter: lowpass Q is resonance in dB (Web Audio)", fmt (peakGain, 2) + " dB at cutoff with q 12");
    }
    else if (type == "comp")
    {
        auto fx = makeEffect ("comp", defaults);
        check (fx->getLatencySamples() == 0, "comp: no latency before prepare");
        fx->prepareToPlay (testRate, testBlock);
        check (fx->getLatencySamples() == 288, "comp: reports the 6 ms look-ahead as latency", String (fx->getLatencySamples()) + " samples");
        const double quiet = gainAt ("comp", defaults, 1000.0); // gain for a sine of 0.25 peak (-12 dBFS)
        auto measure = [&] (double amplitude)
        {
            auto c = makeEffect ("comp", defaults);
            const auto in = sine (1000.0, amplitude, 1.5);
            const auto out = processEffect (*c, in);
            const int from = toSample (1.0, testRate), to = toSample (1.5, testRate);
            return toDb (rms (out, from, to, 0));
        };
        const double outLow = measure (0.01), outHigh = measure (1.0);
        const double lowGain = outLow - toDb (0.01 / std::sqrt (2.0));
        check (outHigh - outLow < 32.0 && outHigh - outLow > 20.0, "comp: 40 dB input range compressed",
               "output range " + fmt (outHigh - outLow, 1) + " dB (gain at -40 dB " + fmt (lowGain, 1) + " dB incl. makeup and Chromium's auto makeup; at -12 dB " + fmt (quiet, 1) + " dB)");
        check (lowGain > 8.0 && lowGain < 16.0, "comp: makeup + automatic makeup below threshold", fmt (lowGain, 2) + " dB");
    }
    else if (type == "limiter")
    {
        const auto props = with (defaults, { { "gain", 18 } });
        auto fx = makeEffect ("limiter", props);
        const auto out = processEffect (*fx, noiseBursts (2.0, 0.5f));
        const float ceiling = std::pow (10.0f, -1.0f / 20.0f);
        check (peak (out) <= ceiling + 1.0e-6f, "limiter: +18 dB drive stays under the -1 dB ceiling", "peak " + fmt (toDb (peak (out)), 3) + " dBFS");
        check (peak (out) > ceiling * 0.95f, "limiter: loud input reaches the ceiling");
        auto quietFx = makeEffect ("limiter", props);
        const auto in = sine (440.0, 0.01, 0.5);
        const auto quietOut = processEffect (*quietFx, in);
        const double g = toDb (rms (quietOut, toSample (0.2, testRate), toSample (0.5, testRate), 0) / rms (in, toSample (0.2, testRate), toSample (0.5, testRate), 0));
        check (std::abs (g - 18.0) < 0.1, "limiter: quiet input only gets the input gain", fmt (g, 3) + " dB");
        auto latencyFx = makeEffect ("limiter", props);
        latencyFx->prepareToPlay (testRate, testBlock);
        check (latencyFx->getLatencySamples() == 288, "limiter: reports its 6 ms look-ahead", String (latencyFx->getLatencySamples()) + " samples");
    }
    else if (type == "dist")
    {
        auto fx = makeEffect ("dist", with (defaults, { { "drive", 1.0 } }));
        const auto out = processEffect (*fx, sine (200.0, 0.5, 0.5));
        const int from = toSample (0.2, testRate), to = toSample (0.5, testRate);
        const double h1 = toneLevel (out, 0, from, to, 200.0, testRate), h3 = toneLevel (out, 0, from, to, 600.0, testRate);
        check (h3 / h1 > 0.1, "dist: drive 1 adds odd harmonics", "3rd/1st " + fmt (h3 / h1));
        auto dryFx = makeEffect ("dist", with (defaults, { { "mix", 0 } }));
        const auto in = sine (200.0, 0.5, 0.3);
        auto scaled = in;
        scaled.applyGain (0.8f);
        const auto dryOut = processEffect (*dryFx, in);
        check (maxDifference (dryOut, scaled) < 1.0e-5f, "dist: mix 0 is the dry signal times out", "max diff " + fmt (maxDifference (dryOut, scaled), 8));
    }
    else if (type == "delay")
    {
        // 0.75 beat at 120 BPM; like Chrome, each pass through the feedback cycle adds one 128-frame render quantum
        const int at = toSample (0.1, testRate), echo = toSample (0.375, testRate), quantum = 128;
        {
            auto fx = makeEffect ("delay", with (defaults, { { "mix", 1 }, { "fb", 0.5 } }));
            const auto out = processEffect (*fx, impulseAt (0.1, 2.0));
            const int l1 = argMax (out, 0, at + 100, at + echo + echo / 2);
            const int r1 = argMax (out, 1, at + 100, at + 2 * echo + echo / 2);
            const int l2 = argMax (out, 0, at + echo + echo / 2, at + 3 * echo + echo / 2);
            check (std::abs (l1 - (at + echo)) <= 2 && std::abs (r1 - (at + 2 * echo + quantum)) <= 3 && std::abs (l2 - (at + 3 * echo + quantum)) <= 4,
                   "delay: ping-pong echoes L at T, R at 2T, L at 3T (T = 0.375 s, + 128 frames after the first, as in Chrome)",
                   String (l1 - at) + ", " + String (r1 - at) + ", " + String (l2 - at) + " samples");
            check (std::abs (out.getSample (0, l2)) < std::abs (out.getSample (0, l1)), "delay: feedback decays");
            check (peak (out, 0, at + 50) < 1.0e-6f, "delay: mix 1 has no dry signal");
        }
        {
            auto fx = makeEffect ("delay", with (defaults, { { "mix", 1 }, { "fb", 0.5 }, { "pp", "off" } }));
            const auto out = processEffect (*fx, impulseAt (0.1, 2.0));
            const int l1 = argMax (out, 0, at + 100, at + echo + echo / 2), r1 = argMax (out, 1, at + 100, at + echo + echo / 2);
            const int l2 = argMax (out, 0, at + echo + echo / 2, at + 2 * echo + echo / 2);
            check (std::abs (l1 - (at + echo)) <= 2 && std::abs (r1 - (at + echo)) <= 2 && std::abs (l2 - (at + 2 * echo + quantum)) <= 4,
                   "delay: normal mode echoes both sides at T, then 2T (+ 128 frames)", String (l1 - at) + ", " + String (r1 - at) + ", " + String (l2 - at));
        }
        {
            auto fx = makeEffect ("delay", with (defaults, { { "mix", 1 }, { "time", "1" } }), 60.0);
            const auto out = processEffect (*fx, impulseAt (0.1, 2.0));
            const int l1 = argMax (out, 0, at + 100, at + toSample (1.5, testRate));
            check (std::abs (l1 - (at + toSample (1.0, testRate))) <= 2, "delay: 1 beat at 60 BPM = 1 s", String (l1 - at) + " samples");
        }
    }
    else if (type == "reverb")
    {
        const auto props = with (defaults, { { "size", 1.0 }, { "mix", 1 } });
        auto fx = makeEffect ("reverb", props);
        const auto out = processEffect (*fx, impulseAt (0.1, 2.0));
        const int start = toSample (0.12, testRate);
        const double early = rms (out, start, toSample (0.4, testRate)), late = rms (out, toSample (0.9, testRate), toSample (1.1, testRate));
        check (peak (out, 0, start - toSample (0.001, testRate)) < 1.0e-6f, "reverb: nothing before the 20 ms pre-delay");
        check (early > 4.0 * late && late > 0.0, "reverb: tail decays", "rms " + fmt (early, 6) + " -> " + fmt (late, 6));
        check (peak (out, toSample (0.1 + 0.02 + 1.0 + 0.05, testRate)) < 1.0e-4f, "reverb: tail ends after 'size' seconds",
               "peak " + fmt (peak (out, toSample (1.17, testRate)), 8));

        // a broadband signal at mix 1 comes out at roughly the same loudness (ConvolverNode normalisation)
        auto loud = makeEffect ("reverb", with (defaults, { { "mix", 1 } }));
        const auto noise = noiseBursts (2.0, 0.5f);
        const auto wet = processEffect (*loud, noise);
        const double ratio = rms (wet, 0, wet.getNumSamples()) / rms (noise, 0, noise.getNumSamples());
        check (ratio > 0.1 && ratio < 2.0, "reverb: normalised impulse keeps a sensible wet level", "wet/dry rms " + fmt (ratio));

        // a new size while running: the impulse is regenerated off the audio thread and swapped in
        auto live = makeEffect ("reverb", props);
        live->prepareToPlay (testRate, testBlock);
        processEffect (*live, silence (0.05), testRate, testBlock, false);
        live->setParams (object (with (props, { { "size", 0.4 } })), { 60, 120.0 });

        for (int i = 0; i < 20; ++i) // let the audio thread pick it up and the background thread build it
        {
            Buffer silence (2, testBlock);
            silence.clear();
            juce::MidiBuffer midi;
            live->processBlock (silence, midi);
            std::this_thread::sleep_for (std::chrono::milliseconds (20));
        }

        processEffect (*live, silence (0.4), testRate, testBlock, false); // finish the crossfade, flush the old tail
        const auto shorter = processEffect (*live, impulseAt (0.1, 1.5), testRate, testBlock, false);
        const float after = peak (shorter, toSample (0.1 + 0.02 + 0.4 + 0.05, testRate));
        check (after < 1.0e-4f && peak (shorter) > 1.0e-4f, "reverb: size change swaps in a shorter impulse while running", "peak after 0.57 s " + fmt (after, 8));
    }
    else if (type == "chorus")
    {
        auto fx = makeEffect ("chorus", with (defaults, { { "mix", 1 }, { "depth", 0 } }));
        const auto out = processEffect (*fx, impulseAt (0.1, 0.5));
        const int at = toSample (0.1, testRate);
        const int l = argMax (out, 0, at, at + 2000), r = argMax (out, 1, at, at + 2000);
        check (std::abs (l - (at + 672)) <= 1 && std::abs (r - (at + 912)) <= 1, "chorus: taps at 14 ms (left) and 19 ms (right)",
               String (l - at) + " / " + String (r - at) + " samples");
        auto moving = makeEffect ("chorus", with (defaults, { { "mix", 1 }, { "depth", 1 }, { "rate", 5 } }));
        const auto modOut = processEffect (*moving, sine (1000.0, 0.5, 1.0));
        check (allFinite (modOut) && peak (modOut) > 0.2f && peak (modOut) < 1.0f, "chorus: full depth modulation", "peak " + fmt (peak (modOut)));
    }
}

void testPerformance()
{
    std::cout << "\n[performance: rendering speed, multiples of real time]" << std::endl;
    const double seconds = 10.0;

    auto timeIt = [] (auto&& fn)
    {
        const double start = juce::Time::getMillisecondCounterHiRes();
        fn();
        return (juce::Time::getMillisecondCounterHiRes() - start) / 1000.0;
    };

    for (const auto& type : { String ("synth"), String ("pad"), String ("epiano"), String ("pluck"), String ("hat"),
                              String ("supersaw"), String ("fm4"), String ("organ") })
    {
        // 32 overlapping long notes: every voice busy
        auto inst = makeInstrument (type, with (instrumentDefaults (type), { { "decay", 4.0 } }));
        std::vector<Event> events;

        for (int i = 0; i < 32; ++i)
            events.push_back (noteOn (i * 0.01, 36 + i, 90));

        Buffer out;
        const double elapsed = timeIt ([&] { out = renderInstrument (*inst, seconds, events); });
        const double speed = seconds / elapsed;
        check (allFinite (out) && speed > 2.0, type + ": 32 voices", fmt (speed, 1) + "x real time");
    }

    {
        // sampler with every modulation on: ping-pong loop, two filter stages with envelope, pitch envelope, LFO everywhere
        const auto props = with (instrumentDefaults ("sampler"), { { "loop", "ping" }, { "ls", 0.1 }, { "le", 0.9 }, { "ftype", "lp24" }, { "fcut", 800 },
                                                                    { "fenv", 0.6 }, { "penv", 5 }, { "lvol", 0.5 }, { "lpan", 0.5 }, { "lcut", 0.5 },
                                                                    { "lpit", 0.3 }, { "fin", 0.05 }, { "norm", "on" } });
        std::vector<Event> events;

        for (int i = 0; i < 32; ++i)
            events.push_back (noteOn (i * 0.01, 36 + i, 90));

        Buffer out;
        const double elapsed = timeIt ([&]
        {
            auto inst = makeInstrument ("sampler", props);
            inst->prepareToPlay (testRate, testBlock);
            inst->setSample (makeSample (44100.0, 2), 44100.0);
            out = renderInstrument (*inst, seconds, events, testRate, testBlock, false);
        });
        const double speed = seconds / elapsed;
        check (allFinite (out) && speed > 2.0, "sampler: 32 voices, every modulation on", fmt (speed, 1) + "x real time");
    }

    for (const auto& type : effectTypes)
    {
        auto fx = makeEffect (type, with (effectDefaults (type), { { "size", 8.0 } }));
        const auto in = noiseBursts (seconds, 0.5f);
        Buffer out;
        const double elapsed = timeIt ([&] { out = processEffect (*fx, in); });
        const double speed = seconds / elapsed;
        check (allFinite (out) && speed > 2.0, type + ": stereo" + (type == "reverb" ? String (", 8 s impulse") : String()),
               fmt (speed, 1) + "x real time");
    }
}

void testFactories()
{
    std::cout << "\n[factories]" << std::endl;
    check (ritmo::createBuiltinInstrument ("nope") == nullptr && ritmo::createBuiltinEffect ("nope") == nullptr, "unknown types return nullptr");
    bool namesOk = true, kindsOk = true;

    for (const auto& type : instrumentTypes)
    {
        auto p = ritmo::createBuiltinInstrument (type);
        namesOk = namesOk && p->getName() == type;
        kindsOk = kindsOk && p->acceptsMidi() && p->getTotalNumOutputChannels() == 2 && p->getTotalNumInputChannels() == 0;
    }

    for (const auto& type : effectTypes)
    {
        auto p = ritmo::createBuiltinEffect (type);
        namesOk = namesOk && p->getName() == type;
        kindsOk = kindsOk && ! p->acceptsMidi() && p->getTotalNumOutputChannels() == 2
                  && p->getTotalNumInputChannels() == (type == "ducker" ? 4 : 2); // the ducker adds a stereo sidechain bus
    }

    check (namesOk, "processor names are the type names");
    check (kindsOk, "instruments: MIDI in, stereo out; effects: stereo in/out (ducker: + stereo sidechain in)");

    // parameters: strings for numbers, unknown keys, out-of-range and missing values
    auto synth = makeInstrument ("synth", { { "w1", "triangle" }, { "cut", "900" }, { "res", 1000 }, { "bogus", 1 } });
    const auto out = renderInstrument (*synth, 0.5, { noteOn (0.0, 60), noteOff (0.3, 60) });
    check (allFinite (out) && peak (out) > 0.01f && peak (out) < 4.0f, "parameters: partial / string / out-of-range values are handled");
}

//==============================================================================
/** A host play head the test moves by hand. */
struct FakePlayHead final : juce::AudioPlayHead
{
    double ppq = 0.0, tempo = 120.0;
    bool playing = true;

    juce::Optional<PositionInfo> getPosition() const override
    {
        PositionInfo info;
        info.setPpqPosition (ppq);
        info.setBpm (tempo);
        info.setIsPlaying (playing);
        return info;
    }
};

/** processEffect() with a play head that advances with the processed blocks. */
Buffer processWithPlayHead (ritmo::BuiltinProcessor& fx, const Buffer& input, FakePlayHead& head, double rate = testRate, int block = testBlock)
{
    fx.setPlayHead (&head);
    fx.prepareToPlay (rate, block);
    const int total = input.getNumSamples();
    Buffer out (2, total), buffer (2, block);
    juce::MidiBuffer midi;

    for (int pos = 0; pos < total; pos += block)
    {
        const int n = std::min (block, total - pos);
        buffer.setSize (2, n, false, false, true);

        for (int ch = 0; ch < 2; ++ch)
            buffer.copyFrom (ch, 0, input, ch, pos, n);

        fx.processBlock (buffer, midi);

        if (head.playing)
            head.ppq += (double) n / rate * head.tempo / 60.0;

        for (int ch = 0; ch < 2; ++ch)
            out.copyFrom (ch, pos, buffer, ch, 0, n);
    }

    fx.setPlayHead (nullptr);
    return out;
}

/** The ducker's engine convention: a 4-channel buffer, track in 0-1, sidechain key in 2-3. 'keyAfter' gets the key
    channels as they were after processing. */
Buffer processSidechain (ritmo::BuiltinProcessor& fx, const Buffer& track, const Buffer& key, double rate = testRate, int block = testBlock,
                         Buffer* keyAfter = nullptr)
{
    fx.prepareToPlay (rate, block);
    const int total = track.getNumSamples();
    Buffer out (2, total), buffer (4, block);
    juce::MidiBuffer midi;

    if (keyAfter != nullptr)
        keyAfter->setSize (2, total);

    for (int pos = 0; pos < total; pos += block)
    {
        const int n = std::min (block, total - pos);
        buffer.setSize (4, n, false, false, true);

        for (int ch = 0; ch < 2; ++ch)
        {
            buffer.copyFrom (ch, 0, track, ch, pos, n);
            buffer.copyFrom (ch + 2, 0, key, ch, pos, n);
        }

        fx.processBlock (buffer, midi);

        for (int ch = 0; ch < 2; ++ch)
        {
            out.copyFrom (ch, pos, buffer, ch, 0, n);

            if (keyAfter != nullptr)
                keyAfter->copyFrom (ch, pos, buffer, ch + 2, 0, n);
        }
    }

    return out;
}

Buffer constant (float value, double seconds, double rate = testRate)
{
    Buffer b (2, toSample (seconds, rate));

    for (int ch = 0; ch < 2; ++ch)
        juce::FloatVectorOperations::fill (b.getWritePointer (ch), value, b.getNumSamples());

    return b;
}

/** A 220 Hz sine plus a little noise: broadband material that no setting of the new effects can null. */
Buffer testSignal (double seconds, double rate = testRate)
{
    juce::Random random (99);
    auto b = sine (220.0, 0.4, seconds, rate);

    for (int ch = 0; ch < 2; ++ch)
        for (int i = 0; i < b.getNumSamples(); ++i)
            b.setSample (ch, i, b.getSample (ch, i) + 0.1f * (random.nextFloat() * 2.0f - 1.0f));

    return b;
}

//==============================================================================
void testNewTypesEverywhere()
{
    std::cout << "\n[new types: default parameters at 44.1 / 48 kHz, blocks 64 / 512 / 2048]" << std::endl;

    for (const auto& type : newInstrumentTypes)
    {
        bool ok = true;
        String detail;

        for (double rate : { 44100.0, 48000.0 })
        {
            for (int block : { 64, 512, 2048 })
            {
                auto inst = makeInstrument (type, instrumentDefaults (type));
                const auto out = renderInstrument (*inst, 1.0, { noteOn (0.0, 48), noteOn (0.1, 55, 90), noteOff (0.5, 48), noteOff (0.55, 55),
                                                                 noteOn (0.6, 60, 127), noteOff (0.8, 60) },
                                                   rate, block);
                const float pk = peak (out);
                const bool good = allFinite (out) && pk > 0.01f && pk < 4.0f;
                ok = ok && good;

                if (! good)
                    detail << String (rate) << "/" << String (block) << ": peak " << fmt (pk) << " ";
            }
        }

        check (ok, type + ": finite, non-silent at every rate and block size", detail);
    }

    for (const auto& type : newEffectTypes)
    {
        bool ok = true;
        String detail;

        for (double rate : { 44100.0, 48000.0 })
        {
            for (int block : { 64, 512, 2048 })
            {
                auto fx = makeEffect (type, effectDefaults (type));
                const auto in = testSignal (1.0, rate);
                Buffer out;

                if (type == "gate")
                {
                    FakePlayHead head;
                    out = processWithPlayHead (*fx, in, head, rate, block);
                }
                else if (type == "ducker")
                {
                    out = processSidechain (*fx, in, sine (60.0, 0.9, 1.0, rate), rate, block);
                }
                else
                {
                    out = processEffect (*fx, in, rate, block);
                }

                const double level = rms (out, 0, out.getNumSamples());
                const bool good = allFinite (out) && level > 0.01 && peak (out) < 4.0f;
                ok = ok && good;

                if (! good)
                    detail << String (rate) << "/" << String (block) << ": rms " << fmt (level) << " ";
            }
        }

        check (ok, type + ": finite, non-silent at every rate and block size", detail);
    }
}

void testSupersaw()
{
    std::cout << "\n[supersaw]" << std::endl;
    const auto defaults = instrumentDefaults ("supersaw");
    const std::vector<Event> note { noteOn (0.0, 57, 127), noteOff (0.6, 57) };

    auto wide = makeInstrument ("supersaw", defaults);
    const auto stereo = renderInstrument (*wide, 1.0, note);
    Buffer left (1, stereo.getNumSamples()), right (1, stereo.getNumSamples());
    left.copyFrom (0, 0, stereo, 0, 0, stereo.getNumSamples());
    right.copyFrom (0, 0, stereo, 1, 0, stereo.getNumSamples());
    check (maxDifference (left, right) > 0.05f, "supersaw: width 0.8 spreads the voices across the stereo field",
           "max L-R difference " + fmt (maxDifference (left, right)));

    auto narrow = makeInstrument ("supersaw", with (defaults, { { "width", 0 } }));
    const auto mono = renderInstrument (*narrow, 1.0, note);
    left.copyFrom (0, 0, mono, 0, 0, mono.getNumSamples());
    right.copyFrom (0, 0, mono, 1, 0, mono.getNumSamples());
    check (maxDifference (left, right) < 1.0e-7f && peak (mono) > 0.05f, "supersaw: width 0 is mono");

    // one voice: a single centred saw, as loud as the synth's single saw at the same level
    auto single = makeInstrument ("supersaw", with (defaults, { { "voices", 1 }, { "env", 0 }, { "cut", 18000 } }));
    const auto one = renderInstrument (*single, 1.0, { noteOn (0.0, 57, 127) });
    const double f = estimateFrequency (one, 0, toSample (0.2, testRate), toSample (0.8, testRate), testRate);
    check (std::abs (f - 220.0) < 1.0, "supersaw: voices 1 is one saw at the note's pitch", fmt (f, 2) + " Hz");
}

void testAcid()
{
    std::cout << "\n[acid: legato and slide]" << std::endl;
    // square through a wide-open filter: easy to measure pitch and level
    const auto props = with (instrumentDefaults ("acid"), { { "wave", "square" }, { "cut", 8000 }, { "res", 0 }, { "env", 0 } });
    auto inst = makeInstrument ("acid", props);
    // 45 = 110 Hz; 57 = 220 Hz arrives while 45 is held: it slides; 45's (late) note off is ignored; 57's note off releases
    const auto out = renderInstrument (*inst, 1.0, { noteOn (0.0, 45, 100), noteOn (0.3, 57, 100), noteOff (0.35, 45), noteOff (0.7, 57) });
    const double before = rms (out, toSample (0.1, testRate), toSample (0.29, testRate), 0);
    double minWindow = 1.0e9;

    for (double t = 0.27; t < 0.40; t += 0.005)
        minWindow = std::min (minWindow, rms (out, toSample (t, testRate), toSample (t + 0.01, testRate), 0));

    check (minWindow > 0.7 * before, "acid: a note on while the previous note is held does not retrigger (no level dip)",
           "lowest 10 ms rms around the slide " + fmt (minWindow) + " vs " + fmt (before));

    const double f1 = estimateFrequency (out, 0, toSample (0.05, testRate), toSample (0.29, testRate), testRate);
    const double fGlide = estimateFrequency (out, 0, toSample (0.3, testRate), toSample (0.33, testRate), testRate);
    const double f2 = estimateFrequency (out, 0, toSample (0.45, testRate), toSample (0.69, testRate), testRate);
    check (std::abs (f1 - 110.0) < 1.0 && std::abs (f2 - 220.0) < 1.0 && fGlide > 120.0 && fGlide < 210.0,
           "acid: the pitch glides from the old note to the new one",
           fmt (f1, 1) + " Hz -> " + fmt (fGlide, 1) + " Hz (first 30 ms of the slide) -> " + fmt (f2, 1) + " Hz");

    const double after = rms (out, toSample (0.4, testRate), toSample (0.69, testRate), 0);
    check (after > 0.7 * before, "acid: a note off for the older note does not silence the newer one", "rms " + fmt (after));
    check (peak (out, toSample (0.7 + 0.065, testRate)) < 1.0e-6f, "acid: the note off of the sounding note releases it");

    // the note off came first: the next note retriggers (from silence, 3 ms attack)
    auto retrig = makeInstrument ("acid", props);
    const auto out2 = renderInstrument (*retrig, 0.6, { noteOn (0.0, 45, 100), noteOff (0.2, 45), noteOn (0.3, 57, 100) });
    const float start = peak (out2, toSample (0.3, testRate), toSample (0.3, testRate) + 20);
    const float later = peak (out2, toSample (0.35, testRate), toSample (0.45, testRate));
    const double fNew = estimateFrequency (out2, 0, toSample (0.305, testRate), toSample (0.35, testRate), testRate);
    check (start < 0.3f * later && std::abs (fNew - 220.0) < 2.0, "acid: after a note off the next note retriggers at its own pitch",
           "first 20 samples " + fmt (start) + " vs " + fmt (later) + ", " + fmt (fNew, 1) + " Hz");

    // accent: velocity above 0.8 is louder (peak * (1 + accent * 0.6)) and opens the filter further
    auto soft = makeInstrument ("acid", instrumentDefaults ("acid"));
    auto loud = makeInstrument ("acid", instrumentDefaults ("acid"));
    const auto softOut = renderInstrument (*soft, 0.3, { noteOn (0.0, 45, 100) });
    const auto loudOut = renderInstrument (*loud, 0.3, { noteOn (0.0, 45, 127) });
    check (rms (loudOut, 0, toSample (0.1, testRate)) > 1.3 * rms (softOut, 0, toSample (0.1, testRate)), "acid: accented notes are louder",
           fmt (rms (loudOut, 0, toSample (0.1, testRate))) + " vs " + fmt (rms (softOut, 0, toSample (0.1, testRate))));
}

void testFm4()
{
    std::cout << "\n[fm4: algorithms]" << std::endl;
    const auto defaults = instrumentDefaults ("fm4");
    Buffer previous;
    bool allOk = true, allDiffer = true;
    String levels;

    for (auto alg : { "stack", "branch", "pairs", "triple", "add" })
    {
        auto inst = makeInstrument ("fm4", with (defaults, { { "alg", alg } }));
        const auto out = renderInstrument (*inst, 1.0, { noteOn (0.0, 57, 110), noteOff (0.6, 57) });
        allOk = allOk && allFinite (out) && peak (out) > 0.02f && peak (out) < 2.0f;
        levels << alg << " " << fmt (peak (out), 3) << " ";

        if (previous.getNumSamples() > 0)
            allDiffer = allDiffer && maxDifference (previous, out) > 1.0e-3f;

        previous = out;
    }

    check (allOk, "fm4: every algorithm renders a finite, non-silent note", levels);
    check (allDiffer, "fm4: each algorithm sounds different from the previous one");

    // add with zero indices: operator 1 alone, a pure sine at f * r1; stack: FM sidebands at f + k * f * r2
    auto pure = makeInstrument ("fm4", with (defaults, { { "alg", "add" }, { "i2", 0 }, { "i3", 0 }, { "i4", 0 } }));
    auto fm = makeInstrument ("fm4", defaults);
    const auto pureOut = renderInstrument (*pure, 2.0, { noteOn (0.0, 69, 127) });
    const auto fmOut = renderInstrument (*fm, 2.0, { noteOn (0.0, 69, 127) });
    const int from = toSample (1.5, testRate), to = toSample (2.0, testRate); // the sustain (decay tau 0.27 s) has settled
    const double p440 = toneLevel (pureOut, 0, from, to, 440.0, testRate), p1320 = toneLevel (pureOut, 0, from, to, 1320.0, testRate);
    const double f440 = toneLevel (fmOut, 0, from, to, 440.0, testRate), f1320 = toneLevel (fmOut, 0, from, to, 1320.0, testRate);
    const double expected = 0.5 * 0.4 * 0.70710678; // gain * sustain * mono-to-stereo
    check (std::abs (p440 - expected) < 0.05 * expected && p1320 < 1.0e-3 * p440, "fm4: add with zero indices is a pure sine at the sustain level",
           "440 Hz " + fmt (p440) + " (expected " + fmt (expected) + "), 1320 Hz " + fmt (p1320, 6));
    check (f1320 > 0.05 * f440, "fm4: stack modulates (sideband at f + f * r2)", "1320/440 Hz " + fmt (f1320 / f440));
}

void testOrgan()
{
    std::cout << "\n[organ]" << std::endl;
    // the three default drawbars (16', 5 1/3', 8') at 1/3 each, no vibrato, percussion or click
    auto inst = makeInstrument ("organ", with (instrumentDefaults ("organ"), { { "perc", 0 }, { "vib", 0 }, { "click", 0 } }));
    const auto out = renderInstrument (*inst, 0.6, { noteOn (0.0, 69, 127) });
    const int from = toSample (0.1, testRate), to = toSample (0.6, testRate);
    const double expected = 0.45 / 3.0 * 0.70710678, h05 = toneLevel (out, 0, from, to, 220.0, testRate);
    const double h1 = toneLevel (out, 0, from, to, 440.0, testRate), h15 = toneLevel (out, 0, from, to, 660.0, testRate);
    const double h2 = toneLevel (out, 0, from, to, 880.0, testRate);
    const bool levelsOk = std::abs (h05 - expected) < 0.03 * expected && std::abs (h1 - expected) < 0.03 * expected
                          && std::abs (h15 - expected) < 0.03 * expected && h2 < 0.01 * expected;
    check (levelsOk, "organ: drawbars b1 b2 b3 give 0.5f, 1.5f and f at 1/3 each, nothing at 2f",
           fmt (h05) + " / " + fmt (h1) + " / " + fmt (h15) + " / " + fmt (h2, 6) + " (expected " + fmt (expected) + ")");

    auto perc = makeInstrument ("organ", with (instrumentDefaults ("organ"), { { "perc", 1 }, { "vib", 0 }, { "click", 0 } }));
    const auto percOut = renderInstrument (*perc, 0.8, { noteOn (0.0, 69, 127) });
    const double early = toneLevel (percOut, 0, toSample (0.01, testRate), toSample (0.06, testRate), 1320.0, testRate);
    const double late = toneLevel (percOut, 0, toSample (0.5, testRate), toSample (0.8, testRate), 1320.0, testRate);
    check (early > 0.02 && late < 0.01 * early, "organ: percussion on the third harmonic decays", fmt (early) + " -> " + fmt (late, 6));
}

void testNewEffects()
{
    std::cout << "\n[new effects]" << std::endl;

    {
        // phaser: wet only, no feedback, no sweep: an allpass chain keeps the level; half mix notches
        auto fx = makeEffect ("phaser", with (effectDefaults ("phaser"), { { "mix", 1 }, { "fb", 0 }, { "depth", 0 } }));
        const auto in = sine (1000.0, 0.25, 0.5);
        const auto out = processEffect (*fx, in);
        const double g = toDb (rms (out, toSample (0.2, testRate), toSample (0.5, testRate), 0) / rms (in, toSample (0.2, testRate), toSample (0.5, testRate), 0));
        check (std::abs (g) < 0.1, "phaser: the wet path is an allpass chain", fmt (g, 3) + " dB");

        double lowest = 0.0, highest = -100.0;

        for (double f = 100.0; f < 8000.0; f *= 1.02)
        {
            const double gain = gainAt ("phaser", with (effectDefaults ("phaser"), { { "fb", 0 }, { "depth", 0 } }), f);
            lowest = std::min (lowest, gain);
            highest = std::max (highest, gain);
        }

        check (lowest < -15.0 && highest > 2.0, "phaser: mix 0.5 makes notches and peaks", "min " + fmt (lowest, 1) + " dB, max " + fmt (highest, 1) + " dB");
    }

    {
        // flanger without depth or feedback: the wet signal is the input delayed by 'delay' ms
        auto fx = makeEffect ("flanger", with (effectDefaults ("flanger"), { { "mix", 1 }, { "depth", 0 }, { "fb", 0 }, { "delay", 5 } }));
        const auto out = processEffect (*fx, impulseAt (0.1, 0.3));
        const int at = toSample (0.1, testRate), l = argMax (out, 0, at, at + 2000), r = argMax (out, 1, at, at + 2000);
        check (l == at + 240 && r == at + 240 && peak (out, 0, at + 200) < 1.0e-6f, "flanger: delay 5 ms, no depth: one tap at 5 ms",
               String (l - at) + " / " + String (r - at) + " samples");
        auto fbFx = makeEffect ("flanger", with (effectDefaults ("flanger"), { { "mix", 1 }, { "depth", 0 }, { "fb", -0.5 }, { "delay", 5 } }));
        const auto fbOut = processEffect (*fbFx, impulseAt (0.1, 0.3));
        check (std::abs (fbOut.getSample (0, at + 480) + 0.5f) < 1.0e-4f, "flanger: negative feedback (second echo at -0.5)",
               fmt (fbOut.getSample (0, at + 480)));
    }

    {
        // bitcrush: the RitmoCrush worklet, sample for sample
        auto fx = makeEffect ("bitcrush", with (effectDefaults ("bitcrush"), { { "bits", 4 }, { "down", 3 }, { "mix", 0.75 } }));
        const auto in = testSignal (0.3);
        const auto out = processEffect (*fx, in, testRate, 100);
        float worst = 0.0f;

        for (int ch = 0; ch < 2; ++ch)
        {
            float hold = 0.0f;
            int left = 0;

            for (int i = 0; i < in.getNumSamples(); ++i)
            {
                const float x = in.getSample (ch, i);

                if (left <= 0)
                {
                    hold = (float) (std::floor (x * 8.0 + 0.5) / 8.0);
                    left = 3;
                }

                --left;
                worst = std::max (worst, std::abs (out.getSample (ch, i) - (x * 0.25f + hold * 0.75f)));
            }
        }

        check (worst < 1.0e-6f, "bitcrush: matches the RitmoCrush worklet", "max diff " + fmt (worst, 8));
    }

    {
        // width: 0 = mono, 1 = unchanged, 2 = sides doubled
        Buffer in (2, toSample (0.3, testRate));

        for (int i = 0; i < in.getNumSamples(); ++i)
        {
            in.setSample (0, i, (float) (0.4 * std::sin (0.05 * i)));
            in.setSample (1, i, (float) (0.3 * std::sin (0.031 * i)));
        }

        float worst = 0.0f;

        for (double w : { 0.0, 1.0, 2.0 })
        {
            auto fx = makeEffect ("width", { { "width", w }, { "gain", 0.5 } });
            const auto out = processEffect (*fx, in);
            const auto a = (float) ((1.0 + w) / 2.0 * 0.5), b = (float) ((1.0 - w) / 2.0 * 0.5);

            for (int i = 0; i < in.getNumSamples(); ++i)
            {
                const float l = in.getSample (0, i), r = in.getSample (1, i);
                worst = std::max (worst, std::abs (out.getSample (0, i) - (l * a + r * b)));
                worst = std::max (worst, std::abs (out.getSample (1, i) - (l * b + r * a)));
            }
        }

        check (worst < 1.0e-5f, "width: the mid/side matrix with output gain (widths 0, 1, 2)", "max diff " + fmt (worst, 8));
    }

    {
        // tremolo: trem swings the level between 1 - depth and 1; pan swings it between the sides
        auto fx = makeEffect ("tremolo", with (effectDefaults ("tremolo"), { { "depth", 1 } }));
        const auto out = processEffect (*fx, constant (0.5f, 1.0));
        const float hi = peak (out);
        float lowest = 1.0f;

        for (int i = 0; i < out.getNumSamples(); ++i)
            lowest = std::min (lowest, std::abs (out.getSample (0, i)));

        check (hi > 0.495f && hi <= 0.5001f && lowest < 0.005f, "tremolo: depth 1 swings the gain between 0 and 1",
               "min " + fmt (lowest) + ", max " + fmt (hi));

        auto pan = makeEffect ("tremolo", with (effectDefaults ("tremolo"), { { "mode", "pan" }, { "depth", 1 } }));
        const auto panned = processEffect (*pan, constant (0.5f, 1.0));
        const int iMax = argMax (panned, 0, 0, panned.getNumSamples());
        check (std::abs (panned.getSample (0, iMax) - 1.0f) < 0.01f && std::abs (panned.getSample (1, iMax)) < 0.01f,
               "tremolo: pan mode moves the stereo signal fully to one side (StereoPanner law)",
               "L " + fmt (panned.getSample (0, iMax)) + ", R " + fmt (panned.getSample (1, iMax)));

        // square: Chromium's band-limited table, so the two levels alternate at 'rate'
        auto square = makeEffect ("tremolo", { { "mode", "trem" }, { "shape", "square" }, { "rate", 4 }, { "depth", 1 } });
        const auto sq = processEffect (*square, constant (0.5f, 1.0));
        const double up = rms (sq, toSample (0.02, testRate), toSample (0.1, testRate), 0), down = rms (sq, toSample (0.145, testRate), toSample (0.225, testRate), 0);
        check (up > 0.4 && down < 0.1, "tremolo: square shape gates at 'rate'", fmt (up) + " / " + fmt (down));
    }
}

void testGate()
{
    std::cout << "\n[gate: host play head]" << std::endl;
    const auto in = constant (0.5f, 1.0);
    const int sixteenth32 = toSample (0.0625, testRate); // a 32nd note at 120 BPM

    auto segmentsOk = [&] (const Buffer& out, int firstOpen, String& detail)
    {
        bool ok = true;

        for (int k = 0; k < 15; ++k)
        {
            const int from = k * sixteenth32 + 300, to = (k + 1) * sixteenth32 - 10;
            const bool open = (k + firstOpen) % 2 == 0;
            float lo = 1.0f, hi = 0.0f;

            for (int i = from; i < to; ++i)
            {
                lo = std::min (lo, out.getSample (0, i));
                hi = std::max (hi, out.getSample (0, i));
            }

            const bool good = open ? lo > 0.49f : hi < 0.01f;
            ok = ok && good;

            if (! good)
                detail << "32nd " << k << (open ? " open" : " closed") << " [" << fmt (lo) << ", " << fmt (hi) << "] ";
        }

        return ok;
    };

    {
        auto fx = makeEffect ("gate", effectDefaults ("gate"));
        FakePlayHead head;
        const auto out = processWithPlayHead (*fx, in, head);
        String detail;
        check (segmentsOk (out, 0, detail), "gate: pattern 16 at 120 BPM alternates open / closed every 32nd", detail);
        writeWav ("fx_gate.wav", out);
    }

    {
        // the pattern follows the song position, not the time since the effect started
        auto fx = makeEffect ("gate", effectDefaults ("gate"));
        FakePlayHead head;
        head.ppq = 0.125; // starts on the second (closed) 32nd
        const auto out = processWithPlayHead (*fx, in, head, testRate, 333);
        String detail;
        check (segmentsOk (out, 1, detail), "gate: follows the play head position (starting on an odd 32nd, block 333)", detail);
    }

    {
        auto fx = makeEffect ("gate", effectDefaults ("gate"));
        FakePlayHead head;
        head.playing = false;
        const auto stopped = processWithPlayHead (*fx, in, head);
        auto fx2 = makeEffect ("gate", effectDefaults ("gate"));
        const auto noHead = processEffect (*fx2, in);
        check (maxDifference (stopped, in) < 1.0e-7f && maxDifference (noHead, in) < 1.0e-7f,
               "gate: passes the signal through when the transport is stopped or there is no play head");
    }

    {
        auto fx = makeEffect ("gate", with (effectDefaults ("gate"), { { "depth", 0.5 } }));
        FakePlayHead head;
        const auto out = processWithPlayHead (*fx, in, head);
        const float closed = out.getSample (0, sixteenth32 + sixteenth32 / 2);
        check (std::abs (closed - 0.25f) < 0.005f, "gate: depth 0.5 closes to half the level", fmt (closed));
    }
}

void testDucker()
{
    std::cout << "\n[ducker: sidechain]" << std::endl;
    const auto track = sine (440.0, 0.5, 1.0);
    const int from = toSample (0.5, testRate), to = toSample (1.0, testRate);

    {
        auto fx = makeEffect ("ducker", effectDefaults ("ducker"));
        const auto key = sine (100.0, 0.9, 1.0);
        Buffer keyAfter;
        const auto out = processSidechain (*fx, track, key, testRate, testBlock, &keyAfter);
        const double g = toDb (rms (out, from, to) / rms (track, from, to));
        check (std::abs (g + 18.0) < 1.0, "ducker: a loud key ducks the track by 'range' (18 dB)", fmt (g, 2) + " dB");
        check (maxDifference (keyAfter, key) < 1.0e-9f, "ducker: the key channels are left untouched");
        writeWav ("fx_ducker.wav", out);
    }

    {
        // a steady key 6 dB over the threshold: half of the range (gain curve over 12 dB)
        auto fx = makeEffect ("ducker", effectDefaults ("ducker"));
        const auto out = processSidechain (*fx, track, constant ((float) std::pow (10.0, -24.0 / 20.0), 1.0));
        const double g = toDb (rms (out, from, to) / rms (track, from, to));
        check (std::abs (g + 9.0) < 0.05, "ducker: key 6 dB over the threshold ducks by half the range", fmt (g, 3) + " dB");
    }

    {
        auto fx = makeEffect ("ducker", effectDefaults ("ducker"));
        const auto out = processSidechain (*fx, track, silence (1.0));
        check (maxDifference (out, track) < 1.0e-9f, "ducker: a silent key leaves the track unchanged");
        auto fx2 = makeEffect ("ducker", effectDefaults ("ducker"));
        const auto twoChannels = processEffect (*fx2, track);
        check (maxDifference (twoChannels, track) < 1.0e-9f, "ducker: a 2-channel buffer passes through unchanged");
    }

    {
        // release: after the key stops, the gain recovers with the release time
        auto fx = makeEffect ("ducker", effectDefaults ("ducker"));
        auto key = sine (100.0, 0.9, 2.0);

        for (int ch = 0; ch < 2; ++ch)
            key.clear (ch, toSample (1.0, testRate), key.getNumSamples() - toSample (1.0, testRate));

        const auto longTrack = sine (440.0, 0.5, 2.0);
        const auto out = processSidechain (*fx, longTrack, key);
        const double ducked = rms (out, toSample (0.8, testRate), toSample (1.0, testRate));
        const double recovered = rms (out, toSample (1.8, testRate), toSample (2.0, testRate));
        check (recovered > 0.95 * rms (longTrack, 0, longTrack.getNumSamples()) && ducked < 0.2 * recovered,
               "ducker: the level recovers after the key stops", fmt (ducked) + " -> " + fmt (recovered));
    }
}

void testSetParamValue()
{
    std::cout << "\n[setParamValue: real-time automation]" << std::endl;

    // every numeric key of every type is accepted, select keys and unknown keys are refused
    {
        bool ok = true;
        String detail;

        auto checkKeys = [&] (ritmo::BuiltinProcessor& p, const String& type, const Props& props)
        {
            for (const auto& prop : props)
            {
                const bool numeric = ! prop.second.isString() && ! (type == "ducker" && String (prop.first) == "src");
                const bool accepted = p.setParamValue (prop.first, (float) (double) (prop.second.isString() ? juce::var (0) : prop.second));

                if (accepted != numeric)
                {
                    ok = false;
                    detail << type << "." << prop.first << " ";
                }
            }

            if (p.setParamValue ("bogus", 1.0f) || p.setParamValue (nullptr, 1.0f))
            {
                ok = false;
                detail << type << ".bogus ";
            }
        };

        for (const auto& type : instrumentTypes)
            if (auto p = makeInstrument (type, instrumentDefaults (type)))
                checkKeys (*p, type, instrumentDefaults (type));

        for (const auto& type : effectTypes)
            if (auto p = makeEffect (type, effectDefaults (type)))
                checkKeys (*p, type, effectDefaults (type));

        if (auto sampler = makeInstrument ("sampler", instrumentDefaults ("sampler")))
            checkKeys (*sampler, "sampler", instrumentDefaults ("sampler"));

        check (ok, "setParamValue: numeric keys accepted, selects / delay time / ducker src / unknown keys refused", detail);
    }

    // synth: a darker cutoff applies to the next note, from the same block on
    {
        auto reference = makeInstrument ("synth", instrumentDefaults ("synth"));
        const auto bright = renderInstrument (*reference, 0.5, { noteOn (0.0, 57) });
        auto inst = makeInstrument ("synth", instrumentDefaults ("synth"));
        inst->prepareToPlay (testRate, testBlock);
        renderInstrument (*inst, 0.7, { noteOn (0.0, 57), noteOff (0.1, 57) }, testRate, testBlock, false); // ends at 0.55 s
        const bool accepted = inst->setParamValue ("cut", 150.0f);
        const auto dark = renderInstrument (*inst, 0.5, { noteOn (0.0, 57) }, testRate, testBlock, false);
        const int from = toSample (0.2, testRate), to = toSample (0.5, testRate);
        const double hBright = toneLevel (bright, 0, from, to, 220.0 * 8.0, testRate), hDark = toneLevel (dark, 0, from, to, 220.0 * 8.0, testRate);
        check (accepted && hDark < 0.05 * hBright, "setParamValue: synth cut 150 Hz darkens the next note",
               "8th harmonic " + fmt (hBright, 6) + " -> " + fmt (hDark, 6));

        const bool clamped = inst->setParamValue ("cut", 1.0e9f);
        const bool nanRefused = ! inst->setParamValue ("cut", std::numeric_limits<float>::quiet_NaN());
        const bool selectRefused = ! inst->setParamValue ("w1", 1.0f);
        const auto loud = renderInstrument (*inst, 0.3, { noteOn (0.0, 57) }, testRate, testBlock, false);
        check (clamped && nanRefused && selectRefused && allFinite (loud) && peak (loud) < 4.0f,
               "setParamValue: out-of-range values are clamped, NaN and select keys refused");
    }

    // bitcrush: bits from 8 to 2 in the middle of a stream, effective from the next block's first sample
    {
        auto fx = makeEffect ("bitcrush", with (effectDefaults ("bitcrush"), { { "down", 1 } }));
        fx->prepareToPlay (testRate, 64);
        const auto in = sine (440.0, 0.3, 0.2);
        const auto first = processEffect (*fx, in, testRate, 64, false);
        const bool accepted = fx->setParamValue ("bits", 2.0f);
        const auto second = processEffect (*fx, in, testRate, 64, false);
        bool coarse = true;

        for (int i = 0; i < second.getNumSamples(); ++i)
        {
            const float x = second.getSample (0, i) * 2.0f;
            coarse = coarse && std::abs (x - std::round (x)) < 1.0e-6f;
        }

        check (accepted && coarse && maxDifference (first, in) < 0.01f && maxDifference (second, in) > 0.2f,
               "setParamValue: bitcrush bits 2 quantises from the next sample on",
               "error before " + fmt (maxDifference (first, in)) + ", after " + fmt (maxDifference (second, in)));
    }

    // an effect gain: width's output level follows within the smoothing time
    {
        auto fx = makeEffect ("width", effectDefaults ("width"));
        fx->prepareToPlay (testRate, testBlock);
        processEffect (*fx, constant (0.5f, 0.1), testRate, testBlock, false);
        fx->setParamValue ("gain", 0.0f);
        const auto out = processEffect (*fx, constant (0.5f, 0.3), testRate, testBlock, false);
        check (std::abs (out.getSample (0, 0)) > 0.45f && peak (out, toSample (0.2, testRate)) < 1.0e-3f,
               "setParamValue: width gain 0 fades the output out (20 ms smoothing)", "after 0.2 s " + fmt (peak (out, toSample (0.2, testRate)), 6));
    }

    // filter: a cutoff change reaches cached coefficients
    {
        auto fx = makeEffect ("filter", effectDefaults ("filter"));
        fx->prepareToPlay (testRate, testBlock);
        const auto in = sine (4000.0, 0.25, 0.3);
        const auto open = processEffect (*fx, in, testRate, testBlock, false);
        fx->setParamValue ("freq", 200.0f);
        const auto closed = processEffect (*fx, in, testRate, testBlock, false);
        const double g0 = rms (open, toSample (0.1, testRate), toSample (0.3, testRate)), g1 = rms (closed, toSample (0.1, testRate), toSample (0.3, testRate));
        check (toDb (g1 / g0) < -40.0, "setParamValue: filter freq 8 kHz -> 200 Hz takes effect", fmt (toDb (g1 / g0), 1) + " dB at 4 kHz");
    }

    // reverb size: rebuilt off the audio thread, swapped in a few blocks later
    {
        const auto props = with (effectDefaults ("reverb"), { { "size", 1.0 }, { "mix", 1 } });
        auto live = makeEffect ("reverb", props);
        live->prepareToPlay (testRate, testBlock);
        processEffect (*live, silence (0.05), testRate, testBlock, false);
        const bool accepted = live->setParamValue ("size", 0.4f);

        for (int i = 0; i < 20; ++i)
        {
            Buffer quiet (2, testBlock);
            quiet.clear();
            juce::MidiBuffer midi;
            live->processBlock (quiet, midi);
            std::this_thread::sleep_for (std::chrono::milliseconds (20));
        }

        processEffect (*live, silence (0.4), testRate, testBlock, false);
        const auto shorter = processEffect (*live, impulseAt (0.1, 1.5), testRate, testBlock, false);
        const float after = peak (shorter, toSample (0.1 + 0.02 + 0.4 + 0.05, testRate));
        check (accepted && after < 1.0e-4f && peak (shorter) > 1.0e-4f, "setParamValue: reverb size rebuilds the impulse in the background",
               "peak after 0.57 s " + fmt (after, 8));
    }

    // gate: smooth and depth from the audio thread
    {
        auto fx = makeEffect ("gate", effectDefaults ("gate"));
        const bool ok = fx->setParamValue ("depth", 0.5f) && fx->setParamValue ("smooth", 0.01f) && ! fx->setParamValue ("pattern", 2.0f);
        FakePlayHead head;
        const auto out = processWithPlayHead (*fx, constant (0.5f, 0.3), head);
        const float closed = out.getSample (0, toSample (0.0625 + 0.06, testRate));
        check (ok && std::abs (closed - 0.25f) < 0.01f, "setParamValue: gate depth 0.5", fmt (closed));
    }
}
} // namespace

int main()
{
    renderDir = juce::File::getSpecialLocation (juce::File::tempDirectory).getChildFile ("ritmo_builtins_renders");
    renderDir.createDirectory();
    std::cout << "Ritmo built-ins offline test" << std::endl;
    std::cout << "WAV renders: " << renderDir.getFullPathName() << std::endl;

    testFactories();

    for (const auto& type : instrumentTypes)
        testInstrument (type);

    testMonoChoke();
    testSampler();
    testSamplerOptions();
    testMonoAndPortamento();
    testExpression();

    for (const auto& type : effectTypes)
        testEffect (type);

    testNewTypesEverywhere();
    testSupersaw();
    testAcid();
    testFm4();
    testOrgan();
    testNewEffects();
    testGate();
    testDucker();
    testSetParamValue();
    testPerformance();

    std::cout << "\n" << numPassed << " passed, " << numFailed << " failed" << std::endl;
    std::cout << "WAV renders: " << renderDir.getFullPathName() << std::endl;
    return numFailed == 0 ? 0 : 1;
}
