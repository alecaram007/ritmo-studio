cmake_minimum_required(VERSION 3.22)

# Ritmo Engine: the native audio engine of Ritmo Studio. It plays the sequencer, the built-in
# instruments and effects, and hosts third-party plug-ins (VST3, AU, LV2, LADSPA, CLAP).
# The Electron app starts it as a helper process and drives it over a local socket.
project(RitmoEngine VERSION 1.4.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)
if(APPLE)
  set(CMAKE_OSX_DEPLOYMENT_TARGET "11.0" CACHE STRING "Minimum macOS version")
endif()

# Windows: link the C runtime statically so the engine runs without the Visual C++ Redistributable.
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")

add_subdirectory(third_party/JUCE)

set(RITMO_BUILTINS_DIR "${CMAKE_CURRENT_SOURCE_DIR}/src/builtins" CACHE PATH "Folder with the built-in instruments and effects sources")
file(GLOB RITMO_BUILTIN_SOURCES CONFIGURE_DEPENDS ${RITMO_BUILTINS_DIR}/*.cpp)
file(GLOB RITMO_ENGINE_SOURCES CONFIGURE_DEPENDS ${CMAKE_CURRENT_SOURCE_DIR}/src/engine/*.cpp)

set(RITMO_COMMON_DEFINITIONS
  JUCE_WEB_BROWSER=0
  JUCE_USE_CURL=0
  JUCE_USE_MP3AUDIOFORMAT=1
  JUCE_USE_FLAC=1
  JUCE_USE_OGGVORBIS=1
  JUCE_MODAL_LOOPS_PERMITTED=0
  JUCE_STRICT_REFCOUNTEDPOINTER=1
)

# ---------- The engine (helper app, no Dock icon) ----------
juce_add_gui_app(RitmoEngine
  PRODUCT_NAME "Ritmo Engine"
  COMPANY_NAME "Ritmo Studio"
  BUNDLE_ID app.ritmostudio.engine
  VERSION ${PROJECT_VERSION}
  MICROPHONE_PERMISSION_ENABLED TRUE
  MICROPHONE_PERMISSION_TEXT "Ritmo Studio usa gli ingressi audio per registrare e per i plugin che li richiedono."
  PLIST_TO_MERGE "<plist><dict><key>LSUIElement</key><true/></dict></plist>")

target_sources(RitmoEngine PRIVATE ${RITMO_ENGINE_SOURCES} ${RITMO_BUILTIN_SOURCES})
target_include_directories(RitmoEngine PRIVATE src)
target_compile_definitions(RitmoEngine PRIVATE
  ${RITMO_COMMON_DEFINITIONS}
  JUCE_APPLICATION_NAME_STRING="$<TARGET_PROPERTY:RitmoEngine,JUCE_PRODUCT_NAME>"
  JUCE_APPLICATION_VERSION_STRING="$<TARGET_PROPERTY:RitmoEngine,JUCE_VERSION>"
  JUCE_PLUGINHOST_VST3=1
  JUCE_PLUGINHOST_LV2=1
  $<$<PLATFORM_ID:Darwin>:JUCE_PLUGINHOST_AU=1>
  $<$<PLATFORM_ID:Linux>:JUCE_PLUGINHOST_LADSPA=1>
  JUCE_PLUGINHOST_ARA=0)
target_link_libraries(RitmoEngine
  PRIVATE
    juce::juce_audio_utils
    juce::juce_audio_processors
    juce::juce_audio_formats
    juce::juce_dsp
  PUBLIC
    juce::juce_recommended_config_flags
    juce::juce_recommended_lto_flags
    juce::juce_recommended_warning_flags)

# ---------- Offline test of the built-in instruments and effects ----------
juce_add_console_app(ritmo_builtins_test PRODUCT_NAME "ritmo_builtins_test")
target_sources(ritmo_builtins_test PRIVATE tests/BuiltinsTest.cpp ${RITMO_BUILTIN_SOURCES})
target_include_directories(ritmo_builtins_test PRIVATE src)
target_compile_definitions(ritmo_builtins_test PRIVATE ${RITMO_COMMON_DEFINITIONS})
target_link_libraries(ritmo_builtins_test
  PRIVATE
    juce::juce_audio_processors
    juce::juce_audio_formats
    juce::juce_dsp
  PUBLIC
    juce::juce_recommended_config_flags
    juce::juce_recommended_warning_flags)
