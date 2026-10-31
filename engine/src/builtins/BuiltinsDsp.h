#pragma once
/*
    Ritmo Engine — private DSP building blocks shared by the built-in instruments and effects.
    Not part of the engine API (see Builtins.h for that).

    Everything here mirrors a Web Audio primitive used by src/js/audio.js:
      SegEnv      AudioParam automation (setValueAtTime / linear / exponential ramps / setTargetAtTime)
      Svf         BiquadFilterNode (same analog prototypes and bilinear transform, but a TPT state-variable
                  structure, so cutoff modulation is smooth and stable)
      Osc         OscillatorNode (Chromium's band-limited PeriodicWave tables)
      sineTable   OscillatorNode "sine" for instruments with many operators per voice (fm4, organ)
      SatCurve    WaveShaperNode with the satCurve() table of the web app
    ParamStore holds the parameters (setParams() on the message thread, setParamValue() on the audio thread).
*/
#include "Builtins.h"
#include <juce_dsp/juce_dsp.h>
#include <algorithm>
#include <array>
#include <atomic>
#include <cmath>
#include <cstdint>
#include <vector>

namespace ritmo::builtins
{
constexpr double pi = juce::MathConstants<double>::pi;
constexpr double twoPi = juce::MathConstants<double>::twoPi;

/** The web app's voices are mono and reach the mixer through a StereoPannerNode, which gives a mono
    source cos(pi/4) per side at centre pan. The native instruments render that stereo image directly,
    so a balance-style pan in the engine (unity at centre for stereo input) matches the web levels. */
constexpr float monoToStereo = 0.70710678f;

inline double mtof (double note) noexcept { return 440.0 * std::pow (2.0, (note - 69.0) / 12.0); }
inline double dbToGain (double db) noexcept { return std::pow (10.0, db / 20.0); }
inline double semitoneRatio (double st) noexcept { return std::pow (2.0, st / 12.0); }
inline double wrap01 (double x) noexcept { return x - std::floor (x); }

/** Web Audio's BiquadFilterNode reads Q in dB for "lowpass" and "highpass". */
inline double resonanceFromDb (double qDb) noexcept { return std::pow (10.0, qDb / 20.0); }

//==============================================================================
/** One entry of INSTRUMENTS[type].params / FXDEFS[type].params of core.js. */
struct ParamSpec
{
    const char* id;
    float min, max, def;
    const char* options; // "a|b|c" for select params (the stored value is the option index), nullptr for numbers
    bool automatable;    // accepted by BuiltinProcessor::setParamValue() (numbers only)
};

/** A numeric parameter (a knob of the web app): automatable. */
constexpr ParamSpec num (const char* id, float mn, float mx, float def) noexcept { return { id, mn, mx, def, nullptr, true }; }
/** A select of the web app: stored as the option index, not automatable. */
constexpr ParamSpec sel (const char* id, const char* options, int def) noexcept { return { id, 0.0f, 0.0f, (float) def, options, false }; }
/** Stored as a number but set only through setParams(): the delay's time (a select of beat fractions in the web app,
    read with parseFloat()) and the ducker's source track (routing, handled by the engine). */
constexpr ParamSpec numFixed (const char* id, float mn, float mx, float def) noexcept { return { id, mn, mx, def, nullptr, false }; }

constexpr int maxParams = 40; // the sampler has 32

/** Parameter values shared between the message thread (writer) and the audio thread (reader) through atomics. */
class ParamStore
{
public:
    ParamStore (const ParamSpec* specsIn, int numSpecsIn) noexcept;

    /** Message thread. Reads every known key of the web app's params object; missing or invalid keys keep their value. */
    void set (const juce::var& params);

    /** Any thread, real-time safe: stores one automatable parameter, clamped to its range.
        Returns its index, or -1 for an unknown key, a select / fixed parameter or a non-finite value. */
    int setValue (const char* key, float value) noexcept;

    /** The index of a parameter key, or -1. Real-time safe. */
    int indexOf (const char* key) const noexcept;

    float get (int index) const noexcept { return values[(size_t) index].load (std::memory_order_relaxed); }
    bool is (int index, int option) const noexcept { return (int) get (index) == option; }
    void snapshot (float* dest) const noexcept;

