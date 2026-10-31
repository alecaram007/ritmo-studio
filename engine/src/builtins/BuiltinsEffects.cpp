// Ritmo Engine — built-in effects: native ports of FX_IMPL / mixPair / impulse in src/js/audio.js.
#include "BuiltinsDsp.h"
#include <mutex>

namespace ritmo::builtins
{
namespace
{
//==============================================================================
// Parameter specs: FXDEFS in src/js/core.js (same order as the effects' enums below).
constexpr ParamSpec eqSpecs[]      = { num ("low", -18.0f, 18.0f, 0.0f), num ("mid", -18.0f, 18.0f, 0.0f),
                                       num ("midf", 150.0f, 6000.0f, 1000.0f), num ("high", -18.0f, 18.0f, 0.0f) };
constexpr ParamSpec filterSpecs[]  = { sel ("type", "lowpass|highpass|bandpass", 0), num ("freq", 20.0f, 20000.0f, 8000.0f),
                                       num ("q", 0.1f, 18.0f, 0.7f) };
constexpr ParamSpec compSpecs[]    = { num ("thr", -60.0f, 0.0f, -18.0f), num ("ratio", 1.0f, 20.0f, 4.0f), num ("att", 0.001f, 0.3f, 0.01f),
                                       num ("rel", 0.02f, 1.0f, 0.2f), num ("makeup", 0.0f, 24.0f, 4.0f) };
constexpr ParamSpec limiterSpecs[] = { num ("gain", 0.0f, 18.0f, 3.0f), num ("ceil", -12.0f, 0.0f, -1.0f) };
constexpr ParamSpec distSpecs[]    = { num ("drive", 0.0f, 1.0f, 0.4f), num ("tone", 500.0f, 12000.0f, 5000.0f), num ("mix", 0.0f, 1.0f, 1.0f),
                                       num ("out", 0.0f, 1.5f, 0.8f) };
// time is a select of beat fractions in the web app ("0.25" ... "2"), read with parseFloat().
constexpr ParamSpec delaySpecs[]   = { numFixed ("time", 0.01f, 64.0f, 0.75f), sel ("pp", "on|off", 0), num ("fb", 0.0f, 0.92f, 0.38f),
                                       num ("tone", 400.0f, 12000.0f, 4000.0f), num ("mix", 0.0f, 1.0f, 0.3f) };
constexpr ParamSpec reverbSpecs[]  = { num ("size", 0.3f, 8.0f, 2.2f), num ("damp", 1000.0f, 16000.0f, 6000.0f), num ("pre", 0.0f, 0.15f, 0.02f),
                                       num ("mix", 0.0f, 1.0f, 0.25f) };
constexpr ParamSpec chorusSpecs[]  = { num ("rate", 0.05f, 5.0f, 0.8f), num ("depth", 0.0f, 1.0f, 0.5f), num ("mix", 0.0f, 1.0f, 0.45f) };
constexpr ParamSpec phaserSpecs[]  = { num ("rate", 0.05f, 8.0f, 0.5f), num ("depth", 0.0f, 1.0f, 0.6f), num ("freq", 200.0f, 4000.0f, 800.0f),
                                       sel ("stages", "4|6|8|12", 1), num ("fb", 0.0f, 0.9f, 0.4f), num ("mix", 0.0f, 1.0f, 0.5f) };
constexpr ParamSpec flangerSpecs[] = { num ("rate", 0.05f, 5.0f, 0.25f), num ("depth", 0.0f, 5.0f, 2.0f), num ("delay", 0.5f, 10.0f, 2.5f),
                                       num ("fb", -0.95f, 0.95f, 0.5f), num ("mix", 0.0f, 1.0f, 0.5f) };
constexpr ParamSpec bitcrushSpecs[] = { num ("bits", 1.0f, 16.0f, 8.0f), num ("down", 1.0f, 32.0f, 4.0f), num ("mix", 0.0f, 1.0f, 1.0f) };
constexpr ParamSpec widthSpecs[]   = { num ("width", 0.0f, 2.0f, 1.4f), num ("gain", 0.0f, 1.5f, 1.0f) };
constexpr ParamSpec gateSpecs[]    = { sel ("pattern", "8|16|dot|tranceA|tranceB|stutter", 1), num ("depth", 0.0f, 1.0f, 1.0f),
                                       num ("smooth", 0.001f, 0.05f, 0.004f), num ("mix", 0.0f, 1.0f, 1.0f) };
constexpr ParamSpec tremoloSpecs[] = { sel ("mode", "trem|pan", 0), sel ("shape", "sine|triangle|square", 0), num ("rate", 0.1f, 20.0f, 4.0f),
                                       num ("depth", 0.0f, 1.0f, 0.6f) };
// src is the source track of the sidechain key: routing, handled by the engine (MAX_INSERTS = 125)
constexpr ParamSpec duckerSpecs[]  = { numFixed ("src", 1.0f, 125.0f, 1.0f), num ("thr", -60.0f, 0.0f, -30.0f), num ("range", 0.0f, 40.0f, 18.0f),
                                       num ("att", 0.001f, 0.1f, 0.005f), num ("rel", 0.02f, 1.0f, 0.2f) };

constexpr double smoothing = 0.02; // seconds, for gains and filter settings

/** mixPair().setMix(): equal-power dry/wet. */
inline double dryGain (double mix) noexcept { return std::cos (mix * pi / 2.0); }
inline double wetGain (double mix) noexcept { return std::sin (mix * pi / 2.0); }

//==============================================================================
/** Stereo in place; mono buses are processed as a duplicated stereo pair; blocks longer than the prepared
    maximum are split; non-finite output resets the effect and is replaced by silence. */
class EffectCore : public BuiltinProcessor
{
public:
    EffectCore (const juce::String& type, const ParamSpec* specs, int numSpecs, bool sidechain = false)
        : BuiltinProcessor (makeBuses (sidechain)),
          params (specs, numSpecs)
    {
        name = type;
        isInstrument = false;
    }

    using juce::AudioProcessor::processBlock;

    void setParams (const juce::var& newParams, const BuiltinContext& ctx) override
    {
        params.set (newParams);
        bpm.store (ctx.bpm > 0.0 ? ctx.bpm : 128.0, std::memory_order_relaxed);
        paramsChanged();
    }

    /** Effects read their parameters at every processed block, so the value is used from the next sample on. */
    bool setParamValue (const char* key, float value) noexcept override
    {
        const int index = params.setValue (key, value);

        if (index < 0)
            return false;

        paramAutomated (index);
        return true;
    }

    bool isBusesLayoutSupported (const BusesLayout& layouts) const override
    {
        const auto in = layouts.getMainInputChannelSet(), out = layouts.getMainOutputChannelSet();

        if (layouts.inputBuses.size() > 1) // the ducker's sidechain
        {
            const auto key = layouts.getChannelSet (true, 1);

            if (! (key.isDisabled() || key == juce::AudioChannelSet::stereo() || key == juce::AudioChannelSet::mono()))
                return false;
        }

        return in == out && (out == juce::AudioChannelSet::stereo() || out == juce::AudioChannelSet::mono());
    }

    void prepareToPlay (double newRate, int maximumBlockSize) override
    {
        fs = newRate > 0.0 ? newRate : 44100.0;
        maxBlock = std::max (1, maximumBlockSize);
        monoScratch.assign ((size_t) maxBlock, 0.0f);
        prepareEffect();
        resetEffect();
    }

    void releaseResources() override {}

