// Ritmo Engine — built-in instruments: native ports of VOICES / analogVoice / ksBuffer / hatVoice in src/js/audio.js
// (drums, bass808, synth, pad, pluck, epiano, sampler, supersaw, acid, fm4, organ).
#include "BuiltinsDsp.h"

namespace ritmo::builtins
{
namespace
{
constexpr int maxVoices = 32;
constexpr double chokeSeconds = 0.01; // CC 120 (all sound off)
constexpr double lowLevel = 1.0e-4;   // the floor of the web app's exponential envelopes

//==============================================================================
// Parameter specs: INSTRUMENTS in src/js/core.js (same order as the voices' enums below).
constexpr const char* waveOptions = "sine|triangle|sawtooth|square";

constexpr ParamSpec kickSpecs[]    = { num ("tune", -12.0f, 12.0f, 0.0f), num ("decay", 0.1f, 1.6f, 0.5f), num ("punch", 0.0f, 1.0f, 0.55f),
                                       num ("click", 0.0f, 1.0f, 0.3f), num ("drive", 0.0f, 1.0f, 0.15f) };
constexpr ParamSpec snareSpecs[]   = { num ("tune", -12.0f, 12.0f, 0.0f), num ("decay", 0.05f, 0.8f, 0.22f), num ("tone", 0.0f, 1.0f, 0.45f),
                                       num ("snappy", 0.0f, 1.0f, 0.7f) };
constexpr ParamSpec clapSpecs[]    = { num ("tone", 600.0f, 4000.0f, 1300.0f), num ("decay", 0.05f, 1.0f, 0.28f), num ("spread", 0.004f, 0.03f, 0.011f) };
constexpr ParamSpec hatSpecs[]     = { num ("tone", 0.0f, 1.0f, 0.6f), num ("decay", 0.02f, 0.4f, 0.07f) };
constexpr ParamSpec ohatSpecs[]    = { num ("tone", 0.0f, 1.0f, 0.55f), num ("decay", 0.1f, 1.5f, 0.42f) };
constexpr ParamSpec tomSpecs[]     = { num ("tune", -12.0f, 12.0f, 0.0f), num ("decay", 0.1f, 1.2f, 0.4f), num ("sweep", 0.0f, 1.0f, 0.5f) };
constexpr ParamSpec cowbellSpecs[] = { num ("tune", -12.0f, 12.0f, 0.0f), num ("decay", 0.05f, 1.0f, 0.3f) };
constexpr ParamSpec crashSpecs[]   = { num ("tone", 0.0f, 1.0f, 0.4f), num ("decay", 0.3f, 4.0f, 1.8f) };
constexpr ParamSpec bass808Specs[] = { num ("decay", 0.2f, 4.0f, 1.2f), num ("glide", 0.0f, 1.0f, 0.3f), num ("drive", 0.0f, 1.0f, 0.3f),
                                       num ("tone", 200.0f, 8000.0f, 2400.0f) };
constexpr ParamSpec synthSpecs[]   = { sel ("w1", waveOptions, 2), sel ("w2", waveOptions, 3), num ("mix", 0.0f, 1.0f, 0.35f),
                                       num ("det", 0.0f, 50.0f, 8.0f), num ("oct2", -2.0f, 2.0f, 0.0f), num ("cut", 60.0f, 18000.0f, 2200.0f),
                                       num ("res", 0.0f, 18.0f, 3.0f), num ("env", 0.0f, 1.0f, 0.4f), num ("a", 0.001f, 2.0f, 0.005f),
                                       num ("d", 0.01f, 3.0f, 0.35f), num ("s", 0.0f, 1.0f, 0.6f), num ("r", 0.01f, 4.0f, 0.25f),
                                       num ("gain", 0.0f, 1.0f, 0.6f) };
constexpr ParamSpec padSpecs[]     = { num ("det", 0.0f, 60.0f, 22.0f), num ("cut", 100.0f, 12000.0f, 1600.0f), num ("res", 0.0f, 12.0f, 1.0f),
                                       num ("a", 0.01f, 4.0f, 0.9f), num ("s", 0.0f, 1.0f, 0.8f), num ("r", 0.05f, 6.0f, 1.6f),
                                       num ("gain", 0.0f, 1.0f, 0.45f) };
constexpr ParamSpec pluckSpecs[]   = { num ("bright", 0.0f, 1.0f, 0.6f), num ("decay", 0.2f, 6.0f, 1.6f), num ("gain", 0.0f, 1.0f, 0.7f) };
constexpr ParamSpec epianoSpecs[]  = { num ("ratio", 0.5f, 8.0f, 1.0f), num ("index", 0.0f, 10.0f, 2.2f), num ("decay", 0.2f, 6.0f, 1.8f),
                                       num ("r", 0.02f, 3.0f, 0.35f), num ("trem", 0.0f, 1.0f, 0.2f), num ("gain", 0.0f, 1.0f, 0.55f) };
// lshape lists the same values as the web select (sine|triangle|square|sawtooth) in waveFromIndex() order.
constexpr ParamSpec samplerSpecs[] = { num ("pitch", -24.0f, 24.0f, 0.0f), num ("gain", 0.0f, 1.5f, 1.0f), sel ("cut", "full|note", 0),
                                       sel ("rev", "fwd|rev", 0), num ("start", 0.0f, 1.0f, 0.0f), num ("end", 0.0f, 1.0f, 1.0f),
                                       num ("fin", 0.0f, 2.0f, 0.0f), num ("fout", 0.0f, 2.0f, 0.0f), sel ("norm", "off|on", 0),
                                       sel ("loop", "off|fwd|ping", 0), num ("ls", 0.0f, 1.0f, 0.0f), num ("le", 0.0f, 1.0f, 1.0f),
                                       num ("a", 0.0f, 4.0f, 0.002f), num ("h", 0.0f, 4.0f, 0.0f), num ("d", 0.0f, 8.0f, 0.0f),
                                       num ("s", 0.0f, 1.0f, 1.0f), num ("r", 0.005f, 8.0f, 0.05f),
                                       sel ("ftype", "off|lp|lp24|hp|bp|notch", 0), num ("fcut", 20.0f, 20000.0f, 20000.0f),
                                       num ("fres", 0.0f, 18.0f, 0.7f), num ("fenv", -1.0f, 1.0f, 0.0f), num ("fa", 0.001f, 4.0f, 0.01f),
                                       num ("fd", 0.01f, 8.0f, 0.3f), num ("fs", 0.0f, 1.0f, 0.0f), num ("penv", -24.0f, 24.0f, 0.0f),
                                       num ("pd", 0.005f, 2.0f, 0.1f), sel ("lshape", waveOptions, 0), num ("lrate", 0.05f, 20.0f, 4.0f),
                                       num ("lvol", 0.0f, 1.0f, 0.0f), num ("lpan", 0.0f, 1.0f, 0.0f), num ("lcut", 0.0f, 1.0f, 0.0f),
                                       num ("lpit", 0.0f, 2.0f, 0.0f) };
static_assert (std::size (samplerSpecs) <= (size_t) maxParams);
constexpr ParamSpec supersawSpecs[] = { num ("voices", 1.0f, 9.0f, 7.0f), num ("det", 0.0f, 100.0f, 25.0f), num ("mix", 0.0f, 1.0f, 0.6f),
                                        num ("width", 0.0f, 1.0f, 0.8f), num ("cut", 100.0f, 18000.0f, 6000.0f), num ("res", 0.0f, 18.0f, 1.0f),
                                        num ("env", 0.0f, 1.0f, 0.2f), num ("a", 0.001f, 2.0f, 0.01f), num ("d", 0.01f, 3.0f, 0.4f),
                                        num ("s", 0.0f, 1.0f, 0.75f), num ("r", 0.01f, 4.0f, 0.35f), num ("gain", 0.0f, 1.0f, 0.5f) };
constexpr ParamSpec acidSpecs[]    = { sel ("wave", "sawtooth|square", 0), num ("cut", 60.0f, 8000.0f, 500.0f), num ("res", 0.0f, 30.0f, 18.0f),
                                       num ("env", 0.0f, 1.0f, 0.6f), num ("decay", 0.05f, 2.0f, 0.35f), num ("accent", 0.0f, 1.0f, 0.5f),
                                       num ("glide", 0.005f, 0.5f, 0.08f), num ("gain", 0.0f, 1.0f, 0.6f) };
constexpr ParamSpec fm4Specs[]     = { sel ("alg", "stack|branch|pairs|triple|add", 0), num ("r1", 0.25f, 16.0f, 1.0f),
                                       num ("r2", 0.25f, 16.0f, 2.0f), num ("r3", 0.25f, 16.0f, 3.0f), num ("r4", 0.25f, 16.0f, 1.0f),
                                       num ("i2", 0.0f, 12.0f, 2.0f), num ("i3", 0.0f, 12.0f, 1.0f), num ("i4", 0.0f, 12.0f, 0.5f),
                                       num ("mdec", 0.02f, 4.0f, 0.6f), num ("msus", 0.0f, 1.0f, 0.3f), num ("a", 0.001f, 2.0f, 0.003f),
                                       num ("d", 0.01f, 4.0f, 0.8f), num ("s", 0.0f, 1.0f, 0.4f), num ("r", 0.01f, 4.0f, 0.3f),
                                       num ("gain", 0.0f, 1.0f, 0.5f) };
constexpr ParamSpec organSpecs[]   = { num ("b1", 0.0f, 1.0f, 1.0f), num ("b2", 0.0f, 1.0f, 1.0f), num ("b3", 0.0f, 1.0f, 1.0f),
                                       num ("b4", 0.0f, 1.0f, 0.0f), num ("b5", 0.0f, 1.0f, 0.0f), num ("b6", 0.0f, 1.0f, 0.0f),
                                       num ("b7", 0.0f, 1.0f, 0.0f), num ("b8", 0.0f, 1.0f, 0.0f), num ("b9", 0.0f, 1.0f, 0.0f),
                                       num ("perc", 0.0f, 1.0f, 0.3f), num ("vib", 0.0f, 1.0f, 0.3f), num ("click", 0.0f, 1.0f, 0.3f),
                                       num ("gain", 0.0f, 1.0f, 0.45f) };

//==============================================================================
struct NoteContext
{
    int note;
    float vel;
    const float* p;
    double rate;
    int root;
    double glideRatio = 1.0; // portamento: frequency of the previous note / frequency of this one
    double glideTime = 0.0;  // portamento time in seconds, 0 = no glide (the glide argument of the web VOICES)
    double fine = 0.0;       // per-note fine pitch in semitones, part of the note's own pitch
};

/** glideTo() of the web app as a factor on a frequency-like parameter: it starts at 'fromRatio' and approaches 1 like
    AudioParam.setTargetAtTime with time constant max(1 ms, time / 3). Once within 1e-9 of 1 the next call returns exactly
    1 and the glide stops (moving() turns false); without a glide next() always returns 1, so multiplying by it leaves
    the non-gliding path bit-exact.
    slide() (a slide note) goes from the current factor to 'ratio' linearly in semitones over n samples: the n-th call
    returns exactly 'ratio' and turns moving() false, and the factor then stays there. */
struct Glide
{
    double factor = 1.0, coeff = 0.0, target = 1.0, step = 1.0;
    int64_t slideLeft = 0;
    bool active = false;

    void start (double fromRatio, double time, double rate) noexcept
    {
        active = time > 0.0 && std::isfinite (fromRatio) && fromRatio > 0.0 && std::abs (fromRatio - 1.0) > 1.0e-12;
        factor = active ? fromRatio : 1.0;
        coeff = active ? std::exp (-1.0 / (std::max (0.001, time / 3.0) * rate)) : 0.0;
        target = 1.0;
        slideLeft = 0;
    }

    void start (const NoteContext& c) noexcept { start (c.glideRatio, c.glideTime, c.rate); }

    void slide (double ratio, int64_t samples) noexcept
    {
        if (! (std::isfinite (ratio) && ratio > 0.0))
            return;

        slideLeft = std::max<int64_t> (1, samples);
        step = std::pow (ratio / factor, 1.0 / (double) slideLeft);
        target = ratio;
        active = true;
    }