    /** The index of a numeric (knob) parameter, or -1 for an unknown key or a select. */
    int numberIndex (const char* key) const noexcept
    {
        const int i = indexOf (key);
        return i >= 0 && specs[i].options == nullptr ? i : -1;
    }

    /** 'value' clamped to the range of parameter 'index'. */
    float limit (int index, float value) const noexcept { return juce::jlimit (specs[index].min, specs[index].max, value); }

private:
    const ParamSpec* specs;
    int numSpecs;
    std::array<std::atomic<float>, maxParams> values;
};

//==============================================================================
/** xorshift32 white noise in [-1, 1). Real-time safe replacement of the looped Math.random() noise buffer. */
struct Rng
{
    uint32_t state = 0x2545F491u;

    void seed (uint32_t s) noexcept { state = s != 0 ? s : 0x9E3779B9u; }

    float next() noexcept
    {
        state ^= state << 13;
        state ^= state >> 17;
        state ^= state << 5;
        return (float) (state >> 8) * (1.0f / 8388608.0f) - 1.0f;
    }
};

//==============================================================================
/** sin(2 pi phase) read from a 4096-point table with linear interpolation (error below 1e-6), for the instruments
    that run many sine oscillators per voice (fm4, organ). Chromium's OscillatorNode reads a table for its sine too.
    Call it once off the audio thread first (prepareToPlay) so the table is built there. */
inline float sineTable (double phase) noexcept
{
    constexpr int size = 4096;
    static const auto table = []
    {
        std::array<float, size + 1> t {};

        for (int i = 0; i <= size; ++i)
            t[(size_t) i] = (float) std::sin (twoPi * (double) i / (double) size);

        return t;
    }();

    const double index = wrap01 (phase) * size;
    const auto whole = std::min (size - 1, (int) index);
    const auto frac = (float) (index - (double) whole);
    const float a = table[(size_t) whole];
    return a + frac * (table[(size_t) whole + 1] - a);
}

//==============================================================================
enum class FilterType { lowpass, highpass, bandpass, notch, peaking, lowshelf, highshelf, allpass };

struct SvfCoeffs
{
    float a1 = 0.0f, a2 = 0.0f, a3 = 0.0f, m0 = 1.0f, m1 = 0.0f, m2 = 0.0f;
};

/** Coefficients of a TPT state-variable filter (A. Simper) whose response equals the Audio EQ Cookbook
    biquad used by Web Audio: lowpass/highpass/bandpass(constant 0 dB peak)/notch/peaking/shelves (shelf slope 1)/allpass.
    q is the *linear* Q (convert lowpass/highpass Q with resonanceFromDb()). */
inline SvfCoeffs makeSvf (FilterType type, double freq, double q, double gainDb, double rate) noexcept
{
    freq = juce::jlimit (1.0, rate * 0.4995, freq);
    q = std::max (q, 1.0e-3);
    double g = std::tan (pi * freq / rate), k = 1.0 / q;
    const double A = std::pow (10.0, gainDb / 40.0);
    double m0 = 0.0, m1 = 0.0, m2 = 0.0;

    switch (type)
    {
        case FilterType::lowpass:   m2 = 1.0; break;
        case FilterType::highpass:  m0 = 1.0; m1 = -k; m2 = -1.0; break;
        case FilterType::bandpass:  m1 = k; break;
        case FilterType::notch:     m0 = 1.0; m1 = -k; break;
        case FilterType::peaking:   k = 1.0 / (q * A); m0 = 1.0; m1 = k * (A * A - 1.0); break;
        case FilterType::lowshelf:  g /= std::sqrt (A); m0 = 1.0; m1 = k * (A - 1.0); m2 = A * A - 1.0; break;
        case FilterType::highshelf: g *= std::sqrt (A); m0 = A * A; m1 = k * (1.0 - A) * A; m2 = 1.0 - A * A; break;
        case FilterType::allpass:   m0 = 1.0; m1 = -2.0 * k; break;
    }

    const double a1 = 1.0 / (1.0 + g * (g + k));
    SvfCoeffs c;
    c.a1 = (float) a1;
    c.a2 = (float) (g * a1);
    c.a3 = (float) (g * g * a1);
    c.m0 = (float) m0;
    c.m1 = (float) m1;
    c.m2 = (float) m2;
    return c;
}

/** Shelf filters of the BiquadFilterNode ignore Q: slope S = 1 is a Q of 1/sqrt(2). */
constexpr double shelfQ = 0.70710678118654752;

struct SvfState
{
    float ic1 = 0.0f, ic2 = 0.0f;