    void processBlock (juce::AudioBuffer<float>& buffer, juce::MidiBuffer&) override
    {
        juce::ScopedNoDenormals noDenormals;
        const int n = buffer.getNumSamples(), numChannels = buffer.getNumChannels();

        if (numChannels == 0 || n == 0 || monoScratch.empty())
            return;

        beginBlock();
        float* L = buffer.getWritePointer (0);
        float* R = numChannels > 1 ? buffer.getWritePointer (1) : nullptr;

        for (int start = 0; start < n; start += maxBlock)
        {
            const int len = std::min (maxBlock, n - start);

            if (R != nullptr)
            {
                process (L + start, R + start, len);
            }
            else
            {
                std::copy (L + start, L + start + len, monoScratch.data());
                process (L + start, monoScratch.data(), len);

                for (int i = 0; i < len; ++i)
                    L[start + i] = 0.5f * (L[start + i] + monoScratch[(size_t) i]);
            }
        }

        containNonFinite (buffer);
    }

protected:
    virtual void paramsChanged() {}
    /** Audio thread: setParamValue() stored parameter 'index'. */
    virtual void paramAutomated (int index) noexcept { juce::ignoreUnused (index); }
    virtual void prepareEffect() = 0;
    virtual void resetEffect() noexcept = 0;
    /** Audio thread, once per processBlock() before the first process() call (the gate reads the play head here). */
    virtual void beginBlock() noexcept {}
    virtual void process (float* L, float* R, int n) noexcept = 0;

    /** Non-finite output in channels 0-1 resets the effect and is replaced by silence. */
    void containNonFinite (juce::AudioBuffer<float>& buffer) noexcept
    {
        const int n = buffer.getNumSamples(), numChannels = std::min (2, buffer.getNumChannels());

        for (int ch = 0; ch < numChannels; ++ch)
        {
            const float* d = buffer.getReadPointer (ch);

            for (int i = 0; i < n; ++i)
            {
                if (! std::isfinite (d[i]))
                {
                    resetEffect();

                    for (int c = 0; c < numChannels; ++c)
                        buffer.clear (c, 0, n);

                    return;
                }
            }
        }
    }

    ParamStore params;
    std::atomic<double> bpm { 128.0 };
    double fs = 44100.0;
    int maxBlock = 512;

private:
    static BusesProperties makeBuses (bool sidechain)
    {
        auto buses = BusesProperties().withInput ("Input", juce::AudioChannelSet::stereo(), true)
                                      .withOutput ("Output", juce::AudioChannelSet::stereo(), true);
        return sidechain ? buses.withInput ("Sidechain", juce::AudioChannelSet::stereo(), true) : buses;
    }

    std::vector<float> monoScratch;
};

//==============================================================================
/** eq: lowshelf 180 Hz -> peaking (midf, Q 0.9) -> highshelf 6.5 kHz. */
class EqEffect final : public EffectCore
{
public:
    EqEffect() : EffectCore ("eq", eqSpecs, (int) std::size (eqSpecs)) {}

protected:
    enum { pLow, pMid, pMidf, pHigh };

    void prepareEffect() override
    {
        for (auto* s : { &low, &mid, &midLogFreq, &high })
        {
            s->prepare (fs, smoothing);
            s->primed = false;
        }
    }

    void resetEffect() noexcept override
    {
        for (auto& s : states)
            s.reset();

        coeffsValid = false;
    }

    void process (float* L, float* R, int n) noexcept override
    {
        low.setTarget (params.get (pLow));
        mid.setTarget (params.get (pMid));
        midLogFreq.setTarget (std::log (params.get (pMidf)));
        high.setTarget (params.get (pHigh));

        for (int start = 0; start < n; start += 16)
        {
            const int len = std::min (16, n - start);
            updateCoeffs (len);

            for (int i = start; i < start + len; ++i)
            {
                L[i] = states[4].process (hiC, states[2].process (midC, states[0].process (lowC, L[i])));
                R[i] = states[5].process (hiC, states[3].process (midC, states[1].process (lowC, R[i])));
            }
        }
    }

private:
    void updateCoeffs (int len) noexcept
    {
        const bool moving = ! (low.isSettled (1.0e-5) && mid.isSettled (1.0e-5) && midLogFreq.isSettled (1.0e-6) && high.isSettled (1.0e-5));

        if (coeffsValid && ! moving)
            return;

        const double gl = low.skip (len), gm = mid.skip (len), lf = midLogFreq.skip (len), gh = high.skip (len);
        lowC = makeSvf (FilterType::lowshelf, 180.0, shelfQ, gl, fs);
        midC = makeSvf (FilterType::peaking, std::exp (lf), 0.9, gm, fs);
        hiC = makeSvf (FilterType::highshelf, 6500.0, shelfQ, gh, fs);
        coeffsValid = true;
    }

    Smoother low, mid, midLogFreq, high;
    SvfCoeffs lowC, midC, hiC;
    std::array<SvfState, 6> states;
    bool coeffsValid = false;
};

//==============================================================================
/** filter: BiquadFilterNode lowpass / highpass (Q in dB) / bandpass (linear Q). */
class FilterEffect final : public EffectCore
{
public:
    FilterEffect() : EffectCore ("filter", filterSpecs, (int) std::size (filterSpecs)) {}

protected:
    enum { pType, pFreq, pQ };

    void prepareEffect() override
    {
        logFreq.prepare (fs, smoothing);
        q.prepare (fs, smoothing);
        logFreq.primed = q.primed = false;
    }

    void resetEffect() noexcept override
    {
        for (auto& s : states)
            s.reset();

        coeffsValid = false;
    }

    void process (float* L, float* R, int n) noexcept override
    {
        const int typeIndex = (int) params.get (pType);
        const auto type = typeIndex == 1 ? FilterType::highpass : (typeIndex == 2 ? FilterType::bandpass : FilterType::lowpass);

        if (type != currentType)
        {
            currentType = type;
            coeffsValid = false;
        }

        logFreq.setTarget (std::log (params.get (pFreq)));
        q.setTarget (params.get (pQ));

        for (int start = 0; start < n; start += 16)
        {
            const int len = std::min (16, n - start);

            if (! coeffsValid || ! logFreq.isSettled (1.0e-6) || ! q.isSettled (1.0e-6))
            {
                const double f = std::exp (logFreq.skip (len)), qv = q.skip (len);
                coeffs = makeSvf (currentType, f, currentType == FilterType::bandpass ? qv : resonanceFromDb (qv), 0.0, fs);
                coeffsValid = true;
            }

            for (int i = start; i < start + len; ++i)
            {
                L[i] = states[0].process (coeffs, L[i]);
                R[i] = states[1].process (coeffs, R[i]);
            }
        }
    }

private:
    Smoother logFreq, q;
    SvfCoeffs coeffs;
    std::array<SvfState, 2> states;
    FilterType currentType = FilterType::lowpass;
    bool coeffsValid = false;
};

//==============================================================================
/** Port of Chromium's DynamicsCompressorKernel, which is what the web app's DynamicsCompressorNode runs:
    6 ms look-ahead, exponential soft knee, adaptive release curve, automatic makeup gain
    (pow(1 / curve(1.0), 0.6)), sin() warped gain, control rate updates every 32 samples. */
class WebCompressor
{
public:
    void prepare (double rate)
    {
        fs = (float) rate;
        preDelayFrames = std::max (1, (int) (0.006 * rate));
        const int size = juce::nextPowerOfTwo (std::max (1024, preDelayFrames + 1));

        for (auto& b : delay)
            b.assign ((size_t) size, 0.0f);

        mask = size - 1;
        reset();
    }

    void reset() noexcept
    {
        for (auto& b : delay)
            std::fill (b.begin(), b.end(), 0.0f);

        readIndex = 0;
        writeIndex = preDelayFrames;
        detectorAverage = 1.0f; // Chromium starts at 0, which ducks the first few milliseconds
        compressorGain = 1.0f;
        maxAttackCompressionDiffDb = -1.0f;
        attackDiffKnown = false;
        frameInDivision = 0;
        envelopeRate = 1.0f;
        scaledDesiredGain = 1.0f;
    }

    int getLatency() const noexcept { return preDelayFrames; }

