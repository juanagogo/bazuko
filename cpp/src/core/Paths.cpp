#include "Paths.hpp"

#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <vector>

#if defined(_WIN32)
  #include <windows.h>
#elif defined(__linux__)
  #include <unistd.h>
#endif

namespace fs = std::filesystem;

namespace Bazuko::Paths {

namespace {

fs::path g_ExeDir;
fs::path g_PublicOverride;

fs::path ExecutableDir(const char* argv0) {
#if defined(_WIN32)
    wchar_t buf[MAX_PATH];
    const DWORD n = GetModuleFileNameW(nullptr, buf, MAX_PATH);
    if (n > 0 && n < MAX_PATH) return fs::path(buf).parent_path();
#elif defined(__linux__)
    std::error_code ec;
    const fs::path p = fs::read_symlink("/proc/self/exe", ec);
    if (!ec) return p.parent_path();
#endif
    std::error_code ec2;
    if (argv0 && *argv0) return fs::weakly_canonical(fs::path(argv0), ec2).parent_path();
    return fs::current_path();
}

} // namespace

void Init(int argc, char** argv) {
    g_ExeDir = ExecutableDir(argc > 0 ? argv[0] : nullptr);
    for (int i = 1; i + 1 < argc; ++i) {
        if (std::strcmp(argv[i], "--public") == 0) g_PublicOverride = argv[i + 1];
    }
    if (g_PublicOverride.empty()) {
        if (const char* env = std::getenv("BAZUKO_PUBLIC")) g_PublicOverride = env;
    }
}

std::string Find(const std::string& relative) {
    std::error_code ec;
    std::vector<fs::path> candidates;

    // public/ indicado por el usuario
    const std::string prefix = "public/";
    if (!g_PublicOverride.empty() && relative.compare(0, prefix.size(), prefix) == 0) {
        candidates.push_back(g_PublicOverride / relative.substr(prefix.size()));
    }
    // junto al ejecutable y en las carpetas superiores (cpp/build -> cpp -> raiz del repo)
    fs::path up = g_ExeDir;
    for (int i = 0; i < 6 && !up.empty(); ++i) {
        candidates.push_back(up / relative);
        const fs::path parent = up.parent_path();
        if (parent == up) break;
        up = parent;
    }
    candidates.push_back(fs::current_path() / relative);
#ifdef BAZUKO_SOURCE_DIR
    candidates.push_back(fs::path(BAZUKO_SOURCE_DIR) / relative);
    candidates.push_back(fs::path(BAZUKO_SOURCE_DIR) / ".." / relative);
#endif
    for (const auto& c : candidates) {
        if (fs::exists(c, ec)) return c.lexically_normal().string();
    }
    return relative;
}

} // namespace Bazuko::Paths