    bool moving() const noexcept { return active; }

    /** The factor at the current sample, then advances by one sample. */
    double next() noexcept
    {
        if (! active)
            return factor;

        if (slideLeft > 0)
        {
            factor = --slideLeft == 0 ? target : factor * step;
            active = slideLeft > 0;
            return factor;
        }

        if (std::abs (factor - target) < 1.0e-9)
        {
            factor = target;
            active = false;
            return factor;
        }

        const double out = factor;
        factor = target + (factor - target) * coeff;
        return out;
    }
};

struct NoShared {};

inline void addMono (float* L, float* R, int i, float s) noexcept
{
    L[i] += s * monoToStereo;
    R[i] += s * monoToStereo;
}

/** Allocation bookkeeping and the fast choke fade every voice shares (cutEnv of the web app). */
struct VoiceBase
{
    bool active = false;
    bool held = false;      // note on received, its note off not yet
    bool releasing = false; // in its release: preferred when stealing
    int note = -1;
    int channel = 0;        // MIDI channel of the note on, 0..15
    double fine = 0.0;      // per-note fine pitch (semitones), part of the voice's own pitch
    float pan = 0.0f;       // per-note pan: a StereoPannerNode after the voice (InstrumentCore::renderPanned)
    float relScale = 1.0f;  // per-note release: factor on parameter 'r' at note off
    uint64_t order = 0;
    int64_t age = 0;        // samples since the note started
    double fs = 44100.0;
    const WaveTables* tables = nullptr;

    bool choking = false;
    double chokeGain = 1.0, chokeMul = 1.0;
    int64_t chokeLeft = 0;

    void prepare (double rate)
    {
        fs = rate;
        tables = WaveTables::forSampleRate (rate);
    }

    void startBase (const NoteContext& c) noexcept
    {
        active = true;
        held = true;
        releasing = false;
        note = c.note;
        fine = c.fine;
        age = 0;
        fs = c.rate;
        choking = false;
        chokeGain = chokeMul = 1.0;
        chokeLeft = 0;
    }

    /** Exponential fade to -80 dB over 'seconds', then the voice stops (cutEnv / panic of the web app). */
    void choke (double seconds) noexcept
    {
        if (! active)
            return;

        const auto n = std::max<int64_t> (1, (int64_t) std::llround (seconds * fs));

        if (choking && chokeLeft <= n)
            return;

        choking = true;
        chokeLeft = n;
        chokeMul = std::pow (lowLevel, 1.0 / (double) n);
    }

    /** Advances one sample; returns the choke gain to apply to it. */
    float tick() noexcept
    {
        ++age;

        if (! choking)
            return 1.0f;

        const auto g = (float) chokeGain;
        chokeGain *= chokeMul;

        if (--chokeLeft <= 0)
            active = false;

        return g;
    }

    /** Note off. Drums, bass808 and pluck play their natural length. */
    void release (const float*) noexcept {}

    /** Voices with a noise source give each voice its own sequence (the web app starts its noise loop at a random offset). */
    void seed (uint32_t) noexcept {}

    /** Slide note: glide to MIDI note 'target' over n samples (melodic voices; drums ignore it). */
    void slideTo (double, int64_t) noexcept {}

    /** The ratio that takes the voice's own pitch (note + fine) to MIDI note 'target'. */
    double ratioTo (double target) const noexcept { return semitoneRatio (target - (double) note - fine); }

    /** Stereo voices write different left and right signals; the others are mono through addMono(). */
    bool isStereo() const noexcept { return false; }
};

//==============================================================================
struct KickVoice : VoiceBase
{
    using Shared = NoShared;
    enum { pTune, pDecay, pPunch, pClick, pDrive };

    Osc osc;
    SegEnv freq, amp, clickEnv;
    SvfCoeffs hpCoeffs;
    SvfState hp;
    SatCurve sat;
    Rng rng;

    void seed (uint32_t value) noexcept { rng.seed (value); }
    bool useSat = false, useClick = false;

    void start (const NoteContext& c, const Shared&) noexcept
    {
        startBase (c);
        const auto* p = c.p;
        const double k = semitoneRatio ((double) p[pTune] + (double) (c.note - c.root) + c.fine);
        const double f0 = 48.0 * k, f1 = f0 * (2.2 + p[pPunch] * 5.0);
        osc.reset();
        freq.begin (f1, fs);
        freq.expTo (f0, 0.04 + (1.0 - p[pPunch]) * 0.06);
        percEnv (amp, c.vel, p[pDecay], 0.002, fs);
        useSat = p[pDrive] > 0.01f;
        sat.set (p[pDrive] * 0.6);
        useClick = p[pClick] > 0.01f;
        hpCoeffs = makeSvf (FilterType::highpass, 2500.0, resonanceFromDb (1.0), 0.0, fs);
        hp.reset();
        percEnv (clickEnv, c.vel * p[pClick] * 0.5, 0.012, 0.001, fs);
    }

    void render (float* L, float* R, int n, const Shared&) noexcept
    {
        for (int i = 0; i < n && active; ++i)
        {
            float s = osc.sine (freq.next() / fs) * (float) amp.next();

            if (useSat)
                s = sat (s);

            if (useClick && ! clickEnv.finished())
                s += hp.process (hpCoeffs, rng.next()) * (float) clickEnv.next();

            addMono (L, R, i, s * tick());

            if (amp.finished() && (! useClick || clickEnv.finished()))
                active = false;
        }
    }
};

struct SnareVoice : VoiceBase
{
    using Shared = NoShared;
    enum { pTune, pDecay, pTone, pSnappy };

    Osc osc;
    SegEnv freq, toneEnv, noiseEnv;
    SvfCoeffs hpCoeffs, pkCoeffs;
    SvfState hp, pk;
    Rng rng;

    void seed (uint32_t value) noexcept { rng.seed (value); }

    void start (const NoteContext& c, const Shared&) noexcept
    {
        startBase (c);
        const auto* p = c.p;
        const double k = semitoneRatio ((double) p[pTune] + (double) (c.note - c.root) + c.fine);
        osc.reset();
        freq.begin (250.0 * k, fs);
        freq.expTo (175.0 * k, 0.05);
        percEnv (toneEnv, c.vel * p[pTone] * 0.9, std::max (0.05, p[pDecay] * 0.55), 0.001, fs);
        hpCoeffs = makeSvf (FilterType::highpass, 1200.0 * k, resonanceFromDb (1.0), 0.0, fs);
        pkCoeffs = makeSvf (FilterType::peaking, 5000.0, 1.0, 4.0, fs);
        hp.reset();
        pk.reset();
        percEnv (noiseEnv, c.vel * (0.25 + p[pSnappy] * 0.6), p[pDecay], 0.001, fs);
    }

    void render (float* L, float* R, int n, const Shared&) noexcept
    {
        for (int i = 0; i < n && active; ++i)
        {
            const float body = osc.swept (Wave::triangle, freq.next(), fs, tables) * (float) toneEnv.next();
            const float wires = pk.process (pkCoeffs, hp.process (hpCoeffs, rng.next())) * (float) noiseEnv.next();
            addMono (L, R, i, (body + wires) * tick());

            if (toneEnv.finished() && noiseEnv.finished())
                active = false;
        }
    }
};

struct ClapVoice : VoiceBase
{
    using Shared = NoShared;
    enum { pTone, pDecay, pSpread };

    SegEnv env;
    SvfCoeffs bpCoeffs, hpCoeffs;
    SvfState bp, hp;
    Rng rng;

    void seed (uint32_t value) noexcept { rng.seed (value); }

    void start (const NoteContext& c, const Shared&) noexcept
    {
        startBase (c);
        const auto* p = c.p;
        const double k = semitoneRatio ((double) (c.note - c.root) + c.fine), sp = p[pSpread], v = c.vel;
        bpCoeffs = makeSvf (FilterType::bandpass, p[pTone] * k, 1.1, 0.0, fs);
        hpCoeffs = makeSvf (FilterType::highpass, 500.0, resonanceFromDb (1.0), 0.0, fs);
        bp.reset();
        hp.reset();

        // three quick bursts sp apart, then the tail
        env.begin (v, fs);

        for (int i = 0; i < 3; ++i)
        {
            env.expTo (v * 0.12, sp * 0.92);
            env.hold (sp * 0.08);
            env.jumpTo (v);
        }

        env.expTo (lowLevel, p[pDecay]);
    }

    void render (float* L, float* R, int n, const Shared&) noexcept
    {
        for (int i = 0; i < n && active; ++i)
        {
            const float s = hp.process (hpCoeffs, bp.process (bpCoeffs, rng.next())) * (float) env.next();
            addMono (L, R, i, s * tick());

            if (env.finished())
                active = false;
        }
    }
};

/** hatVoice(): six square oscillators + noise, bandpass then highpass (hat, ohat, crash). */
struct HatShared
{
    double base = 8500.0;
    double velScale = 1.0;
};

struct HatVoice : VoiceBase
{
    using Shared = HatShared;
    enum { pTone, pDecay };
    static constexpr std::array<double, 6> partials { 205.3, 304.4, 369.6, 522.7, 540.0, 800.0 };

    std::array<Osc, 6> oscs;
    float noiseGain = 0.5f;
    SegEnv env;
    SvfCoeffs bpCoeffs, hpCoeffs;
    SvfState bp, hp;
    Rng rng;

    void seed (uint32_t value) noexcept { rng.seed (value); }

    void start (const NoteContext& c, const Shared& sh) noexcept
    {
        startBase (c);
        const auto* p = c.p;
        const double k = semitoneRatio ((double) (c.note - c.root) + c.fine);

        for (size_t j = 0; j < oscs.size(); ++j)
            oscs[j].start (Wave::square, partials[j] * k * 1.4, fs, tables);

        noiseGain = (float) (0.35 + (1.0 - p[pTone]) * 0.3);
        bpCoeffs = makeSvf (FilterType::bandpass, sh.base + p[pTone] * 3500.0, 0.7, 0.0, fs);
        hpCoeffs = makeSvf (FilterType::highpass, sh.base - 2500.0 + p[pTone] * 1500.0, resonanceFromDb (1.0), 0.0, fs);
        bp.reset();
        hp.reset();
        percEnv (env, c.vel * sh.velScale * 0.9, p[pDecay], 0.001, fs);
    }

    void render (float* L, float* R, int n, const Shared&) noexcept
    {
        for (int i = 0; i < n && active; ++i)
        {
            float sum = rng.next() * noiseGain;

            for (auto& osc : oscs)
                sum += osc.next();

            const float s = hp.process (hpCoeffs, bp.process (bpCoeffs, sum * 0.2f)) * (float) env.next();
            addMono (L, R, i, s * tick());

            if (env.finished())
                active = false;
        }
    }
};

struct TomVoice : VoiceBase
{
    using Shared = NoShared;
    enum { pTune, pDecay, pSweep };

    Osc osc;
    SegEnv freq, amp;

    void start (const NoteContext& c, const Shared&) noexcept
    {
        startBase (c);
        const auto* p = c.p;
        const double f = 110.0 * semitoneRatio ((double) p[pTune] + (double) (c.note - c.root) + c.fine);
        osc.reset();
        freq.begin (f * (1.0 + p[pSweep] * 1.2), fs);
        freq.expTo (f, 0.06 + p[pSweep] * 0.14);
        percEnv (amp, c.vel, p[pDecay], 0.002, fs);
    }

    void render (float* L, float* R, int n, const Shared&) noexcept
    {
        for (int i = 0; i < n && active; ++i)
        {
            const float s = osc.sine (freq.next() / fs) * (float) amp.next();
            addMono (L, R, i, s * tick());

            if (amp.finished())
                active = false;
        }
    }
};

struct CowbellVoice : VoiceBase
{
    using Shared = NoShared;
    enum { pTune, pDecay };

    Osc osc1, osc2;
    SegEnv env;
    SvfCoeffs bpCoeffs;
    SvfState bp;

