// Ritmo Engine — built-in instruments and effects: factories and the shared parameter store.
// The instruments live in BuiltinsInstruments.cpp, the effects in BuiltinsEffects.cpp.
#include "BuiltinsDsp.h"
#include <cstring>
#include <map>
#include <mutex>

namespace ritmo
{
namespace builtins
{
ParamStore::ParamStore (const ParamSpec* specsIn, int numSpecsIn) noexcept
    : specs (specsIn), numSpecs (juce::jlimit (0, maxParams, numSpecsIn))
{
    for (int i = 0; i < maxParams; ++i)
        values[(size_t) i].store (i < numSpecs ? specs[i].def : 0.0f);
}

void ParamStore::set (const juce::var& params)
{
    if (! params.isObject())
        return;

    for (int i = 0; i < numSpecs; ++i)
    {
        const auto& spec = specs[i];
        const auto value = params.getProperty (juce::Identifier (spec.id), juce::var());

        if (value.isVoid() || value.isUndefined())
            continue;

        float result = 0.0f;

        if (spec.options != nullptr)
        {
            const auto options = juce::StringArray::fromTokens (spec.options, "|", "");
            const int option = options.indexOf (value.toString().trim());

            if (option < 0)
                continue;

            result = (float) option;
        }
        else
        {
            // Numbers may arrive as strings (e.g. the delay's time select holds "0.75"): parseFloat().
            const double d = value.isString() ? value.toString().trim().getDoubleValue() : (double) value;

            if (! std::isfinite (d))
                continue;

            result = juce::jlimit (spec.min, spec.max, (float) d);
        }

        values[(size_t) i].store (result, std::memory_order_relaxed);
    }
}

int ParamStore::indexOf (const char* key) const noexcept
{
    if (key == nullptr)
        return -1;

    for (int i = 0; i < numSpecs; ++i)
        if (std::strcmp (specs[i].id, key) == 0)
            return i;

    return -1;
}

int ParamStore::setValue (const char* key, float value) noexcept
{
    const int index = indexOf (key);

    if (index < 0 || ! specs[index].automatable || ! std::isfinite (value))
        return -1;

    values[(size_t) index].store (juce::jlimit (specs[index].min, specs[index].max, value), std::memory_order_relaxed);
    return index;
}

void ParamStore::snapshot (float* dest) const noexcept
{
    for (int i = 0; i < numSpecs; ++i)
        dest[i] = get (i);
}

//==============================================================================
WaveTables::WaveTables (int sizeIn)
    : tableSize (sizeIn), numRanges ((int) std::lrint (3.0 * std::log2 ((double) sizeIn)))
{
    const int half = tableSize / 2;
    data.assign ((size_t) (3 * numRanges * tableSize), 0.0f);
    juce::dsp::FFT fft (juce::roundToInt (std::log2 ((double) tableSize)));
    std::vector<float> work ((size_t) (2 * tableSize));
    std::vector<double> b ((size_t) half, 0.0);

    for (int w = 0; w < 3; ++w)
    {
        // GenerateBasicWaveform(): sine-series coefficients, n = 1 .. half - 1
        for (int n = 1; n < half; ++n)
        {
            const double piFactor = 2.0 / (n * pi);
            const bool odd = (n & 1) != 0;

            if (w == 0)      b[(size_t) n] = odd ? 2.0 * piFactor : 0.0;                                         // square
            else if (w == 1) b[(size_t) n] = piFactor * (odd ? 1.0 : -1.0);                                      // sawtooth
            else             b[(size_t) n] = odd ? 4.0 * piFactor * piFactor * ((((n - 1) >> 1) & 1) ? -1.0 : 1.0) : 0.0; // triangle
        }

        float normalisation = 1.0f;

        for (int r = 0; r < numRanges; ++r)
        {
            // NumberOfPartialsForRange(): cull 400 cents per range below the full set
            const auto partials = (int) (std::pow (2.0, -r * 400.0 / 1200.0) * half);
            const int keep = std::min (half, partials + 1);
            std::fill (work.begin(), work.end(), 0.0f);

            for (int n = 1; n < keep; ++n)
                work[(size_t) (2 * n + 1)] = (float) -b[(size_t) n];

            fft.performRealOnlyInverseTransform (work.data());
            float* table = data.data() + (size_t) (w * numRanges + r) * (size_t) tableSize;
            std::copy (work.begin(), work.begin() + tableSize, table);

            if (r == 0)
            {
                // normalise to the peak of the fullest table; all three waves are positive at 1/8 of the cycle
                float peak = 0.0f;

                for (int i = 0; i < tableSize; ++i)
                    peak = std::max (peak, std::abs (table[i]));

                normalisation = peak > 0.0f ? 1.0f / peak : 1.0f;

                if (table[tableSize / 8] < 0.0f)
                    normalisation = -normalisation;
            }

            for (int i = 0; i < tableSize; ++i)
                table[i] *= normalisation;
        }
    }
}

const WaveTables* WaveTables::forSampleRate (double sampleRate)
{
    // PeriodicWaveSize(): 2048 up to 24 kHz, 4096 up to 88.2 kHz, 16384 above
    const int size = sampleRate <= 24000.0 ? 2048 : (sampleRate <= 88200.0 ? 4096 : 16384);
    static std::mutex mutex;
    static auto* cache = new std::map<int, std::unique_ptr<WaveTables>>(); // lives until the process exits
    const std::lock_guard<std::mutex> lock (mutex);
    auto& tables = (*cache)[size];

    if (tables == nullptr)
        tables = std::make_unique<WaveTables> (size);

    return tables.get();
}
} // namespace builtins

//==============================================================================
namespace
{
constexpr juce::uint8 sysExNonCommercial = 0x7D, sysExRitmo = 0x52; // manufacturer id 7D (non-commercial), then "R"
constexpr int maxCode = 16383;

int encode (float value, float lo, float hi) noexcept
{
    const float x = std::isfinite (value) ? juce::jlimit (lo, hi, value) : 0.5f * (lo + hi);
    return juce::jlimit (0, maxCode, (int) std::lround ((x - lo) / (hi - lo) * (float) maxCode));
}

float decode (int code, float lo, float hi, float def) noexcept
{
    return code == encode (def, lo, hi) ? def : lo + (hi - lo) * (float) code / (float) maxCode;
}

void put14 (juce::uint8* out, int code) noexcept
{
    out[0] = (juce::uint8) ((code >> 7) & 0x7F);
    out[1] = (juce::uint8) (code & 0x7F);
}

int get14 (const juce::uint8* in) noexcept { return ((in[0] & 0x7F) << 7) | (in[1] & 0x7F); }

bool isRitmoSysEx (const juce::uint8* d, int size, int type, int length) noexcept
{
    return d != nullptr && size >= length && d[0] == 0xF0 && d[1] == sysExNonCommercial && d[2] == sysExRitmo && d[3] == type
           && d[length - 1] == 0xF7;
}
} // namespace

void writeExpressionSysEx (juce::uint8* out, int note, const NoteExpression& e) noexcept
{
    out[0] = 0xF0;
    out[1] = sysExNonCommercial;
    out[2] = sysExRitmo;
    out[3] = 0x01;
    out[4] = (juce::uint8) juce::jlimit (0, 127, note);
    put14 (out + 5, encode (e.pan, -1.0f, 1.0f));
    put14 (out + 7, encode (e.fine, -1.0f, 1.0f));
    put14 (out + 9, encode (e.mx, 0.0f, 1.0f));
    put14 (out + 11, encode (e.my, 0.0f, 1.0f));
    put14 (out + 13, encode (e.rel, 0.0f, 1.0f));
    out[15] = e.porta ? 1 : 0;
    out[16] = 0xF7;
}

bool readExpressionSysEx (const juce::uint8* d, int size, int& note, NoteExpression& e) noexcept
{
    if (! isRitmoSysEx (d, size, 0x01, expressionSysExSize))
        return false;

    note = d[4] & 0x7F;
    e.pan = decode (get14 (d + 5), -1.0f, 1.0f, 0.0f);
    e.fine = decode (get14 (d + 7), -1.0f, 1.0f, 0.0f);
    e.mx = decode (get14 (d + 9), 0.0f, 1.0f, 0.5f);
    e.my = decode (get14 (d + 11), 0.0f, 1.0f, 0.5f);
    e.rel = decode (get14 (d + 13), 0.0f, 1.0f, 0.5f);
    e.porta = (d[15] & 0x7F) != 0;
    return true;
}

void writeSlideSysEx (juce::uint8* out, int channel, int note, double milliseconds) noexcept
{
    out[0] = 0xF0;
    out[1] = sysExNonCommercial;
    out[2] = sysExRitmo;
    out[3] = 0x02;
    out[4] = (juce::uint8) juce::jlimit (0, 15, channel);
    out[5] = (juce::uint8) juce::jlimit (0, 127, note);
    put14 (out + 6, std::isfinite (milliseconds) ? juce::jlimit (1, maxCode, (int) std::lround (milliseconds)) : 1);
    out[8] = 0xF7;
}

bool readSlideSysEx (const juce::uint8* d, int size, int& channel, int& note, double& milliseconds) noexcept
{
    if (! isRitmoSysEx (d, size, 0x02, slideSysExSize))
        return false;

    channel = d[4] & 0x0F;
    note = d[5] & 0x7F;
    milliseconds = std::max (1, get14 (d + 6));
    return true;
}

std::unique_ptr<BuiltinProcessor> createBuiltinInstrument (const juce::String& type)
{
    return builtins::makeInstrument (type);
}

std::unique_ptr<BuiltinProcessor> createBuiltinEffect (const juce::String& type)
{
    return builtins::makeEffect (type);
}
} // namespace ritmo