    void setCurve (float thresholdDb, float kneeDb, float newRatio) noexcept
    {
        if (curveValid && std::abs (thresholdDb - dbThreshold) < 1.0e-6f && std::abs (kneeDb - dbKnee) < 1.0e-6f
            && std::abs (newRatio - ratio) < 1.0e-6f)
            return;

        curveValid = true;
        dbThreshold = thresholdDb;
        linearThreshold = db2lin (thresholdDb);
        dbKnee = kneeDb;
        ratio = newRatio;
        slope = 1.0f / ratio;
        const float k = kAtSlope (1.0f / ratio);
        kneeThresholdDb = thresholdDb + kneeDb;
        kneeThreshold = db2lin (kneeThresholdDb);
        ykneeThresholdDb = lin2db (kneeCurve (kneeThreshold, k));
        kneeK = k;
        makeupGain = std::pow (1.0f / saturate (1.0f, k), 0.6f);
    }

    void process (float* L, float* R, int n, float attackTime, float releaseTime) noexcept
    {
        const float attackFrames = std::max (0.001f, attackTime) * fs;
        const float releaseFrames = fs * releaseTime;
        const float satReleaseFrames = 0.0025f * fs;

        // Adaptive release: a 4th order polynomial through four release zones (0.09, 0.16, 0.42, 0.98).
        const float y1 = releaseFrames * 0.09f, y2 = releaseFrames * 0.16f, y3 = releaseFrames * 0.42f, y4 = releaseFrames * 0.98f;
        const float kA = 0.9999999999999998f * y1 + 1.8432219684323923e-16f * y2 - 1.9373394351676423e-16f * y3 + 8.824516011816245e-18f * y4;
        const float kB = -1.5788320352845888f * y1 + 2.3305837032074286f * y2 - 0.9141194204840429f * y3 + 0.1623677525612032f * y4;
        const float kC = 0.5334142869106424f * y1 - 1.272736789213631f * y2 + 0.9258856042207512f * y3 - 0.18656310191776226f * y4;
        const float kD = 0.08783463138207234f * y1 - 0.1694162967925622f * y2 + 0.08588057951595272f * y3 - 0.00429891410546283f * y4;
        const float kE = -0.042416883008123074f * y1 + 0.1115693827987602f * y2 - 0.09764676325265872f * y3 + 0.028494263462021576f * y4;

        for (int i = 0; i < n; ++i)
        {
            if (frameInDivision == 0)
                updateEnvelopeRate (kA, kB, kC, kD, kE, attackFrames);

            frameInDivision = (frameInDivision + 1) & 31;

            const float inL = L[i], inR = R[i];
            delay[0][(size_t) writeIndex] = inL;
            delay[1][(size_t) writeIndex] = inR;

            // Detector on the undelayed signal.
            const float absInput = std::max (std::abs (inL), std::abs (inR));
            const float shaped = saturate (absInput, kneeK);
            const float attenuation = absInput <= 0.0001f ? 1.0f : shaped / absInput;
            const float attenuationDb = std::max (2.0f, -lin2db (attenuation));
            const float satReleaseRate = db2lin (attenuationDb / satReleaseFrames) - 1.0f;
            const float rate = attenuation > detectorAverage ? satReleaseRate : 1.0f;
            detectorAverage += (attenuation - detectorAverage) * rate;
            detectorAverage = std::min (1.0f, detectorAverage);

            if (! std::isfinite (detectorAverage))
                detectorAverage = 1.0f;

            if (envelopeRate < 1.0f)
                compressorGain += (scaledDesiredGain - compressorGain) * envelopeRate;
            else
                compressorGain = std::min (1.0f, compressorGain * envelopeRate);

            const float gain = makeupGain * std::sin (juce::MathConstants<float>::halfPi * compressorGain);
            L[i] = delay[0][(size_t) readIndex] * gain;
            R[i] = delay[1][(size_t) readIndex] * gain;
            readIndex = (readIndex + 1) & mask;
            writeIndex = (writeIndex + 1) & mask;
        }
    }

private:
    static float lin2db (float x) noexcept { return 20.0f * std::log10 (x); }
    static float db2lin (float x) noexcept { return std::pow (10.0f, 0.05f * x); }

    void updateEnvelopeRate (float kA, float kB, float kC, float kD, float kE, float attackFrames) noexcept
    {
        if (! std::isfinite (detectorAverage))
            detectorAverage = 1.0f;

        scaledDesiredGain = std::asin (detectorAverage) / juce::MathConstants<float>::halfPi;
        float compressionDiffDb = lin2db (compressorGain / scaledDesiredGain);

        if (scaledDesiredGain > compressorGain) // releasing
        {
            attackDiffKnown = false;

            if (! std::isfinite (compressionDiffDb))
                compressionDiffDb = -1.0f;

            const float x = 0.25f * (juce::jlimit (-12.0f, 0.0f, compressionDiffDb) + 12.0f);
            const float x2 = x * x, x3 = x2 * x, x4 = x2 * x2;
            const float frames = kA + kB * x + kC * x2 + kD * x3 + kE * x4;
            envelopeRate = db2lin (5.0f / frames);
        }
        else // attacking
        {
            if (! std::isfinite (compressionDiffDb))
                compressionDiffDb = 1.0f;

            if (! attackDiffKnown || maxAttackCompressionDiffDb < compressionDiffDb)
            {
                maxAttackCompressionDiffDb = compressionDiffDb;
                attackDiffKnown = true;
            }

            const float effAttenDiffDb = std::max (0.5f, maxAttackCompressionDiffDb);
            envelopeRate = 1.0f - std::pow (0.25f / effAttenDiffDb, 1.0f / attackFrames);
        }
    }

    float kneeCurve (float x, float k) const noexcept
    {
        if (x < linearThreshold)
            return x;

        return linearThreshold + (1.0f - std::exp (-k * (x - linearThreshold))) / k;
    }

    float saturate (float x, float k) const noexcept
    {
        if (x < kneeThreshold)
            return kneeCurve (x, k);

        return db2lin (ykneeThresholdDb + slope * (lin2db (x) - kneeThresholdDb));
    }

    float slopeAt (float x, float k) const noexcept
    {
        if (x < linearThreshold)
            return 1.0f;

        const float x2 = x * 1.001f;
        const float xDb = lin2db (x), x2Db = lin2db (x2);
        const float yDb = lin2db (kneeCurve (x, k)), y2Db = lin2db (kneeCurve (x2, k));
        return (y2Db - yDb) / (x2Db - xDb);
    }

    float kAtSlope (float desiredSlope) const noexcept
    {
        const float x = db2lin (dbThreshold + dbKnee);
        float minK = 0.1f, maxK = 10000.0f, k = 5.0f;

        for (int i = 0; i < 15; ++i)
        {
            if (slopeAt (x, k) < desiredSlope)
                maxK = k;
            else
                minK = k;

            k = std::sqrt (minK * maxK);
        }

        return k;
    }

    std::array<std::vector<float>, 2> delay;
    int mask = 0, readIndex = 0, writeIndex = 0, preDelayFrames = 1, frameInDivision = 0;
    float fs = 44100.0f;
    float detectorAverage = 1.0f, compressorGain = 1.0f, maxAttackCompressionDiffDb = -1.0f;
    float envelopeRate = 1.0f, scaledDesiredGain = 1.0f;
    bool attackDiffKnown = false, curveValid = false;

    float dbThreshold = 0.0f, linearThreshold = 1.0f, dbKnee = 0.0f, ratio = 1.0f, slope = 1.0f;
    float kneeThresholdDb = 0.0f, kneeThreshold = 1.0f, ykneeThresholdDb = 0.0f, kneeK = 1.0f, makeupGain = 1.0f;
};

/** comp: DynamicsCompressorNode (knee 6 dB) followed by the makeup GainNode. */
class CompEffect final : public EffectCore
{
public:
    CompEffect() : EffectCore ("comp", compSpecs, (int) std::size (compSpecs)) {}

protected:
    enum { pThr, pRatio, pAtt, pRel, pMakeup };

    void prepareEffect() override
    {
        kernel.prepare (fs);
        setLatencySamples (kernel.getLatency());
        makeup.prepare (fs, smoothing);
        makeup.primed = false;
    }