    void start (const NoteContext& c, const Shared&) noexcept
    {
        startBase (c);
        const auto* p = c.p;
        const double k = semitoneRatio ((double) p[pTune] + (double) (c.note - c.root) + c.fine);
        osc1.start (Wave::square, 587.0 * k, fs, tables);
        osc2.start (Wave::square, 845.0 * k, fs, tables);
        bpCoeffs = makeSvf (FilterType::bandpass, 1000.0 * k, 0.9, 0.0, fs);
        bp.reset();
        percEnv (env, c.vel, p[pDecay], 0.001, fs);
    }

    void render (float* L, float* R, int n, const Shared&) noexcept
    {
        for (int i = 0; i < n && active; ++i)
        {
            const float sum = (osc1.next() + osc2.next()) * 0.35f;
            const float s = bp.process (bpCoeffs, sum) * (float) env.next();
            addMono (L, R, i, s * tick());

            if (env.finished())
                active = false;
        }
    }
};

struct Bass808Voice : VoiceBase
{
    using Shared = NoShared;
    enum { pDecay, pGlide, pDrive, pTone };

    Osc osc;
    SegEnv freq, amp;
    SatCurve sat;
    SvfCoeffs lpCoeffs;
    SvfState lp;

    void start (const NoteContext& c, const Shared&) noexcept
    {
        startBase (c);
        const auto* p = c.p;
        const double f = mtof (c.note + c.fine);
        osc.reset();

        if (c.glideTime > 0.0) // portamento replaces the pitch drop (glideTo)
        {
            freq.begin (f * c.glideRatio, fs);
            freq.targetTo (f, std::max (0.001, c.glideTime / 3.0));
        }
        else
        {
            freq.begin (f * (1.0 + p[pGlide] * 2.5), fs);
            freq.expTo (f, 0.03 + p[pGlide] * 0.09);
        }

        percEnv (amp, c.vel, p[pDecay], 0.004, fs);
        sat.set (p[pDrive] * 0.7);
        lpCoeffs = makeSvf (FilterType::lowpass, p[pTone], resonanceFromDb (0.7), 0.0, fs);
        lp.reset();
    }

    void slideTo (double target, int64_t samples) noexcept
    {
        freq.begin (freq.current(), fs); // an exponential ramp is linear in semitones
        freq.expTo (mtof (target), (double) std::max<int64_t> (1, samples) / fs);
    }

    void render (float* L, float* R, int n, const Shared&) noexcept
    {
        for (int i = 0; i < n && active; ++i)
        {
            const float s = lp.process (lpCoeffs, sat (osc.sine (freq.next() / fs) * (float) amp.next()));
            addMono (L, R, i, s * tick());

            if (amp.finished())
                active = false;
        }
    }
};

//==============================================================================
/** analogVoice(): up to nine oscillators -> resonant lowpass with envelope -> VCA (synth, pad and supersaw). */
struct OscSpec
{
    Wave wave;
    double gain, detuneCents, octave;
    double pan; // StereoPannerNode on this oscillator (supersaw); 0 = none
};

struct AnalogVoice : VoiceBase
{
    using Shared = NoShared;

    struct Slot
    {
        Osc osc;
        double freq = 440.0; // target frequency, detune included
        float gainL = 0.0f, gainR = 0.0f;
    };

    std::array<Slot, 9> slots;
    int numSlots = 0;
    Glide glide;
    double pickedRatio = 1.0; // glide factor of the band-limited tables in use
    SegEnv vca, cutoffEnv;
    SvfCoeffs filterCoeffs;
    SvfState filter, filterR;
    double resonance = 1.0, sustainLevel = 0.0, releaseTau = 0.01, releaseLength = 0.1;
    int64_t attackEnd = 0, endAt = -1, fadeLength = 1, minReleaseAge = 0;
    int coeffCountdown = 0;
    bool filterMoves = false, pendingRelease = false, stereo = false;

    void setup (const NoteContext& c, const OscSpec* specs, int count, double cut, double res, double envAmount,
                double a, double d, double s, double r, double gain) noexcept
    {
        startBase (c);
        const double f = mtof (c.note + c.fine);
        numSlots = std::min (count, (int) slots.size());

        // Web Audio: an oscillator with a pan goes through a StereoPannerNode, which makes the voice stereo; the other
        // (mono) oscillators are then up-mixed into it at unity on both sides. A voice without pans stays mono and gets
        // the usual mono-to-stereo image (addMono).
        stereo = false;

        for (int i = 0; i < numSlots; ++i)
            stereo = stereo || std::abs (specs[i].pan) > 0.0;

        for (int i = 0; i < numSlots; ++i)
        {
            auto& slot = slots[(size_t) i];
            slot.freq = f * std::pow (2.0, specs[i].octave) * std::pow (2.0, specs[i].detuneCents / 1200.0);
            slot.osc.start (specs[i].wave, slot.freq, fs, tables);
            const double g = specs[i].gain;

            if (stereo && std::abs (specs[i].pan) > 0.0)
            {
                // StereoPannerNode, mono input: equal-power law
                const double x = (juce::jlimit (-1.0, 1.0, specs[i].pan) + 1.0) * 0.5;
                slot.gainL = (float) (g * std::cos (x * pi / 2.0));
                slot.gainR = (float) (g * std::sin (x * pi / 2.0));
            }
            else
            {
                slot.gainL = slot.gainR = (float) g;
            }
        }

        // portamento: every oscillator starts at the previous note's pitch (glideTo)
        glide.start (c);
        pickedRatio = 1.0;

        const double peak = std::max (0.0005, c.vel * gain), tau = std::max (0.005, d / 3.0);
        vca.begin (0.0, fs);
        vca.linearTo (peak, a);
        vca.targetTo (peak * s, tau);
        sustainLevel = peak * s;
        attackEnd = (int64_t) std::llround (a * fs);

        resonance = resonanceFromDb (res);
        const double top = std::min (18000.0, cut * (1.0 + envAmount * 10.0));
        filterMoves = envAmount > 0.001;

        if (filterMoves)
        {
            const double ramp = std::max (0.003, a * 0.7);
            cutoffEnv.begin (cut, fs);
            cutoffEnv.linearTo (top, ramp);

            if (a > ramp)
                cutoffEnv.hold (a - ramp);

            cutoffEnv.targetTo (cut + (top - cut) * s * 0.3, tau);
        }

        filterCoeffs = makeSvf (FilterType::lowpass, cut, resonance, 0.0, fs);
        filter.reset();
        filterR.reset();
        coeffCountdown = 0;

        releaseTau = std::max (0.004, r / 4.0);
        releaseLength = r * 1.6 + 0.05;
        endAt = -1;
        fadeLength = std::max<int64_t> (1, (int64_t) std::llround (0.002 * fs));
        minReleaseAge = (int64_t) std::llround (0.003 * fs);
        pendingRelease = false;
    }

    void release (const float*) noexcept
    {
        if (! active || releasing)
            return;

        if (age < minReleaseAge)
            pendingRelease = true;
        else
            beginRelease();
    }

    void beginRelease() noexcept
    {
        releasing = true;
        pendingRelease = false;
        const double level = vca.current();
        vca.begin (level, fs);
        vca.targetTo (0.0, releaseTau);
        endAt = age + (int64_t) std::llround (releaseLength * fs);
    }

    void slideTo (double target, int64_t samples) noexcept { glide.slide (ratioTo (target), samples); }
    bool isStereo() const noexcept { return stereo; }

    /** Portamento: every oscillator at 'ratio' times its target frequency; the band-limited tables follow the pitch
        ('settled': the glide is over, back to the exact frequencies and tables of a note without portamento). */
    void retune (double ratio, bool settled) noexcept
    {
        const bool repick = settled || std::abs (ratio - pickedRatio) > 1.0e-3 * pickedRatio;

        for (int j = 0; j < numSlots; ++j)
        {
            auto& osc = slots[(size_t) j].osc;

            if (repick)
                osc.setFrequency (slots[(size_t) j].freq * ratio, fs, tables);
            else
                osc.inc = slots[(size_t) j].freq * ratio / fs;
        }

        if (repick)
            pickedRatio = ratio;
    }

    void render (float* L, float* R, int n, const Shared&) noexcept
    {
        for (int i = 0; i < n && active; ++i)
        {
            if (glide.moving()) // the factor of this sample, before the oscillators advance (a-rate frequency)
            {
                const double ratio = glide.next();
                retune (ratio, ! glide.moving());
            }

            if (filterMoves)
            {
                const double cutoff = cutoffEnv.next();

                if (--coeffCountdown <= 0)
                {
                    filterCoeffs = makeSvf (FilterType::lowpass, cutoff, resonance, 0.0, fs);
                    coeffCountdown = 4;
                }
            }

            float x = 0.0f, xr = 0.0f;

            for (int j = 0; j < numSlots; ++j)
            {
                auto& slot = slots[(size_t) j];
                const float o = slot.osc.next();
                x += slot.gainL * o;
                xr += slot.gainR * o;
            }

            const auto level = (float) vca.next();
            float s = filter.process (filterCoeffs, x) * level;
            float sr = stereo ? filterR.process (filterCoeffs, xr) * level : 0.0f;

            if (endAt >= 0)
            {
                const auto left = endAt - age;

                if (left < fadeLength) // the web app stops its oscillators here; a 2 ms fade avoids the click
                {
                    const float fade = (float) std::max<int64_t> (0, left) / (float) fadeLength;
                    s *= fade;
                    sr *= fade;
                }
            }

            const float g = tick();

            if (stereo)
            {
                L[i] += s * g;
                R[i] += sr * g;
            }
            else
            {
                addMono (L, R, i, s * g);
            }

            if (pendingRelease && age >= minReleaseAge)
                beginRelease();

            if (endAt >= 0 ? age >= endAt
                           : (sustainLevel < lowLevel && age > attackEnd && vca.current() < lowLevel))
                active = false;
        }
    }
};

struct SynthVoice : AnalogVoice
{
    enum { pW1, pW2, pMix, pDet, pOct2, pCut, pRes, pEnv, pA, pD, pS, pR, pGain };

    void start (const NoteContext& c, const Shared&) noexcept
    {
        const auto* p = c.p;
        const OscSpec specs[] = { { waveFromIndex (p[pW1]), 1.0 - p[pMix], 0.0, 0.0, 0.0 },
                                  { waveFromIndex (p[pW2]), p[pMix], p[pDet], p[pOct2], 0.0 } };
        setup (c, specs, 2, p[pCut], p[pRes], p[pEnv], p[pA], p[pD], p[pS], p[pR], p[pGain]);
    }
};

struct PadVoice : AnalogVoice
{
    enum { pDet, pCut, pRes, pA, pS, pR, pGain };

    void start (const NoteContext& c, const Shared&) noexcept
    {
        const auto* p = c.p;
        const OscSpec specs[] = { { Wave::sawtooth, 0.3, -(double) p[pDet], 0.0, 0.0 },
                                  { Wave::sawtooth, 0.3, 0.0, 0.0, 0.0 },
                                  { Wave::sawtooth, 0.3, p[pDet], 0.0, 0.0 },
                                  { Wave::sine, 0.35, 0.0, -1.0, 0.0 } };
        setup (c, specs, 4, p[pCut], p[pRes], 0.15, p[pA], 1.2, p[pS], p[pR], p[pGain]);
    }
};

/** supersaw: N detuned saws spread across the stereo field (centre voice at full weight, the others at 'mix',
    normalised to unit power), then the analogVoice filter and envelopes. */
struct SupersawVoice : AnalogVoice
{
    enum { pVoices, pDet, pMix, pWidth, pCut, pRes, pEnv, pA, pD, pS, pR, pGain };

