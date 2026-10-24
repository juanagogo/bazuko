if(TARGET ogg AND NOT TARGET Ogg::ogg)
    add_library(Ogg::ogg ALIAS ogg)
endif()

if(TARGET Ogg::ogg)
    set(Ogg_FOUND TRUE)
else()
    find_package(Ogg CONFIG REQUIRED)
endif()
