/*
    Ritmo Engine — entry point.

    Normal run:   "Ritmo Engine" --token <secret>
                  Listens on 127.0.0.1 (a free port), prints "RITMO_ENGINE_PORT <n>" on stdout, accepts one
                  connection whose first message must carry the token, and quits when that connection closes.
    Scanner run:  "Ritmo Engine" --scan-one <format> <fileOrIdentifier> <outFile>
                  Used by PluginHost to scan a single plug-in in its own process.

    Messages are JSON objects framed by juce::InterprocessConnection: uint32 magic 0x524D5452 ("RTMR" little-endian),
    uint32 payload size, UTF-8 payload.
*/
#include "Engine.h"
#include "PluginHost.h"
#include <iostream>

namespace ritmo
{
constexpr juce::uint32 messageMagic = 0x524d5452;

class Connection final : public juce::InterprocessConnection
{
public:
    Connection (juce::String expectedToken, std::function<void (const juce::var&)> onMessage, std::function<void()> onLost)
        : juce::InterprocessConnection (true, messageMagic), token (std::move (expectedToken)),
          handle (std::move (onMessage)), lost (std::move (onLost)) {}

    ~Connection() override { disconnect(); }

    void connectionMade() override {}
    void connectionLost() override
    {
        if (lost)
            lost();
    }

    void messageReceived (const juce::MemoryBlock& data) override
    {
        const auto msg = juce::JSON::parse (data.toString());
        if (! authenticated)
        {
            if (msg["t"].toString() == "hello" && msg["token"].toString() == token)
                authenticated = true;
            else
                disconnect();
            return;
        }
        handle (msg);
    }

    void sendJson (const juce::var& v)
    {
        if (! authenticated)
            return;
        const auto text = juce::JSON::toString (v, juce::JSON::FormatOptions {}.withSpacing (juce::JSON::Spacing::none));
        sendMessage (juce::MemoryBlock (text.toRawUTF8(), text.getNumBytesAsUTF8()));
    }

private:
    juce::String token;
    std::function<void (const juce::var&)> handle;
    std::function<void()> lost;
    bool authenticated = false;
};

class Server final : public juce::InterprocessConnectionServer
{
public:
    std::function<juce::InterprocessConnection*()> factory;
    juce::InterprocessConnection* createConnectionObject() override { return factory ? factory() : nullptr; }
};

class RitmoEngineApplication final : public juce::JUCEApplication
{
public:
    const juce::String getApplicationName() override { return "Ritmo Engine"; }
    const juce::String getApplicationVersion() override { return JUCE_APPLICATION_VERSION_STRING; }
    bool moreThanOneInstanceAllowed() override { return true; }

    void initialise (const juce::String&) override
    {
        const auto args = getCommandLineParameterArray();
        if (const int i = args.indexOf ("--scan-one"); i >= 0)
        {
            // Scan once the event loop runs: some plug-ins (e.g. Arturia's) crash if loaded before the app has finished launching.
            juce::MessageManager::callAsync ([this, format = args[i + 1], id = args[i + 2], out = juce::File (args[i + 3])]
            {
                setApplicationReturnValue (PluginHost::runScanOne (format, id, out));
                quit();
            });
            return;
        }
        juce::String token;
        if (const int i = args.indexOf ("--token"); i >= 0)
            token = args[i + 1];
        if (token.isEmpty())
        {
            std::cerr << "Ritmo Engine: missing --token" << std::endl;
            setApplicationReturnValue (2);
            quit();
            return;
        }

        host = std::make_unique<PluginHost>();
        engine = std::make_unique<Engine> (*host, [this] (const juce::var& v)
        {
            if (connection != nullptr)
                connection->sendJson (v);
        });

        server.factory = [this, token]() -> juce::InterprocessConnection*
        {
            // Called on the listener thread: hand the connection to the message thread.
            if (connectionCreated.exchange (true))
                return nullptr;
            auto* c = new Connection (
                token,
                [this] (const juce::var& msg) { onMessage (msg); },
                [] { juce::MessageManager::callAsync ([] { juce::JUCEApplication::getInstance()->systemRequestedQuit(); }); });
            juce::MessageManager::callAsync ([this, c] { connection.reset (c); });
            return c;
        };
        if (! server.beginWaitingForSocket (0, "127.0.0.1"))
        {
            std::cerr << "Ritmo Engine: cannot open a local socket" << std::endl;
            setApplicationReturnValue (3);
            quit();
            return;
        }
        std::cout << "RITMO_ENGINE_PORT " << server.getBoundPort() << std::endl;

        const auto audioError = engine->startAudio();
        if (audioError.isNotEmpty())
            std::cerr << "Ritmo Engine: audio device error: " << audioError << std::endl;
        startupError = audioError;

        // Quit if the app never connects (for example, it crashed while starting us).
        juce::Timer::callAfterDelay (20000, [this] { if (connection == nullptr) systemRequestedQuit(); });
    }

    void onMessage (const juce::var& msg)
    {
        if (msg["t"].toString() == "hello")
            return;
        if (msg["t"].toString() == "init")
        {
            auto* o = new juce::DynamicObject();
            o->setProperty ("t", "ready");
            o->setProperty ("version", getApplicationVersion());
            o->setProperty ("audioError", startupError);
            juce::StringArray fmts;
            for (auto* f : host->formats.getFormats())
                fmts.add (f->getName());
            o->setProperty ("formats", fmts.joinIntoString (", "));
            connection->sendJson (juce::var (o));
            connection->sendJson (engine->deviceInfo());
            return;
        }
        engine->handleMessage (msg);
    }

    void shutdown() override
    {
        server.stop();
        engine.reset();
        connection.reset();
        host.reset();
    }

    void systemRequestedQuit() override { quit(); }
    void anotherInstanceStarted (const juce::String&) override {}

private:
    std::unique_ptr<PluginHost> host;
    std::unique_ptr<Engine> engine;
    std::unique_ptr<Connection> connection;
    std::atomic<bool> connectionCreated { false };
    Server server;
    juce::String startupError;
};

} // namespace ritmo

START_JUCE_APPLICATION (ritmo::RitmoEngineApplication)
