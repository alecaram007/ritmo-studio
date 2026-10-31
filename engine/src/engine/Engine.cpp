#include "Engine.h"
#include <algorithm>
#include <cmath>
#include <deque>
#include <limits>
#include <set>
#include <utility>

namespace ritmo
{
using juce::var;

namespace
{
constexpr double stepsPerBar = 16.0;
const float noReport = std::numeric_limits<float>::quiet_NaN();

double num (const var& v, double fallback)
{
    return (v.isVoid() || v.isUndefined() || v.isString()) ? fallback : (double) v;
}

var object (std::initializer_list<std::pair<const char*, var>> props)
{
    auto* o = new juce::DynamicObject();
    for (const auto& [k, v] : props)
        o->setProperty (k, v);
    return var (o);
}

double patternLength (const var& pattern)
{
    double end = num (pattern["len"], 16.0);
    if (auto* notes = pattern["notes"].getDynamicObject())
        for (const auto& kv : notes->getProperties())
            if (auto* arr = kv.value.getArray())
                for (const auto& n : *arr)
                    end = std::max (end, num (n["s"], 0.0) + num (n["l"], 1.0));
    return std::ceil (end / stepsPerBar) * stepsPerBar;
}

juce::MemoryBlock fromBase64 (const juce::String& s)
{
    juce::MemoryOutputStream out;
    juce::Base64::convertFromBase64 (out, s);
    return out.getMemoryBlock();
}

juce::String toBase64 (const juce::MemoryBlock& mb)
{
    return juce::Base64::toBase64 (mb.getData(), mb.getSize());
}

juce::String safeFileName (const juce::String& s)
{
    auto r = s.removeCharacters ("\\/:*?\"<>|").trim();
    return r.isEmpty() ? juce::String ("traccia") : r.substring (0, 60);
}

} // namespace

//==============================================================================
void ProcessorSlot::prepare (double sampleRate, int blockSize)
{
    numChannels = std::max ({ minChannels, 2, proc->getTotalNumInputChannels(), proc->getTotalNumOutputChannels() });
    proc->setRateAndBufferSizeDetails (sampleRate, blockSize);
    proc->prepareToPlay (sampleRate, blockSize);
    work.setSize (numChannels, blockSize, false, true, false);
    work.clear();
}

void ProcessorSlot::process (int numSamples, juce::MidiBuffer& midi)
{
    juce::AudioBuffer<float> view (work.getArrayOfWritePointers(), numChannels, numSamples);
    const juce::ScopedLock sl (proc->getCallbackLock());
    if (proc->isSuspended())
    {
        view.clear();
        return;
    }
    proc->processBlock (view, midi);
    if (proc->getTotalNumOutputChannels() == 1)
        view.copyFrom (1, 0, view, 0, 0, numSamples);
}

void ChannelNode::controllerToAll (int controller, int offset)
{
    for (int c = 0; c < 16; ++c)
        if ((midiChannels >> c) & 1)
            midi.addEvent (juce::MidiMessage::controllerEvent (c + 1, controller, 0), offset);
}

void ChannelNode::pushLive (LiveEvent e)
{
    const auto scope = fifo.write (1);
    if (scope.blockSize1 > 0)
        fifoData[(size_t) scope.startIndex1] = e;
    else if (scope.blockSize2 > 0)
        fifoData[(size_t) scope.startIndex2] = e;
}

float Snapshot::AutoRun::valueAt (double x) const
{
    if (points.empty())
        return 0.5f;
    if (x <= points.front().s)
        return points.front().v;
    for (size_t i = 1; i < points.size(); ++i)
    {
        const auto& a = points[i - 1];
        const auto& b = points[i];
        if (x <= b.s)
            return b.s <= a.s ? b.v : a.v + (b.v - a.v) * (float) ((x - a.s) / (b.s - a.s));
    }
    return points.back().v;
}

float Snapshot::AutoRun::map (float n) const
{
    n = juce::jlimit (0.0f, 1.0f, n);
    float v = log && min > 0.0f ? min * std::pow (max / min, n) : min + n * (max - min);
    if (step > 0.0f)
        v = std::round (v / step) * step;
    return v;
}

//==============================================================================
Engine::Engine (PluginHost& h, Sender s) : host (h), send (std::move (s))
{
    for (auto& i : inserts)
        i = std::make_shared<InsertNode>();
    busBuffers.resize ((size_t) numInserts);
    for (auto& b : busBuffers)
    {
        b.setSize (2, maxBlock);
        b.clear();
    }
    for (auto& r : autoReport)
        r = noReport;
    publish();
    startTimerHz (30);
}

Engine::~Engine()
{
    stopTimer();
    if (renderThread != nullptr)
        renderThread->stopThread (10000);
    recWriter = nullptr;
    deviceManager.removeAudioCallback (this);
    deviceManager.closeAudioDevice();
    recOwned.reset();
    recThread.stopThread (2000);
    host.closeAllEditors();
    delete current.exchange (nullptr);
}

juce::File Engine::settingsFile() const { return PluginHost::dataFolder().getChildFile ("audio-settings.xml"); }

void Engine::saveDeviceSettings()
{
    if (auto xml = deviceManager.createStateXml())
        xml->writeTo (settingsFile());
}

juce::String Engine::startAudio()
{
    juce::String error;
    if (auto xml = juce::parseXML (settingsFile()))
        error = deviceManager.initialise (0, 2, xml.get(), true);
    else
    {
        error = deviceManager.initialiseWithDefaultDevices (0, 2);
        if (error.isEmpty())
        {
            auto setup = deviceManager.getAudioDeviceSetup();
            setup.bufferSize = 256;
            deviceManager.setAudioDeviceSetup (setup, true);
        }
    }
    deviceManager.addAudioCallback (this);
    return error;
}

juce::var Engine::deviceInfo()
{
    auto* d = deviceManager.getCurrentAudioDevice();
    juce::Array<var> ins;
    if (d != nullptr)
    {
        const auto names = d->getInputChannelNames();
        const auto active = d->getActiveInputChannels();
        for (int i = 0; i < names.size(); ++i)
            if (active[i])
                ins.add (names[i]);
    }
    return object ({ { "t", "device" }, { "name", d != nullptr ? d->getName() : juce::String() },
                     { "type", d != nullptr ? d->getTypeName() : juce::String() },
                     { "sampleRate", sampleRate }, { "bufferSize", blockSize }, { "inputs", ins } });
}

void Engine::audioDeviceAboutToStart (juce::AudioIODevice* device)
{
    sampleRate = device->getCurrentSampleRate();
    blockSize = std::min (device->getCurrentBufferSizeSamples(), maxBlock);
    logBuffer.setSize (2, (int) (sampleRate * 60.0));
    logBuffer.clear();
    logWrite = logFilled = 0;
    for (auto& [id, node] : channels)
        if (node->slot)
            node->slot->prepare (sampleRate, blockSize);
    for (auto& ins : inserts)
    {
        for (auto& fx : ins->fx)
            if (fx)
                fx->prepare (sampleRate, blockSize);
        if (ins->eq)
            ins->eq->prepare (sampleRate, blockSize);
    }
    std::weak_ptr<int> alive = lifeToken;
    juce::MessageManager::callAsync ([this, alive]
    {
        if (! alive.expired())
            send (deviceInfo());
    });
}

void Engine::audioDeviceStopped() {}

//==============================================================================
std::shared_ptr<ProcessorSlot> Engine::makeBuiltin (const juce::String& type, bool instrument)
{
    std::unique_ptr<BuiltinProcessor> p = instrument ? createBuiltinInstrument (type) : createBuiltinEffect (type);
    if (p == nullptr)
        return nullptr;
    auto slot = std::make_shared<ProcessorSlot>();
    slot->signature = "builtin:" + type;
    slot->builtin = p.get();
    p->setPlayHead (this);  // the rhythmic gate follows the song position
    slot->proc = std::move (p);
    if (type == "ducker")
        slot->minChannels = 4;
    slot->prepare (sampleRate, blockSize);
    return slot;
}

void Engine::retire (std::shared_ptr<ProcessorSlot> slot)
{
    if (slot == nullptr)
        return;
    if (slot->proc != nullptr)
        host.closeEditor (*slot->proc);
    retiredSlots.emplace_back (juce::Time::getMillisecondCounter(), std::move (slot));
}

void Engine::applyProject (var p, var ui, bool remember)
{
    if (remember)
    {
        lastProject = p;
        lastUi = ui;
    }
    const double bpm = juce::jlimit (20.0, 999.0, num (p["bpm"], 128.0));
    const double swing = juce::jlimit (0.0, 1.0, num (p["swing"], 0.0));
    const bool song = ui["mode"].toString() == "song";
    const auto patternId = ui["pattern"].toString();
    metronomeOn = (bool) ui["metro"];
    songMode = song;
    currentBpm = bpm;

    // ---- channels
    const auto* chans = p["channels"].getArray();
    bool anySolo = false;
    if (chans != nullptr)
        for (const auto& ch : *chans)
            anySolo = anySolo || (bool) ch["solo"];

    channelOrder.clear();
    std::vector<bool> audibleByIndex;
    if (chans != nullptr)
    {
        for (const auto& ch : *chans)
        {
            const auto id = ch["id"].toString();
            const auto type = ch["type"].toString();
            if (id.isEmpty())
                continue;
            channelOrder.push_back (id);
            auto& node = channels[id];
            if (node == nullptr)
            {
                node = std::make_shared<ChannelNode>();
                node->id = id;
            }
            node->type = type;
            node->isHat = type == "hat";
            node->isOhat = type == "ohat";
            node->vol = (float) num (ch["vol"], 0.78);
            node->pan = (float) num (ch["pan"], 0.0);
            node->cutSelf = (bool) ch["cutSelf"];
            node->cutGroup = (int) num (ch["cutGroup"], 0.0);
            node->cutBy = (int) num (ch["cutBy"], 0.0);
            const bool mono = (bool) ch["mono"];
            const double porta = juce::jlimit (0.0, 2.0, num (ch["porta"], 0.0));
            node->monoPlugin = type == "plugin" && (mono || porta > 0.0);
            const bool audible = ! (bool) ch["mute"] && (! anySolo || (bool) ch["solo"]);
            node->audible = audible;
            audibleByIndex.push_back (audible);
            node->insertIndex = juce::jlimit (0, numInserts - 1, (int) num (ch["mixer"], 0.0));

            const auto sig = type == "plugin" ? "plugin:" + ch["plugin"]["id"].toString() : "builtin:" + type;
            if (node->slot == nullptr || node->slot->signature != sig)
            {
                if (type == "plugin")
                {
                    if (node->loadingSignature != sig)
                    {
                        node->loadingSignature = sig;
                        loadPluginFor ("ch:" + id, ch["plugin"], ch["pluginState"].toString());
                    }
                }
                else if (auto slot = makeBuiltin (type, true))
                {
                    retire (node->slot);
                    node->slot = slot;
                    node->sampleId = {};
                }
            }
            if (node->slot != nullptr && node->slot->builtin != nullptr)
            {
                node->slot->builtin->setParams (ch["params"], { (int) num (ch["root"], 60.0), bpm, mono, porta });
                if (type == "sampler")
                {
                    const auto sid = ch["sample"].toString();
                    if (sid != node->sampleId)
                        if (auto it = samples.find (sid); it != samples.end())
                        {
                            node->slot->builtin->setSample (it->second, sampleRates[sid]);
                            node->sampleId = sid;
                        }
                }
            }
        }
    }
    for (auto it = channels.begin(); it != channels.end();)
    {
        if (std::find (channelOrder.begin(), channelOrder.end(), it->first) == channelOrder.end())
        {
            retire (it->second->slot);
            it = channels.erase (it);
        }
        else
            ++it;
    }

    applyMixer (p["mixer"], bpm);

    // ---- notes to play
    std::map<juce::String, int> index;
    for (size_t i = 0; i < channelOrder.size(); ++i)
        index[channelOrder[i]] = (int) i;
    events.clear();
    const auto* patterns = p["patterns"].getArray();
    auto findPattern = [patterns] (const juce::String& id) -> const var*
    {
        if (patterns != nullptr)
            for (const auto& pt : *patterns)
                if (pt["id"].toString() == id)
                    return &pt;
        return nullptr;
    };
    // The playback map of the page (seqInfo() in core.js), in steps: song end, wrap, marker jumps and pauses, metre
    // and the length of every pattern. Without it the engine works out the lengths itself, rounded to 4/4 bars.
    const var seq = p["seq"];
    const bool hasSeq = seq.isObject();
    auto lengthOf = [&seq, hasSeq] (const var& pat)
    {
        const auto id = pat["id"].toString();
        if (auto* plen = seq["plen"].getDynamicObject(); hasSeq && plen != nullptr && id.isNotEmpty() && plen->hasProperty (id))
            if (const double l = num (plen->getProperty (id), 0.0); l > 0.0)
                return l;
        return patternLength (pat);
    };
    jumps.clear();
    pauses.clear();
    meter.clear();
    if (const auto* arr = seq["meter"].getArray())
        for (const auto& m : *arr)
            if (const Snapshot::MeterRun run { num (m["s"], 0.0), num (m["bar"], 16.0), num (m["beat"], 4.0) }; run.bar > 0.0 && run.beat > 0.0)
                meter.push_back (run);
    std::sort (meter.begin(), meter.end(), [] (const auto& a, const auto& b) { return a.s < b.s; });

    auto addPattern = [&] (const var& pat, double offset, double clipLength, double L, double clipOffset)
    {
        auto* notes = pat["notes"].getDynamicObject();
        if (notes == nullptr)
            return;
        for (const auto& kv : notes->getProperties())
        {
            const auto it = index.find (kv.name.toString());
            if (it == index.end() || ! audibleByIndex[(size_t) it->second])
                continue;
            const auto* arr = kv.value.getArray();
            if (arr == nullptr)
                continue;
            const int reps = clipLength < 0 ? 1 : (int) std::ceil ((clipLength + clipOffset) / L);
            for (const auto& n : *arr)
            {
                if ((bool) n["mu"])
                    continue;
                const double s = num (n["s"], 0.0);
                SeqEvent e;
                e.length = num (n["l"], 1.0);
                e.channel = it->second;
                e.note = (uint8_t) juce::jlimit (0, 127, (int) num (n["m"], 60.0));
                e.velocity = (float) juce::jlimit (0.0, 1.0, num (n["v"], 0.8));
                e.expr.rel = (float) juce::jlimit (0.0, 1.0, num (n["rel"], 0.5));
                e.expr.pan = (float) juce::jlimit (-1.0, 1.0, num (n["pan"], 0.0));
                e.expr.fine = (float) juce::jlimit (-1.0, 1.0, num (n["fine"], 0.0));
                e.expr.mx = (float) juce::jlimit (0.0, 1.0, num (n["mx"], 0.5));
                e.expr.my = (float) juce::jlimit (0.0, 1.0, num (n["my"], 0.5));
                e.expr.porta = (bool) n["porta"];
                e.col = (uint8_t) juce::jlimit (0, 15, (int) num (n["col"], 0.0));
                e.slide = (bool) n["slide"];
                for (int r = 0; r < reps; ++r)
                {
                    const double local = r * L + s - clipOffset;
                    if (local < 0)
                        continue;
                    if (clipLength >= 0 && local >= clipLength)
                        break;
                    e.start = offset + local;
                    if (swing > 0 && s == std::floor (s) && (((int) s) & 1))
                        e.start += swing * 0.5;
                    events.push_back (e);
                }
            }
        }
    };
    if (song)
    {
        double end = 0.0;
        const auto* tracks = p["playlist"]["tracks"].getArray();
        if (const auto* clips = p["playlist"]["clips"].getArray())
            for (const auto& c : *clips)
            {
                const int t = (int) num (c["t"], 0.0);
                const double cs = num (c["s"], 0.0), cl = num (c["l"], 16.0);
                end = std::max (end, cs + cl);
                if ((bool) c["mu"] || (tracks != nullptr && t < tracks->size() && (bool) tracks->getReference (t)["mute"]))
                    continue;
                if (const auto* pat = findPattern (c["p"].toString()))
                    addPattern (*pat, cs, cl, lengthOf (*pat), num (c["o"], 0.0));
            }
        loopStart = minPos = 0.0;
        loopLength = std::max (stepsPerBar, std::ceil (end / stepsPerBar) * stepsPerBar);
        if (hasSeq)
        {
            // the song ends exactly at seq.end and continues at seq.wrap (the playhead may still start before it)
            if (const double e = num (seq["end"], 0.0); e > 0.0)
                loopLength = e;
            if (const double w = num (seq["wrap"], 0.0); w > 0.0 && w < loopLength)
                loopStart = w;
            if (const auto* arr = seq["jumps"].getArray())
                for (const auto& j : *arr)
                    if (const Snapshot::Jump jump { num (j["at"], -1.0), num (j["to"], -1.0), (bool) j["loop"] }; jump.at > 0.0 && jump.to >= 0.0)
                        jumps.push_back (jump);
            if (const auto* arr = seq["pauses"].getArray())
                for (const auto& x : *arr)
                    if (const double at = num (x, -1.0); at > 0.0)
                        pauses.push_back (at);
            std::sort (jumps.begin(), jumps.end(), [] (const auto& a, const auto& b) { return a.at < b.at; });
            std::sort (pauses.begin(), pauses.end());
        }
        const var loop = p["loop"];
        if (loop.isObject() && num (loop["e"], 0.0) > num (loop["s"], 0.0))
        {
            loopStart = minPos = std::max (0.0, num (loop["s"], 0.0));
            loopLength = num (loop["e"], loopLength);
        }
    }
    else
    {
        const var* pat = findPattern (patternId);
        if (pat == nullptr && patterns != nullptr && ! patterns->isEmpty())
            pat = &patterns->getReference (0);
        loopStart = minPos = 0.0;
        loopLength = pat != nullptr ? lengthOf (*pat) : stepsPerBar;
        if (pat != nullptr)
            addPattern (*pat, 0.0, -1.0, loopLength, 0.0);
        if (! meter.empty())  // a pattern plays in the project's metre
            meter = { { 0.0, meter.front().bar, meter.front().beat } };
    }
    // by start; at the same start, slide notes after the notes they bend
    std::stable_sort (events.begin(), events.end(), [] (const SeqEvent& a, const SeqEvent& b)
                      { return a.start < b.start || (! (b.start < a.start) && ! a.slide && b.slide); });
    buildClips (p);
    buildAutomation (p);
    publish();
}

void Engine::applyMixer (const var& mixer, double bpm)
{
    mixerModel = mixer;
    const auto* arr = mixer.getArray();
    if (arr == nullptr)
        return;
    for (int i = 0; i < numInserts && i < arr->size(); ++i)
    {
        const auto& t = arr->getReference (i);
        auto& node = *inserts[(size_t) i];
        node.vol = (float) num (t["vol"], i == 0 ? 0.9 : 0.8);
        node.pan = (float) num (t["pan"], 0.0);
        node.muted = (bool) t["mute"];
        const auto* fx = t["fx"].getArray();
        for (int k = 0; k < fxSlotsPerInsert; ++k)
        {
            const var slotv = (fx != nullptr && k < fx->size()) ? fx->getReference (k) : var();
            auto& cur = node.fx[(size_t) k];
            if (! slotv.isObject())
            {
                retire (cur);
                cur.reset();
                node.loading[(size_t) k] = {};
                continue;
            }
            const auto type = slotv["type"].toString();
            node.fxOn[(size_t) k] = slotv.getProperty ("on", true);
            node.fxMix[(size_t) k] = (float) juce::jlimit (0.0, 1.0, num (slotv["mix"], 1.0));
            const auto sig = type == "plugin" ? "plugin:" + slotv["plugin"]["id"].toString() : "builtin:" + type;
            if (cur == nullptr || cur->signature != sig)
            {
                if (type == "plugin")
                {
                    if (node.loading[(size_t) k] != sig)
                    {
                        node.loading[(size_t) k] = sig;
                        loadPluginFor ("fx:" + juce::String (i) + ":" + juce::String (k), slotv["plugin"], slotv["state"].toString());
                    }
                }
                else if (auto slot = makeBuiltin (type, false))
                {
                    retire (cur);
                    cur = slot;
                }
            }
            if (cur != nullptr && cur->builtin != nullptr)
                cur->builtin->setParams (slotv["params"], { 60, bpm });
        }
        // track EQ: the built-in 3-band EQ, present only while one band is not flat
        const var eq = t["eq"];
        const bool eqOn = eq.isObject() && (num (eq["low"], 0.0) != 0.0 || num (eq["mid"], 0.0) != 0.0 || num (eq["high"], 0.0) != 0.0);
        if (! eqOn && node.eq != nullptr)
        {
            retire (node.eq);
            node.eq.reset();
        }
        else if (eqOn)
        {
            if (node.eq == nullptr)
                node.eq = makeBuiltin ("eq", false);
            if (node.eq != nullptr)
                node.eq->builtin->setParams (eq, { 60, bpm });
        }
    }
}

void Engine::buildClips (const var& p)
{
    clipRuns.clear();
    clipData.clear();
    if (! songMode)
        return;
    const auto* tracks = p["playlist"]["tracks"].getArray();
    if (const auto* clips = p["playlist"]["clips"].getArray())
        for (const auto& c : *clips)
        {
            const auto sid = c["smp"].toString();
            if (sid.isEmpty())
                continue;
            const int t = (int) num (c["t"], 0.0);
            if ((bool) c["mu"] || (tracks != nullptr && t < tracks->size() && (bool) tracks->getReference (t)["mute"]))
                continue;
            auto it = samples.find (sid);
            if (it == samples.end())
                continue;
            Snapshot::ClipRun run;
            run.start = num (c["s"], 0.0);
            run.length = num (c["l"], 16.0);
            run.offset = num (c["o"], 0.0);
            run.gain = (float) num (c["gain"], 1.0);
            run.insert = juce::jlimit (0, numInserts - 1, (int) num (c["mx"], 0.0));
            run.data = it->second.get();
            run.dataRate = sampleRates[sid];
            run.fadeIn = std::max (0.0, num (c["fin"], 0.0));
            run.fadeOut = std::max (0.0, num (c["fout"], 0.0));
            clipRuns.push_back (run);
            clipData.push_back (it->second);
        }
}

// Automation clips keep their target as ids here; publish() resolves them to the processors of the moment.
void Engine::buildAutomation (const var& p)
{
    autoRuns.clear();
    autoTargets.clear();
    if (! songMode)
        return;
    std::map<juce::String, const var*> byId;
    if (const auto* autos = p["automation"].getArray())
        for (const auto& a : *autos)
            byId[a["id"].toString()] = &a;
    const auto* tracks = p["playlist"]["tracks"].getArray();
    const auto* clips = p["playlist"]["clips"].getArray();
    if (clips == nullptr)
        return;
    for (const auto& c : *clips)
    {
        const auto aid = c["a"].toString();
        if (aid.isEmpty())
            continue;
        const int t = (int) num (c["t"], 0.0);
        if ((bool) c["mu"] || (tracks != nullptr && t < tracks->size() && (bool) tracks->getReference (t)["mute"]))
            continue;
        auto it = byId.find (aid);
        if (it == byId.end())
            continue;
        const var& a = *it->second;
        const var tg = a["target"], spec = a["spec"];
        Snapshot::AutoRun run;
        run.start = num (c["s"], 0.0);
        run.length = num (c["l"], 16.0);
        run.offset = num (c["o"], 0.0);
        if (const auto* pts = a["points"].getArray())
            for (const auto& q : *pts)
                run.points.push_back ({ num (q["s"], 0.0), (float) num (q["v"], 0.0) });
        const auto kind = tg["kind"].toString();
        if (kind == "chVol") run.kind = AutoKind::chVol;
        else if (kind == "chPan") run.kind = AutoKind::chPan;
        else if (kind == "chParam") run.kind = AutoKind::chParam;
        else if (kind == "mixVol") run.kind = AutoKind::mixVol;
        else if (kind == "mixPan") run.kind = AutoKind::mixPan;
        else if (kind == "fxParam") run.kind = AutoKind::fxParam;
        else if (kind == "plugin") run.kind = AutoKind::plugin;
        else continue;
        run.insert = juce::jlimit (0, numInserts - 1, (int) num (tg["ins"], 0.0));
        const auto key = tg["key"].toString();
        key.copyToUTF8 (run.key.data(), run.key.size());
        run.min = (float) num (spec["min"], 0.0);
        run.max = (float) num (spec["max"], 1.0);
        run.step = (float) num (spec["step"], 0.0);
        run.log = (bool) spec["log"];
        auto slotPos = std::find (autoIds.begin(), autoIds.end(), aid);
        if (slotPos == autoIds.end() && autoIds.size() < (size_t) maxAutoReports)
            slotPos = autoIds.insert (autoIds.end(), aid);
        run.report = slotPos == autoIds.end() ? -1 : (int) (slotPos - autoIds.begin());
        autoRuns.push_back (std::move (run));
        autoTargets.push_back ({ tg["ch"].toString(), (int) num (tg["slot"], 0.0), tg["target"].toString(), (int) num (tg["pid"], -1.0) });
    }
}

void Engine::publish()
{
    auto s = std::make_unique<Snapshot>();
    s->song = songMode;
    for (const auto& id : channelOrder)
    {
        auto it = channels.find (id);
        if (it == channels.end())
            continue;
        auto& node = it->second;
        s->channels.push_back ({ node.get(), node->slot.get(), node->insertIndex });
        s->keepAlive.push_back (node);
        if (node->slot)
            s->keepAlive.push_back (node->slot);
    }

    // ---- mixer routing
    const auto* mx = mixerModel.getArray();
    auto track = [mx] (int i) -> var { return (mx != nullptr && i < mx->size()) ? mx->getReference (i) : var(); };
    std::vector<std::vector<int>> edges ((size_t) numInserts);  // signal edges between tracks
    for (int i = 0; i < numInserts; ++i)
    {
        auto& run = s->inserts[(size_t) i];
        auto& node = inserts[(size_t) i];
        run.node = node.get();
        s->keepAlive.push_back (node);
        const var t = track (i);
        const auto* fxv = t["fx"].getArray();
        for (int k = 0; k < fxSlotsPerInsert; ++k)
        {
            auto& fx = node->fx[(size_t) k];
            run.fx[(size_t) k] = (fx != nullptr && node->fxOn[(size_t) k]) ? fx.get() : nullptr;
            run.sidechain[(size_t) k] = -1;
            if (fx)
            {
                s->keepAlive.push_back (fx);
                if (fx->signature == "builtin:ducker" && fxv != nullptr && k < fxv->size())
                {
                    const int src = (int) std::round (num (fxv->getReference (k)["params"]["src"], 1.0));
                    if (src > 0 && src < numInserts && src != i)
                        run.sidechain[(size_t) k] = src;
                }
            }
        }
        run.eq = node->eq.get();
        if (node->eq)
            s->keepAlive.push_back (node->eq);
        run.out = i == 0 ? -1 : juce::jlimit (0, numInserts - 1, (int) num (t["out"], 0.0));
        if (run.out == i)
            run.out = 0;
        if (const auto* sends = t["sends"].getArray())
            for (const auto& snd : *sends)
            {
                const int to = (int) num (snd["to"], 0.0);
                const float lv = (float) num (snd["lv"], 0.0);
                if (to > 0 && to < numInserts && to != i)
                    run.sends.push_back ({ to, lv * lv });
            }
        run.width = (float) juce::jlimit (0.0, 2.0, num (t["width"], 1.0));
        run.phase = (bool) t["phase"];
        run.swap = (bool) t["swap"];
        if (run.out >= 0)
            edges[(size_t) i].push_back (run.out);
        for (const auto& snd : run.sends)
            edges[(size_t) i].push_back (snd.to);
    }
    // tracks something reaches: channels, audio clips, and everything downstream of them
    std::vector<bool> used ((size_t) numInserts, false);
    std::deque<int> todo { 0 };
    used[0] = true;
    auto mark = [&] (int i) { if (i >= 0 && i < numInserts && ! used[(size_t) i]) { used[(size_t) i] = true; todo.push_back (i); } };
    for (auto& c : s->channels)
        mark (c.insert);
    for (auto& c : clipRuns)
        mark (c.insert);
    while (! todo.empty())
    {
        const int i = todo.front();
        todo.pop_front();
        for (int j : edges[(size_t) i])
            mark (j);
    }
    // sidechain keys must be processed before the track they duck
    for (int i = 0; i < numInserts; ++i)
        for (int src : s->inserts[(size_t) i].sidechain)
            if (src > 0 && used[(size_t) i] && used[(size_t) src])
                edges[(size_t) src].push_back (i);
    std::vector<int> indegree ((size_t) numInserts, 0);
    for (int i = 0; i < numInserts; ++i)
        if (used[(size_t) i])
            for (int j : edges[(size_t) i])
                if (used[(size_t) j])
                    ++indegree[(size_t) j];
    std::vector<bool> placed ((size_t) numInserts, false);
    for (int i = 1; i < numInserts; ++i)
        if (used[(size_t) i] && indegree[(size_t) i] == 0)
            todo.push_back (i);
    while (! todo.empty())
    {
        const int i = todo.front();
        todo.pop_front();
        placed[(size_t) i] = true;
        s->order.push_back (i);
        for (int j : edges[(size_t) i])
            if (j > 0 && used[(size_t) j] && --indegree[(size_t) j] == 0)
                todo.push_back (j);
    }
    for (int i = 1; i < numInserts; ++i)  // tracks caught in a loop (the UI refuses those routes): process them anyway
        if (used[(size_t) i] && ! placed[(size_t) i])
            s->order.push_back (i);
    s->order.push_back (0);
    for (int i = 0; i < numInserts; ++i)
        s->inserts[(size_t) i].used = used[(size_t) i];

    // ---- audio and automation clips
    s->clips = clipRuns;
    for (auto& d : clipData)
        s->keepAlive.push_back (d);
    for (size_t k = 0; k < autoRuns.size(); ++k)
    {
        auto run = autoRuns[k];
        const auto& tg = autoTargets[k];
        bool ok = true;
        switch (run.kind)
        {
            case AutoKind::chVol: case AutoKind::chPan: case AutoKind::chParam:
            {
                auto it = channels.find (tg.channel);
                ok = it != channels.end();
                if (ok)
                {
                    run.channel = it->second.get();
                    run.slot = it->second->slot.get();
                    ok = run.kind != AutoKind::chParam || (run.slot != nullptr && run.slot->builtin != nullptr);
                }
                break;
            }
            case AutoKind::fxParam:
                run.slot = juce::isPositiveAndBelow (tg.slot, fxSlotsPerInsert) ? inserts[(size_t) run.insert]->fx[(size_t) tg.slot].get() : nullptr;
                ok = run.slot != nullptr && run.slot->builtin != nullptr;
                break;
            case AutoKind::plugin:
            {
                run.slot = findSlot (tg.plugin);
                ok = run.slot != nullptr && run.slot->proc != nullptr;
                if (ok)
                {
                    const auto& params = run.slot->proc->getParameters();
                    ok = juce::isPositiveAndBelow (tg.pid, params.size());
                    if (ok)
                        run.param = params[tg.pid];
                }
                break;
            }
            case AutoKind::mixVol: case AutoKind::mixPan:
                break;
        }
        if (ok)
            s->autos.push_back (std::move (run));
    }

    s->events = events;
    s->loopStart = loopStart;
    s->loopLength = loopLength;
    s->minPos = minPos;
    s->jumps = jumps;
    s->pauses = pauses;
    s->meter = meter;
    s->bpm = currentBpm;
    s->metronome = metronomeOn;
    if (auto* old = current.exchange (s.release(), std::memory_order_acq_rel))
        graveyard.emplace_back (juce::Time::getMillisecondCounter(), std::unique_ptr<Snapshot> (old));
}

//==============================================================================
void Engine::loadPluginFor (const juce::String& target, const var& pluginInfo, const juce::String& state)
{
    const auto id = pluginInfo["id"].toString();
    const auto desc = host.find (id);
    if (! desc)
    {
        send (object ({ { "t", "pluginError" }, { "target", target },
                        { "error", "Plugin non trovato su questo computer: " + pluginInfo["name"].toString() } }));
        return;
    }
    std::weak_ptr<int> alive = lifeToken;
    host.createInstance (*desc, sampleRate, blockSize,
                         [this, alive, target, state, name = desc->name] (std::unique_ptr<juce::AudioPluginInstance> instance, const juce::String& error)
                         {
                             if (alive.expired())
                                 return;
                             if (instance == nullptr)
                             {
                                 send (object ({ { "t", "pluginError" }, { "target", target }, { "error", "Impossibile caricare " + name + ": " + error } }));
                                 return;
                             }
                             installPlugin (target, std::move (instance), state);
                         });
}

void Engine::installPlugin (const juce::String& target, std::unique_ptr<juce::AudioPluginInstance> instance, const juce::String& state)
{
    auto slot = std::make_shared<ProcessorSlot>();
    slot->signature = "plugin:" + instance->getPluginDescription().createIdentifierString();
    const auto name = instance->getName();
    if (state.isNotEmpty())
    {
        const auto mb = fromBase64 (state);
        if (mb.getSize() > 0)
            instance->setStateInformation (mb.getData(), (int) mb.getSize());
    }
    instance->setPlayHead (this);
    slot->plugin = instance.get();
    slot->proc = std::move (instance);
    slot->prepare (sampleRate, blockSize);

    bool used = false;
    if (target.startsWith ("ch:"))
    {
        auto it = channels.find (target.fromFirstOccurrenceOf ("ch:", false, false));
        if (it != channels.end() && it->second->loadingSignature == slot->signature)
        {
            it->second->loadingSignature = {};
            retire (it->second->slot);
            it->second->slot = slot;
            used = true;
        }
    }
    else if (target.startsWith ("fx:"))
    {
        const auto parts = juce::StringArray::fromTokens (target, ":", "");
        const int i = parts[1].getIntValue(), k = parts[2].getIntValue();
        if (juce::isPositiveAndBelow (i, numInserts) && juce::isPositiveAndBelow (k, fxSlotsPerInsert))
        {
            auto& node = *inserts[(size_t) i];
            if (node.loading[(size_t) k] == slot->signature)
            {
                node.loading[(size_t) k] = {};
                retire (node.fx[(size_t) k]);
                node.fx[(size_t) k] = slot;
                used = true;
            }
        }
    }
    if (! used)
    {
        retire (slot);
        return;
    }
    publish();
    send (object ({ { "t", "pluginLoaded" }, { "target", target }, { "name", name }, { "hasEditor", slot->proc->hasEditor() },
                    { "numParams", slot->proc->getParameters().size() } }));
}

ProcessorSlot* Engine::findSlot (const juce::String& target) const
{
    if (target.startsWith ("ch:"))
    {
        auto it = channels.find (target.fromFirstOccurrenceOf ("ch:", false, false));
        return it != channels.end() ? it->second->slot.get() : nullptr;
    }
    const auto parts = juce::StringArray::fromTokens (target, ":", "");
    const int i = parts[1].getIntValue(), k = parts[2].getIntValue();
    if (parts[0] == "fx" && juce::isPositiveAndBelow (i, numInserts) && juce::isPositiveAndBelow (k, fxSlotsPerInsert))
        return inserts[(size_t) i]->fx[(size_t) k].get();
    return nullptr;
}

void Engine::sendStates (const var& req)
{
    auto* states = new juce::DynamicObject();
    auto add = [states] (const juce::String& key, const ProcessorSlot* slot)
    {
        if (slot == nullptr || slot->plugin == nullptr)
            return;
        juce::MemoryBlock mb;
        slot->plugin->getStateInformation (mb);
        states->setProperty (key, toBase64 (mb));
    };
    for (const auto& [id, node] : channels)
        add ("ch:" + id, node->slot.get());
    for (int i = 0; i < numInserts; ++i)
        for (int k = 0; k < fxSlotsPerInsert; ++k)
            add ("fx:" + juce::String (i) + ":" + juce::String (k), inserts[(size_t) i]->fx[(size_t) k].get());
    send (object ({ { "t", "states" }, { "req", req }, { "states", var (states) } }));
}

// The automatable parameters of a hosted plug-in, for the "create automation clip" menu.
void Engine::sendParams (const var& msg)
{
    const auto target = msg["target"].toString();
    juce::Array<var> list;
    if (auto* slot = findSlot (target); slot != nullptr && slot->proc != nullptr)
    {
        const auto& params = slot->proc->getParameters();
        for (int i = 0; i < params.size() && list.size() < 2000; ++i)
        {
            auto* prm = params[i];
            if (! prm->isAutomatable())
                continue;
            list.add (object ({ { "i", i }, { "name", prm->getName (60) }, { "value", prm->getValue() } }));
        }
    }
    send (object ({ { "t", "params" }, { "req", msg["req"] }, { "target", target }, { "list", list } }));
}

void Engine::loadSample (const var& msg)
{
    const auto id = msg["id"].toString();
    const auto data = fromBase64 (msg["data"].toString());
    juce::AudioFormatManager fm;
    fm.registerBasicFormats();
    std::unique_ptr<juce::AudioFormatReader> reader (fm.createReaderFor (std::make_unique<juce::MemoryInputStream> (data, false)));
    if (reader == nullptr || reader->lengthInSamples <= 0)
    {
        send (object ({ { "t", "sampleLoaded" }, { "id", id }, { "ok", false } }));
        return;
    }
    const int numCh = (int) std::min<unsigned int> (2, reader->numChannels);
    const int len = (int) std::min<juce::int64> (reader->lengthInSamples, (juce::int64) reader->sampleRate * 600);
    auto buf = std::make_shared<juce::AudioBuffer<float>> (numCh, len);
    reader->read (buf.get(), 0, len, 0, true, numCh > 1);
    samples[id] = buf;
    sampleRates[id] = reader->sampleRate;
    for (auto& [cid, node] : channels)
        if (node->sampleId == id)
            node->sampleId = {};
    if (lastProject.isObject())
        applyProject (lastProject, lastUi);
    send (object ({ { "t", "sampleLoaded" }, { "id", id }, { "ok", true } }));
}

//==============================================================================
void Engine::handleMessage (const var& msg)
{
    const auto t = msg["t"].toString();
    if (t == "project")
        applyProject (msg["project"], msg["ui"]);
    else if (t == "play")
    {
        requestedStart = num (msg["from"], 0.0);
        ++playRequest;
    }
    else if (t == "stop")
    {
        ++stopRequest;
        finishRecording();
    }
    else if (t == "noteOn" || t == "noteOff")
    {
        if (auto it = channels.find (msg["ch"].toString()); it != channels.end())
            it->second->pushLive ({ (uint8_t) (t == "noteOn" ? 0 : 1), (uint8_t) juce::jlimit (0, 127, (int) num (msg["m"], 60.0)),
                                    (float) juce::jlimit (0.0, 1.0, num (msg["v"], 0.8)) });
    }
    else if (t == "panic")
    {
        for (auto& [id, node] : channels)
            node->pushLive ({ 2, 0, 0.0f });
    }
    else if (t == "sample")
        loadSample (msg);
    else if (t == "scan")
    {
        const auto mode = msg["mode"].toString();
        if (mode == "list" && ! host.known.getTypes().isEmpty())
            send (object ({ { "t", "plugins" }, { "list", host.describeAll() } }));
        else
            host.startScan (mode == "full", [this, alive = std::weak_ptr<int> (lifeToken)] (const var& v) { if (! alive.expired()) send (v); });
    }
    else if (t == "openEditor")
    {
        const auto target = msg["target"].toString();
        auto* slot = findSlot (target);
        if (slot != nullptr && slot->plugin != nullptr)
            host.openEditor (*slot->proc, msg["title"].toString().isNotEmpty() ? msg["title"].toString() : slot->proc->getName());
        else
            send (object ({ { "t", "pluginError" }, { "target", target }, { "error", "Il plugin non è ancora caricato" } }));
    }
    else if (t == "getStates")
        sendStates (msg["req"]);
    else if (t == "params")
        sendParams (msg);
    else if (t == "render")
        startRender (msg);
    else if (t == "audioLog")
        saveAudioLog (msg);
    else if (t == "getDevices")
        send (describeDevices());
    else if (t == "setDevice")
        setDevice (msg);
    else if (t == "recStart")
        startRecording (msg);
    else if (t == "preview")
        startPreview (msg);
    else if (t == "previewStop")
    {
        previewStop = true;
        const auto now = juce::Time::getMillisecondCounter();
        for (auto& p : previews)
            if (p.second == 0)
                p.second = now;
    }
    else if (t == "previewVol")
        previewVol = (float) juce::jlimit (0.0, 1.5, num (msg["vol"], 0.8));
    else if (t == "recStop")
    {
        ++stopRequest;
        finishRecording();
    }
}

//==============================================================================
void Engine::timerCallback()
{
    const auto now = juce::Time::getMillisecondCounter();
    if (renderThread == nullptr || ! renderThread->isThreadRunning())  // a render keeps using the snapshot it started with
    {
        graveyard.erase (std::remove_if (graveyard.begin(), graveyard.end(), [now] (const auto& g) { return now - g.first > 1000; }), graveyard.end());
        retiredSlots.erase (std::remove_if (retiredSlots.begin(), retiredSlots.end(), [now] (const auto& g) { return now - g.first > 1000; }), retiredSlots.end());
    }
    if (const double at = pausedAt.exchange (-1.0); at >= 0.0)
    {
        send (object ({ { "t", "paused" }, { "pos", at } }));
        finishRecording();  // like a stop
    }
    previews.erase (std::remove_if (previews.begin(), previews.end(), [now] (const auto& p) { return p.second != 0 && now - p.second > 2000; }), previews.end());
    if (previewWasPlaying && ! previewPlaying.load())
        send (object ({ { "t", "previewEnd" }, { "ok", true } }));
    previewWasPlaying = previewPlaying.load();

    juce::Array<var> meters, flash, scopeOut, autos;
    for (auto& ins : inserts)
        meters.add (juce::Array<var> { ins->peakL.exchange (0.0f), ins->peakR.exchange (0.0f) });
    for (auto& [id, node] : channels)
        if (node->flash.exchange (false))
            flash.add (id);
    const int w = scopeWrite.load();
    for (int i = 0; i < 96; ++i)
        scopeOut.add (scope[(size_t) ((w - 1024 + i * 1024 / 96 + 2048) & 2047)]);
    for (size_t i = 0; i < autoIds.size(); ++i)
    {
        const float v = autoReport[i].exchange (noReport);
        if (! std::isnan (v))
            autos.add (juce::Array<var> { autoIds[i], v });
    }
    auto msg = object ({ { "t", "status" }, { "playing", playing.load() }, { "pos", position.load() },
                         { "meters", meters }, { "flash", flash }, { "scope", scopeOut } });
    if (! autos.isEmpty())
        msg.getDynamicObject()->setProperty ("auto", autos);
    if (recWriter.load() != nullptr)
        msg.getDynamicObject()->setProperty ("rec", true);
    send (msg);
}

//==============================================================================
juce::var Engine::describeDevices()
{
    juce::Array<var> types;
    for (auto* type : deviceManager.getAvailableDeviceTypes())
    {
        type->scanForDevices();
        juce::Array<var> outs, ins;
        for (auto& n : type->getDeviceNames (false))
            outs.add (n);
        for (auto& n : type->getDeviceNames (true))
            ins.add (n);
        types.add (object ({ { "name", type->getTypeName() }, { "outputs", outs }, { "inputs", ins } }));
    }
    const auto setup = deviceManager.getAudioDeviceSetup();
    auto* d = deviceManager.getCurrentAudioDevice();
    juce::Array<var> rates, sizes, inNames;
    if (d != nullptr)
    {
        for (auto r : d->getAvailableSampleRates())
            rates.add (r);
        for (auto b : d->getAvailableBufferSizes())
            sizes.add (b);
        for (auto& n : d->getInputChannelNames())
            inNames.add (n);
    }
    return object ({ { "t", "devices" }, { "types", types }, { "type", deviceManager.getCurrentAudioDeviceType() },
                     { "output", setup.outputDeviceName }, { "input", setup.inputDeviceName },
                     { "sampleRate", d != nullptr ? d->getCurrentSampleRate() : 0.0 }, { "bufferSize", d != nullptr ? d->getCurrentBufferSizeSamples() : 0 },
                     { "sampleRates", rates }, { "bufferSizes", sizes }, { "inputChannels", inNames },
                     { "inputsOn", d != nullptr && d->getActiveInputChannels().countNumberOfSetBits() > 0 },
                     { "latency", d != nullptr ? (d->getInputLatencyInSamples() + d->getOutputLatencyInSamples()) / std::max (1.0, d->getCurrentSampleRate()) : 0.0 } });
}

void Engine::setDevice (const var& msg)
{
    juce::String error;
    const auto type = msg["type"].toString();
    if (type.isNotEmpty() && type != deviceManager.getCurrentAudioDeviceType())
        deviceManager.setCurrentAudioDeviceType (type, true);
    auto setup = deviceManager.getAudioDeviceSetup();
    if (msg.hasProperty ("output"))
        setup.outputDeviceName = msg["output"].toString();
    if (msg.hasProperty ("input"))
        setup.inputDeviceName = msg["input"].toString();
    if (msg.hasProperty ("sampleRate"))
        setup.sampleRate = num (msg["sampleRate"], setup.sampleRate);
    if (msg.hasProperty ("bufferSize"))
        setup.bufferSize = (int) num (msg["bufferSize"], setup.bufferSize);
    setup.useDefaultOutputChannels = true;
    if (msg.hasProperty ("inputsOn"))
    {
        setup.useDefaultInputChannels = false;
        setup.inputChannels.clear();
        if ((bool) msg["inputsOn"] && setup.inputDeviceName.isNotEmpty())
            setup.inputChannels.setRange (0, 2, true);
    }
    error = deviceManager.setAudioDeviceSetup (setup, true);
    saveDeviceSettings();
    auto d = describeDevices();
    d.getDynamicObject()->setProperty ("error", error);
    send (d);
    send (deviceInfo());
}

// Recording needs the input of the sound card: open the default input (two channels) if none is open yet.
bool Engine::enableInputs()
{
    auto* d = deviceManager.getCurrentAudioDevice();
    if (d != nullptr && d->getActiveInputChannels().countNumberOfSetBits() > 0)
        return true;
    auto setup = deviceManager.getAudioDeviceSetup();
    if (setup.inputDeviceName.isEmpty())
        if (auto* type = deviceManager.getCurrentDeviceTypeObject())
        {
            const auto names = type->getDeviceNames (true);
            if (names.isEmpty())
                return false;
            setup.inputDeviceName = names[std::max (0, type->getDefaultDeviceIndex (true))];
        }
    setup.useDefaultInputChannels = false;
    setup.inputChannels.clear();
    setup.inputChannels.setRange (0, 2, true);
    const auto error = deviceManager.setAudioDeviceSetup (setup, true);
    saveDeviceSettings();
    d = deviceManager.getCurrentAudioDevice();
    send (deviceInfo());
    return error.isEmpty() && d != nullptr && d->getActiveInputChannels().countNumberOfSetBits() > 0;
}

void Engine::startRecording (const var& msg)
{
    finishRecording();
    recReq = msg["req"];
    if (! enableInputs())
    {
        send (object ({ { "t", "recDone" }, { "req", recReq }, { "ok", false },
                        { "error", "Nessun ingresso audio disponibile: scegli la scheda audio in Opzioni › Impostazioni audio" } }));
        return;
    }
    recFile = juce::File::createTempFile (".wav");
    std::unique_ptr<juce::OutputStream> stream = std::make_unique<juce::FileOutputStream> (recFile);
    juce::WavAudioFormat wav;
    auto writer = wav.createWriterFor (stream, juce::AudioFormatWriterOptions{}.withSampleRate (sampleRate).withNumChannels (2).withBitsPerSample (24));
    if (writer == nullptr)
    {
        send (object ({ { "t", "recDone" }, { "req", recReq }, { "ok", false }, { "error", "Impossibile creare il file di registrazione" } }));
        return;
    }
    if (! recThread.isThreadRunning())
        recThread.startThread();
    recOwned = std::make_unique<juce::AudioFormatWriter::ThreadedWriter> (writer.release(), recThread, (int) (sampleRate * 4));
    recPair = std::max (0, (int) num (msg["input"], 1.0) - 1);
    recFrom = num (msg["from"], 0.0);
    recStarted = false;
    recWriter = recOwned.get();
    requestedStart = recFrom;
    ++playRequest;
}

void Engine::finishRecording()
{
    if (recOwned == nullptr)
        return;
    recWriter = nullptr;
    std::weak_ptr<int> alive = lifeToken;
    // let the audio thread finish the block it may be writing, then close the file and hand it to the UI
    juce::Timer::callAfterDelay (150, [this, alive]
    {
        if (alive.expired() || recOwned == nullptr)
            return;
        recOwned.reset();
        juce::MemoryBlock data;
        const bool read = recFile.getSize() < 300 * 1024 * 1024 && recFile.loadFileAsData (data);
        auto* d = deviceManager.getCurrentAudioDevice();
        const double latency = d != nullptr ? (d->getInputLatencyInSamples() + d->getOutputLatencyInSamples()) / sampleRate : 0.0;
        const double seconds = (double) std::max<juce::int64> (0, recFile.getSize() - 44) / (sampleRate * 6.0);
        if (read && data.getSize() > 44)
            send (object ({ { "t", "recDone" }, { "req", recReq }, { "ok", true }, { "data", toBase64 (data) }, { "from", recFrom },
                            { "seconds", seconds }, { "latency", latency } }));
        else
            send (object ({ { "t", "recDone" }, { "req", recReq }, { "ok", false }, { "error", read ? "Registrazione vuota" : "Registrazione troppo lunga" } }));
        recFile.deleteFile();
    });
}

//==============================================================================
juce::Optional<juce::AudioPlayHead::PositionInfo> Engine::getPosition() const
{
    PositionInfo info;
    const double bpm = currentBpmAudio;
    info.setBpm (bpm);
    info.setTimeSignature (TimeSignature { 4, 4 });
    info.setIsPlaying (playingAudio);
    info.setPpqPosition (pos / 4.0);
    info.setPpqPositionOfLastBarStart (std::floor (pos / stepsPerBar) * 4.0);
    info.setTimeInSeconds (pos * 60.0 / (bpm * 4.0));
    info.setTimeInSamples ((juce::int64) (pos * 60.0 / (bpm * 4.0) * sampleRate));
    return info;
}

// Everything a note-on silences first: "cut itself", choke groups, the open hat under a closed one, and the
// previous note of a mono plug-in (built-in instruments handle mono and portamento themselves).
void Engine::noteChokes (Snapshot& s, ChannelNode& node, int note, int midiChannel, int offset)
{
    if (node.cutSelf.load())
        node.controllerToAll (120, offset);
    if (const int g = node.cutGroup.load(); g > 0)
        for (auto& o : s.channels)
            if (o.node->cutBy.load() == g)
                o.node->controllerToAll (120, offset);
    if (node.isHat)
        for (auto& o : s.channels)
            if (o.node->isOhat)
                o.node->controllerToAll (120, offset);
    if (node.monoPlugin.load() && node.lastNote >= 0)
        node.midi.addEvent (juce::MidiMessage::noteOff (node.lastChannel, node.lastNote), offset);
    node.lastNote = note;
    node.lastChannel = midiChannel;
}

void Engine::processLiveEvent (Snapshot& s, ChannelNode& node, const LiveEvent& e)
{
    if (e.kind == 0)
    {
        noteChokes (s, node, e.note, 1, 0);
        node.midi.addEvent (juce::MidiMessage::noteOn (1, e.note, e.velocity), 0);
        node.flash = true;
    }
    else if (e.kind == 1)
        node.midi.addEvent (juce::MidiMessage::noteOff (1, e.note), 0);
    else
    {
        node.controllerToAll (123, 0);
        node.controllerToAll (120, 0);
    }
}

// Browser preview: decode the file here (up to one minute) and hand it to the audio thread.
void Engine::startPreview (const var& msg)
{
    const auto now = juce::Time::getMillisecondCounter();
    for (auto& p : previews)
        if (p.second == 0)
            p.second = now;
    if (msg.hasProperty ("vol"))
        previewVol = (float) juce::jlimit (0.0, 1.5, num (msg["vol"], 0.8));
    const juce::File f (msg["path"].toString());
    juce::AudioFormatManager fm;
    fm.registerBasicFormats();
    std::unique_ptr<juce::AudioFormatReader> reader (f.existsAsFile() ? fm.createReaderFor (f) : nullptr);
    if (reader == nullptr || reader->lengthInSamples <= 0)
    {
        previewStop = true;
        send (object ({ { "t", "previewEnd" }, { "ok", false } }));
        return;
    }
    auto p = std::make_unique<Preview>();
    const int numCh = (int) std::min<unsigned int> (2, reader->numChannels);
    const int len = (int) std::min<juce::int64> (reader->lengthInSamples, (juce::int64) (reader->sampleRate * 60.0));
    p->data.setSize (numCh, len);
    reader->read (&p->data, 0, len, 0, true, numCh > 1);
    p->rate = reader->sampleRate;
    previewStop = false;
    previewNext = p.get();
    previews.emplace_back (std::move (p), 0);
}

void Engine::mixPreview (float* const* outputs, int numOutputs, int n)
{
    if (previewStop.exchange (false))
        previewCur = nullptr;
    if (auto* p = previewNext.exchange (nullptr))
    {
        previewCur = p;
        previewPos = 0.0;
    }
    if (previewCur == nullptr)
    {
        previewPlaying = false;
        return;
    }
    previewPlaying = true;
    const auto& d = previewCur->data;
    const int len = d.getNumSamples();
    const double step = previewCur->rate / sampleRate;
    const float vol = previewVol.load();
    const float* l = d.getReadPointer (0);
    const float* r = d.getReadPointer (d.getNumChannels() > 1 ? 1 : 0);
    for (int i = 0; i < n; ++i, previewPos += step)
    {
        const int k = (int) previewPos;
        if (k + 1 >= len)
        {
            previewCur = nullptr;
            break;
        }
        const float f = (float) (previewPos - k);
        const float a = (l[k] + (l[k + 1] - l[k]) * f) * vol, b = (r[k] + (r[k + 1] - r[k]) * f) * vol;
        if (numOutputs > 0 && outputs[0] != nullptr)
            outputs[0][i] += a;
        if (numOutputs > 1 && outputs[1] != nullptr)
            outputs[1][i] += b;
    }
}

void Engine::applyGainPan (float* l, float* r, int n, float& lastGain, float gain, float pan)
{
    // Web Audio StereoPannerNode for a stereo input, followed by a gain ramped across the block.
    const float x = pan <= 0.0f ? pan + 1.0f : pan;
    const float gL = std::cos (x * juce::MathConstants<float>::halfPi), gR = std::sin (x * juce::MathConstants<float>::halfPi);
    const float step = (gain - lastGain) / (float) n;
    float g = lastGain;
    for (int i = 0; i < n; ++i)
    {
        g += step;
        const float a = l[i], b = r[i];
        if (pan <= 0.0f)
        {
            l[i] = (a + b * gL) * g;
            r[i] = (b * gR) * g;
        }
        else
        {
            l[i] = (a * gL) * g;
            r[i] = (b + a * gR) * g;
        }
    }
    lastGain = gain;
}

void Engine::allNotesOff (Snapshot& s, int offset)
{
    for (auto& c : s.channels)
    {
        c.node->controllerToAll (123, offset);
        c.node->controllerToAll (120, offset);
    }
    numPendingOffs = 0;
}

void Engine::clearAutomationOverrides (Snapshot& s)
{
    for (auto& c : s.channels)
    {
        c.node->autoVol = -1.0f;
        c.node->autoPan = -2.0f;
    }
    for (auto& ins : s.inserts)
    {
        ins.node->autoVol = -1.0f;
        ins.node->autoPan = -2.0f;
    }
}

void Engine::runSequencer (Snapshot& s, int numSamples)
{
    const double sps = s.bpm / 60.0 * 4.0 / sampleRate;
    flushOffs (s, numSamples);
    numClicks = 0;
    numSegments = 0;
    int done = 0;
    while (done < numSamples)
    {
        if (pos < s.minPos)
            pos = s.minPos;
        if (pos >= s.loopLength)
            pos = s.loopStart;
        // the block is cut where the music ends, at a pause marker (song, not in a render) or at a jump (song;
        // loop jumps not in a render), whichever comes first; a cut exactly where the piece starts does not count
        enum class Cut { none, end, pause, jump } cut = Cut::none;
        int len = numSamples - done;
        double to = pos + len * sps, next = 0.0;
        if (to >= s.loopLength - 1.0e-9)
        {
            to = s.loopLength;
            cut = Cut::end;
        }
        if (! rendering)
            for (const double at : s.pauses)
                if (at > pos && at <= to)
                {
                    to = at;
                    cut = Cut::pause;
                    break;
                }
        for (const auto& j : s.jumps)
            if (j.at > pos && (j.at < to || (cut == Cut::none && j.at <= to)) && ! (j.loop && rendering))
            {
                to = j.at;
                next = j.to;
                cut = Cut::jump;
                break;
            }
        if (cut != Cut::none)  // (a cut that falls on a sample boundary is not pushed one sample later by rounding)
            len = juce::jlimit (1, numSamples - done, (int) std::ceil ((to - pos) / sps - 1.0e-6));
        if (numSegments < (int) segments.size())
            segments[(size_t) numSegments++] = { done, len, pos, to };
        scheduleNotes (s, pos, to, done, len, sps);  // notes at the cut itself belong to after it
        if (s.metronome)
            scheduleClicks (s, pos, to, done, len, sps);
        done += len;
        pos = cut == Cut::jump ? next : to;
        if (cut == Cut::end)
        {
            if (rendering)  // an offline render ends with the music
            {
                renderEnd = done;
                break;
            }
            pos = s.loopStart;
        }
        else if (cut == Cut::pause)
        {
            // like a stop request, from the marker on; the playhead stays on the marker and the page is told
            flushOffs (s, done);
            allNotesOff (s, std::min (done, numSamples - 1));
            playingAudio = false;
            clearAutomationOverrides (s);
            pausedAt = pos;
            return;
        }
    }
    flushOffs (s, numSamples);
}

// The notes that start in [from, to), placed from sample 'offset' of the block ('length' samples).
void Engine::scheduleNotes (Snapshot& s, double from, double to, int offset, int length, double sps)
{
    auto it = std::lower_bound (s.events.begin(), s.events.end(), from, [] (const SeqEvent& e, double p) { return e.start < p; });
    for (; it != s.events.end() && it->start < to; ++it)
    {
        const int off = juce::jlimit (offset, offset + length - 1, offset + (int) ((it->start - from) / sps));
        auto& ch = s.channels[(size_t) it->channel];
        auto& node = *ch.node;
        const bool builtin = ch.slot != nullptr && ch.slot->builtin != nullptr;
        if (it->slide)
        {
            // a slide note bends the sounding notes of its colour; hosted plug-ins have no equivalent and skip it
            if (builtin)
            {
                std::array<juce::uint8, slideSysExSize> sx;
                writeSlideSysEx (sx.data(), it->col, it->note, it->length * 60000.0 / (s.bpm * 4.0));
                node.midi.addEvent (sx.data(), slideSysExSize, off);
            }
            continue;
        }
        const int midiChannel = it->col + 1;
        noteChokes (s, node, it->note, midiChannel, off);
        if (builtin && ! it->expr.isDefault())
        {
            std::array<juce::uint8, expressionSysExSize> sx;
            writeExpressionSysEx (sx.data(), it->note, it->expr);
            node.midi.addEvent (sx.data(), expressionSysExSize, off);
        }
        node.midi.addEvent (juce::MidiMessage::noteOn (midiChannel, it->note, it->velocity), off);
        node.midiChannels = (uint16_t) (node.midiChannels | (1u << it->col));
        node.flash = true;
        const auto lenSamples = std::max<juce::int64> (1, (juce::int64) (it->length / sps) - 1);
        if (numPendingOffs < (int) pendingOffs.size())
            pendingOffs[(size_t) numPendingOffs++] = { sampleCounter + off + lenSamples, &node, it->note, (uint8_t) midiChannel, it->expr.rel };
    }
}

// Metronome clicks in [from, to): every beat of the metre in force there, accented on the first beat of a bar.
void Engine::scheduleClicks (Snapshot& s, double from, double to, int offset, int length, double sps)
{
    auto add = [&] (double at, bool accent)
    {
        clicks[(size_t) numClicks++] = { juce::jlimit (offset, offset + length - 1, offset + (int) ((at - from) / sps)), accent };
    };
    if (s.meter.empty())  // no playback map: 4/4
    {
        for (double beat = std::ceil (from / 4.0) * 4.0; beat < to && numClicks < (int) clicks.size(); beat += 4.0)
            add (beat, std::fmod (beat, stepsPerBar) == 0.0);
        return;
    }
    for (size_t k = 0; k < s.meter.size(); ++k)
    {
        const auto& m = s.meter[k];
        const double end = k + 1 < s.meter.size() ? std::min (to, s.meter[k + 1].s) : to;
        for (double j = std::ceil ((std::max (from, m.s) - m.s) / m.beat - 1.0e-9); numClicks < (int) clicks.size(); j += 1.0)
        {
            const double at = m.s + j * m.beat;
            if (at >= end)
                break;
            const double inBar = std::fmod (j * m.beat, m.bar);
            add (at, inBar < 1.0e-6 || m.bar - inBar < 1.0e-6);
        }
    }
}

// The note offs due before sample 'upTo' of this block, on the note's MIDI channel with its release velocity.
void Engine::flushOffs (Snapshot& s, int upTo)
{
    if (upTo <= 0)
        return;
    auto contains = [&s] (ChannelNode* n)
    {
        for (auto& c : s.channels)
            if (c.node == n)
                return true;
        return false;
    };
    for (int i = 0; i < numPendingOffs;)
    {
        auto& p = pendingOffs[(size_t) i];
        if (p.at < sampleCounter + upTo)
        {
            if (contains (p.node))
                p.node->midi.addEvent (juce::MidiMessage::noteOff (p.channel, p.note, p.velocity),
                                       (int) juce::jlimit<juce::int64> (0, upTo - 1, p.at - sampleCounter));
            pendingOffs[(size_t) i] = pendingOffs[(size_t) --numPendingOffs];
        }
        else
            ++i;
    }
}

// Automation clips under the playhead set their parameter once per block (volumes and pans are ramped anyway).
void Engine::runAutomation (Snapshot& s)
{
    if (! playingAudio || ! s.song)
        return;
    double p = std::max (pos, s.minPos);
    if (p >= s.loopLength)
        p = s.loopStart;
    for (auto& a : s.autos)
    {
        if (p < a.start || p >= a.start + a.length)
            continue;
        const float n = a.valueAt (p - a.start + a.offset);
        const float v = a.kind == AutoKind::plugin ? n : a.map (n);
        switch (a.kind)
        {
            case AutoKind::chVol:   a.channel->autoVol = v; break;
            case AutoKind::chPan:   a.channel->autoPan = v; break;
            case AutoKind::mixVol:  s.inserts[(size_t) a.insert].node->autoVol = v; break;
            case AutoKind::mixPan:  s.inserts[(size_t) a.insert].node->autoPan = v; break;
            case AutoKind::chParam:
            case AutoKind::fxParam: a.slot->builtin->setParamValue (a.key.data(), v); break;
            case AutoKind::plugin:  if (std::abs (a.param->getValue() - v) > 1.0e-5f) a.param->setValue (v); break;
        }
        if (a.report >= 0)
            autoReport[(size_t) a.report] = v;
    }
}

// Audio clips play their file into a mixer track, following the stretches of the song this block covers,
// with linear fades (in steps of song position) at their start and end.
void Engine::renderClips (Snapshot& s)
{
    if (numSegments == 0 || ! s.song || s.clips.empty())
        return;
    const double sps = s.bpm / 60.0 * 4.0 / sampleRate, secPerStep = 60.0 / (s.bpm * 4.0);
    for (int g = 0; g < numSegments; ++g)
    {
        const auto& seg = segments[(size_t) g];
        for (const auto& c : s.clips)
        {
            const double from = std::max (seg.from, c.start), to = std::min (seg.to, c.start + c.length);
            if (to <= from || c.data == nullptr)
                continue;
            auto& bus = busBuffers[(size_t) c.insert];
            const int i0 = seg.offset + (int) std::ceil ((from - seg.from) / sps - 1.0e-9);
            const int i1 = std::min (seg.offset + seg.length, seg.offset + (int) std::ceil ((to - seg.from) / sps - 1.0e-9));
            const float* srcL = c.data->getReadPointer (0);
            const float* srcR = c.data->getReadPointer (c.data->getNumChannels() > 1 ? 1 : 0);
            const int srcLen = c.data->getNumSamples();
            float* l = bus.getWritePointer (0);
            float* r = bus.getWritePointer (1);
            for (int i = std::max (i0, seg.offset); i < i1; ++i)
            {
                const double step = seg.from + (i - seg.offset) * sps;
                const double at = ((step - c.start) + c.offset) * secPerStep * c.dataRate;
                if (at < 0.0)
                    continue;
                const int k = (int) at;
                if (k + 1 >= srcLen)
                    break;
                const float f = (float) (at - k);
                float gain = c.gain;
                if (c.fadeIn > 0.0)
                    gain *= (float) std::min (1.0, (step - c.start) / c.fadeIn);
                if (c.fadeOut > 0.0)
                    gain *= (float) std::min (1.0, (c.start + c.length - step) / c.fadeOut);
                l[i] += (srcL[k] + (srcL[k + 1] - srcL[k]) * f) * gain;
                r[i] += (srcR[k] + (srcR[k + 1] - srcR[k]) * f) * gain;
            }
        }
    }
}

// One mixer track: effect slots (each with its dry/wet mix), EQ, stereo tools, pan and fader, then out and sends.
void Engine::runInsert (Snapshot& s, int i, int n)
{
    auto& run = s.inserts[(size_t) i];
    auto& node = *run.node;
    auto& bus = busBuffers[(size_t) i];
    auto runSlot = [&] (ProcessorSlot* fx, float mix, int key)
    {
        if (mix < 0.999f)
        {
            node.dry.copyFrom (0, 0, bus, 0, 0, n);
            node.dry.copyFrom (1, 0, bus, 1, 0, n);
        }
        auto& w = fx->work;
        w.clear (0, n);
        w.copyFrom (0, 0, bus, 0, 0, n);
        w.copyFrom (1, 0, bus, 1, 0, n);
        if (key > 0 && w.getNumChannels() >= 4 && s.inserts[(size_t) key].used)
        {
            w.copyFrom (2, 0, busBuffers[(size_t) key], 0, 0, n);
            w.copyFrom (3, 0, busBuffers[(size_t) key], 1, 0, n);
        }
        fxMidi.clear();
        fx->process (n, fxMidi);
        if (mix < 0.999f)
        {
            for (int ch = 0; ch < 2; ++ch)
            {
                float* b = bus.getWritePointer (ch);
                const float* d = node.dry.getReadPointer (ch);
                const float* wet = w.getReadPointer (ch);
                for (int k = 0; k < n; ++k)
                    b[k] = d[k] * (1.0f - mix) + wet[k] * mix;
            }
        }
        else
        {
            bus.copyFrom (0, 0, w, 0, 0, n);
            bus.copyFrom (1, 0, w, 1, 0, n);
        }
    };
    for (int k = 0; k < fxSlotsPerInsert; ++k)
        if (auto* fx = run.fx[(size_t) k])
            runSlot (fx, node.fxMix[(size_t) k].load(), run.sidechain[(size_t) k]);
    if (run.eq != nullptr)
        runSlot (run.eq, 1.0f, -1);
    float* l = bus.getWritePointer (0);
    float* r = bus.getWritePointer (1);
    if (run.width != 1.0f || run.phase || run.swap)
    {
        const float a = (1.0f + run.width) * 0.5f, b = (1.0f - run.width) * 0.5f, ph = run.phase ? -1.0f : 1.0f;
        for (int k = 0; k < n; ++k)
        {
            const float L = l[k], R = r[k];
            float nl = (a * L + b * R) * ph, nr = (b * L + a * R) * ph;
            if (run.swap)
                std::swap (nl, nr);
            l[k] = nl;
            r[k] = nr;
        }
    }
    const float v = node.autoVol >= 0.0f ? node.autoVol : node.vol.load();
    const float pan = node.autoPan >= -1.0f ? node.autoPan : node.pan.load();
    applyGainPan (l, r, n, node.lastGain, node.muted.load() ? 0.0f : v * v, pan);
    node.peakL = std::max (node.peakL.load(), bus.getMagnitude (0, 0, n));
    node.peakR = std::max (node.peakR.load(), bus.getMagnitude (1, 0, n));
    if (i == 0)
        return;
    if (run.out >= 0)
    {
        busBuffers[(size_t) run.out].addFrom (0, 0, bus, 0, 0, n);
        busBuffers[(size_t) run.out].addFrom (1, 0, bus, 1, 0, n);
    }
    for (const auto& snd : run.sends)
    {
        busBuffers[(size_t) snd.to].addFrom (0, 0, bus, 0, 0, n, snd.gain);
        busBuffers[(size_t) snd.to].addFrom (1, 0, bus, 1, 0, n, snd.gain);
    }
}

void Engine::processBlock (const float* const* inputs, int numInputs, float* const* outputs, int numOutputs, int n)
{
    for (int c = 0; c < numOutputs; ++c)
        if (outputs[c] != nullptr)
            juce::FloatVectorOperations::clear (outputs[c], n);
    auto* s = current.load (std::memory_order_acquire);
    if (s == nullptr)
        return;
    currentBpmAudio = s->bpm;

    for (auto& c : s->channels)
        c.node->midi.clear();
    if (std::exchange (silenceVoices, false))
        allNotesOff (*s);

    if (const int r = stopRequest.load(); r != seenStop)
    {
        seenStop = r;
        if (playingAudio)
            allNotesOff (*s);
        playingAudio = false;
        clearAutomationOverrides (*s);
    }
    if (const int r = playRequest.load(); r != seenPlay)
    {
        seenPlay = r;
        allNotesOff (*s);
        clearAutomationOverrides (*s);
        pos = requestedStart.load();
        playingAudio = true;
    }

    // record the input of the sound card while the song plays
    if (auto* w = recWriter.load(); w != nullptr && playingAudio)
    {
        const int a = recPair.load() * 2;
        const float* src[2] = { silence.data(), silence.data() };
        if (inputs != nullptr && a < numInputs && inputs[a] != nullptr)
            src[0] = src[1] = inputs[a];
        if (inputs != nullptr && a + 1 < numInputs && inputs[a + 1] != nullptr)
            src[1] = inputs[a + 1];
        w->write (src, n);
        recStarted = true;
    }

    for (auto& c : s->channels)
    {
        auto& node = *c.node;
        const auto reader = node.fifo.read (node.fifo.getNumReady());
        reader.forEach ([this, s, &node] (int idx) { processLiveEvent (*s, node, node.fifoData[(size_t) idx]); });
    }

    numClicks = 0;
    numSegments = 0;
    if (playingAudio)
    {
        runAutomation (*s);
        runSequencer (*s, n);
    }
    else if (rendering)
        flushOffs (*s, n);  // the tail of a render: notes still held at the end of the music get their note offs

    for (int i : s->order)
        busBuffers[(size_t) i].clear (0, n);

    for (auto& c : s->channels)
    {
        if (c.slot == nullptr)
            continue;
        auto& w = c.slot->work;
        w.clear (0, n);
        c.slot->process (n, c.node->midi);
        const float v = c.node->autoVol >= 0.0f ? c.node->autoVol : c.node->vol.load();
        const float gain = c.node->audible.load() ? v * v * 1.3f : 0.0f;
        const float pan = c.node->autoPan >= -1.0f ? c.node->autoPan : c.node->pan.load();
        float* l = w.getWritePointer (0);
        float* r = w.getWritePointer (1);
        applyGainPan (l, r, n, c.node->lastGain, gain, pan);
        auto& bus = busBuffers[(size_t) juce::jlimit (0, numInserts - 1, c.insert)];
        bus.addFrom (0, 0, l, n);
        bus.addFrom (1, 0, r, n);
    }
    renderClips (*s);

    for (int i : s->order)
        runInsert (*s, i, n);

    auto& master = busBuffers[0];
    // metronome clicks go straight to the output, after the master chain, like the web version
    auto renderClick = [&] (int from, int to)
    {
        for (int i = from; i < to && clickRemaining > 0; ++i, --clickRemaining)
        {
            const float env = (float) clickRemaining / (float) clickTotal;
            const float v = (float) std::sin (clickPhase) * 0.18f * env * env;
            clickPhase += juce::MathConstants<double>::twoPi * clickFreq / sampleRate;
            master.addSample (0, i, v);
            master.addSample (1, i, v);
        }
    };
    int cursor = 0;
    for (int k = 0; k < numClicks; ++k)
    {
        renderClick (cursor, clicks[(size_t) k].offset);
        cursor = clicks[(size_t) k].offset;
        clickTotal = clickRemaining = (int) (0.04 * sampleRate);
        clickPhase = 0.0;
        clickFreq = clicks[(size_t) k].accent ? 1760.0 : 1175.0;
    }
    renderClick (cursor, n);

    if (numOutputs > 0 && outputs[0] != nullptr)
        juce::FloatVectorOperations::copy (outputs[0], master.getReadPointer (0), n);
    if (numOutputs > 1 && outputs[1] != nullptr)
        juce::FloatVectorOperations::copy (outputs[1], master.getReadPointer (1), n);
    else if (numOutputs == 1 && outputs[0] != nullptr)
        juce::FloatVectorOperations::add (outputs[0], master.getReadPointer (1), n);
    if (! rendering)
        mixPreview (outputs, numOutputs, n);

    if (logging && logBuffer.getNumSamples() > 0)
    {
        const int size = logBuffer.getNumSamples();
        for (int ch = 0; ch < 2; ++ch)
        {
            const float* src = master.getReadPointer (ch);
            float* dst = logBuffer.getWritePointer (ch);
            for (int i = 0, w = logWrite; i < n; ++i, w = (w + 1) % size)
                dst[w] = src[i];
        }
        logWrite = (logWrite + n) % size;
        logFilled = std::min (size, logFilled + n);
    }

    int wpos = scopeWrite.load();
    const float* ml = master.getReadPointer (0);
    for (int i = 0; i < n; ++i)
        scope[(size_t) (wpos++ & 2047)] = ml[i];
    scopeWrite = wpos & 2047;

    sampleCounter += n;
    position = pos;
    playing = playingAudio;
}

void Engine::audioDeviceIOCallbackWithContext (const float* const* inputs, int numInputs, float* const* outputs, int numOutputs, int numSamples,
                                               const juce::AudioIODeviceCallbackContext&)
{
    juce::ScopedNoDenormals noDenormals;
    const juce::ScopedTryLock tryLock (renderLock);
    if (! tryLock.isLocked())
    {
        for (int c = 0; c < numOutputs; ++c)
            if (outputs[c] != nullptr)
                juce::FloatVectorOperations::clear (outputs[c], numSamples);
        return;
    }
    std::array<float*, 16> outs {};
    std::array<const float*, 16> ins {};
    const int numOut = std::min (numOutputs, 16), numIn = std::min (numInputs, 16);
    for (int done = 0; done < numSamples;)
    {
        const int n = std::min (numSamples - done, blockSize);
        for (int c = 0; c < numOut; ++c)
            outs[(size_t) c] = outputs[c] != nullptr ? outputs[c] + done : nullptr;
        for (int c = 0; c < numIn; ++c)
            ins[(size_t) c] = inputs[c] != nullptr ? inputs[c] + done : nullptr;
        processBlock (ins.data(), numIn, outs.data(), numOut, n);
        done += n;
    }
}

void Engine::saveAudioLog (const var& msg)
{
    const int size = logBuffer.getNumSamples(), filled = logFilled, end = logWrite;
    const juce::File out (msg["path"].toString());
    bool ok = false;
    if (filled > 0)
    {
        juce::AudioBuffer<float> copy (2, filled);
        const int start = (end - filled + size) % size;
        for (int ch = 0; ch < 2; ++ch)
            for (int i = 0; i < filled; ++i)
                copy.setSample (ch, i, logBuffer.getSample (ch, (start + i) % size));
        out.deleteFile();
        std::unique_ptr<juce::OutputStream> stream = std::make_unique<juce::FileOutputStream> (out);
        juce::WavAudioFormat wav;
        if (auto writer = wav.createWriterFor (stream, juce::AudioFormatWriterOptions{}.withSampleRate (sampleRate).withNumChannels (2).withBitsPerSample (24)))
            ok = writer->writeFromAudioSampleBuffer (copy, 0, filled);
    }
    send (object ({ { "t", "audioLogDone" }, { "req", msg["req"] }, { "ok", ok }, { "seconds", filled / sampleRate }, { "path", out.getFullPathName() } }));
}

//==============================================================================
class RenderJob final : public juce::Thread
{
public:
    explicit RenderJob (std::function<void (juce::Thread&)> fn) : juce::Thread ("Render"), job (std::move (fn)) {}
    void run() override { job (*this); }

private:
    std::function<void (juce::Thread&)> job;
};

/*  render { path, mode, pattern, req, format: "wav" | "flac" | "ogg", bits: 16 | 24 | 32, quality: 0..10,
             stems: [{ i, name }] (one file per mixer track, post-fader, written next to path), master: true to also write the mix,
             project: the project to render instead of the last one received (same channels and mixer, so nothing is reloaded;
                      the engine returns to the last received one afterwards),
             tail: false to stop exactly at the end of the music (default true: let the sound ring out),
             data: true to get the mix back in renderDone.data as a base64 WAV (24-bit, stereo, engine rate) instead of a
                   file; path is then empty and stems are ignored }
    The music ends when the playhead first reaches the end of the song (seq.end or the loop region) or of the pattern. */
void Engine::startRender (const var& msg)
{
    if (renderThread != nullptr && renderThread->isThreadRunning())
        return;
    const bool toData = (bool) msg["data"], tail = (bool) msg.getProperty ("tail", true);
    const juce::File outFile = toData ? juce::File() : juce::File (msg["path"].toString());
    const var req = msg["req"];
    const auto format = toData || msg["format"].toString().isEmpty() ? juce::String ("wav") : msg["format"].toString();
    const int bits = toData ? 24 : (format == "ogg" ? 16 : juce::jlimit (16, format == "flac" ? 24 : 32, (int) num (msg["bits"], 24.0)));
    const int quality = juce::jlimit (0, 10, (int) num (msg["quality"], 6.0));
    std::vector<std::pair<int, juce::String>> stems;
    if (const auto* st = msg["stems"].getArray(); st != nullptr && ! toData)
        for (const auto& x : *st)
        {
            const int i = (int) num (x["i"], -1.0);
            if (juce::isPositiveAndBelow (i, numInserts))
                stems.push_back ({ i, x["name"].toString() });
        }
    const bool writeMaster = stems.empty() || (bool) msg["master"];
    // Build the notes for the requested mode, then render on a background thread while the
    // realtime callback outputs silence (it cannot take renderLock).
    auto renderUi = var (new juce::DynamicObject());
    renderUi.getDynamicObject()->setProperty ("mode", msg["mode"]);
    renderUi.getDynamicObject()->setProperty ("pattern", msg["pattern"]);
    renderUi.getDynamicObject()->setProperty ("metro", false);
    applyProject (msg["project"].isObject() ? msg["project"] : lastProject, renderUi, false);
    std::weak_ptr<int> alive = lifeToken;
    finishRecording();

    renderThread = std::make_unique<RenderJob> ([this, outFile, req, alive, format, bits, quality, stems, writeMaster, toData, tail] (juce::Thread& thread)
    {
        bool ok = false;
        juce::String error, data;
        double seconds = 0.0;
        int files = 0;
        {
            const juce::ScopedLock sl (renderLock);
            auto* s = current.load();
            std::vector<juce::AudioProcessor*> procs;
            for (auto& c : s->channels)
                if (c.slot != nullptr)
                    procs.push_back (c.slot->proc.get());
            for (auto& ins : s->inserts)
            {
                for (auto* fx : ins.fx)
                    if (fx != nullptr)
                        procs.push_back (fx->proc.get());
                if (ins.eq != nullptr)
                    procs.push_back (ins.eq->proc.get());
            }
            for (auto* p : procs)
                p->setNonRealtime (true);
            logging = false;
            rendering = true;

            std::unique_ptr<juce::AudioFormat> fmt;
            if (format == "flac")
                fmt = std::make_unique<juce::FlacAudioFormat>();
            else if (format == "ogg")
                fmt = std::make_unique<juce::OggVorbisAudioFormat>();
            else
                fmt = std::make_unique<juce::WavAudioFormat>();
            auto makeWriter = [&] (std::unique_ptr<juce::OutputStream> stream) -> std::unique_ptr<juce::AudioFormatWriter>
            {
                auto opts = juce::AudioFormatWriterOptions{}.withSampleRate (sampleRate).withNumChannels (2).withBitsPerSample (bits);
                if (format == "wav" && bits == 32)
                    opts = opts.withSampleFormat (juce::AudioFormatWriterOptions::SampleFormat::floatingPoint);
                if (format == "ogg")
                    opts = opts.withQualityOptionIndex (quality);
                return fmt->createWriterFor (stream, opts);
            };
            auto makeFileWriter = [&] (const juce::File& f)
            {
                f.deleteFile();
                return makeWriter (std::make_unique<juce::FileOutputStream> (f));
            };
            juce::MemoryBlock wav;  // data: the WAV file, complete once its writer is deleted
            std::unique_ptr<juce::AudioFormatWriter> masterWriter;
            std::vector<std::pair<int, std::unique_ptr<juce::AudioFormatWriter>>> stemWriters;
            if (writeMaster)
            {
                masterWriter = toData ? makeWriter (std::make_unique<juce::MemoryOutputStream> (wav, false)) : makeFileWriter (outFile);
                if (masterWriter == nullptr)
                    error = toData ? juce::String ("Impossibile preparare l'audio") : "Impossibile scrivere il file " + outFile.getFullPathName();
            }
            const auto base = outFile.getFileNameWithoutExtension(), ext = outFile.getFileExtension();
            for (const auto& [i, name] : stems)
            {
                const auto f = outFile.getSiblingFile (base + " - " + juce::String (i).paddedLeft ('0', 3) + " " + safeFileName (name) + ext);
                if (auto w = makeFileWriter (f))
                    stemWriters.emplace_back (i, std::move (w));
                else
                    error = "Impossibile scrivere il file " + f.getFullPathName();
            }
            if (error.isEmpty())
            {
                const double sps = s->bpm / 60.0 * 4.0 / sampleRate;
                const double from = s->minPos, span = std::max (1.0e-9, s->loopLength - from);
                // the music normally ends when the playhead reaches the end; this cap only stops jumps that never get there
                const auto cap = (juce::int64) std::ceil (((double) s->jumps.size() + 1.0) * s->loopLength / sps) + blockSize;
                const auto maxTail = (juce::int64) (sampleRate * 6.0);
                std::vector<float> left ((size_t) blockSize), right ((size_t) blockSize);
                float* outs[2] = { left.data(), right.data() };
                // fresh transport for the render: whatever still sounds is choked in a short pre-roll that is not written
                seenPlay = playRequest.load();
                seenStop = stopRequest.load();
                playingAudio = false;
                silenceVoices = true;
                for (int k = (int) std::ceil (0.03 * sampleRate / blockSize); k > 0; --k)
                    processBlock (nullptr, 0, outs, 2, blockSize);
                pos = 0.0;
                numPendingOffs = 0;
                playingAudio = true;
                clearAutomationOverrides (*s);
                juce::int64 done = 0, musicEnd = -1, quietRun = 0;
                int lastPct = -1;
                while (! thread.threadShouldExit())
                {
                    const int n = blockSize;
                    renderEnd = -1;
                    processBlock (nullptr, 0, outs, 2, n);
                    int keep = n;
                    if (musicEnd < 0 && (renderEnd >= 0 || done + n >= cap))
                    {
                        const int at = renderEnd >= 0 ? renderEnd : (int) (cap - done);
                        musicEnd = done + at;
                        playingAudio = false;  // notes already scheduled still get their note offs; tails ring out
                        if (! tail)
                            keep = at;
                    }
                    if (masterWriter != nullptr)
                        masterWriter->writeFromFloatArrays (outs, 2, keep);
                    for (auto& [i, w] : stemWriters)
                        w->writeFromAudioSampleBuffer (busBuffers[(size_t) i], 0, keep);
                    done += keep;
                    if (musicEnd >= 0)
                    {
                        if (! tail)
                            break;
                        float pk = 0.0f;
                        for (int i = 0; i < n; ++i)
                            pk = std::max ({ pk, std::abs (left[(size_t) i]), std::abs (right[(size_t) i]) });
                        quietRun = pk < 1.0e-4f ? quietRun + n : 0;
                        if (quietRun > (juce::int64) (sampleRate * 0.3) || done - musicEnd > maxTail)
                            break;
                    }
                    const int pct = musicEnd >= 0 ? 100 : (int) (100.0 * juce::jlimit (0.0, 1.0, (pos - from) / span)) / 5 * 5;
                    if (pct != lastPct)
                    {
                        lastPct = pct;
                        juce::MessageManager::callAsync ([this, alive, req, pct]
                        {
                            if (! alive.expired())
                                send (object ({ { "t", "renderProgress" }, { "req", req }, { "progress", pct } }));
                        });
                    }
                }
                masterWriter.reset();
                files = toData ? 0 : (writeMaster ? 1 : 0) + (int) stemWriters.size();
                stemWriters.clear();
                seconds = (double) done / sampleRate;
                ok = ! thread.threadShouldExit();
                if (ok && toData)
                    data = toBase64 (wav);
                playingAudio = false;
                pos = 0.0;
                numPendingOffs = 0;
                silenceVoices = true;  // notes cut by tail:false stop in the next block
                clearAutomationOverrides (*s);
            }
            for (auto* p : procs)
                p->setNonRealtime (false);
            logging = true;
            rendering = false;
        }
        juce::MessageManager::callAsync ([this, alive, req, ok, error, seconds, files, data, path = outFile.getFullPathName()]
        {
            if (alive.expired())
                return;
            applyProject (lastProject, lastUi);  // back to the page's project (the render's own one was not remembered)
            auto done = object ({ { "t", "renderDone" }, { "req", req }, { "ok", ok }, { "error", error }, { "path", path },
                                  { "seconds", seconds }, { "files", files } });
            if (data.isNotEmpty())
                done.getDynamicObject()->setProperty ("data", data);
            send (done);
        });
    });
    renderThread->startThread();
}

} // namespace ritmo