    void reset() noexcept { ic1 = ic2 = 0.0f; }

    float process (const SvfCoeffs& c, float v0) noexcept
    {
        const float v3 = v0 - ic2;
        const float v1 = c.a1 * ic1 + c.a2 * v3;
        const float v2 = ic2 + c.a2 * ic1 + c.a3 * v3;
        ic1 = 2.0f * v1 - ic1;
        ic2 = 2.0f * v2 - ic2;
        return c.m0 * v0 + c.m1 * v1 + c.m2 * v2;
    }
};

//==============================================================================
enum class Wave { sine, triangle, sawtooth, square };

/** Two neighbouring band-limited tables for one fundamental (see WaveTables::pick). */
struct TablePick
{
    const float* lower = nullptr;  // fewer partials
    const float* higher = nullptr; // more partials
    float mix = 0.0f;              // 0 = higher, 1 = lower
    int mask = 0;
    double size = 0.0;
};

/** Port of Chromium's PeriodicWave for the built-in "square", "sawtooth" and "triangle" types: the same
    Fourier series, culled into 3 band-limited tables per octave (4096 points at 44.1/48 kHz), normalised
    to the peak of the fullest table, picked and crossfaded by fundamental, read with linear interpolation.
    Tables depend only on the table size and are built once, off the audio thread (prepareToPlay). */
class WaveTables
{
public:
    explicit WaveTables (int sizeIn);

    /** Message thread: the shared tables for this sample rate (built on first use, kept for the process lifetime). */
    static const WaveTables* forSampleRate (double sampleRate);

    TablePick pick (Wave wave, double frequency, double sampleRate) const noexcept
    {
        TablePick t;

        if (wave == Wave::sine)
            return t;

        // WaveDataForFundamentalFrequency(): one range ahead "just in time to truncate partials before aliasing"
        const double lowest = sampleRate / tableSize;
        const double ratio = frequency > 0.0 ? frequency / lowest : 0.5;
        const double range = juce::jlimit (0.0, (double) (numRanges - 1), 1.0 + std::log2 (ratio) * 1200.0 / 400.0);
        const int r1 = (int) range, r2 = r1 < numRanges - 1 ? r1 + 1 : r1;
        const size_t w = wave == Wave::square ? 0 : (wave == Wave::sawtooth ? 1 : 2);
        t.higher = data.data() + ((w * (size_t) numRanges + (size_t) r1) * (size_t) tableSize);
        t.lower = data.data() + ((w * (size_t) numRanges + (size_t) r2) * (size_t) tableSize);
        t.mix = (float) (range - r1);
        t.mask = tableSize - 1;
        t.size = tableSize;
        return t;
    }

private:
    int tableSize, numRanges;
    std::vector<float> data; // [square, sawtooth, triangle][range][tableSize]
};

/** OscillatorNode: phase 0 at start, the Web Audio waveforms (all odd functions rising at phase 0). */
struct Osc
{
    double phase = 0.0, inc = 0.0;
    Wave wave = Wave::sine;
    TablePick pick;

    void reset() noexcept { phase = 0.0; }

    /** A fixed-frequency oscillator. */
    void start (Wave w, double freq, double rate, const WaveTables* tables) noexcept
    {
        phase = 0.0;
        wave = w;
        inc = freq / rate;
        pick = tables != nullptr ? tables->pick (w, freq, rate) : TablePick {};
    }

    /** Changes the frequency without resetting the phase (portamento): new increment and band-limited table pair. */
    void setFrequency (double freq, double rate, const WaveTables* tables) noexcept
    {
        inc = freq / rate;
        pick = tables != nullptr ? tables->pick (wave, freq, rate) : TablePick {};
    }