    void resetEffect() noexcept override { kernel.reset(); }

    void process (float* L, float* R, int n) noexcept override
    {
        kernel.setCurve (params.get (pThr), 6.0f, params.get (pRatio));
        kernel.process (L, R, n, params.get (pAtt), params.get (pRel));
        makeup.setTarget (dbToGain (params.get (pMakeup)));

        for (int i = 0; i < n; ++i)
        {
            const auto g = (float) makeup.next();
            L[i] *= g;
            R[i] *= g;
        }
    }

private:
    WebCompressor kernel;
    Smoother makeup;
};

//==============================================================================
/** limiter: input gain, then a look-ahead brickwall limiter at 'ceil'. The web app uses a DynamicsCompressorNode
    (ratio 20, knee 0, attack 1 ms, release 60 ms, 6 ms pre-delay), which lets peaks through above the ceiling
    and adds automatic makeup gain; this keeps its timing (6 ms look-ahead, about 1 ms gain ramp, 60 ms release)
    but never exceeds the ceiling: the gain is the minimum needed over the look-ahead window, smoothed by a short
    boxcar that is complete before the peak leaves the delay line, and a final clamp guarantees the ceiling. */
class LimiterEffect final : public EffectCore
{
public:
    LimiterEffect() : EffectCore ("limiter", limiterSpecs, (int) std::size (limiterSpecs)) {}

protected:
    enum { pGain, pCeil };

    void prepareEffect() override
    {
        look = std::max (2, (int) (0.006 * fs));                            // like the compressor's pre-delay
        ramp = juce::jlimit (1, look, (int) std::lround (0.001 * fs));      // gain ramp (boxcar) length
        const int size = juce::nextPowerOfTwo (look + 2);

        for (auto& d : delay)
            d.assign ((size_t) size, 0.0f);

        mask = size - 1;
        queueValue.assign ((size_t) size, 1.0f);
        queueIndex.assign ((size_t) size, 0);
        box.assign ((size_t) ramp, 1.0);
        releaseAlpha = 1.0 - std::exp (-1.0 / (0.06 * fs));
        setLatencySamples (look);
        inputGain.prepare (fs, smoothing);
        inputGain.primed = false;
    }

    void resetEffect() noexcept override
    {
        for (auto& d : delay)
            std::fill (d.begin(), d.end(), 0.0f);

        std::fill (box.begin(), box.end(), 1.0);
        boxSum = (double) ramp;
        boxPos = writePos = queueHead = queueCount = 0;
        envelope = 1.0;
        sampleIndex = 0;
    }

    void process (float* L, float* R, int n) noexcept override
    {
        inputGain.setTarget (dbToGain (params.get (pGain)));
        const auto ceiling = (float) dbToGain (params.get (pCeil));

        for (int i = 0; i < n; ++i)
        {
            const auto g = (float) inputGain.next();
            const float xl = L[i] * g, xr = R[i] * g;
            const float peak = std::max (std::abs (xl), std::abs (xr));
            const float required = peak > ceiling ? ceiling / peak : 1.0f;

            // sliding minimum over the last look + 1 samples (monotonic queue)
            while (queueCount > 0 && queueValue[(size_t) ((queueHead + queueCount - 1) & mask)] >= required)
                --queueCount;

            const auto back = (size_t) ((queueHead + queueCount) & mask);
            queueValue[back] = required;
            queueIndex[back] = sampleIndex;
            ++queueCount;

            while (queueIndex[(size_t) queueHead] <= sampleIndex - (look + 1))
            {
                queueHead = (queueHead + 1) & mask;
                --queueCount;
            }

            const double windowMin = queueValue[(size_t) queueHead];
            envelope = windowMin < envelope ? windowMin : envelope + (windowMin - envelope) * releaseAlpha;

            boxSum += envelope - box[(size_t) boxPos];
            box[(size_t) boxPos] = envelope;
            boxPos = boxPos + 1 == ramp ? 0 : boxPos + 1;
            const auto gain = (float) (boxSum / (double) ramp);

            delay[0][(size_t) writePos] = xl;
            delay[1][(size_t) writePos] = xr;
            const auto readPos = (size_t) ((writePos - look) & mask);
            L[i] = juce::jlimit (-ceiling, ceiling, delay[0][readPos] * gain);
            R[i] = juce::jlimit (-ceiling, ceiling, delay[1][readPos] * gain);
            writePos = (writePos + 1) & mask;
            ++sampleIndex;
        }
    }

private:
    std::array<std::vector<float>, 2> delay;
    std::vector<float> queueValue;
    std::vector<int64_t> queueIndex;
    std::vector<double> box;
    int look = 2, ramp = 1, mask = 0, writePos = 0, queueHead = 0, queueCount = 0, boxPos = 0;
    int64_t sampleIndex = 0;
    double boxSum = 1.0, envelope = 1.0, releaseAlpha = 0.0;
    Smoother inputGain;
};

//==============================================================================
/** dist: dry (1 - mix) + wet (mix) * lowpass(tone) of the 2x oversampled satCurve(drive) shaper, then output gain.
    Chromium's 2x WaveShaper (FIR up/down-samplers) delays the wet path by 128 frames and the dry path not at all,
    which colours partial mixes; the wet path here is padded to the same 128 frames. */
class DistEffect final : public EffectCore
{
public:
    DistEffect() : EffectCore ("dist", distSpecs, (int) std::size (distSpecs)) {}

protected:
    enum { pDrive, pTone, pMix, pOut };

    void prepareEffect() override
    {
        oversampler = std::make_unique<juce::dsp::Oversampling<float>> (2, 1, juce::dsp::Oversampling<float>::filterHalfBandFIREquiripple, true, true);
        oversampler->initProcessing ((size_t) maxBlock);
        wet.setSize (2, maxBlock);
        padding = std::max (0.0, 128.0 - (double) oversampler->getLatencyInSamples());

        for (auto& line : pad)
            line.prepare ((int) std::ceil (padding) + 8);

        for (auto* s : { &dry, &wetLevel, &output })
        {
            s->prepare (fs, smoothing);
            s->primed = false;
        }

        lastTone = -1.0f;
    }

    void resetEffect() noexcept override
    {
        if (oversampler != nullptr)
            oversampler->reset();

        for (auto& s : lp)
            s.reset();

        for (auto& line : pad)
            line.clear();
    }

    void process (float* L, float* R, int n) noexcept override
    {
        sat.set (params.get (pDrive));
        const float tone = params.get (pTone);

        if (std::abs (tone - lastTone) > 1.0e-3f)
        {
            lastTone = tone;
            lpCoeffs = makeSvf (FilterType::lowpass, tone, resonanceFromDb (1.0), 0.0, fs);
        }

        const double mix = params.get (pMix);
        dry.setTarget (1.0 - mix);
        wetLevel.setTarget (mix);
        output.setTarget (params.get (pOut));

        std::copy (L, L + n, wet.getWritePointer (0));
        std::copy (R, R + n, wet.getWritePointer (1));
        juce::dsp::AudioBlock<float> block (wet.getArrayOfWritePointers(), 2, 0, (size_t) n);
        auto up = oversampler->processSamplesUp (block);

        for (size_t ch = 0; ch < up.getNumChannels(); ++ch)
        {
            auto* d = up.getChannelPointer (ch);

            for (size_t i = 0; i < up.getNumSamples(); ++i)
                d[i] = sat (d[i]);
        }

        oversampler->processSamplesDown (block);
        const float* wl = wet.getReadPointer (0);
        const float* wr = wet.getReadPointer (1);

        for (int i = 0; i < n; ++i)
        {
            const auto dg = (float) dry.next(), wg = (float) wetLevel.next(), og = (float) output.next();
            pad[0].push (lp[0].process (lpCoeffs, wl[i]));
            pad[1].push (lp[1].process (lpCoeffs, wr[i]));
            L[i] = (L[i] * dg + pad[0].read (padding + 1.0) * wg) * og;
            R[i] = (R[i] * dg + pad[1].read (padding + 1.0) * wg) * og;
        }
    }

private:
    std::unique_ptr<juce::dsp::Oversampling<float>> oversampler;
    juce::AudioBuffer<float> wet;
    SatCurve sat;
    SvfCoeffs lpCoeffs;
    std::array<SvfState, 2> lp;
    std::array<DelayLine, 2> pad;
    double padding = 0.0;
    Smoother dry, wetLevel, output;
    float lastTone = -1.0f;
};

//==============================================================================
/** Chromium breaks a feedback cycle of DelayNodes by running the cycle one render quantum (128 frames) late:
    measured in Chrome, ping-pong echoes come at T (left), 2T + 128 (right), 3T + 128 (left)...; the normal
    mode at T, 2T + 128, 3T + 256. The port keeps that timing so the echoes land where they do in the web app. */
constexpr double cycleQuantum = 128.0;

/** delay: tempo-synced, lowpass in the feedback loop, ping-pong (mono in, left echo then right echo) or
    stereo, equal-power mix. */
class DelayEffect final : public EffectCore
{
public:
    DelayEffect() : EffectCore ("delay", delaySpecs, (int) std::size (delaySpecs)) {}

