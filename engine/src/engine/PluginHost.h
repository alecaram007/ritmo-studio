#pragma once
/*
    Ritmo Engine — third-party plug-ins: formats, scanning, instantiation and editor windows.

    Scanning runs each plug-in file in a short-lived child process (this same executable started with
    --scan-one), so a plug-in that crashes or hangs while being scanned only costs that child; it is then
    skipped on later scans. Results are cached in the user's application-data folder.
*/
#include <juce_audio_utils/juce_audio_utils.h>
#include <functional>
#include <map>

namespace ritmo
{

class PluginHost final : private juce::Thread
{
public:
    PluginHost();
    ~PluginHost() override;

    juce::AudioPluginFormatManager formats;
    juce::KnownPluginList known;

    /** The plug-in list as JSON for the UI. */
    juce::var describeAll() const;
    static juce::var describe (const juce::PluginDescription&);
    std::optional<juce::PluginDescription> find (const juce::String& identifier) const;

    /** Starts a background scan. `force` rescans everything, including plug-ins that failed before. */
    void startScan (bool force, std::function<void (const juce::var&)> onEvent);
    bool isScanning() const { return isThreadRunning(); }

    void createInstance (const juce::PluginDescription&, double sampleRate, int blockSize,
                         std::function<void (std::unique_ptr<juce::AudioPluginInstance>, const juce::String& error)>);

    /** Opens (or brings forward) the plug-in's own editor window. Message thread. */
    bool openEditor (juce::AudioProcessor& proc, const juce::String& title);
    void closeEditor (juce::AudioProcessor& proc);
    void closeAllEditors();

    /** Child-process entry point: scans one plug-in and writes its descriptions to `outFile`. */
    static int runScanOne (const juce::String& formatName, const juce::String& fileOrIdentifier, const juce::File& outFile);

    static juce::File dataFolder();

private:
    juce::File cacheFile;
    juce::CriticalSection listLock;
    bool forceScan = false;
    std::function<void (const juce::var&)> scanEvents;
    std::map<juce::AudioProcessor*, std::unique_ptr<juce::DocumentWindow>> windows;

    void run() override;
    void saveCache();
};

} // namespace ritmo
