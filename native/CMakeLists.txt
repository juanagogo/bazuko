cmake_minimum_required(VERSION 3.25)
project(bazuko VERSION 0.1.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

# Dependencias antiguas (doctest) declaran un CMake mínimo que CMake 4 rechaza.
set(CMAKE_POLICY_VERSION_MINIMUM 3.5)

include(FetchContent)
set(FETCHCONTENT_QUIET OFF)

option(BAZUKO_BUILD_APP "Compila el ejecutable con ventana (requiere SDL3)" ON)
option(BAZUKO_GPU_TESTS "Añade pruebas de humo que abren una ventana OpenGL" OFF)

FetchContent_Declare(doctest
  GIT_REPOSITORY https://github.com/doctest/doctest.git
  GIT_TAG v2.4.11
  GIT_SHALLOW TRUE)
FetchContent_MakeAvailable(doctest)

FetchContent_Declare(glm
  GIT_REPOSITORY https://github.com/g-truc/glm.git
  GIT_TAG 1.0.1
  GIT_SHALLOW TRUE)
FetchContent_MakeAvailable(glm)

FetchContent_Declare(json
  GIT_REPOSITORY https://github.com/nlohmann/json.git
  GIT_TAG v3.11.3
  GIT_SHALLOW TRUE)
FetchContent_MakeAvailable(json)

# miniaudio (un solo archivo) y Dear ImGui (con los backends de SDL3 y OpenGL 3).
FetchContent_Declare(miniaudio
  GIT_REPOSITORY https://github.com/mackron/miniaudio.git
  GIT_TAG 0.11.24
  GIT_SHALLOW TRUE)
FetchContent_MakeAvailable(miniaudio)
FetchContent_Declare(imgui
  GIT_REPOSITORY https://github.com/ocornut/imgui.git
  GIT_TAG v1.91.9
  GIT_SHALLOW TRUE)
FetchContent_MakeAvailable(imgui)

if(BAZUKO_BUILD_APP)
  # SDL3: usa el paquete del sistema (dnf install SDL3-devel) o lo compila desde fuente.
  find_package(SDL3 3.2 QUIET CONFIG)
  if(NOT SDL3_FOUND)
    message(STATUS "SDL3 no encontrado en el sistema: se descarga con FetchContent")
    FetchContent_Declare(SDL3
      GIT_REPOSITORY https://github.com/libsdl-org/SDL.git
      GIT_TAG release-3.2.28
      GIT_SHALLOW TRUE)
    set(SDL_TEST_LIBRARY OFF CACHE BOOL "" FORCE)
    FetchContent_MakeAvailable(SDL3)
  endif()
endif()

# Lógica sin dependencias de GL/SDL (testeable en consola).
add_library(bazuko_core STATIC
  src/core/FrameMetrics.cpp
  src/core/FrameLoop.cpp
  src/game/data/GameData.cpp
  src/game/systems/TalentSystem.cpp
  src/game/systems/DiseaseSystem.cpp
  src/game/systems/StatsSystem.cpp
  src/game/systems/InventorySystem.cpp
  src/game/systems/CraftingSystem.cpp
  src/game/systems/Survival.cpp
  src/game/systems/SaveSystem.cpp
  src/game/Entities.cpp
  src/game/Interaction.cpp
  src/game/Places.cpp
  src/game/UiText.cpp
  src/world/StreetLayout.cpp
  src/world/TileMap.cpp
  src/world/CityLayout.cpp
  src/world/CollisionWorld.cpp
  src/world/TrafficRoute.cpp
  src/world/TrafficSystem.cpp
  src/world/BusService.cpp
  src/world/PedestrianNavigation.cpp
  src/world/PedestrianAgent.cpp
  src/world/Bogota.cpp
  src/core/Input.cpp
  src/core/AdaptiveResolution.cpp
  src/game/Lighting.cpp
  src/game/CameraRig.cpp
  src/game/PlayerMotor.cpp)
target_include_directories(bazuko_core PUBLIC src)
target_link_libraries(bazuko_core PUBLIC nlohmann_json::nlohmann_json)
target_compile_options(bazuko_core PRIVATE -Wall -Wextra)

find_package(PkgConfig REQUIRED)
pkg_check_modules(WEBP REQUIRED IMPORTED_TARGET libwebp)

# Gráficos en CPU (mallas, canvas 2D, texturas procedurales, mundo visual): sin GL ni SDL, testeables.
add_library(bazuko_gfx STATIC
  src/render/MeshBuilder.cpp
  src/render/Canvas2D.cpp
  src/render/ProceduralTextures.cpp
  src/render/BuildingVisibility.cpp
  src/render/Frustum.cpp
  src/render/Shadow.cpp
  src/render/VisualWorld.cpp
  src/render/VisualProps.cpp
  src/character/Gltf.cpp
  src/character/Rig.cpp
  src/character/Retarget.cpp
  src/character/Animator.cpp
  src/character/Look.cpp
  src/character/Catalog.cpp
  src/character/CharacterLibrary.cpp
  src/character/Character.cpp
  src/character/ProceduralCharacter.cpp)
target_include_directories(bazuko_gfx PUBLIC src)
target_include_directories(bazuko_gfx SYSTEM PUBLIC third_party/stb)
# Modelos y texturas de personajes: los de native/assets si existen; si no, los del juego web (mismo repositorio).
if(EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/assets/models")
  set(BAZUKO_MODELS_DIR "${CMAKE_CURRENT_SOURCE_DIR}/assets/models")
else()
  set(BAZUKO_MODELS_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../public/models")
endif()
target_compile_definitions(bazuko_gfx PUBLIC BAZUKO_ASSETS_DIR="${CMAKE_CURRENT_SOURCE_DIR}/assets"
                                              BAZUKO_MODELS_DIR="${BAZUKO_MODELS_DIR}")
target_link_libraries(bazuko_gfx PUBLIC bazuko_core glm::glm PkgConfig::WEBP)
target_compile_options(bazuko_gfx PRIVATE -Wall -Wextra)

# Audio: efectos y ambiente. Los WAV son del juego web (en LFS: `git lfs pull`); sin ellos el juego queda en silencio.
if(EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/assets/audio")
  set(BAZUKO_AUDIO_DIR "${CMAKE_CURRENT_SOURCE_DIR}/assets/audio")
else()
  set(BAZUKO_AUDIO_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../public/audio")
endif()
add_library(bazuko_audio STATIC src/audio/AudioEngine.cpp)
target_include_directories(bazuko_audio PUBLIC src)
target_include_directories(bazuko_audio SYSTEM PRIVATE ${miniaudio_SOURCE_DIR})
target_compile_definitions(bazuko_audio PUBLIC BAZUKO_AUDIO_DIR="${BAZUKO_AUDIO_DIR}")
target_link_libraries(bazuko_audio PRIVATE ${CMAKE_DL_LIBS} m Threads::Threads)
find_package(Threads REQUIRED)

add_executable(texdump tools/texdump.cpp)
target_link_libraries(texdump PRIVATE bazuko_gfx)

if(BAZUKO_BUILD_APP)
  add_library(bazuko_render STATIC
    third_party/glad/src/gl.c
    src/render/Gpu.cpp
    src/render/Renderer.cpp)
  target_include_directories(bazuko_render PUBLIC src)
  target_include_directories(bazuko_render SYSTEM PUBLIC third_party/glad/include)
  target_link_libraries(bazuko_render PUBLIC bazuko_gfx)
  target_compile_options(bazuko_render PRIVATE $<$<COMPILE_LANGUAGE:CXX>:-Wall -Wextra>)

  add_library(imgui_lib STATIC
    ${imgui_SOURCE_DIR}/imgui.cpp ${imgui_SOURCE_DIR}/imgui_draw.cpp ${imgui_SOURCE_DIR}/imgui_tables.cpp
    ${imgui_SOURCE_DIR}/imgui_widgets.cpp ${imgui_SOURCE_DIR}/backends/imgui_impl_sdl3.cpp
    ${imgui_SOURCE_DIR}/backends/imgui_impl_opengl3.cpp)
  target_include_directories(imgui_lib SYSTEM PUBLIC ${imgui_SOURCE_DIR} ${imgui_SOURCE_DIR}/backends)
  target_link_libraries(imgui_lib PUBLIC SDL3::SDL3)

  add_executable(bazuko src/main.cpp src/app/Game.cpp src/app/EntityModels.cpp src/app/Ui.cpp)
  target_include_directories(bazuko SYSTEM PRIVATE third_party/stb)
  target_compile_definitions(bazuko PRIVATE BAZUKO_DATA_DIR="${CMAKE_CURRENT_SOURCE_DIR}/data")
  target_link_libraries(bazuko PRIVATE bazuko_render bazuko_audio imgui_lib SDL3::SDL3)
  target_compile_options(bazuko PRIVATE -Wall -Wextra)
endif()

enable_testing()
add_executable(bazuko_tests tests/main_test.cpp tests/core_test.cpp tests/data_test.cpp tests/sim_test.cpp tests/save_test.cpp tests/world_test.cpp tests/traffic_test.cpp tests/render_logic_test.cpp tests/canvas_test.cpp tests/visual_test.cpp tests/lights_test.cpp tests/gltf_test.cpp tests/animation_test.cpp tests/character_test.cpp tests/procedural_test.cpp tests/game_test.cpp tests/audio_test.cpp tests/ui_test.cpp tests/integration_test.cpp)
target_compile_definitions(bazuko_tests PRIVATE BAZUKO_DATA_DIR="${CMAKE_CURRENT_SOURCE_DIR}/data")
target_link_libraries(bazuko_tests PRIVATE bazuko_gfx bazuko_audio doctest::doctest)
add_test(NAME bazuko_tests COMMAND bazuko_tests)

if(BAZUKO_BUILD_APP AND BAZUKO_GPU_TESTS)
  add_test(NAME smoke_screenshot
    COMMAND bazuko --screenshot ${CMAKE_CURRENT_BINARY_DIR}/smoke.png --frames 10 --hour 12 --seed 1)
  set_tests_properties(smoke_screenshot PROPERTIES PASS_REGULAR_EXPRESSION "captura: ")
endif()
