#include "online/SecureStore.hpp"

#include <fstream>
#include <iterator>
#include <system_error>
#include <vector>

#ifdef _WIN32
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#include <dpapi.h>
#else
#include <sys/stat.h>
#endif

namespace Bazuko::Online {

namespace {
constexpr char kMagic[4] = {'B', 'Z', 'S', '1'};

std::optional<std::vector<char>> ReadAll(const std::filesystem::path& file) {
    std::ifstream in(file, std::ios::binary);
    if (!in) return std::nullopt;
    std::vector<char> data((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
    if (data.size() > 64 * 1024) return std::nullopt;
    return data;
}
} // namespace

bool SaveSecret(const std::filesystem::path& file, const std::string& secret, const std::string& purpose) {
    std::vector<char> payload(kMagic, kMagic + 4);
#ifdef _WIN32
    DATA_BLOB input{static_cast<DWORD>(secret.size()), reinterpret_cast<BYTE*>(const_cast<char*>(secret.data()))};
    DATA_BLOB entropy{static_cast<DWORD>(purpose.size()), reinterpret_cast<BYTE*>(const_cast<char*>(purpose.data()))};
    DATA_BLOB output{};
    if (!CryptProtectData(&input, L"Bazuko", &entropy, nullptr, nullptr, CRYPTPROTECT_UI_FORBIDDEN, &output)) return false;
    payload.insert(payload.end(), reinterpret_cast<char*>(output.pbData), reinterpret_cast<char*>(output.pbData) + output.cbData);
    SecureZeroMemory(output.pbData, output.cbData);
    LocalFree(output.pbData);
#else
    (void)purpose;
    payload.insert(payload.end(), secret.begin(), secret.end());
#endif
    const std::filesystem::path temp = file.string() + ".tmp";
    {
        std::ofstream out(temp, std::ios::binary | std::ios::trunc);
        if (!out) return false;
#ifndef _WIN32
        chmod(temp.c_str(), 0600);
#endif
        out.write(payload.data(), static_cast<std::streamsize>(payload.size()));
        if (!out) return false;
    }
    std::error_code error;
    std::filesystem::rename(temp, file, error);
    if (error) { std::filesystem::remove(temp, error); return false; }
    return true;
}

std::optional<std::string> LoadSecret(const std::filesystem::path& file, const std::string& purpose) {
    const auto data = ReadAll(file);
    if (!data || data->size() <= 4 || !std::equal(kMagic, kMagic + 4, data->begin())) return std::nullopt;
#ifdef _WIN32
    DATA_BLOB input{static_cast<DWORD>(data->size() - 4), reinterpret_cast<BYTE*>(const_cast<char*>(data->data() + 4))};
    DATA_BLOB entropy{static_cast<DWORD>(purpose.size()), reinterpret_cast<BYTE*>(const_cast<char*>(purpose.data()))};
    DATA_BLOB output{};
    if (!CryptUnprotectData(&input, nullptr, &entropy, nullptr, nullptr, CRYPTPROTECT_UI_FORBIDDEN, &output)) return std::nullopt;
    std::string secret(reinterpret_cast<char*>(output.pbData), output.cbData);
    SecureZeroMemory(output.pbData, output.cbData);
    LocalFree(output.pbData);
    return secret;
#else
    (void)purpose;
    return std::string(data->begin() + 4, data->end());
#endif
}

void EraseSecret(const std::filesystem::path& file) {
    std::error_code error;
    const auto size = std::filesystem::file_size(file, error);
    if (!error && size > 0 && size < 64 * 1024) {
        std::ofstream out(file, std::ios::binary | std::ios::trunc);
        const std::vector<char> zeros(static_cast<size_t>(size), '\0');
        out.write(zeros.data(), static_cast<std::streamsize>(zeros.size()));
    }
    std::filesystem::remove(file, error);
}

} // namespace Bazuko::Online