    void start (const NoteContext& c, const Shared&) noexcept
    {
        const auto* p = c.p;
        const int n = juce::jlimit (1, 9, (int) std::floor ((double) p[pVoices] + 0.5)); // Math.round
        std::array<OscSpec, 9> specs {};
        double power = 0.0;

        for (int i = 0; i < n; ++i)
        {
            const double x = n == 1 ? 0.0 : ((double) i / (double) (n - 1)) * 2.0 - 1.0;
            const double w = std::abs (x) < 1.0e-6 ? 1.0 : (double) p[pMix];
            specs[(size_t) i] = { Wave::sawtooth, w, x * p[pDet], 0.0, x * p[pWidth] };
            power += w * w;
        }

        const double norm = 1.0 / std::sqrt (std::max (power, 1.0e-6));

        for (int i = 0; i < n; ++i)
            specs[(size_t) i].gain *= norm;

        setup (c, specs.data(), n, p[pCut], p[pRes], p[pEnv], p[pA], p[pD], p[pS], p[pR], p[pGain]);
    }
};

//==============================================================================
/** ksBuffer(): Karplus-Strong string, generated in real time (same recurrence, sample for sample), played like the web
    app's AudioBufferSourceNode: at playbackRate 1, or gliding from the previous note's pitch (portamento), read with
    linear interpolation (Chromium) from the samples generated so far. */
struct PluckVoice : VoiceBase
{
    using Shared = NoShared;
    enum { pBright, pDecay, pGain };

    std::vector<float> ring;
    int period = 2, index = 0;
    int64_t length = 0, fadeLength = 1, generated = 0;
    float rho = 1.0f, weight = 0.5f, level = 1.0f;
    std::array<float, 4> history {}; // the last generated buffer samples, by index & 3
    double pos = 0.0;                // read position in the string buffer
    double fineRate = 1.0;           // playback rate of the per-note fine pitch
    Glide glide;
    Rng rng;

    void seed (uint32_t value) noexcept { rng.seed (value); }

    void prepare (double rate)
    {
        VoiceBase::prepare (rate);
        ring.assign ((size_t) std::ceil (rate / mtof (0.0)) + 4, 0.0f);
    }

    void start (const NoteContext& c, const Shared&) noexcept
    {
        startBase (c);

        if (ring.size() < 2)
        {
            active = false;
            return;
        }

        const auto* p = c.p;
        const double f = mtof (c.note);
        period = juce::jlimit (2, (int) ring.size(), (int) std::lround (fs / f));
        length = (int64_t) std::floor (fs * std::min (p[pDecay] * 1.15 + 0.05, 8.0));

        // the excitation: lowpassed noise normalised to 0.9
        const double a = 0.12 + p[pBright] * 0.88;
        double lp = 0.0, peak = 0.0;

        for (int i = 0; i < period; ++i)
        {
            lp += a * ((double) rng.next() - lp);
            ring[(size_t) i] = (float) lp;
            peak = std::max (peak, std::abs (lp));
        }

        const auto norm = (float) (peak > 0.0 ? 0.9 / peak : 1.0);

        for (int i = 0; i < period; ++i)
            ring[(size_t) i] *= norm;

        rho = (float) std::pow (0.001, 1.0 / std::max (1.0, p[pDecay] * f));
        weight = (float) (0.5 - p[pBright] * 0.42);
        index = 0;
        generated = 0;
        pos = 0.0;
        fineRate = semitoneRatio (c.fine);
        glide.start (c);
        fadeLength = std::max<int64_t> (1, std::min (length, (int64_t) std::floor (fs * 0.03)));
        level = c.vel * p[pGain];

        if (length <= 0)
            active = false;
    }

    /** Buffer sample 'generated' of ksBuffer(): one step of the string, the last 30 ms faded out linearly. */
    void generate() noexcept
    {
        const int nextIndex = index + 1 == period ? 0 : index + 1;
        const float cur = ring[(size_t) index], nxt = ring[(size_t) nextIndex];
        float s = cur;
        ring[(size_t) index] = rho * ((1.0f - weight) * cur + weight * nxt);
        index = nextIndex;

        const auto fromEnd = length - 1 - generated;

        if (fromEnd < fadeLength)
            s *= (float) std::max<int64_t> (0, fromEnd) / (float) fadeLength;

        history[(size_t) (generated & 3)] = s;
        ++generated;
    }

    void render (float* L, float* R, int n, const Shared&) noexcept
    {
        for (int i = 0; i < n && active; ++i)
        {
            if (pos >= (double) length) // the end of the buffer
            {
                active = false;
                break;
            }

            const auto k = (int64_t) pos;
            const auto t = (float) (pos - (double) k);

            while (generated < std::min (k + 2, length))
                generate();

            const float a = history[(size_t) (k & 3)];
            const float b = k + 1 < length ? history[(size_t) ((k + 1) & 3)] : 0.0f;
            const float s = a + t * (b - a); // exactly a at playbackRate 1

            addMono (L, R, i, s * level * tick());
            pos += fineRate * glide.next();
        }
    }

    void slideTo (double target, int64_t samples) noexcept { glide.slide (ratioTo (target), samples); }
};

//==============================================================================
/** Two-operator FM e-piano with tremolo. */
struct EPianoVoice : VoiceBase
{
    using Shared = NoShared;
    enum { pRatio, pIndex, pDecay, pR, pTrem, pGain };

    Osc carrier, modulator, lfo;
    SegEnv modDepth, vca;
    Glide glide; // portamento of carrier and modulator
    double freq = 440.0, modInc = 0.0, lfoInc = 0.0, releaseTime = 0.35;
    float tremBase = 1.0f, tremDepth = 0.0f;
    int64_t attackEnd = 0, minReleaseAge = 0, endAt = -1, fadeLength = 1;
    bool pendingRelease = false;

    void start (const NoteContext& c, const Shared&) noexcept
    {
        startBase (c);
        const auto* p = c.p;
        freq = mtof (c.note + c.fine);
        modInc = freq * p[pRatio] / fs;
        const double depth = p[pIndex] * freq * (0.4 + c.vel * 0.8);
        modDepth.begin (depth, fs);
        modDepth.targetTo (depth * 0.12, std::max (1.0e-4, p[pDecay] * 0.2));

        const double peak = std::max (0.0005, (double) (c.vel * p[pGain]));
        vca.begin (0.0, fs);
        vca.linearTo (peak, 0.003);
        vca.targetTo (0.0, p[pDecay] / 3.0);

        tremDepth = p[pTrem] * 0.35f;
        tremBase = 1.0f - tremDepth;
        lfoInc = 4.6 / fs;
        glide.start (c);
        carrier.reset();
        modulator.reset();
        lfo.reset();

        attackEnd = (int64_t) std::llround (0.003 * fs);
        minReleaseAge = (int64_t) std::llround (0.004 * fs);
        fadeLength = std::max<int64_t> (1, (int64_t) std::llround (0.002 * fs));
        endAt = -1;
        pendingRelease = false;
    }

    void release (const float* p) noexcept
    {
        if (! active || releasing)
            return;

        releaseTime = p[pR]; // read when the note ends, like the web app's stop()

        if (age < minReleaseAge)
            pendingRelease = true;
        else
            beginRelease();
    }

    void beginRelease() noexcept
    {
        releasing = true;
        pendingRelease = false;
        const double level = vca.current();
        vca.begin (level, fs);
        vca.targetTo (0.0, std::max (0.005, releaseTime / 4.0));
        endAt = age + (int64_t) std::llround ((releaseTime * 1.6 + 0.05) * fs);
    }

    void slideTo (double target, int64_t samples) noexcept { glide.slide (ratioTo (target), samples); }

    void render (float* L, float* R, int n, const Shared&) noexcept
    {
        for (int i = 0; i < n && active; ++i)
        {
            const double ratio = glide.next(); // 1 without portamento
            const float m = modulator.sine (modInc * ratio);
            const double instant = freq * ratio + modDepth.next() * (double) m;
            float s = carrier.sine (instant / fs) * (float) vca.next() * (tremBase + tremDepth * lfo.sine (lfoInc));

            if (endAt >= 0)
            {
                const auto left = endAt - age;

                if (left < fadeLength)
                    s *= (float) std::max<int64_t> (0, left) / (float) fadeLength;
            }

            addMono (L, R, i, s * tick());

            if (pendingRelease && age >= minReleaseAge)
                beginRelease();

            if (endAt >= 0 ? age >= endAt : (age > attackEnd && vca.current() < lowLevel))
                active = false;
        }
    }
};

//==============================================================================
/** fm4: four sine operators; modulators shift their targets' frequency in Hz (FM, like a GainNode into
    OscillatorNode.frequency), each with an attack / decay-to-sustain envelope; carriers through an ADSR VCA. */
struct Fm4Voice : VoiceBase
{
    using Shared = NoShared;
    enum { pAlg, pR1, pR2, pR3, pR4, pI2, pI3, pI4, pMdec, pMsus, pA, pD, pS, pR, pGain };
    enum { algStack, algBranch, algPairs, algTriple, algAdd };

    std::array<double, 4> phase {}, freq {}, depth {};
    std::array<float, 4> level {};
    std::array<int, 4> targets {}; // bit k of targets[j]: operator j modulates operator k (0-based)
    SegEnv modEnv, vca;            // modEnv is normalised: depth[j] * modEnv is the modulation in Hz
    Glide glide;                   // portamento of every operator
    double sustainLevel = 0.0, releaseTime = 0.3, invRate = 1.0 / 44100.0;
    int64_t attackEnd = 0, minReleaseAge = 0, endAt = -1, fadeLength = 1;
    bool modulates = false, pendingRelease = false;

    void prepare (double rate)
    {
        VoiceBase::prepare (rate);
        sineTable (0.0); // builds the shared table off the audio thread
    }

    void start (const NoteContext& c, const Shared&) noexcept
    {
        startBase (c);
        const auto* p = c.p;
        const double f = mtof (c.note + c.fine), v = c.vel;
        const double ratios[] = { p[pR1], p[pR2], p[pR3], p[pR4] };
        const double indices[] = { 0.0, p[pI2], p[pI3], p[pI4] };
        invRate = 1.0 / fs;

        for (size_t k = 0; k < 4; ++k)
        {
            phase[k] = 0.0;
            freq[k] = f * ratios[k];
            depth[k] = indices[k] * f * ratios[k] * (0.5 + 0.5 * v);
            level[k] = 0.0f;
            targets[k] = 0;
        }

        // mod (k, dst) of the web code: operator k (1-based) modulates operator dst
        const auto mod = [this] (int k, int dst) { targets[(size_t) (k - 1)] |= 1 << (dst - 1); };

        switch ((int) p[pAlg])
        {
            case algBranch: mod (3, 2); mod (4, 2); mod (2, 1); level[0] = 1.0f; break;
            case algPairs:  mod (4, 3); mod (2, 1); level[0] = level[2] = 0.5f; break;
            case algTriple: mod (4, 1); mod (4, 2); mod (4, 3); level[0] = level[1] = level[2] = 1.0f / 3.0f; break;
            case algAdd:
            {
                const double lv[] = { 1.0, std::min (1.0, indices[1] / 6.0), std::min (1.0, indices[2] / 6.0), std::min (1.0, indices[3] / 6.0) };
                const double sum = lv[0] + lv[1] + lv[2] + lv[3];

                for (size_t k = 0; k < 4; ++k)
                    level[k] = (float) (lv[k] / sum);

                break;
            }
            default:        mod (4, 3); mod (3, 2); mod (2, 1); level[0] = 1.0f; break; // stack
        }

        modulates = targets[1] != 0 || targets[2] != 0 || targets[3] != 0;
        glide.start (c);

        const double a = std::max (0.001, (double) p[pA]);
        modEnv.begin (0.0, fs);
        modEnv.linearTo (1.0, a);
        modEnv.targetTo (p[pMsus], std::max (0.005, p[pMdec] / 3.0));

        const double peak = std::max (0.0005, v * p[pGain]), tau = std::max (0.005, p[pD] / 3.0);
        vca.begin (0.0, fs);
        vca.linearTo (peak, a);
        vca.targetTo (peak * p[pS], tau);
        sustainLevel = peak * p[pS];

        attackEnd = (int64_t) std::llround (a * fs);
        minReleaseAge = (int64_t) std::llround (0.003 * fs);
        fadeLength = std::max<int64_t> (1, (int64_t) std::llround (0.002 * fs));
        endAt = -1;
        pendingRelease = false;
    }

    void release (const float* p) noexcept
    {
        if (! active || releasing)
            return;

        releaseTime = p[pR]; // read when the note ends, like the web app's stop()

        if (age < minReleaseAge)
            pendingRelease = true;
        else
            beginRelease();
    }

