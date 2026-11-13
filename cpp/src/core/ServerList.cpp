#include "ServerList.hpp"

#include <nlohmann/json.hpp>

#include <algorithm>
#include <atomic>
#include <cctype>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <mutex>
#include <sstream>
#include <thread>

#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <winhttp.h>
#endif

#ifndef BAZUKO_LISTA_SERVIDORES_DEFAULT
#define BAZUKO_LISTA_SERVIDORES_DEFAULT ""
#endif
#ifndef BAZUKO_SERVIDOR_SALAS_DEFAULT
#define BAZUKO_SERVIDOR_SALAS_DEFAULT ""
#endif

namespace Bazuko {

namespace {
constexpr size_t kMaxBody = 64 * 1024;
constexpr size_t kMaxServers = 8;

bool ValidAddress(const std::string& text) {   // host:puerto con letras, numeros, puntos y guiones
    if (text.empty() || text.size() > 120) return false;
    const size_t colon = text.rfind(':');
    if (colon == std::string::npos || colon == 0 || colon + 1 >= text.size()) return false;
    for (size_t i = 0; i < colon; ++i) {
        const unsigned char c = static_cast<unsigned char>(text[i]);
        if (!std::isalnum(c) && c != '.' && c != '-') return false;
    }
    for (size_t i = colon + 1; i < text.size(); ++i) if (!std::isdigit(static_cast<unsigned char>(text[i]))) return false;
    const long port = std::strtol(text.c_str() + colon + 1, nullptr, 10);
    return port > 0 && port < 65536;
}

#ifdef _WIN32
std::optional<std::string> WinHttpGet(const std::string& url, int timeoutMs) {
    const std::wstring wide(url.begin(), url.end());   // la URL es ASCII (viene de la compilacion o de una variable de entorno)
    URL_COMPONENTS parts{};
    parts.dwStructSize = sizeof(parts);
    wchar_t host[256] = {}, path[2048] = {};
    parts.lpszHostName = host; parts.dwHostNameLength = 256;
    parts.lpszUrlPath = path; parts.dwUrlPathLength = 2048;
    if (!WinHttpCrackUrl(wide.c_str(), 0, 0, &parts)) return std::nullopt;
    HINTERNET session = WinHttpOpen(L"Bazuko/1.0", WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY, WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0);
    if (!session) return std::nullopt;
    WinHttpSetTimeouts(session, timeoutMs, timeoutMs, timeoutMs, timeoutMs);
    std::optional<std::string> body;
    if (HINTERNET connection = WinHttpConnect(session, host, parts.nPort, 0)) {
        const DWORD flags = parts.nScheme == INTERNET_SCHEME_HTTPS ? WINHTTP_FLAG_SECURE : 0;
        if (HINTERNET request = WinHttpOpenRequest(connection, L"GET", path, nullptr, WINHTTP_NO_REFERER, WINHTTP_DEFAULT_ACCEPT_TYPES, flags)) {
            DWORD status = 0, size = sizeof(status);
            if (WinHttpSendRequest(request, WINHTTP_NO_ADDITIONAL_HEADERS, 0, WINHTTP_NO_REQUEST_DATA, 0, 0, 0) && WinHttpReceiveResponse(request, nullptr)
                && WinHttpQueryHeaders(request, WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER, WINHTTP_HEADER_NAME_BY_INDEX, &status, &size, WINHTTP_NO_HEADER_INDEX)
                && status == 200) {
                std::string text;
                char buffer[4096];
                DWORD read = 0;
                while (WinHttpReadData(request, buffer, sizeof buffer, &read) && read > 0) {
                    text.append(buffer, read);
                    if (text.size() > kMaxBody) { text.clear(); break; }
                }
                if (!text.empty()) body = std::move(text);
            }
            WinHttpCloseHandle(request);
        }
        WinHttpCloseHandle(connection);
    }
    WinHttpCloseHandle(session);
    return body;
}
#else
std::optional<std::string> CurlGet(const std::string& url, int timeoutMs) {
    for (char c : url) if (c == '\'' || c == '\\' || static_cast<unsigned char>(c) < 0x20) return std::nullopt;   // nada que rompa las comillas
    const std::string command = "curl -fsSL --max-time " + std::to_string(std::max(1, timeoutMs / 1000)) + " -A Bazuko/1.0 '" + url + "' 2>/dev/null";
    FILE* pipe = popen(command.c_str(), "r");
    if (!pipe) return std::nullopt;
    std::string text;
    char buffer[4096];
    size_t read = 0;
    while ((read = std::fread(buffer, 1, sizeof buffer, pipe)) > 0) {
        text.append(buffer, read);
        if (text.size() > kMaxBody) { text.clear(); break; }
    }
    const int status = pclose(pipe);
    if (status != 0 || text.empty()) return std::nullopt;
    return text;
}
#endif
} // namespace

std::optional<std::string> HttpGet(const std::string& url, int timeoutMs) {
    if (url.empty()) return std::nullopt;
    if (url.rfind("http://", 0) != 0 && url.rfind("https://", 0) != 0) {   // archivo local (pruebas)
        std::ifstream in(url, std::ios::binary);
        if (!in) return std::nullopt;
        std::ostringstream text;
        text << in.rdbuf();
        std::string body = text.str();
        if (body.empty() || body.size() > kMaxBody) return std::nullopt;
        return body;
    }
#ifdef _WIN32
    return WinHttpGet(url, timeoutMs);
#else
    return CurlGet(url, timeoutMs);
#endif
}

std::vector<std::string> ParseServerList(const std::string& json) {
    std::vector<std::string> out;
    try {
        const nlohmann::json document = nlohmann::json::parse(json);
        if (!document.is_object() || !document.contains("servidores") || !document["servidores"].is_array()) return out;
        for (const auto& entry : document["servidores"]) {
            std::string address;
            if (entry.is_string()) address = entry.get<std::string>();
            else if (entry.is_object()) address = entry.value("direccion", std::string{});
            if (!ValidAddress(address) || std::find(out.begin(), out.end(), address) != out.end()) continue;
            out.push_back(address);
            if (out.size() >= kMaxServers) break;
        }
    } catch (...) { out.clear(); }
    return out;
}

std::string ServerListUrl() {
    if (const char* env = std::getenv("BAZUKO_LISTA_SERVIDORES")) return env;
    return BAZUKO_LISTA_SERVIDORES_DEFAULT;
}

std::string FallbackServer() {
    if (const char* env = std::getenv("BAZUKO_SERVIDOR_SALAS")) return env;
    return BAZUKO_SERVIDOR_SALAS_DEFAULT;
}

struct ServerListFetch::State {
    std::atomic<bool> done{false};
    mutable std::mutex mutex;
    std::vector<std::string> servers;
};

void ServerListFetch::Start(const std::string& url) {
    m_State = std::make_shared<State>();
    if (url.empty()) { m_State->done = true; return; }
    std::thread([state = m_State, url]() {   // el hilo guarda su propia copia del estado: el lobby puede cerrarse antes de que termine
        std::vector<std::string> servers;
        if (const auto body = HttpGet(url)) servers = ParseServerList(*body);
        {
            std::lock_guard<std::mutex> lock(state->mutex);
            state->servers = std::move(servers);
        }
        state->done = true;
    }).detach();
}

bool ServerListFetch::Done() const { return m_State && m_State->done; }

std::vector<std::string> ServerListFetch::Result() const {
    if (!m_State) return {};
    std::lock_guard<std::mutex> lock(m_State->mutex);
    return m_State->servers;
}

} // namespace Bazuko