    float next() noexcept { return wave == Wave::sine ? sine (inc) : table (inc); }

    /** Sine at a per-sample frequency: dt = frequency / sampleRate (may be negative, for FM). */
    float sine (double dt) noexcept
    {
        const double p = phase;
        phase = wrap01 (phase + dt);
        return (float) std::sin (twoPi * p);
    }

    /** Non-sine wave at a per-sample frequency (the table pair is chosen per sample, like Chromium's a-rate path). */
    float swept (Wave w, double freq, double rate, const WaveTables* tables) noexcept
    {
        if (tables == nullptr)
            return 0.0f;

        pick = tables->pick (w, freq, rate);
        return table (freq / rate);
    }

private:
    float table (double dt) noexcept
    {
        const double p = phase;
        phase = wrap01 (phase + dt);

        if (pick.higher == nullptr)
            return 0.0f;

        const double index = p * pick.size;
        const int i0 = (int) index & pick.mask, i1 = (i0 + 1) & pick.mask;
        const auto f = (float) (index - std::floor (index));
        const float hi = pick.higher[i0] + f * (pick.higher[i1] - pick.higher[i0]);
        const float lo = pick.lower[i0] + f * (pick.lower[i1] - pick.lower[i0]);
        return hi + pick.mix * (lo - hi);
    }
};

inline Wave waveFromIndex (float index) noexcept
{
    switch ((int) index)
    {
        case 0:  return Wave::sine;
        case 1:  return Wave::triangle;
        case 2:  return Wave::sawtooth;
        default: return Wave::square;
    }
}

//==============================================================================
/** satCurve(k) of the web app as a WaveShaperNode: tanh(x * d) / tanh(d) with d = 1 + 12 k, input clamped to [-1, 1]. */
struct SatCurve
{
    float drive = 1.0f, norm = 1.0f;

    void set (double k) noexcept
    {
        const double d = 1.0 + k * 12.0;
        drive = (float) d;
        norm = (float) (1.0 / std::tanh (d));
    }

    float operator() (float x) const noexcept { return std::tanh (juce::jlimit (-1.0f, 1.0f, x) * drive) * norm; }
};

//==============================================================================
/** AudioParam automation timeline, evaluated sample by sample (double precision so long ramps don't drift). */
class SegEnv
{
public:
    void begin (double startValue, double rate) noexcept
    {
        fs = rate;
        value = startValue;
        num = index = 0;
        pos = 0;
        endTime = 0.0;
        entered = false;
    }

    void linearTo (double target, double seconds) noexcept    { push (Kind::linear, target, seconds, 0.0); }
    void expTo (double target, double seconds) noexcept       { push (Kind::exponential, target, seconds, 0.0); }
    void hold (double seconds) noexcept                       { push (Kind::hold, 0.0, seconds, 0.0); }
    void jumpTo (double target) noexcept                      { push (Kind::linear, target, 0.0, 0.0); }
    /** setTargetAtTime: open-ended, must be the last segment. */
    void targetTo (double target, double tau) noexcept        { push (Kind::target, target, -1.0, tau); }

    /** The value at the current sample, then advances by one sample. */
    double next() noexcept
    {
        if (! entered)
        {
            entered = true;
            enter();
        }

        const double out = value;
        ++pos;

        if (index < num)
        {
            const auto& s = segs[(size_t) index];

            switch (s.kind)
            {
                case Kind::linear:      value += inc; break;
                case Kind::exponential: value *= inc; break;
                case Kind::target:      value = s.target + (value - s.target) * inc; break;
                case Kind::hold:        break;
            }

            if (s.end >= 0 && pos >= s.end)
            {
                if (s.kind == Kind::linear || s.kind == Kind::exponential)
                    value = s.target;

                ++index;
                enter();
            }
        }

        return out;
    }

    /** True once every segment has run (the value then holds). */
    bool finished() const noexcept { return entered ? index >= num : num == 0; }
    double current() const noexcept { return value; }

private:
    enum class Kind { linear, exponential, hold, target };

    struct Seg
    {
        Kind kind;
        double target, tau;
        int64_t end; // absolute sample index at which the segment ends, -1 = open-ended
    };