    void beginRelease() noexcept
    {
        releasing = true;
        pendingRelease = false;
        const double tau = std::max (0.004, releaseTime / 4.0);
        const double level0 = vca.current(), mod0 = modEnv.current();
        vca.begin (level0, fs);
        vca.targetTo (0.0, tau);
        modEnv.begin (mod0, fs);
        modEnv.targetTo (0.0, tau);
        endAt = age + (int64_t) std::llround ((releaseTime * 1.6 + 0.05) * fs);
    }

    void slideTo (double target, int64_t samples) noexcept { glide.slide (ratioTo (target), samples); }

    void render (float* L, float* R, int n, const Shared&) noexcept
    {
        for (int i = 0; i < n && active; ++i)
        {
            // an oscillator outputs its current phase, then advances by the frequency of this sample (Chromium)
            std::array<float, 4> out;

            for (size_t k = 0; k < 4; ++k)
                out[k] = sineTable (phase[k]);

            std::array<double, 4> instant = freq;
            const double ratio = glide.next(); // 1 without portamento

            for (auto& f : instant)
                f *= ratio;

            if (modulates)
            {
                const double env = modEnv.next();

                for (size_t j = 1; j < 4; ++j)
                {
                    if (targets[j] == 0)
                        continue;

                    const double shift = depth[j] * env * (double) out[j];

                    for (size_t k = 0; k < 4; ++k)
                        if ((targets[j] & (1 << k)) != 0)
                            instant[k] += shift;
                }
            }

            for (size_t k = 0; k < 4; ++k)
                phase[k] = wrap01 (phase[k] + instant[k] * invRate);

            float s = (level[0] * out[0] + level[1] * out[1] + level[2] * out[2] + level[3] * out[3]) * (float) vca.next();

            if (endAt >= 0)
            {
                const auto left = endAt - age;

                if (left < fadeLength) // the web app stops its oscillators here; a 2 ms fade avoids the click
                    s *= (float) std::max<int64_t> (0, left) / (float) fadeLength;
            }

            addMono (L, R, i, s * tick());

            if (pendingRelease && age >= minReleaseAge)
                beginRelease();

            if (endAt >= 0 ? age >= endAt
                           : (sustainLevel < lowLevel && age > attackEnd && vca.current() < lowLevel))
                active = false;
        }
    }
};

//==============================================================================
/** organ: nine sine drawbars with a shared 6.5 Hz vibrato, percussion on the third harmonic, key click. */
struct OrganVoice : VoiceBase
{
    using Shared = NoShared;
    enum { pB1, pB2, pB3, pB4, pB5, pB6, pB7, pB8, pB9, pPerc, pVib, pClick, pGain };
    static constexpr std::array<double, 9> harmonics { 0.5, 1.5, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 8.0 };

    std::array<double, 9> phase {}, inc {};
    std::array<float, 9> level {};
    int numBars = 0;
    Glide glide; // portamento of the drawbars (not of the percussion)
    double lfoPhase = 0.0, lfoInc = 0.0, vibCents = 0.0, percPhase = 0.0, percInc = 0.0, peak = 0.0;
    bool usePerc = false, useClick = false, pendingRelease = false;
    int64_t percEnd = 0, clickEnd = 0, minReleaseAge = 0, endAt = -1, fadeLength = 1;
    SegEnv percAmp, clickAmp, vca;
    SvfCoeffs clickCoeffs;
    SvfState clickFilter;
    Rng rng;

    void seed (uint32_t value) noexcept { rng.seed (value); }

    void prepare (double rate)
    {
        VoiceBase::prepare (rate);
        sineTable (0.0); // builds the shared table off the audio thread
    }

    void start (const NoteContext& c, const Shared&) noexcept
    {
        startBase (c);
        const auto* p = c.p;
        const double f = mtof (c.note + c.fine);
        double total = 0.0;

        for (int k = pB1; k <= pB9; ++k)
            total += p[k];

        total = std::max (1.0, total);
        numBars = 0;

        for (size_t k = 0; k < harmonics.size(); ++k)
        {
            if (p[k] < 0.001f)
                continue;

            const auto j = (size_t) numBars++;
            phase[j] = 0.0;
            inc[j] = f * harmonics[k] / fs;
            level[j] = (float) (p[k] / total);
        }

        lfoPhase = 0.0;
        lfoInc = 6.5 / fs;
        vibCents = p[pVib] * 25.0;
        glide.start (c);

        usePerc = p[pPerc] > 0.001f;
        percPhase = 0.0;
        percInc = f * 3.0 / fs;
        percEnv (percAmp, p[pPerc] * 0.6, 0.25, 0.002, fs);
        percEnd = (int64_t) std::llround (0.4 * fs);

        useClick = p[pClick] > 0.001f;
        clickCoeffs = makeSvf (FilterType::bandpass, 2400.0, 0.8, 0.0, fs);
        clickFilter.reset();
        percEnv (clickAmp, p[pClick] * 0.3, 0.006, 0.0005, fs);
        clickEnd = (int64_t) std::llround (0.02 * fs);

        peak = std::max (0.0005, (0.55 + 0.45 * c.vel) * p[pGain]);
        vca.begin (0.0, fs);
        vca.linearTo (peak, 0.005);

        minReleaseAge = (int64_t) std::llround (0.006 * fs);
        fadeLength = std::max<int64_t> (1, (int64_t) std::llround (0.002 * fs));
        endAt = -1;
        pendingRelease = false;
    }

    void release (const float*) noexcept
    {
        if (! active || releasing)
            return;

        if (age < minReleaseAge)
            pendingRelease = true;
        else
            beginRelease();
    }

    void beginRelease() noexcept
    {
        releasing = true;
        pendingRelease = false;
        vca.begin (peak, fs);
        vca.targetTo (0.0, 0.012);
        endAt = age + (int64_t) std::llround (0.1 * fs);
    }

    void slideTo (double target, int64_t samples) noexcept { glide.slide (ratioTo (target), samples); } // the drawbars

    void render (float* L, float* R, int n, const Shared&) noexcept
    {
        for (int i = 0; i < n && active; ++i)
        {
            const double lfo = sineTable (lfoPhase);
            lfoPhase = wrap01 (lfoPhase + lfoInc);
            const double ratio = vibCents > 0.0 ? std::exp2 (vibCents * lfo / 1200.0) : 1.0; // OscillatorNode.detune
            const double glideRatio = glide.next(); // 1 without portamento
            float sum = 0.0f;

            for (size_t j = 0; j < (size_t) numBars; ++j)
            {
                sum += level[j] * sineTable (phase[j]);
                phase[j] = wrap01 (phase[j] + inc[j] * glideRatio * ratio);
            }

            if (usePerc && age < percEnd)
            {
                sum += sineTable (percPhase) * (float) percAmp.next();
                percPhase = wrap01 (percPhase + percInc);
            }

            if (useClick && age < clickEnd)
                sum += clickFilter.process (clickCoeffs, rng.next()) * (float) clickAmp.next();

            float s = sum * (float) vca.next();

            if (endAt >= 0)
            {
                const auto left = endAt - age;

                if (left < fadeLength) // the web app stops its oscillators here; a 2 ms fade avoids the click
                    s *= (float) std::max<int64_t> (0, left) / (float) fadeLength;
            }

            addMono (L, R, i, s * tick());

            if (pendingRelease && age >= minReleaseAge)
                beginRelease();

            if (endAt >= 0 && age >= endAt)
                active = false;
        }
    }
};

//==============================================================================
/** acid: TB-303 style voice (saw / square -> resonant lowpass with accent envelope -> VCA). The voice holds its level
    while the note is held; legato notes slide into it (see AcidInstrument). */
struct AcidVoice : VoiceBase
{
    enum { pWave, pCut, pRes, pEnv, pDecay, pAccent, pGlide, pGain };

    Osc osc;
    Wave wave = Wave::sawtooth;
    double freq = 440.0, targetFreq = 440.0, glideCoeff = 0.0, pickedFreq = -1.0;
    double slideStep = 1.0; // slide note: frequency factor per sample (linear in semitones) for slideLeft samples
    int64_t slideLeft = 0;
    double resonance = 1.0, peak = 0.0;
    SegEnv amp, cutoff;
    SvfCoeffs coeffs;
    SvfState filter;
    int coeffCountdown = 0;
    int64_t minReleaseAge = 0, endAt = -1;
    bool pendingRelease = false;

    void start (const NoteContext& c) noexcept
    {
        startBase (c);
        const auto* p = c.p;
        wave = p[pWave] > 0.5f ? Wave::square : Wave::sawtooth;
        freq = targetFreq = mtof (c.note + c.fine);
        glideCoeff = 0.0;
        slideLeft = 0;
        osc.reset();
        osc.wave = wave;
        pickedFreq = -1.0;
        resonance = resonanceFromDb (p[pRes]);
        filter.reset();
        coeffCountdown = 0;
        minReleaseAge = (int64_t) std::llround (0.003 * fs);
        endAt = -1;
        pendingRelease = false;
        strike (p, c.vel, true);
    }

    /** strike() of the web code: accent above v = 0.8, amplitude and filter envelopes. */
    void strike (const float* p, double vel, bool retrig) noexcept
    {
        const double acc = vel > 0.8 ? (double) p[pAccent] : 0.0, cut = p[pCut];
        peak = std::max (0.0005, vel * p[pGain] * (1.0 + acc * 0.6));
        const double top = std::min (18000.0, cut * (1.0 + p[pEnv] * 8.0 * (1.0 + acc)));

        if (retrig)
        {
            amp.begin (0.0, fs);
            amp.linearTo (peak, 0.003);
        }
        else
        {
            amp.begin (amp.current(), fs);
            amp.targetTo (peak, 0.004);
        }

        cutoff.begin (retrig ? cut : top * 0.8, fs);
        cutoff.linearTo (top, 0.004);
        cutoff.targetTo (cut, std::max (0.01, p[pDecay] / 3.0));
    }

    /** A note on now would slide into this voice: it has not been released (or its release is still pending). */
    bool canSlide() const noexcept { return active && ! releasing && ! choking; }

    /** legato() of the web code: the gain holds the current peak, the pitch glides, a loud note re-strikes the accent. */
    void slide (const NoteContext& c) noexcept
    {
        amp.begin (peak, fs);
        pendingRelease = false;
        note = c.note;
        fine = c.fine;
        targetFreq = mtof (c.note + c.fine);
        slideLeft = 0;
        glideCoeff = std::exp (-1.0 / (std::max (1.0e-6, c.p[pGlide] / 3.0) * fs));

        if (c.vel > 0.8f)
            strike (c.p, c.vel, false);
    }

    void release() noexcept
    {
        if (! active || releasing)
            return;

        if (age < minReleaseAge)
            pendingRelease = true;
        else
            beginRelease();
    }

    void beginRelease() noexcept
    {
        releasing = true;
        pendingRelease = false;
        amp.begin (peak, fs);
        amp.targetTo (0.0, 0.006);
        endAt = age + (int64_t) std::llround (0.06 * fs);
    }

    /** Slide note: from the current pitch to 'target', linear in semitones, then held (until the next legato note). */
    void slideTo (double target, int64_t samples) noexcept
    {
        targetFreq = mtof (target);
        slideLeft = std::max<int64_t> (1, samples);
        slideStep = std::pow (targetFreq / freq, 1.0 / (double) slideLeft);
        glideCoeff = 0.0;
    }

