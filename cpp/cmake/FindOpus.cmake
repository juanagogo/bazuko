if(TARGET opus AND NOT TARGET Opus::opus)
    add_library(Opus::opus ALIAS opus)
endif()

if(TARGET Opus::opus)
    set(Opus_FOUND TRUE)
else()
    find_package(Opus CONFIG REQUIRED)
endif()
