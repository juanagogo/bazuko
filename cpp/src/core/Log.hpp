#pragma once
#include <iostream>
#include <string_view>
#include <format>

namespace Bazuko {

enum class LogLevel { Info, Warn, Error, Debug };

inline void Log(LogLevel level, std::string_view msg) {
    const char* prefix = "[INFO]";
    switch (level) {
        case LogLevel::Info: prefix = "[INFO]"; break;
        case LogLevel::Warn: prefix = "\033[33m[WARN]\033[0m"; break;
        case LogLevel::Error: prefix = "\033[31m[ERROR]\033[0m"; break;
        case LogLevel::Debug: prefix = "\033[36m[DEBUG]\033[0m"; break;
    }
    std::cout << prefix << " " << msg << std::endl;
}

template<typename... Args>
inline void LogInfo(std::format_string<Args...> fmt, Args&&... args) {
    Log(LogLevel::Info, std::format(fmt, std::forward<Args>(args)...));
}

template<typename... Args>
inline void LogWarn(std::format_string<Args...> fmt, Args&&... args) {
    Log(LogLevel::Warn, std::format(fmt, std::forward<Args>(args)...));
}

template<typename... Args>
inline void LogError(std::format_string<Args...> fmt, Args&&... args) {
    Log(LogLevel::Error, std::format(fmt, std::forward<Args>(args)...));
}

template<typename... Args>
inline void LogDebug(std::format_string<Args...> fmt, Args&&... args) {
    Log(LogLevel::Debug, std::format(fmt, std::forward<Args>(args)...));
}

} // namespace Bazuko