    void push (Kind kind, double target, double seconds, double tau) noexcept
    {
        if (num >= (int) segs.size())
            return;

        int64_t end = -1;

        if (seconds >= 0.0)
        {
            endTime += seconds;
            end = (int64_t) std::llround (endTime * fs);
        }

        segs[(size_t) num++] = { kind, target, tau, end };
    }

    void enter() noexcept
    {
        while (index < num)
        {
            const auto& s = segs[(size_t) index];

            if (s.end >= 0 && s.end <= pos)
            {
                if (s.kind == Kind::linear || s.kind == Kind::exponential)
                    value = s.target;

                ++index;
                continue;
            }

            const double n = s.end >= 0 ? (double) (s.end - pos) : 1.0;

            switch (s.kind)
            {
                case Kind::linear:      inc = (s.target - value) / n; break;
                case Kind::exponential: inc = (value > 0.0 && s.target > 0.0) ? std::pow (s.target / value, 1.0 / n) : 1.0; break;
                case Kind::target:      inc = std::exp (-1.0 / (std::max (s.tau, 1.0e-6) * fs)); break;
                case Kind::hold:        inc = 0.0; break;
            }
            return;
        }
    }

    std::array<Seg, 12> segs {};
    int num = 0, index = 0;
    int64_t pos = 0;
    double value = 0.0, inc = 0.0, endTime = 0.0, fs = 44100.0;
    bool entered = false;
};

/** percEnv() of the web app: exponential 'atk' rise from 0.0001 to peak, exponential decay to 0.0001 over 'dec'. */
inline void percEnv (SegEnv& env, double peak, double dec, double atk, double rate) noexcept
{
    constexpr double lo = 1.0e-4;
    env.begin (lo, rate);
    env.expTo (std::max (peak, 3.0e-4), atk);
    env.expTo (lo, dec);
}

//==============================================================================
/** Circular delay line read with linear interpolation, like the Web Audio DelayNode. */
class DelayLine
{
public:
    void prepare (int maxDelaySamples)
    {
        const int size = juce::nextPowerOfTwo (std::max (8, maxDelaySamples + 4));
        buffer.assign ((size_t) size, 0.0f);
        mask = size - 1;
        writePos = 0;
    }

    void clear() noexcept
    {
        std::fill (buffer.begin(), buffer.end(), 0.0f);
        writePos = 0;
    }

    void push (float x) noexcept
    {
        buffer[(size_t) writePos] = x;
        writePos = (writePos + 1) & mask;
    }

    /** The signal 'delay' samples before the next push (delay >= 1; call push() first and add 1 for delays from 0). */
    float read (double delay) const noexcept
    {
        delay = juce::jlimit (1.0, (double) (mask - 3), delay);
        const double whole = std::floor (delay);
        const int k = (int) whole;
        const auto t = (float) (delay - whole);
        const float p1 = at (k);
        return p1 + t * (at (k + 1) - p1);
    }

private:
    float at (int k) const noexcept { return buffer[(size_t) ((writePos - k) & mask)]; }

    std::vector<float> buffer;
    int mask = 0, writePos = 0;
};

//==============================================================================
/** One-pole parameter smoother (the web app sets AudioParam.value directly; this only removes zipper noise). */
struct Smoother
{
    double current = 0.0, target = 0.0, coeff = 0.0;
    bool primed = false;

    void prepare (double rate, double seconds) noexcept { coeff = std::exp (-1.0 / (seconds * rate)); }
    void setTarget (double t) noexcept
    {
        target = t;
        if (! primed) { current = t; primed = true; }
    }
    double next() noexcept { return current = target + (current - target) * coeff; }
    /** Advances n samples at once (for control-rate updates). */
    double skip (int n) noexcept { return current = target + (current - target) * std::pow (coeff, (double) n); }
    bool isSettled (double tolerance) const noexcept { return std::abs (current - target) <= tolerance; }
};

//==============================================================================
// Factories implemented in BuiltinsInstruments.cpp / BuiltinsEffects.cpp.
std::unique_ptr<BuiltinProcessor> makeInstrument (const juce::String& type);
std::unique_ptr<BuiltinProcessor> makeEffect (const juce::String& type);

} // namespace ritmo::builtins