    double getTailLengthSeconds() const override
    {
        const double t = delaySeconds() + cycleQuantum / 44100.0, fb = params.get (pFb);
        const double repeats = fb > 0.001 ? std::log (1.0e-3) / std::log (fb) : 1.0;
        return std::min (60.0, t * (repeats + 1.0) * (params.is (pPingPong, 0) ? 2.0 : 1.0));
    }

protected:
    enum { pTime, pPingPong, pFb, pTone, pMix };

    double delaySeconds() const noexcept
    {
        return std::min (3.9, params.get (pTime) * 60.0 / bpm.load (std::memory_order_relaxed));
    }

    void prepareEffect() override
    {
        const int maxDelay = (int) std::ceil (4.0 * fs + cycleQuantum) + 8;
        lineA.prepare (maxDelay);
        lineB.prepare (maxDelay);
        delaySamples.prepare (fs, 0.05);

        for (auto* s : { &delaySamples, &feedback, &dry, &wetLevel })
        {
            if (s != &delaySamples)
                s->prepare (fs, smoothing);

            s->primed = false;
        }

        lastTone = -1.0f;
    }

    void resetEffect() noexcept override
    {
        lineA.clear();
        lineB.clear();
        lpA.reset();
        lpB.reset();
    }

    void process (float* L, float* R, int n) noexcept override
    {
        delaySamples.setTarget (std::max (1.0, delaySeconds() * fs));
        feedback.setTarget (params.get (pFb));
        const double mix = params.get (pMix);
        dry.setTarget (dryGain (mix));
        wetLevel.setTarget (wetGain (mix));
        const float tone = params.get (pTone);

        if (std::abs (tone - lastTone) > 1.0e-3f)
        {
            lastTone = tone;
            lpCoeffs = makeSvf (FilterType::lowpass, tone, resonanceFromDb (1.0), 0.0, fs);
        }

        const bool pingPong = params.is (pPingPong, 0);

        for (int i = 0; i < n; ++i)
        {
            const double d = delaySamples.next();
            const auto fb = (float) feedback.next(), dg = (float) dry.next(), wg = (float) wetLevel.next();
            const float inL = L[i], inR = R[i];
            float a, b;

            if (pingPong)
            {
                // input (downmixed) -> dl -> lowpass -> dr -> feedback -> dl; dl feeds the left, dr the right
                a = lineA.read (d);
                b = lineB.read (d + cycleQuantum);
                lineA.push (0.5f * (inL + inR) + fb * b);
                lineB.push (lpA.process (lpCoeffs, a));
            }
            else
            {
                // input -> dl -> wet, and dl -> lowpass -> feedback -> dl
                a = lineA.read (d);
                b = lineB.read (d);
                lineA.push (inL + fb * lpA.process (lpCoeffs, lineA.read (d + cycleQuantum)));
                lineB.push (inR + fb * lpB.process (lpCoeffs, lineB.read (d + cycleQuantum)));
            }

            L[i] = inL * dg + a * wg;
            R[i] = inR * dg + b * wg;
        }
    }

private:
    DelayLine lineA, lineB;
    SvfCoeffs lpCoeffs;
    SvfState lpA, lpB;
    Smoother delaySamples, feedback, dry, wetLevel;
    float lastTone = -1.0f;
};

//==============================================================================
/** impulse(): exponentially decaying stereo noise of 'seconds', scaled like a ConvolverNode with
    normalize = true (Chromium Reverb::CalculateNormalizationScale: RMS, -58 dB calibration, 44.1 kHz reference). */
juce::AudioBuffer<float> makeReverbImpulse (double rate, double seconds, juce::Random& random)
{
    const int len = std::max (1, (int) std::floor (rate * seconds));
    juce::AudioBuffer<float> ir (2, len);
    const double fadeIn = rate * 0.004;
    double power = 0.0;

    for (int ch = 0; ch < 2; ++ch)
    {
        auto* d = ir.getWritePointer (ch);

        for (int i = 0; i < len; ++i)
        {
            const double x = (double) i / (double) len;
            const double v = (random.nextDouble() * 2.0 - 1.0) * std::exp (-6.9 * x) * std::min (1.0, (double) i / fadeIn);
            d[i] = (float) v;
            power += v * v;
        }
    }

    power = std::sqrt (power / (2.0 * len));

    if (! std::isfinite (power) || power < 0.000125)
        power = 0.000125;

    ir.applyGain ((float) (dbToGain (-58.0) / power * 44100.0 / rate));
    return ir;
}

/** One background thread shared by every reverb, alive while at least one reverb exists: it rebuilds the impulse
    responses of sizes set by setParamValue() on the audio thread (generating an impulse is not real-time work). */
std::shared_ptr<juce::TimeSliceThread> sharedImpulseThread()
{
    static std::mutex mutex;
    static auto* shared = new std::weak_ptr<juce::TimeSliceThread>(); // lives until the process exits
    const std::lock_guard<std::mutex> lock (mutex);
    auto thread = shared->lock();

    if (thread == nullptr)
    {
        thread = std::make_shared<juce::TimeSliceThread> ("Ritmo reverb impulses");
        thread->startThread();
        *shared = thread;
    }

    return thread;
}

/** reverb: pre-delay -> convolution with impulse(size) -> lowpass(damp), equal-power mix.
    New impulse responses are generated on the message thread (setParams) or on a shared background thread
    (setParamValue) and handed to the audio thread with a try-lock; juce::dsp::Convolution then prepares them on
    its own background thread and crossfades. */
class ReverbEffect final : public EffectCore,
                           private juce::TimeSliceClient
{
public:
    ReverbEffect() : EffectCore ("reverb", reverbSpecs, (int) std::size (reverbSpecs)), impulseThread (sharedImpulseThread())
    {
        impulseThread->addTimeSliceClient (this);
    }

    ~ReverbEffect() override
    {
        impulseThread->removeTimeSliceClient (this); // waits for a rebuild in progress
    }

    double getTailLengthSeconds() const override { return (double) params.get (pPre) + (double) params.get (pSize); }

protected:
    enum { pSize, pDamp, pPre, pMix };

    void paramAutomated (int index) noexcept override
    {
        if (index == pSize)
            sizeAutomated.store (true, std::memory_order_release);
    }

    void paramsChanged() override { rebuildImpulse(); }

    /** Background thread: polls for an automated size. */
    int useTimeSlice() override
    {
        if (sizeAutomated.exchange (false, std::memory_order_acq_rel))
            rebuildImpulse();

        return 15;
    }

    /** Message or background thread: a new impulse when the size moved by more than 40 ms (as the web app does). */
    void rebuildImpulse()
    {
        const double rate = preparedRate.load();

        if (rate <= 0.0)
            return;

        const juce::ScopedLock sl (irLock);
        const double size = params.get (pSize);

        if (std::abs (size - irSize) <= 0.04)
            return;

        irSize = size;
        auto ir = makeReverbImpulse (rate, size, random);

        {
            const juce::SpinLock::ScopedLockType lock (pendingLock);
            std::swap (pendingIR, ir);
            pendingRate = rate;
            irPending = true;
        }
        // 'ir' now holds any impulse the audio thread never picked up; it is freed here, on this thread
    }

    void prepareEffect() override
    {
        const int maxPre = (int) std::ceil (0.5 * fs) + 8;
        preL.prepare (maxPre);
        preR.prepare (maxPre);
        wet.setSize (2, maxBlock);

        for (auto* s : { &preDelay, &dry, &wetLevel })
        {
            s->prepare (fs, smoothing);
            s->primed = false;
        }

        lastDamp = -1.0f;

        {
            const juce::ScopedLock sl (irLock);
            irSize = params.get (pSize);
            auto ir = makeReverbImpulse (fs, irSize, random);

            {
                const juce::SpinLock::ScopedLockType lock (pendingLock);
                pendingIR = {};
                irPending = false;
            }

            convolution.loadImpulseResponse (std::move (ir), fs, juce::dsp::Convolution::Stereo::yes,
                                             juce::dsp::Convolution::Trim::no, juce::dsp::Convolution::Normalise::no);
        }

        convolution.prepare ({ fs, (juce::uint32) maxBlock, 2 }); // installs the impulse synchronously
        preparedRate.store (fs);
    }

    void resetEffect() noexcept override
    {
        convolution.reset();
        preL.clear();
        preR.clear();

        for (auto& s : damp)
            s.reset();
    }

    void process (float* L, float* R, int n) noexcept override
    {
        {
            const juce::SpinLock::ScopedTryLockType lock (pendingLock);

            if (lock.isLocked() && irPending)
            {
                convolution.loadImpulseResponse (std::move (pendingIR), pendingRate, juce::dsp::Convolution::Stereo::yes,
                                                 juce::dsp::Convolution::Trim::no, juce::dsp::Convolution::Normalise::no);
                irPending = false;
            }
        }

        preDelay.setTarget (params.get (pPre) * fs);
        const double mix = params.get (pMix);
        dry.setTarget (dryGain (mix));
        wetLevel.setTarget (wetGain (mix));
        const float dampFreq = params.get (pDamp);

        if (std::abs (dampFreq - lastDamp) > 1.0e-3f)
        {
            lastDamp = dampFreq;
            dampCoeffs = makeSvf (FilterType::lowpass, dampFreq, resonanceFromDb (1.0), 0.0, fs);
        }

        float* wl = wet.getWritePointer (0);
        float* wr = wet.getWritePointer (1);

        for (int i = 0; i < n; ++i)
        {
            preL.push (L[i]);
            preR.push (R[i]);
            const double d = preDelay.next() + 1.0;
            wl[i] = preL.read (d);
            wr[i] = preR.read (d);
        }

        juce::dsp::AudioBlock<float> block (wet.getArrayOfWritePointers(), 2, 0, (size_t) n);
        convolution.process (juce::dsp::ProcessContextReplacing<float> (block));

        for (int i = 0; i < n; ++i)
        {
            const auto dg = (float) dry.next(), wg = (float) wetLevel.next();
            L[i] = L[i] * dg + damp[0].process (dampCoeffs, wl[i]) * wg;
            R[i] = R[i] * dg + damp[1].process (dampCoeffs, wr[i]) * wg;
        }
    }

private:
    juce::dsp::Convolution convolution { juce::dsp::Convolution::NonUniform { 2048 } };
    juce::AudioBuffer<float> wet;
    DelayLine preL, preR;
    SvfCoeffs dampCoeffs;
    std::array<SvfState, 2> damp;
    Smoother preDelay, dry, wetLevel;
    float lastDamp = -1.0f;

    // message thread and impulse thread
    juce::CriticalSection irLock;
    juce::Random random;
    double irSize = -1.0;
    std::atomic<double> preparedRate { 0.0 };
    std::atomic<bool> sizeAutomated { false };
    std::shared_ptr<juce::TimeSliceThread> impulseThread;

    // message thread -> audio thread
    juce::SpinLock pendingLock;
    juce::AudioBuffer<float> pendingIR;
    double pendingRate = 44100.0;
    bool irPending = false;
};

//==============================================================================
/** chorus: two delays (14 ms and 19 ms) modulated in opposite directions by one sine LFO (depth * 5 ms),
    fed by the mono downmix (the ChannelMerger downmixes each delay), left / right, equal-power mix. */
class ChorusEffect final : public EffectCore
{
public:
    ChorusEffect() : EffectCore ("chorus", chorusSpecs, (int) std::size (chorusSpecs)) {}