    void render (float* L, float* R, int n) noexcept
    {
        for (int i = 0; i < n && active; ++i)
        {
            if (slideLeft > 0)
                freq = --slideLeft == 0 ? targetFreq : freq * slideStep;
            else if (glideCoeff > 0.0)
                freq = targetFreq + (freq - targetFreq) * glideCoeff;

            const double fc = cutoff.next();

            if (--coeffCountdown <= 0)
            {
                coeffs = makeSvf (FilterType::lowpass, fc, resonance, 0.0, fs);
                coeffCountdown = 4;
            }

            if (std::abs (freq - pickedFreq) > pickedFreq * 1.0e-4) // band-limited table for the current pitch
            {
                osc.pick = tables != nullptr ? tables->pick (wave, freq, fs) : TablePick {};
                pickedFreq = freq;
            }

            osc.inc = freq / fs;
            const float s = filter.process (coeffs, osc.next()) * (float) amp.next();
            addMono (L, R, i, s * tick());

            if (pendingRelease && age >= minReleaseAge)
                beginRelease();

            if (endAt >= 0 && age >= endAt)
                active = false;
        }
    }
};

//==============================================================================
struct SampleSlot
{
    std::shared_ptr<const juce::AudioBuffer<float>> data;
    double sampleRate = 44100.0;
    float peak = 0.0f; // samplePeak(): the largest |x| of the whole sample, every channel (norm)
};

struct SamplerShared
{
    const SampleSlot* slot = nullptr;
};

/** VOICES.sampler: an AudioBufferSourceNode (playbackRate with portamento and pitch envelope, detune from the LFO; the
    start..end region, or a forward / ping-pong loop) -> filter(s) with envelope and LFO -> region fades -> AHDSR ->
    LFO tremolo -> LFO auto-pan. Hermite interpolation. */
struct SamplerVoice : VoiceBase
{
    using Shared = SamplerShared;
    enum { pPitch, pGain, pCut, pRev, pStart, pEnd, pFin, pFout, pNorm, pLoop, pLs, pLe, pA, pH, pD, pS, pR,
           pFtype, pFcut, pFres, pFenv, pFa, pFd, pFs, pPenv, pPd, pLshape, pLrate, pLvol, pLpan, pLcut, pLpit };
    enum { loopOff, loopFwd, loopPing };
    enum { filterOff, filterLp, filterLp24, filterHp, filterBp, filterNotch };

    // source: frames of the (reversed) sample; a ping-pong loop reads a virtual buffer like pingPongBuffer(): the sample
    // up to the loop end ('turn'), then the loop region mirrored
    int64_t length = 0, virtualLength = 0, turn = 0, loopWrap = 1;
    double pos = 0.0, step = 1.0, endFrame = 0.0, loopStart = 0.0, loopEnd = 0.0, loopLength = 1.0;
    bool reverse = false, looping = false, stereoOut = false;
    Glide pitch; // playbackRate factor: portamento, pitch envelope and slides

    // filter
    bool filterOn = false, twoStages = false, filterEnv = false, cutoffMoves = false;
    FilterType filterType = FilterType::lowpass;
    double filterQ = 1.0, cutoffBase = 20000.0;
    SegEnv cutoff;
    SvfCoeffs coeffs;
    std::array<SvfState, 4> filters; // stage 1 / 2, left / right
    int coeffCountdown = 0;

    // amplitude
    SegEnv env;
    double playLength = 0.0, fadeIn = 0.0, fadeOut = 0.0; // samples of output (playLen of the web code)
    bool useFades = false;
    int64_t stopAt = -1;

    // LFO
    Osc lfo;
    bool lfoOn = false;
    double lvol = 0.0, lpan = 0.0, lcut = 0.0, lpit = 0.0;
    int64_t lfoEnd = -1;

    static bool usable (const Shared& sh) noexcept
    {
        return sh.slot != nullptr && sh.slot->data != nullptr && sh.slot->data->getNumSamples() > 0 && sh.slot->data->getNumChannels() > 0;
    }

    void start (const NoteContext& c, const Shared& sh) noexcept
    {
        startBase (c);

        if (! usable (sh))
        {
            active = false;
            return;
        }

        const auto* p = c.p;
        const auto& slot = *sh.slot;
        length = slot.data->getNumSamples();
        const auto frames = (double) length;
        const double sr = slot.sampleRate;
        reverse = p[pRev] > 0.5f;
        const int loopMode = (int) p[pLoop];
        looping = loopMode != loopOff;

        // the region: start / end are fractions of the (reversed) sample, at least 2 ms long
        const double s0 = juce::jlimit (0.0, 1.0, (double) p[pStart]) * frames;
        const double s1 = std::max (s0 + 0.002 * sr, juce::jlimit (0.0, 1.0, (double) p[pEnd]) * frames);
        virtualLength = turn = length;
        stopAt = -1;

        if (looping)
        {
            const double ls = juce::jlimit (0.0, 1.0, (double) p[pLs]) * frames;
            const double le = std::max (ls + 0.002 * sr, juce::jlimit (0.0, 1.0, (double) p[pLe]) * frames);

            if (loopMode == loopPing)
            {
                const auto i0 = (int64_t) std::floor (ls), i1 = std::min (length, (int64_t) std::floor (le));
                turn = i1;
                virtualLength = i1 + std::max<int64_t> (0, i1 - i0);
                loopEnd = le + (le - ls);
            }
            else
            {
                loopEnd = le;
            }

            // Chromium: the loop ends at the end of the buffer at the latest
            loopEnd = std::min (loopEnd, (double) virtualLength);
            loopStart = std::min (ls, loopEnd - 1.0);

            if (! (loopStart >= 0.0 && loopEnd > loopStart))
            {
                loopStart = 0.0;
                loopEnd = (double) virtualLength;
            }

            loopLength = loopEnd - loopStart;
            loopWrap = std::max<int64_t> (1, std::llround (loopLength));
            pos = s0 >= loopEnd ? loopStart : s0; // Chromium: an offset past the loop end starts at the loop start
            endFrame = (double) virtualLength;
        }
        else
        {
            pos = s0;
            endFrame = std::min (s1, frames);
        }

        // pitch: portamento from the previous note, then the pitch envelope on top
        const double rate = semitoneRatio ((double) (c.note - c.root) + p[pPitch] + c.fine);
        step = semitoneRatio ((double) (c.note - c.root) + p[pPitch] + c.fine) * slot.sampleRate / fs;
        const bool gliding = c.glideTime > 0.0;

        if (std::abs (p[pPenv]) > 0.0f)
            pitch.start ((gliding ? c.glideRatio : 1.0) * semitoneRatio (p[pPenv]),
                         gliding ? std::min (c.glideTime, (double) p[pPd]) : (double) p[pPd], fs);
        else
            pitch.start (c);

        // filter with its own envelope (bipolar, up to +-6 octaves) and LFO
        const int ftype = (int) p[pFtype];
        filterOn = ftype != filterOff;
        filterEnv = false;
        cutoffMoves = false;

        if (filterOn)
        {
            filterType = ftype == filterHp ? FilterType::highpass
                       : (ftype == filterBp ? FilterType::bandpass : (ftype == filterNotch ? FilterType::notch : FilterType::lowpass));
            filterQ = (ftype == filterBp || ftype == filterNotch) ? 0.5 + p[pFres] : resonanceFromDb (p[pFres]);
            twoStages = ftype == filterLp24;
            cutoffBase = p[pFcut];
            cutoff.begin (cutoffBase, fs);
            filterEnv = std::abs (p[pFenv]) > 0.0f;

            if (filterEnv)
            {
                const double peakCut = juce::jlimit (20.0, 20000.0, cutoffBase * std::exp2 (p[pFenv] * 6.0));
                const double sustainCut = juce::jlimit (20.0, 20000.0, cutoffBase * std::exp2 (p[pFenv] * 6.0 * p[pFs]));
                cutoff.linearTo (peakCut, p[pFa]);
                cutoff.targetTo (sustainCut, std::max (0.003, p[pFd] / 3.0));
            }

            cutoffMoves = filterEnv;
            coeffs = makeSvf (filterType, cutoffBase, filterQ, 0.0, fs);
            coeffCountdown = 0;

            for (auto& f : filters)
                f.reset();
        }

        // amplitude: normalise, fades of the region, AHDSR
        const double norm = p[pNorm] > 0.5f ? 1.0 / std::max (1.0e-4, (double) slot.peak) : 1.0;
        const double peak = std::max (0.0005, (double) (c.vel * p[pGain]) * norm);
        const double playLen = (s1 - s0) / sr / rate; // seconds of output when not looping (pitch envelope ignored)
        playLength = playLen * fs;
        fadeIn = p[pFin] > 0.0f ? std::max (1.0, std::min ((double) p[pFin], playLen) * fs) : 0.0;
        fadeOut = p[pFout] > 0.0f && ! looping ? std::max (1.0, std::min ((double) p[pFout], playLen) * fs) : 0.0;
        useFades = fadeIn > 0.0 || fadeOut > 0.0;

        env.begin (0.0, fs);
        env.linearTo (peak, std::max (0.001, (double) p[pA]));

        if (p[pH] > 0.0f)
            env.hold (p[pH]);

        if (p[pD] > 0.0f)
            env.targetTo (peak * p[pS], p[pD] / 3.0);

        // LFOs: volume, pan, filter and pitch from one oscillator that starts with the note
        lvol = p[pLvol];
        lpan = p[pLpan];
        lcut = filterOn ? (double) p[pLcut] : 0.0;
        lpit = p[pLpit];
        lfoOn = lvol > 0.0 || lpan > 0.0 || lcut > 0.0 || lpit > 0.0;

        if (lfoOn)
            lfo.start (waveFromIndex (p[pLshape]), p[pLrate], fs, tables);

        stereoOut = slot.data->getNumChannels() > 1 || lpan > 0.0;

        lfoEnd = looping ? -1 : (int64_t) std::llround ((playLen + 0.05) * fs);
    }

    void slideTo (double target, int64_t samples) noexcept { pitch.slide (ratioTo (target), samples); }
    bool isStereo() const noexcept { return stereoOut; }

    void release (const float* p) noexcept
    {
        if (p[pCut] > 0.5f || looping) // cut == "note", or a loop
            releaseWith (std::max (0.005, (double) p[pR]));
    }

    void releaseWith (double rel) noexcept
    {
        if (! active || releasing || (! looping && (double) age >= playLength)) // the web ignores a stop after the region
            return;

        releasing = true;
        const double level = env.current();
        env.begin (level, fs);
        env.targetTo (0.0, rel / 4.0);

        if (filterOn && filterEnv) // the cutoff returns to fcut
        {
            const double from = cutoff.current();
            cutoff.begin (from, fs);
            cutoff.targetTo (cutoffBase, rel / 4.0);
        }

        stopAt = age + (int64_t) std::llround ((rel * 2.0 + 0.02) * fs);

        if (! looping)
            stopAt = std::min (stopAt, (int64_t) std::llround (playLength));
    }

    float at (const float* d, int64_t v) const noexcept
    {
        if (v < 0)
            return 0.0f;

        if (v >= virtualLength)
        {
            if (! looping)
                return 0.0f;

            v -= loopWrap; // past the end of a looping buffer: back into the loop (Chromium)

            if (v < 0 || v >= virtualLength)
                return 0.0f;
        }

        if (v >= turn)
            v = 2 * turn - 1 - v; // the mirrored half of a ping-pong loop

        return d[reverse ? length - 1 - v : v];
    }

    float interpolate (const float* d, int64_t k, float t) const noexcept
    {
        const float p0 = at (d, k - 1), p1 = at (d, k), p2 = at (d, k + 1), p3 = at (d, k + 2);
        const float c1 = 0.5f * (p2 - p0);
        const float c2 = p0 - 2.5f * p1 + 2.0f * p2 - 0.5f * p3;
        const float c3 = 0.5f * (p3 - p0) + 1.5f * (p1 - p2);
        return ((c3 * t + c2) * t + c1) * t + p1;
    }

    float fadeAt (int64_t n) const noexcept
    {
        double g = 1.0;

        if (fadeIn > 0.0)
            g = std::min (1.0, (double) n / fadeIn);

        if (fadeOut > 0.0)
            g *= juce::jlimit (0.0, 1.0, (playLength - (double) n) / fadeOut);

        return (float) g;
    }

