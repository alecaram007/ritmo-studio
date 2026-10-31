#include "PluginHost.h"
#include <thread>

namespace ritmo
{
namespace
{
class PluginWindow final : public juce::DocumentWindow
{
public:
    PluginWindow (const juce::String& title, juce::AudioProcessorEditor* editor, std::function<void()> closed)
        : DocumentWindow (title, juce::Colour (0xff2b363d), DocumentWindow::closeButton | DocumentWindow::minimiseButton),
          onClose (std::move (closed))
    {
        setUsingNativeTitleBar (true);
        setContentOwned (editor, true);
        setResizable (editor->isResizable(), false);
        centreWithSize (getWidth(), getHeight());
        setVisible (true);
    }

    void closeButtonPressed() override
    {
        if (onClose)
            onClose();
    }

private:
    std::function<void()> onClose;
};

void post (std::function<void (const juce::var&)> callback, juce::var value)
{
    if (callback)
        juce::MessageManager::callAsync ([fn = std::move (callback), v = std::move (value)] { fn (v); });
}
} // namespace

juce::File PluginHost::dataFolder()
{
    auto f = juce::File::getSpecialLocation (juce::File::userApplicationDataDirectory);
   #if JUCE_MAC
    f = f.getChildFile ("Application Support");
   #endif
    f = f.getChildFile ("Ritmo Studio").getChildFile ("engine");
    f.createDirectory();
    return f;
}

PluginHost::PluginHost() : juce::Thread ("Plugin scan")
{
    juce::addDefaultFormatsToManager (formats);
    // One list per CPU architecture: on Apple Silicon the Intel build (under Rosetta) can load Intel-only
    // plug-ins that the native build had to skip, and the other way round.
   #if defined (__aarch64__) || defined (__arm64__) || defined (_M_ARM64)
    cacheFile = dataFolder().getChildFile ("plugins-arm64.xml");
   #else
    cacheFile = dataFolder().getChildFile ("plugins-x64.xml");
   #endif
    if (auto xml = juce::XmlDocument::parse (cacheFile))
        known.recreateFromXml (*xml);
}

PluginHost::~PluginHost()
{
    stopThread (40000);
    closeAllEditors();
}

juce::var PluginHost::describe (const juce::PluginDescription& d)
{
    auto* o = new juce::DynamicObject();
    o->setProperty ("id", d.createIdentifierString());
    o->setProperty ("name", d.name);
    o->setProperty ("vendor", d.manufacturerName);
    o->setProperty ("format", d.pluginFormatName);
    o->setProperty ("category", d.category);
    o->setProperty ("version", d.version);
    o->setProperty ("isInstrument", d.isInstrument);
    o->setProperty ("file", d.fileOrIdentifier);
    return juce::var (o);
}

juce::var PluginHost::describeAll() const
{
    auto types = known.getTypes();
    std::sort (types.begin(), types.end(), [] (const auto& a, const auto& b) { return a.name.compareIgnoreCase (b.name) < 0; });
    juce::Array<juce::var> list;
    for (const auto& d : types)
        list.add (describe (d));
    return list;
}

std::optional<juce::PluginDescription> PluginHost::find (const juce::String& identifier) const
{
    for (const auto& d : known.getTypes())
        if (d.createIdentifierString() == identifier)
            return d;
    return std::nullopt;
}

void PluginHost::startScan (bool force, std::function<void (const juce::var&)> onEvent)
{
    if (isThreadRunning())
        return;
    forceScan = force;
    scanEvents = std::move (onEvent);
    startThread();
}

void PluginHost::run()
{
    struct Job
    {
        juce::String formatName, id;
    };
    std::vector<Job> jobs;
    const auto blacklist = known.getBlacklistedFiles();
    if (forceScan)
        known.clearBlacklistedFiles();

    for (auto* fmt : formats.getFormats())
    {
        if (! fmt->canScanForPlugins())
            continue;
        for (const auto& id : fmt->searchPathsForPlugins (fmt->getDefaultLocationsToSearch(), true, false))
        {
            if (! forceScan && (known.isListingUpToDate (id, *fmt) || blacklist.contains (id)))
                continue;
            jobs.push_back ({ fmt->getName(), id });
        }
    }

    const auto total = (int) jobs.size();
    {
        auto* o = new juce::DynamicObject();
        o->setProperty ("t", "scanStart");
        o->setProperty ("total", total);
        post (scanEvents, juce::var (o));
    }

    const auto exe = juce::File::getSpecialLocation (juce::File::currentExecutableFile);
    std::atomic<int> next { 0 }, done { 0 };

    auto worker = [&]
    {
        for (;;)
        {
            const int i = next++;
            if (i >= total || threadShouldExit())
                return;
            const auto& job = jobs[(size_t) i];
            auto out = juce::File::createTempFile (".xml");
            juce::ChildProcess child;
            bool ok = child.start (juce::StringArray { exe.getFullPathName(), "--scan-one", job.formatName, job.id, out.getFullPathName() }, 0);
            if (ok && ! child.waitForProcessToFinish (45000))
            {
                child.kill();
                ok = false;
            }
            int added = 0;
            if (ok)
                if (auto xml = juce::XmlDocument::parse (out))
                    for (auto* e : xml->getChildIterator())
                    {
                        juce::PluginDescription d;
                        if (d.loadFromXml (*e))
                        {
                            const juce::ScopedLock sl (listLock);
                            known.addType (d);
                            ++added;
                        }
                    }
            out.deleteFile();
            if (added == 0)
            {
                const juce::ScopedLock sl (listLock);
                known.addToBlacklist (job.id);
            }
            const int n = ++done;
            auto* o = new juce::DynamicObject();
            o->setProperty ("t", "scanProgress");
            o->setProperty ("done", n);
            o->setProperty ("total", total);
            o->setProperty ("current", juce::File::isAbsolutePath (job.id) ? juce::File (job.id).getFileNameWithoutExtension() : job.id);
            post (scanEvents, juce::var (o));
        }
    };

    std::vector<std::thread> pool;
    const int numWorkers = juce::jlimit (1, 6, juce::SystemStats::getNumCpus() / 2);
    for (int w = 0; w < numWorkers; ++w)
        pool.emplace_back (worker);
    for (auto& t : pool)
        t.join();

    saveCache();
    auto* o = new juce::DynamicObject();
    o->setProperty ("t", "plugins");
    o->setProperty ("list", describeAll());
    o->setProperty ("scanned", total);
    post (scanEvents, juce::var (o));
}

void PluginHost::saveCache()
{
    const juce::ScopedLock sl (listLock);
    if (auto xml = known.createXml())
        xml->writeTo (cacheFile);
}

void PluginHost::createInstance (const juce::PluginDescription& desc, double sampleRate, int blockSize,
                                 std::function<void (std::unique_ptr<juce::AudioPluginInstance>, const juce::String&)> onDone)
{
    formats.createPluginInstanceAsync (desc, sampleRate, blockSize,
                                       [done = std::move (onDone)] (std::unique_ptr<juce::AudioPluginInstance> instance, const juce::String& error)
                                       { done (std::move (instance), error); });
}

bool PluginHost::openEditor (juce::AudioProcessor& proc, const juce::String& title)
{
    juce::Process::makeForegroundProcess();
    if (auto it = windows.find (&proc); it != windows.end())
    {
        it->second->setVisible (true);
        it->second->toFront (true);
        return true;
    }
    juce::AudioProcessorEditor* editor = proc.hasEditor() ? proc.createEditorAndMakeActive() : nullptr;
    if (editor == nullptr)
        editor = new juce::GenericAudioProcessorEditor (proc);
    auto* p = &proc;
    auto window = std::make_unique<PluginWindow> (title, editor, [this, p] { juce::MessageManager::callAsync ([this, p] { closeEditor (*p); }); });
    window->toFront (true);
    windows[&proc] = std::move (window);
    return true;
}

void PluginHost::closeEditor (juce::AudioProcessor& proc)
{
    windows.erase (&proc);
}

void PluginHost::closeAllEditors()
{
    windows.clear();
}

int PluginHost::runScanOne (const juce::String& formatName, const juce::String& fileOrIdentifier, const juce::File& outFile)
{
    juce::AudioPluginFormatManager fm;
    juce::addDefaultFormatsToManager (fm);
    for (auto* f : fm.getFormats())
    {
        if (f->getName() != formatName)
            continue;
        juce::OwnedArray<juce::PluginDescription> found;
        f->findAllTypesForFile (found, fileOrIdentifier);
        juce::XmlElement root ("PLUGINS");
        for (auto* d : found)
            root.addChildElement (d->createXml().release());
        root.writeTo (outFile);
        return found.isEmpty() ? 2 : 0;
    }
    return 3;
}

} // namespace ritmo