    double getTailLengthSeconds() const override { return 0.03; }

protected:
    enum { pRate, pDepth, pMix };

    void prepareEffect() override
    {
        line.prepare ((int) std::ceil (0.1 * fs) + 8);

        for (auto* s : { &depth, &dry, &wetLevel })
        {
            s->prepare (fs, smoothing);
            s->primed = false;
        }
    }

    void resetEffect() noexcept override
    {
        line.clear();
        lfoPhase = 0.0;
    }

    void process (float* L, float* R, int n) noexcept override
    {
        const double inc = params.get (pRate) / fs;
        depth.setTarget (params.get (pDepth) * 0.005 * fs);
        const double mix = params.get (pMix);
        dry.setTarget (dryGain (mix));
        wetLevel.setTarget (wetGain (mix));

        for (int i = 0; i < n; ++i)
        {
            const double lfo = std::sin (twoPi * lfoPhase), swing = lfo * depth.next();
            lfoPhase = wrap01 (lfoPhase + inc);
            const float a = line.read (0.014 * fs + swing), b = line.read (0.019 * fs - swing);
            const auto dg = (float) dry.next(), wg = (float) wetLevel.next();
            line.push (0.5f * (L[i] + R[i]));
            L[i] = L[i] * dg + a * wg;
            R[i] = R[i] * dg + b * wg;
        }
    }

private:
    DelayLine line;
    double lfoPhase = 0.0;
    Smoother depth, dry, wetLevel;
};

//==============================================================================
/** phaser: 'stages' allpass filters (Q 0.7) swept by one sine LFO around 'freq' (freq * (1 + depth * 0.9 * lfo)),
    feedback from the last stage into the first, equal-power mix; left and right processed alike.
    Chrome delays the feedback by one render quantum (128 frames, the minimum delay of a cycle); here it is one sample,
    which is the classic phaser response. */
class PhaserEffect final : public EffectCore
{
public:
    PhaserEffect() : EffectCore ("phaser", phaserSpecs, (int) std::size (phaserSpecs)) {}

protected:
    enum { pRate, pDepth, pFreq, pStages, pFb, pMix };
    static constexpr int maxStages = 12, chunk = 16; // coefficients follow the LFO every 16 samples

    void prepareEffect() override
    {
        for (auto* s : { &logFreq, &depth, &feedback, &dry, &wetLevel })
        {
            s->prepare (fs, smoothing);
            s->primed = false;
        }
    }

    void resetEffect() noexcept override
    {
        clearStages();
        lfoPhase = 0.0;
    }