    void render (float* L, float* R, int n, const Shared& sh) noexcept
    {
        if (! usable (sh) || sh.slot->data->getNumSamples() != length)
        {
            active = false;
            return;
        }

        const auto& buffer = *sh.slot->data;
        const float* left = buffer.getReadPointer (0);
        const float* right = buffer.getNumChannels() > 1 ? buffer.getReadPointer (1) : nullptr;

        for (int i = 0; i < n && active; ++i)
        {
            if (pos >= endFrame)
            {
                active = false;
                break;
            }

            const int64_t now = age;
            const double mod = lfoOn && (lfoEnd < 0 || now < lfoEnd) ? (double) lfo.next() : 0.0;

            const double whole = std::floor (pos);
            const auto k = (int64_t) whole;
            const auto t = (float) (pos - whole);
            float x = interpolate (left, k, t);
            float xr = right != nullptr ? interpolate (right, k, t) : 0.0f;

            if (filterOn)
            {
                const double fc = cutoffMoves ? cutoff.next() : cutoffBase;

                if ((cutoffMoves || lcut > 0.0) && --coeffCountdown <= 0)
                {
                    // BiquadFilterNode.detune: lcut * 4800 cents
                    coeffs = makeSvf (filterType, lcut > 0.0 ? fc * std::exp2 (lcut * 4.0 * mod) : fc, filterQ, 0.0, fs);
                    coeffCountdown = 4;
                }

                x = filters[0].process (coeffs, x);

                if (twoStages)
                    x = filters[1].process (coeffs, x);

                if (right != nullptr)
                {
                    xr = filters[2].process (coeffs, xr);

                    if (twoStages)
                        xr = filters[3].process (coeffs, xr);
                }
            }

            float g = (float) env.next() * tick();

            if (useFades)
                g *= fadeAt (now);

            if (lvol > 0.0)
                g *= (float) (1.0 - lvol * 0.5 + lvol * 0.5 * mod);

            if (lpan > 0.0)
            {
                const double pan = juce::jlimit (-1.0, 1.0, lpan * mod);

                if (right == nullptr)
                {
                    // StereoPannerNode, mono input: equal-power law (at the centre the usual monoToStereo)
                    const double xp = (pan + 1.0) * 0.5;
                    const float s = x * g;
                    L[i] += s * (float) std::cos (xp * pi / 2.0);
                    R[i] += s * (float) std::sin (xp * pi / 2.0);
                }
                else
                {
                    // StereoPannerNode, stereo input
                    const double xp = pan <= 0.0 ? pan + 1.0 : pan;
                    const auto gl = (float) std::cos (xp * pi / 2.0), gr = (float) std::sin (xp * pi / 2.0);
                    const float l = x * g, r = xr * g;

                    if (pan <= 0.0)
                    {
                        L[i] += l + r * gl;
                        R[i] += r * gr;
                    }
                    else
                    {
                        L[i] += l * gl;
                        R[i] += r + l * gr;
                    }
                }
            }
            else if (right != nullptr)
            {
                L[i] += x * g;
                R[i] += xr * g;
            }
            else
            {
                addMono (L, R, i, x * g);
            }

            // computedPlaybackRate = playbackRate * 2^(detune / 1200); detune = lpit * 100 cents
            double rateFactor = pitch.next();

            if (lpit > 0.0)
                rateFactor *= std::exp2 (lpit * mod / 12.0);

            pos += step * rateFactor;

            if (looping && pos >= loopEnd)
            {
                pos -= loopLength;

                if (pos >= loopEnd)
                    pos = loopStart + std::fmod (pos - loopStart, loopLength);
            }

            if (stopAt >= 0 && age >= stopAt)
                active = false;
        }
    }
};

//==============================================================================
struct Traits
{
    bool mono = false;      // a new note chokes the previous one
    double monoChoke = 0.01;
};

/** MIDI handling shared by every built-in instrument. */
class InstrumentCore : public BuiltinProcessor
{
public:
    InstrumentCore (const juce::String& type, const ParamSpec* specs, int numSpecs)
        : BuiltinProcessor (BusesProperties().withOutput ("Output", juce::AudioChannelSet::stereo(), true)),
          params (specs, numSpecs)
    {
        name = type;
        isInstrument = true;
        // the parameters a note's expression scales (the sampler's 'cut' is a select: its filter is fcut / fres)
        cutIndex = params.numberIndex ("fcut") >= 0 ? params.numberIndex ("fcut") : params.numberIndex ("cut");
        resIndex = params.numberIndex ("fres") >= 0 ? params.numberIndex ("fres") : params.numberIndex ("res");
        relIndex = params.numberIndex ("r");
    }

    using juce::AudioProcessor::processBlock;

    void setParams (const juce::var& newParams, const BuiltinContext& ctx) override
    {
        params.set (newParams);
        root.store (juce::jlimit (0, 127, ctx.root), std::memory_order_relaxed);
        monoMode.store (ctx.mono, std::memory_order_relaxed);
        portaTime.store (std::isfinite (ctx.porta) ? std::max (0.0, ctx.porta) : 0.0, std::memory_order_relaxed);
        paramsChanged();
    }

    /** Voices read the parameters when their note starts (and release times at note off), as in the web app. */
    bool setParamValue (const char* key, float value) noexcept override
    {
        return params.setValue (key, value) >= 0;
    }

    bool isBusesLayoutSupported (const BusesLayout& layouts) const override
    {
        const auto out = layouts.getMainOutputChannelSet();
        return layouts.getMainInputChannelSet().isDisabled()
               && (out == juce::AudioChannelSet::stereo() || out == juce::AudioChannelSet::mono());
    }

    void prepareToPlay (double newRate, int) override
    {
        fs = newRate > 0.0 ? newRate : 44100.0;
        prepareVoices();
    }

    void releaseResources() override {}

    void processBlock (juce::AudioBuffer<float>& buffer, juce::MidiBuffer& midi) override
    {
        juce::ScopedNoDenormals noDenormals;
        const int n = buffer.getNumSamples(), numChannels = buffer.getNumChannels();
        buffer.clear();

        if (++blockCount == 0) // an expression applies to the note ons of its own block
            blockCount = 1;

        beginBlock();

        if (numChannels == 0)
        {
            for (const auto meta : midi)
                handleMidi (meta.data, meta.numBytes);

            return;
        }

        // A mono buffer gets both sides added into the same channel, then halved.
        float* L = buffer.getWritePointer (0);
        float* R = numChannels > 1 ? buffer.getWritePointer (1) : L;
        int pos = 0;

        for (const auto meta : midi)
        {
            const int at = juce::jlimit (0, n, meta.samplePosition);

            if (at > pos)
            {
                renderVoices (L + pos, R + pos, at - pos);
                pos = at;
            }

            handleMidi (meta.data, meta.numBytes);
        }

        if (pos < n)
            renderVoices (L + pos, R + pos, n - pos);

        if (numChannels == 1)
            buffer.applyGain (0.5f);

        for (int ch = 0; ch < numChannels; ++ch)
        {
            const float* d = buffer.getReadPointer (ch);

            for (int i = 0; i < n; ++i)
            {
                if (! std::isfinite (d[i]))
                {
                    killAll();
                    buffer.clear();
                    return;
                }
            }
        }
    }

protected:
    virtual void paramsChanged() {}
    virtual void prepareVoices() = 0;
    virtual void beginBlock() noexcept {}
    virtual void renderVoices (float* L, float* R, int n) noexcept = 0;
    virtual void noteOn (int note, float vel, int channel, const NoteExpression& e) noexcept = 0;
    virtual void noteOff (int note, int channel) noexcept = 0;
    /** Slide note: the sounding, not yet released voices started on 'channel' glide to 'note' over 'samples'. */
    virtual void slide (int channel, int note, int64_t samples) noexcept = 0;
    virtual void releaseAll() noexcept = 0;
    virtual void chokeAll() noexcept = 0;
    virtual void killAll() noexcept = 0;

    /** Engine.trigger of the web app, before a new voice starts: with mono or portamento every sounding voice is choked,
        and with portamento (or a porta note) the context gets the glide from the previously played pitch, over ctx.porta
        (0.1 s for a porta note on a channel without portamento). Every note on is remembered, sounding or not, for the
        next glide (never forgotten: not by CC 120 / 123 either). */
    template <typename VoiceArray>
    void prepareNote (NoteContext& c, VoiceArray& voices, bool notePorta) noexcept
    {
        const double porta = portaTime.load (std::memory_order_relaxed);

        if (monoMode.load (std::memory_order_relaxed) || porta > 0.0)
            for (auto& v : voices)
                v.choke (chokeSeconds);

        const double pitch = (double) c.note + c.fine;

        if ((porta > 0.0 || notePorta) && hasLastPitch)
        {
            c.glideRatio = semitoneRatio (lastPitch - pitch);
            c.glideTime = porta > 0.0 ? porta : 0.1;
        }

        lastPitch = pitch;
        hasLastPitch = true;
    }

    /** A note's expression on its parameter snapshot: mx on the cutoff, my on the resonance, rel on the release time. */
    void applyExpression (float* p, const NoteExpression& e) const noexcept
    {
        if (cutIndex >= 0 && e.mx != 0.5f)
            p[cutIndex] = params.limit (cutIndex, (float) ((double) p[cutIndex] * std::exp2 ((e.mx - 0.5) * 4.0)));

        if (resIndex >= 0 && e.my != 0.5f)
            p[resIndex] = params.limit (resIndex, (float) ((double) p[resIndex] * std::exp2 ((e.my - 0.5) * 2.0)));

        releaseParams (p, releaseScale (e));
    }

    static float releaseScale (const NoteExpression& e) noexcept
    {
        return e.rel == 0.5f ? 1.0f : (float) std::exp2 ((e.rel - 0.5) * 2.0);
    }

    /** The note-off snapshot of a voice: its per-note factor on the release time (types that read 'r' at note off). */
    void releaseParams (float* p, float relScale) const noexcept
    {
        if (relIndex >= 0 && relScale != 1.0f)
            p[relIndex] *= relScale;
    }

    /** A voice with a per-note pan renders into scratch buffers, then through a StereoPannerNode: the equal-power law for
        a mono voice (it writes s * monoToStereo on both sides), the stereo law of the engine's channel pan for a stereo one. */
    template <typename Voice, typename Render>
    void renderPanned (Voice& v, float* L, float* R, int n, Render&& render) noexcept
    {
        const double pan = juce::jlimit (-1.0, 1.0, (double) v.pan);
        const bool stereo = v.isStereo();
        const double x = stereo ? (pan <= 0.0 ? pan + 1.0 : pan) : (pan + 1.0) * 0.5;
        const double unmix = stereo ? 1.0 : 1.0 / (double) monoToStereo;
        const auto gl = (float) (std::cos (x * pi / 2.0) * unmix), gr = (float) (std::sin (x * pi / 2.0) * unmix);

        for (int done = 0; done < n && v.active;)
        {
            const int k = std::min (n - done, (int) panL.size());
            std::fill_n (panL.begin(), k, 0.0f);
            std::fill_n (panR.begin(), k, 0.0f);
            render (panL.data(), panR.data(), k);
            float* l = L + done;
            float* r = R + done;

            for (int i = 0; i < k; ++i)
            {
                const float a = panL[(size_t) i], b = panR[(size_t) i];

                if (! stereo)
                {
                    l[i] += a * gl;
                    r[i] += b * gr;
                }
                else if (pan <= 0.0)
                {
                    l[i] += a + b * gl;
                    r[i] += b * gr;
                }
                else
                {
                    l[i] += a * gl;
                    r[i] += b + a * gr;
                }
            }

            done += k;
        }
    }

    ParamStore params;
    std::atomic<int> root { 60 };
    std::atomic<bool> monoMode { false };
    std::atomic<double> portaTime { 0.0 };
    double fs = 44100.0;
    double lastPitch = 0.0; // audio thread: the pitch (note + fine) of the previous note on
    bool hasLastPitch = false;
    int cutIndex = -1, resIndex = -1, relIndex = -1;

private:
    static_assert (std::atomic<double>::is_always_lock_free && std::atomic<bool>::is_always_lock_free);

    std::array<NoteExpression, 128> pending {}; // per note number: the expression for its next note on...
    std::array<uint32_t, 128> pendingBlock {};  // ...if it arrived in this block (blockCount)
    uint32_t blockCount = 0;
    std::array<float, 128> panL {}, panR {};

