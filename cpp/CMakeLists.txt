cmake_minimum_required(VERSION 3.22)
project(bazuko_cpp VERSION 1.0.0 LANGUAGES C CXX)

if(NOT CMAKE_BUILD_TYPE AND NOT CMAKE_CONFIGURATION_TYPES)
    set(CMAKE_BUILD_TYPE Release CACHE STRING "Build type" FORCE)
endif()

include(FetchContent)
list(PREPEND CMAKE_MODULE_PATH "${CMAKE_CURRENT_SOURCE_DIR}/cmake")
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)
set(FETCHCONTENT_UPDATES_DISCONNECTED ON CACHE BOOL "Use pinned dependency revisions" FORCE)

if(MSVC)
    add_compile_options(/W4 /permissive-)
else()
    add_compile_options(-Wall -Wextra -Wpedantic -Wno-unused-parameter)
endif()

set(GLFW_BUILD_DOCS OFF CACHE BOOL "" FORCE)
set(GLFW_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(GLFW_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
if(WIN32 AND DEFINED ENV{WEBP_ROOT})
    find_path(WEBP_INCLUDE_DIR webp/decode.h HINTS "$ENV{WEBP_ROOT}/include" REQUIRED)
    find_library(WEBP_LIBRARY NAMES webp libwebp HINTS "$ENV{WEBP_ROOT}/lib" REQUIRED)
    add_library(bazuko_webp UNKNOWN IMPORTED)
    set_target_properties(bazuko_webp PROPERTIES IMPORTED_LOCATION "${WEBP_LIBRARY}" INTERFACE_INCLUDE_DIRECTORIES "${WEBP_INCLUDE_DIR}")
    set(BAZUKO_WEBP_TARGET bazuko_webp)
endif()

# En compilacion cruzada (MinGW) no se usan las librerias del sistema anfitrion
if(NOT CMAKE_CROSSCOMPILING)
    find_package(glfw3 3.3 QUIET)
    find_package(glm 0.9.9 QUIET)
endif()
if(NOT TARGET glfw)
    FetchContent_Declare(glfw GIT_REPOSITORY https://github.com/glfw/glfw.git GIT_TAG 3.4 GIT_SHALLOW TRUE)
endif()
if(NOT TARGET glm::glm)
    FetchContent_Declare(glm GIT_REPOSITORY https://github.com/g-truc/glm.git GIT_TAG 1.0.1 GIT_SHALLOW TRUE)
endif()
FetchContent_Declare(imgui GIT_REPOSITORY https://github.com/ocornut/imgui.git GIT_TAG v1.91.8 GIT_SHALLOW TRUE)
if(NOT TARGET glfw)
    FetchContent_MakeAvailable(glfw)
endif()
if(NOT TARGET glm::glm)
    FetchContent_MakeAvailable(glm)
endif()
FetchContent_MakeAvailable(imgui)

set(BUILD_TESTING OFF CACHE BOOL "" FORCE)
set(INSTALL_DOCS OFF CACHE BOOL "" FORCE)
set(INSTALL_PKG_CONFIG_MODULE OFF CACHE BOOL "" FORCE)
set(INSTALL_CMAKE_PACKAGE_MODULE OFF CACHE BOOL "" FORCE)
set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
set(OPUS_BUILD_TESTING OFF CACHE BOOL "" FORCE)
set(OPUS_BUILD_PROGRAMS OFF CACHE BOOL "" FORCE)
set(OPUS_BUILD_SHARED_LIBRARY OFF CACHE BOOL "" FORCE)
set(OPUS_INSTALL_PKG_CONFIG_MODULE OFF CACHE BOOL "" FORCE)
set(OPUS_INSTALL_CMAKE_CONFIG_MODULE OFF CACHE BOOL "" FORCE)
set(OP_DISABLE_HTTP ON CACHE BOOL "" FORCE)
set(OP_DISABLE_EXAMPLES ON CACHE BOOL "" FORCE)
set(OP_DISABLE_DOCS ON CACHE BOOL "" FORCE)
set(CMAKE_SKIP_INSTALL_RULES ON)
FetchContent_Declare(ogg
    GIT_REPOSITORY https://github.com/xiph/ogg.git
    GIT_TAG v1.3.6
    GIT_SHALLOW TRUE
)
FetchContent_Declare(opus
    GIT_REPOSITORY https://github.com/xiph/opus.git
    GIT_TAG v1.5.2
    GIT_SHALLOW TRUE
)
FetchContent_Declare(opusfile
    GIT_REPOSITORY https://github.com/xiph/opusfile.git
    GIT_TAG 3ecc22aa0a4430f61c2403d57370a089536d197a
)
FetchContent_MakeAvailable(ogg opus opusfile)
unset(CMAKE_SKIP_INSTALL_RULES)

add_library(glad STATIC third_party/glad/src/gl.c)
target_include_directories(glad PUBLIC third_party/glad/include)

add_library(imgui STATIC
    ${imgui_SOURCE_DIR}/imgui.cpp
    ${imgui_SOURCE_DIR}/imgui_draw.cpp
    ${imgui_SOURCE_DIR}/imgui_tables.cpp
    ${imgui_SOURCE_DIR}/imgui_widgets.cpp
    ${imgui_SOURCE_DIR}/backends/imgui_impl_glfw.cpp
    ${imgui_SOURCE_DIR}/backends/imgui_impl_opengl3.cpp
)
target_include_directories(imgui PUBLIC ${imgui_SOURCE_DIR} ${imgui_SOURCE_DIR}/backends)
target_link_libraries(imgui PUBLIC glfw glad)

find_package(Threads REQUIRED)
if(NOT BAZUKO_WEBP_TARGET)
    find_package(PkgConfig QUIET)
    if(PkgConfig_FOUND AND NOT CMAKE_CROSSCOMPILING)
        pkg_check_modules(WEBP QUIET IMPORTED_TARGET libwebp)
    endif()
    if(TARGET PkgConfig::WEBP)
        set(BAZUKO_WEBP_TARGET PkgConfig::WEBP)
    else()
        if(NOT CMAKE_CROSSCOMPILING)
            find_path(WEBP_INCLUDE_DIR webp/decode.h)
            find_library(WEBP_LIBRARY NAMES webp)
        endif()
        if(WEBP_INCLUDE_DIR AND WEBP_LIBRARY)
            add_library(bazuko_webp UNKNOWN IMPORTED)
            set_target_properties(bazuko_webp PROPERTIES IMPORTED_LOCATION "${WEBP_LIBRARY}" INTERFACE_INCLUDE_DIRECTORIES "${WEBP_INCLUDE_DIR}")
            set(BAZUKO_WEBP_TARGET bazuko_webp)
        else()
            # Sin libwebp instalada (p. ej. Windows sin WEBP_ROOT): se descarga y compila sola.
            message(STATUS "libwebp no esta instalada: se descarga y compila con FetchContent")
            foreach(opt ANIM_UTILS CWEBP DWEBP GIF2WEBP IMG2WEBP VWEBP WEBPINFO WEBPMUX EXTRAS LIBWEBPMUX)
                set(WEBP_BUILD_${opt} OFF CACHE BOOL "" FORCE)
            endforeach()
            FetchContent_Declare(libwebp GIT_REPOSITORY https://github.com/webmproject/libwebp.git GIT_TAG v1.4.0 GIT_SHALLOW TRUE)
            FetchContent_MakeAvailable(libwebp)
            set(BAZUKO_WEBP_TARGET webp)
            set(BAZUKO_WEBP_INCLUDE_DIR ${libwebp_SOURCE_DIR}/src)
        endif()
    endif()
endif()

add_executable(bazuko
    src/main.cpp
    src/audio/AudioManager.cpp
    src/core/Window.cpp src/core/Input.cpp src/core/Paths.cpp
    src/renderer/Buffer.cpp src/renderer/VertexArray.cpp src/renderer/Shader.cpp
    src/renderer/Mesh.cpp src/renderer/Camera.cpp src/renderer/Renderer.cpp
    src/renderer/Texture.cpp src/renderer/Model.cpp
    src/ui/UIManager.cpp src/ui/CharacterCreatorUI.cpp
    src/character/CharacterManager.cpp src/character/CharacterPreview.cpp src/character/Ragdoll.cpp
    src/world/CityLayout.cpp src/world/Simulation.cpp
    src/world/TextRaster.cpp src/world/SignAtlas.cpp
)
if(WIN32)
    set_target_properties(bazuko PROPERTIES WIN32_EXECUTABLE TRUE)
endif()
target_include_directories(bazuko PRIVATE src third_party/include third_party/glad/include ${BAZUKO_WEBP_INCLUDE_DIR})
target_compile_definitions(bazuko PRIVATE BAZUKO_SOURCE_DIR="${CMAKE_CURRENT_SOURCE_DIR}")
if(MINGW)
    target_link_options(bazuko PRIVATE -static -static-libgcc -static-libstdc++)
endif()
target_link_libraries(bazuko PRIVATE glfw glm::glm glad imgui Threads::Threads opusfile ${BAZUKO_WEBP_TARGET} ${CMAKE_DL_LIBS})

option(BAZUKO_BUILD_OPUS_TESTS "Build the Opus audio decoding smoke test" OFF)
if(BAZUKO_BUILD_OPUS_TESTS)
    enable_testing()
    add_executable(bazuko_opus_audio_test tests/OpusAudioTest.cpp)
    target_link_libraries(bazuko_opus_audio_test PRIVATE opusfile)
    target_compile_definitions(bazuko_opus_audio_test PRIVATE
        BAZUKO_TEST_AUDIO_DIR="${CMAKE_CURRENT_SOURCE_DIR}/../public/audio"
    )
    add_test(NAME bazuko_opus_audio COMMAND bazuko_opus_audio_test)
endif()

add_custom_command(TARGET bazuko POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E copy_directory "${CMAKE_CURRENT_SOURCE_DIR}/assets" "$<TARGET_FILE_DIR:bazuko>/assets"
)
# Los modelos y el audio se copian junto al ejecutable solo si se pide (el juego tambien los busca en ../public).
option(BAZUKO_COPY_PUBLIC "Copiar public/ junto al ejecutable (portable, ~50 MB)" OFF)
if(BAZUKO_COPY_PUBLIC AND EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/../public")
    add_custom_command(TARGET bazuko POST_BUILD
        COMMAND ${CMAKE_COMMAND} -E copy_directory "${CMAKE_CURRENT_SOURCE_DIR}/../public" "$<TARGET_FILE_DIR:bazuko>/public")
endif()

if(WIN32 AND DEFINED ENV{WEBP_ROOT})
    file(GLOB BAZUKO_WEBP_RUNTIME_DLLS "$ENV{WEBP_ROOT}/bin/*.dll")
    foreach(WEBP_RUNTIME_DLL IN LISTS BAZUKO_WEBP_RUNTIME_DLLS)
        add_custom_command(TARGET bazuko POST_BUILD
            COMMAND ${CMAKE_COMMAND} -E copy_if_different
                "${WEBP_RUNTIME_DLL}" "$<TARGET_FILE_DIR:bazuko>"
            VERBATIM
        )
    endforeach()
endif()