    void process (float* L, float* R, int n) noexcept override
    {
        static constexpr int stageCounts[] = { 4, 6, 8, 12 };
        const int stagesNow = stageCounts[juce::jlimit (0, 3, (int) params.get (pStages))];

        if (stagesNow != numStages) // the web app rebuilds its node chain
        {
            numStages = stagesNow;
            clearStages();
        }

        const double inc = params.get (pRate) / fs;
        logFreq.setTarget (std::log (params.get (pFreq)));
        depth.setTarget (params.get (pDepth));
        feedback.setTarget (params.get (pFb));
        const double mix = params.get (pMix);
        dry.setTarget (dryGain (mix));
        wetLevel.setTarget (wetGain (mix));

        for (int start = 0; start < n; start += chunk)
        {
            const int len = std::min (chunk, n - start);
            const double f = std::exp (logFreq.skip (len)), d = depth.skip (len);
            coeffs = makeSvf (FilterType::allpass, f + f * d * 0.9 * std::sin (twoPi * lfoPhase), 0.7, 0.0, fs);
            lfoPhase = wrap01 (lfoPhase + inc * len);

            for (int i = start; i < start + len; ++i)
            {
                const auto fb = (float) feedback.next(), dg = (float) dry.next(), wg = (float) wetLevel.next();
                float l = L[i] + fb * lastL, r = R[i] + fb * lastR;

                for (int k = 0; k < numStages; ++k)
                {
                    l = left[(size_t) k].process (coeffs, l);
                    r = right[(size_t) k].process (coeffs, r);
                }

                lastL = l;
                lastR = r;
                L[i] = L[i] * dg + l * wg;
                R[i] = R[i] * dg + r * wg;
            }
        }
    }

private:
    void clearStages() noexcept
    {
        for (auto& s : left)
            s.reset();

        for (auto& s : right)
            s.reset();

        lastL = lastR = 0.0f;
    }

    std::array<SvfState, maxStages> left, right;
    SvfCoeffs coeffs;
    int numStages = 6;
    float lastL = 0.0f, lastR = 0.0f;
    double lfoPhase = 0.0;
    Smoother logFreq, depth, feedback, dry, wetLevel;
};

//==============================================================================
/** flanger: a delay of delay + depth / 2 + depth / 2 * sin(2 pi rate t) milliseconds with feedback from its output
    into its input (fb may be negative), equal-power mix; left and right through their own delay lines, one LFO. */
class FlangerEffect final : public EffectCore
{
public:
    FlangerEffect() : EffectCore ("flanger", flangerSpecs, (int) std::size (flangerSpecs)) {}

    double getTailLengthSeconds() const override
    {
        const double fb = std::abs ((double) params.get (pFb));
        const double repeats = fb > 0.001 ? std::log (1.0e-3) / std::log (fb) : 1.0;
        return std::min (10.0, 0.015 * (repeats + 1.0));
    }

protected:
    enum { pRate, pDepth, pDelay, pFb, pMix };

    void prepareEffect() override
    {
        const int maxDelay = (int) std::ceil (0.02 * fs) + 8; // 10 ms + 5 ms at most
        lineL.prepare (maxDelay);
        lineR.prepare (maxDelay);

        for (auto* s : { &centre, &swing, &feedback, &dry, &wetLevel })
        {
            s->prepare (fs, smoothing);
            s->primed = false;
        }
    }

    void resetEffect() noexcept override
    {
        lineL.clear();
        lineR.clear();
        lfoPhase = 0.0;
    }

    void process (float* L, float* R, int n) noexcept override
    {
        const double inc = params.get (pRate) / fs, depthMs = params.get (pDepth), delayMs = params.get (pDelay);
        centre.setTarget ((delayMs + depthMs / 2.0) * 0.001 * fs);
        swing.setTarget (depthMs / 2.0 * 0.001 * fs);
        feedback.setTarget (params.get (pFb));
        const double mix = params.get (pMix);
        dry.setTarget (dryGain (mix));
        wetLevel.setTarget (wetGain (mix));

        for (int i = 0; i < n; ++i)
        {
            const double lfo = std::sin (twoPi * lfoPhase);
            lfoPhase = wrap01 (lfoPhase + inc);
            const double d = centre.next() + swing.next() * lfo;
            const auto fb = (float) feedback.next(), dg = (float) dry.next(), wg = (float) wetLevel.next();
            const float l = lineL.read (d), r = lineR.read (d);
            lineL.push (L[i] + fb * l);
            lineR.push (R[i] + fb * r);
            L[i] = L[i] * dg + l * wg;
            R[i] = R[i] * dg + r * wg;
        }
    }

private:
    DelayLine lineL, lineR;
    double lfoPhase = 0.0;
    Smoother centre, swing, feedback, dry, wetLevel;
};

//==============================================================================
/** bitcrush: the RitmoCrush AudioWorklet of the web app, sample for sample: sample-and-hold every round(down)
    samples, quantised to round(x * q) / q with q = 2^(bits - 1), out = x * (1 - mix) + held * mix. */
class BitcrushEffect final : public EffectCore
{
public:
    BitcrushEffect() : EffectCore ("bitcrush", bitcrushSpecs, (int) std::size (bitcrushSpecs)) {}

protected:
    enum { pBits, pDown, pMix };

    void prepareEffect() override {}

    void resetEffect() noexcept override
    {
        holdL = holdR = 0.0f;
        left = 0;
    }

    void process (float* L, float* R, int n) noexcept override
    {
        const double q = std::pow (2.0, (double) params.get (pBits) - 1.0);
        const int down = std::max (1, (int) std::floor ((double) params.get (pDown) + 0.5)); // Math.round
        const float mix = params.get (pMix);

        for (int i = 0; i < n; ++i)
        {
            if (left <= 0)
            {
                holdL = (float) (std::floor ((double) L[i] * q + 0.5) / q); // Math.round
                holdR = (float) (std::floor ((double) R[i] * q + 0.5) / q);
                left = down;
            }

            --left;
            L[i] = L[i] * (1.0f - mix) + holdL * mix;
            R[i] = R[i] * (1.0f - mix) + holdR * mix;
        }
    }

private:
    float holdL = 0.0f, holdR = 0.0f;
    int left = 0;
};

//==============================================================================
/** width: the mid/side matrix of the web app's stereoMatrix(), L' = L (1 + w) / 2 + R (1 - w) / 2 and
    R' = L (1 - w) / 2 + R (1 + w) / 2, then the output gain. */
class WidthEffect final : public EffectCore
{
public:
    WidthEffect() : EffectCore ("width", widthSpecs, (int) std::size (widthSpecs)) {}

protected:
    enum { pWidth, pGain };

    void prepareEffect() override
    {
        for (auto* s : { &width, &gain })
        {
            s->prepare (fs, smoothing);
            s->primed = false;
        }
    }

    void resetEffect() noexcept override {}

    void process (float* L, float* R, int n) noexcept override
    {
        width.setTarget (params.get (pWidth));
        gain.setTarget (params.get (pGain));

        for (int i = 0; i < n; ++i)
        {
            const double w = width.next(), g = gain.next();
            const auto a = (float) ((1.0 + w) * 0.5 * g), b = (float) ((1.0 - w) * 0.5 * g);
            const float l = L[i], r = R[i];
            L[i] = l * a + r * b;
            R[i] = l * b + r * a;
        }
    }

private:
    Smoother width, gain;
};

//==============================================================================
/** GATE_PATTERNS of audio.js, in 32nd notes, looped along the song ('repeat' 2: each value lasts a 16th). */
struct GatePattern
{
    const uint8_t* values;
    int length, repeat;
};

constexpr uint8_t gate8[] = { 1, 1, 0, 0 };
constexpr uint8_t gate16[] = { 1, 0 };
constexpr uint8_t gateDot[] = { 1, 1, 1, 1, 0, 0 };
constexpr uint8_t gateTranceA[] = { 1, 0, 1, 1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 1, 0 };
constexpr uint8_t gateTranceB[] = { 1, 1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 1, 0 };
constexpr uint8_t gateStutter[] = { 1, 0, 1, 0, 1, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 0, 1, 1, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1 };

constexpr GatePattern gatePatterns[] = { { gate8, 4, 1 }, { gate16, 2, 1 }, { gateDot, 6, 1 },
                                         { gateTranceA, 16, 2 }, { gateTranceB, 16, 2 }, { gateStutter, 32, 1 } };

/** gate: a volume gate locked to the host play head. The 32nd note k = floor(ppq * 8) picks the pattern value;
    the gain moves to 1 - depth * mix * (1 - value) with a time constant of smooth / 3 (setTargetAtTime in the web app,
    where the sequencer calls step() for every 16th it schedules). Stopped, or without a play head: gain 1. */
class GateEffect final : public EffectCore
{
public:
    GateEffect() : EffectCore ("gate", gateSpecs, (int) std::size (gateSpecs)) {}

protected:
    enum { pPattern, pDepth, pSmooth, pMix };