    void handleMidi (const juce::uint8* d, int size) noexcept
    {
        if (size < 2)
            return;

        if (d[0] == 0xF0)
        {
            handleSysEx (d, size);
            return;
        }

        const int status = d[0] & 0xF0, channel = d[0] & 0x0F, d1 = d[1] & 0x7F, d2 = size > 2 ? (d[2] & 0x7F) : 0;

        if (status == 0x90 && d2 > 0)
            startNote (d1, juce::jlimit (0.02f, 1.0f, (float) d2 / 127.0f), channel);
        else if (status == 0x80 || status == 0x90)
            noteOff (d1, channel);
        else if (status == 0xB0 && d1 == 120)
            chokeAll();
        else if (status == 0xB0 && d1 == 123)
            releaseAll();
    }

    /** The engine's SysEx (Builtins.h): F0 7D 52 01 the expression of the next note on of a note number, F0 7D 52 02 a slide. */
    void handleSysEx (const juce::uint8* d, int size) noexcept
    {
        int note = 0, channel = 0;
        double ms = 0.0;
        NoteExpression e;

        if (readExpressionSysEx (d, size, note, e))
        {
            pending[(size_t) note] = e;
            pendingBlock[(size_t) note] = blockCount;
        }
        else if (readSlideSysEx (d, size, channel, note, ms))
        {
            slide (channel, note, std::max<int64_t> (1, (int64_t) std::llround (ms * 0.001 * fs)));
        }
    }

    void startNote (int note, float vel, int channel) noexcept
    {
        if (pendingBlock[(size_t) note] == blockCount)
        {
            pendingBlock[(size_t) note] = 0;
            noteOn (note, vel, channel, pending[(size_t) note]);
        }
        else
        {
            noteOn (note, vel, channel, NoteExpression {});
        }
    }
};

template <typename Voice>
class PolyInstrument : public InstrumentCore
{
public:
    PolyInstrument (const juce::String& type, const ParamSpec* specs, int numSpecs, Traits t, typename Voice::Shared sh = {})
        : InstrumentCore (type, specs, numSpecs), traits (t), shared (sh)
    {
    }

protected:
    void prepareVoices() override
    {
        uint32_t seed = 0x2545F491u;

        for (auto& v : voices)
        {
            v.prepare (fs);
            v.seed (seed += 0x9E3779B9u);
            v.active = false;
        }
    }

    void renderVoices (float* L, float* R, int n) noexcept override
    {
        for (auto& v : voices)
        {
            if (! v.active)
                continue;

            if (v.pan == 0.0f)
                v.render (L, R, n, shared);
            else
                renderPanned (v, L, R, n, [this, &v] (float* l, float* r, int k) { v.render (l, r, k, shared); });
        }
    }

    void noteOn (int note, float vel, int channel, const NoteExpression& e) noexcept override
    {
        float p[maxParams] {};
        params.snapshot (p);
        applyExpression (p, e);

        if (traits.mono)
            for (auto& v : voices)
                if (v.active)
                    v.choke (traits.monoChoke);

        NoteContext c { note, vel, p, fs, root.load (std::memory_order_relaxed) };
        c.fine = e.fine;
        prepareNote (c, voices, e.porta);
        auto& v = allocate();
        v.start (c, shared);
        v.order = ++counter;
        v.channel = channel;
        v.pan = e.pan;
        v.relScale = releaseScale (e);
    }

    void noteOff (int note, int channel) noexcept override
    {
        Voice* oldest = nullptr;

        for (auto& v : voices)
            if (v.active && v.held && v.note == note && v.channel == channel && (oldest == nullptr || v.order < oldest->order))
                oldest = &v;

        if (oldest != nullptr)
        {
            float p[maxParams] {};
            params.snapshot (p);
            releaseParams (p, oldest->relScale);
            oldest->held = false;
            oldest->release (p);
        }
    }

    void slide (int channel, int note, int64_t samples) noexcept override
    {
        for (auto& v : voices)
            if (v.active && v.held && ! v.releasing && ! v.choking && v.channel == channel)
                v.slideTo ((double) note, samples);
    }

    void releaseAll() noexcept override
    {
        float base[maxParams] {};
        params.snapshot (base);

        for (auto& v : voices)
        {
            if (v.active && v.held)
            {
                float p[maxParams];
                std::copy (std::begin (base), std::end (base), std::begin (p));
                releaseParams (p, v.relScale);
                v.held = false;
                v.release (p);
            }
        }
    }

    void chokeAll() noexcept override
    {
        for (auto& v : voices)
            v.choke (chokeSeconds);
    }

    void killAll() noexcept override
    {
        for (auto& v : voices)
            v.active = false;
    }

    /** A free voice, else the oldest releasing one, else the oldest. */
    Voice& allocate() noexcept
    {
        for (auto& v : voices)
            if (! v.active)
                return v;

        Voice* best = nullptr;

        for (auto& v : voices)
            if ((v.releasing || v.choking) && (best == nullptr || v.order < best->order))
                best = &v;

        if (best == nullptr)
            for (auto& v : voices)
                if (best == nullptr || v.order < best->order)
                    best = &v;

        return *best;
    }

    std::array<Voice, maxVoices> voices;
    Traits traits;
    typename Voice::Shared shared;
    uint64_t counter = 0;
};

/** The sampler adds the lock-free hand-over of the decoded sample: the message thread publishes a slot,
    the audio thread announces which slot it uses (hazard pointer), and only unused slots are freed,
    always on the message thread. */
class SamplerInstrument final : public PolyInstrument<SamplerVoice>
{
public:
    SamplerInstrument()
        : PolyInstrument ("sampler", samplerSpecs, (int) std::size (samplerSpecs), Traits {})
    {
    }

    void setSample (std::shared_ptr<const juce::AudioBuffer<float>> data, double dataSampleRate) override
    {
        const juce::ScopedLock sl (slotLock);
        std::unique_ptr<SampleSlot> slot;

        if (data != nullptr && data->getNumChannels() > 0 && data->getNumSamples() > 0 && dataSampleRate > 0.0)
        {
            float peak = 0.0f; // samplePeak(), computed here once rather than at every note

            for (int ch = 0; ch < data->getNumChannels(); ++ch)
            {
                const auto range = juce::FloatVectorOperations::findMinAndMax (data->getReadPointer (ch), data->getNumSamples());
                peak = std::max ({ peak, std::abs (range.getStart()), std::abs (range.getEnd()) });
            }

            slot = std::make_unique<SampleSlot> (SampleSlot { std::move (data), dataSampleRate, peak });
        }

        published.store (slot.get());

        if (slot != nullptr)
            owned.push_back (std::move (slot));

        collectGarbage();
    }

protected:
    void paramsChanged() override
    {
        const juce::ScopedLock sl (slotLock);
        collectGarbage();
    }

    void beginBlock() noexcept override
    {
        const SampleSlot* current = nullptr;

        do
        {
            current = published.load();
            inUse.store (current);
        } while (current != published.load());

        if (current != shared.slot)
        {
            killAll();
            shared.slot = current;
        }
    }

private:
    void collectGarbage()
    {
        const auto* pub = published.load();
        const auto* use = inUse.load();
        owned.erase (std::remove_if (owned.begin(), owned.end(),
                                     [pub, use] (const std::unique_ptr<SampleSlot>& s) { return s.get() != pub && s.get() != use; }),
                     owned.end());
    }

    juce::CriticalSection slotLock;
    std::vector<std::unique_ptr<SampleSlot>> owned;
    std::atomic<const SampleSlot*> published { nullptr }, inUse { nullptr };
};

/** acid: monophonic and legato, like the web Engine.trigger() with INSTRUMENTS.acid.legato:
    - a note on while the sounding voice has not been released slides into it (no retrigger);
    - otherwise a new voice starts and the previous one finishes its release tail;
    - only a note off for the sounding (newest) note releases the voice; any other note off is ignored. */
class AcidInstrument final : public InstrumentCore
{
public:
    AcidInstrument() : InstrumentCore ("acid", acidSpecs, (int) std::size (acidSpecs)) {}

protected:
    void prepareVoices() override
    {
        for (auto& v : voices)
        {
            v.prepare (fs);
            v.active = false;
        }

        current = nullptr;
    }

    void renderVoices (float* L, float* R, int n) noexcept override
    {
        for (auto& v : voices)
        {
            if (! v.active)
                continue;

            if (v.pan == 0.0f)
                v.render (L, R, n);
            else
                renderPanned (v, L, R, n, [&v] (float* l, float* r, int k) { v.render (l, r, k); });
        }
    }

    void noteOn (int note, float vel, int channel, const NoteExpression& e) noexcept override
    {
        float p[maxParams] {};
        params.snapshot (p);
        applyExpression (p, e);
        NoteContext c { note, vel, p, fs, root.load (std::memory_order_relaxed) };
        c.fine = e.fine;

        if (current != nullptr && current->canSlide())
        {
            current->slide (c); // keeps the voice's pan
            current->channel = channel;
            return;
        }

        prepareNote (c, voices, e.porta); // mono / portamento: chokes the release tails (acid itself never glides)
        auto& v = allocate();
        v.start (c);
        v.order = ++counter;
        v.channel = channel;
        v.pan = e.pan;
        current = &v;
    }

    void noteOff (int note, int) noexcept override
    {
        if (current != nullptr && current->active && current->note == note)
            current->release();
    }

    void slide (int channel, int note, int64_t samples) noexcept override
    {
        if (current != nullptr && current->canSlide() && current->channel == channel)
            current->slideTo ((double) note, samples);
    }

    void releaseAll() noexcept override
    {
        if (current != nullptr)
            current->release();
    }

    void chokeAll() noexcept override
    {
        for (auto& v : voices)
            v.choke (chokeSeconds);
    }

    void killAll() noexcept override
    {
        for (auto& v : voices)
            v.active = false;
    }

private:
    /** A free voice, else the oldest one (a release tail: the sounding voice is always the newest). */
    AcidVoice& allocate() noexcept
    {
        AcidVoice* best = nullptr;

        for (auto& v : voices)
        {
            if (! v.active)
                return v;

            if (best == nullptr || v.order < best->order)
                best = &v;
        }

        return *best;
    }

    std::array<AcidVoice, 8> voices;
    AcidVoice* current = nullptr;
    uint64_t counter = 0;
};

template <typename Voice, size_t N>
std::unique_ptr<BuiltinProcessor> make (const juce::String& type, const ParamSpec (&specs)[N], Traits traits = {},
                                        typename Voice::Shared shared = {})
{
    return std::make_unique<PolyInstrument<Voice>> (type, specs, (int) N, traits, shared);
}
} // namespace

std::unique_ptr<BuiltinProcessor> makeInstrument (const juce::String& type)
{
    if (type == "kick")    return make<KickVoice> (type, kickSpecs);
    if (type == "snare")   return make<SnareVoice> (type, snareSpecs);
    if (type == "clap")    return make<ClapVoice> (type, clapSpecs);
    if (type == "hat")     return make<HatVoice> (type, hatSpecs, Traits {}, HatShared { 8500.0, 1.0 });
    if (type == "ohat")    return make<HatVoice> (type, ohatSpecs, Traits { true, 0.01 }, HatShared { 8000.0, 1.0 });
    if (type == "tom")     return make<TomVoice> (type, tomSpecs);
    if (type == "cowbell") return make<CowbellVoice> (type, cowbellSpecs);
    if (type == "crash")   return make<HatVoice> (type, crashSpecs, Traits { true, 0.01 }, HatShared { 6500.0, 0.8 });
    if (type == "bass808") return make<Bass808Voice> (type, bass808Specs, Traits { true, 0.015 });
    if (type == "synth")   return make<SynthVoice> (type, synthSpecs);
    if (type == "pad")     return make<PadVoice> (type, padSpecs);
    if (type == "pluck")   return make<PluckVoice> (type, pluckSpecs);
    if (type == "epiano")  return make<EPianoVoice> (type, epianoSpecs);
    if (type == "sampler") return std::make_unique<SamplerInstrument>();
    if (type == "supersaw") return make<SupersawVoice> (type, supersawSpecs);
    if (type == "acid")    return std::make_unique<AcidInstrument>();
    if (type == "fm4")     return make<Fm4Voice> (type, fm4Specs);
    if (type == "organ")   return make<OrganVoice> (type, organSpecs);
    return nullptr;
}
} // namespace ritmo::builtins