    void prepareEffect() override {}

    void resetEffect() noexcept override { gain = 1.0; }

    void beginBlock() noexcept override
    {
        playing = false;
        auto* playHead = getPlayHead();

        if (playHead == nullptr)
            return;

        const auto position = playHead->getPosition();

        if (! position.hasValue() || ! position->getIsPlaying())
            return;

        const auto ppq = position->getPpqPosition();

        if (! ppq.hasValue())
            return;

        ppqPosition = *ppq;
        tempo = position->getBpm().orFallback (bpm.load (std::memory_order_relaxed));
        playing = std::isfinite (ppqPosition) && std::isfinite (tempo) && tempo > 0.0;
    }

    void process (float* L, float* R, int n) noexcept override
    {
        const auto& pattern = gatePatterns[juce::jlimit (0, (int) std::size (gatePatterns) - 1, (int) params.get (pPattern))];
        const int64_t cycle = (int64_t) pattern.length * pattern.repeat;
        const double amount = (double) params.get (pDepth) * (double) params.get (pMix);
        const double coeff = std::exp (-1.0 / (std::max (1.0e-6, (double) params.get (pSmooth) / 3.0) * fs));
        const double ppqPerSample = tempo / (60.0 * fs);

        for (int i = 0; i < n; ++i)
        {
            double target = 1.0;

            if (playing)
            {
                const auto k = (int64_t) std::floor (ppqPosition * 8.0);
                const auto index = ((k % cycle) + cycle) % cycle;
                target = 1.0 - amount * (1.0 - (double) pattern.values[index / pattern.repeat]);
                ppqPosition += ppqPerSample;
            }

            gain = target + (gain - target) * coeff;
            L[i] *= (float) gain;
            R[i] *= (float) gain;
        }
    }

private:
    double gain = 1.0, ppqPosition = 0.0, tempo = 120.0;
    bool playing = false;
};

//==============================================================================
/** tremolo: an LFO (OscillatorNode: sine, or Chromium's band-limited triangle / square tables) running from the
    creation of the effect. trem: gain 1 - depth / 2 + depth / 2 * lfo. pan: a StereoPannerNode on the stereo signal
    with pan = depth * lfo. */
class TremoloEffect final : public EffectCore
{
public:
    TremoloEffect() : EffectCore ("tremolo", tremoloSpecs, (int) std::size (tremoloSpecs)) {}

protected:
    enum { pMode, pShape, pRate, pDepth };

    void prepareEffect() override
    {
        tables = WaveTables::forSampleRate (fs);
        depth.prepare (fs, smoothing);
        depth.primed = false;
    }

    void resetEffect() noexcept override {} // the LFO keeps running

    void process (float* L, float* R, int n) noexcept override
    {
        const int shape = (int) params.get (pShape);
        const auto wave = shape == 1 ? Wave::triangle : (shape == 2 ? Wave::square : Wave::sine);
        const double rate = params.get (pRate);
        lfo.wave = wave;
        lfo.inc = rate / fs;
        lfo.pick = tables != nullptr ? tables->pick (wave, rate, fs) : TablePick {};
        depth.setTarget (params.get (pDepth));

        if (params.is (pMode, 0))
        {
            for (int i = 0; i < n; ++i)
            {
                const double d = depth.next();
                const auto g = (float) (1.0 - d * 0.5 + d * 0.5 * (double) lfo.next());
                L[i] *= g;
                R[i] *= g;
            }

            return;
        }

        for (int i = 0; i < n; ++i)
        {
            const double pan = juce::jlimit (-1.0, 1.0, depth.next() * (double) lfo.next());
            const double x = pan <= 0.0 ? pan + 1.0 : pan;
            const auto gl = (float) std::cos (x * pi / 2.0), gr = (float) std::sin (x * pi / 2.0);
            const float l = L[i], r = R[i];

            if (pan <= 0.0)
            {
                L[i] = l + r * gl;
                R[i] = r * gr;
            }
            else
            {
                L[i] = l * gl;
                R[i] = r + l * gr;
            }
        }
    }

private:
    const WaveTables* tables = nullptr;
    Osc lfo;
    Smoother depth;
};

//==============================================================================
/** ducker: sidechain compression by the level of another track. processBlock() gets 4 channels: 0-1 the track
    (processed in place), 2-3 the key (read only). Envelope follower on max(|keyL|, |keyR|) with one-pole attack and
    release; gain = -range dB * clamp((level dB - thr) / 12, 0, 1), the curve of the web app's WaveShaper.
    The web app follows the key with a 2-pole lowpass at 1 / (2 pi rel) on |key| and ignores 'att'. */
class DuckerEffect final : public EffectCore
{
public:
    DuckerEffect() : EffectCore ("ducker", duckerSpecs, (int) std::size (duckerSpecs), true) {}

    void processBlock (juce::AudioBuffer<float>& buffer, juce::MidiBuffer&) override
    {
        juce::ScopedNoDenormals noDenormals;
        const int n = buffer.getNumSamples();

        if (buffer.getNumChannels() >= 4 && n > 0)
            duck (buffer.getWritePointer (0), buffer.getWritePointer (1), buffer.getReadPointer (2), buffer.getReadPointer (3), n);

        containNonFinite (buffer);
    }

protected:
    enum { pSrc, pThr, pRange, pAtt, pRel };

    void prepareEffect() override {}
    void resetEffect() noexcept override { envelope = 0.0; }
    void process (float*, float*, int) noexcept override {} // processBlock() needs the key channels

private:
    void duck (float* L, float* R, const float* keyL, const float* keyR, int n) noexcept
    {
        const double thr = params.get (pThr), range = params.get (pRange);
        const double threshold = dbToGain (thr);
        const double attack = std::exp (-1.0 / ((double) params.get (pAtt) * fs));
        const double release = std::exp (-1.0 / ((double) params.get (pRel) * fs));

        for (int i = 0; i < n; ++i)
        {
            const double x = std::max (std::abs (keyL[i]), std::abs (keyR[i]));
            envelope = x + (envelope - x) * (x > envelope ? attack : release);
            float g = 1.0f;

            if (envelope > threshold && range > 0.0)
                g = (float) dbToGain (-range * juce::jlimit (0.0, 1.0, (20.0 * std::log10 (envelope) - thr) / 12.0));

            L[i] *= g;
            R[i] *= g;
        }

        if (! std::isfinite (envelope))
            envelope = 0.0;
    }

    double envelope = 0.0;
};
} // namespace

std::unique_ptr<BuiltinProcessor> makeEffect (const juce::String& type)
{
    if (type == "eq")      return std::make_unique<EqEffect>();
    if (type == "filter")  return std::make_unique<FilterEffect>();
    if (type == "comp")    return std::make_unique<CompEffect>();
    if (type == "limiter") return std::make_unique<LimiterEffect>();
    if (type == "dist")    return std::make_unique<DistEffect>();
    if (type == "delay")   return std::make_unique<DelayEffect>();
    if (type == "reverb")  return std::make_unique<ReverbEffect>();
    if (type == "chorus")  return std::make_unique<ChorusEffect>();
    if (type == "phaser")  return std::make_unique<PhaserEffect>();
    if (type == "flanger") return std::make_unique<FlangerEffect>();
    if (type == "bitcrush") return std::make_unique<BitcrushEffect>();
    if (type == "width")   return std::make_unique<WidthEffect>();
    if (type == "gate")    return std::make_unique<GateEffect>();
    if (type == "tremolo") return std::make_unique<TremoloEffect>();
    if (type == "ducker")  return std::make_unique<DuckerEffect>();
    return nullptr;
}
} // namespace ritmo::builtins
