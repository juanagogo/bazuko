#include "online/Http.hpp"

#include <atomic>
#include <mutex>
#include <thread>

#ifdef _WIN32
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#include <winhttp.h>
#endif

namespace Bazuko::Online {

namespace {
constexpr size_t kMaxBody = 1024 * 1024;   // las respuestas de los servicios son pequenas; algo mas grande es un error

std::wstring Widen(const std::string& text) {
#ifdef _WIN32
    if (text.empty()) return {};
    const int size = MultiByteToWideChar(CP_UTF8, 0, text.data(), static_cast<int>(text.size()), nullptr, 0);
    std::wstring wide(static_cast<size_t>(size), L'\0');
    MultiByteToWideChar(CP_UTF8, 0, text.data(), static_cast<int>(text.size()), wide.data(), size);
    return wide;
#else
    return std::wstring(text.begin(), text.end());
#endif
}
} // namespace

struct HttpCall::State {
    std::atomic<bool> done{false};
    std::mutex mutex;
    HttpResponse response;
};

bool HttpCall::Done() const { return m_State->done.load(); }

HttpResponse HttpCall::Result() const {
    std::lock_guard<std::mutex> lock(m_State->mutex);
    return m_State->response;
}

bool HttpAvailable() {
#ifdef _WIN32
    return true;
#else
    return false;
#endif
}

HttpResponse HttpSendBlocking(const HttpRequest& request) {
    HttpResponse out;
    if (request.url.rfind("https://", 0) != 0) return out;   // nunca se manda nada sin cifrar
#ifdef _WIN32
    const std::wstring url = Widen(request.url);
    URL_COMPONENTS parts{};
    parts.dwStructSize = sizeof(parts);
    wchar_t host[256] = {}, path[2048] = {};
    parts.lpszHostName = host; parts.dwHostNameLength = 256;
    parts.lpszUrlPath = path; parts.dwUrlPathLength = 2048;
    if (!WinHttpCrackUrl(url.c_str(), 0, 0, &parts) || parts.nScheme != INTERNET_SCHEME_HTTPS) return out;
    HINTERNET session = WinHttpOpen(L"Bazuko/1.0", WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY, WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0);
    if (!session) return out;
    WinHttpSetTimeouts(session, request.timeoutMs, request.timeoutMs, request.timeoutMs, request.timeoutMs);
    DWORD protocols = WINHTTP_FLAG_SECURE_PROTOCOL_TLS1_2;
#ifdef WINHTTP_FLAG_SECURE_PROTOCOL_TLS1_3
    protocols |= WINHTTP_FLAG_SECURE_PROTOCOL_TLS1_3;
#endif
    WinHttpSetOption(session, WINHTTP_OPTION_SECURE_PROTOCOLS, &protocols, sizeof(protocols));
    if (HINTERNET connection = WinHttpConnect(session, host, parts.nPort, 0)) {
        const std::wstring method = Widen(request.method);
        if (HINTERNET handle = WinHttpOpenRequest(connection, method.c_str(), path, nullptr, WINHTTP_NO_REFERER, WINHTTP_DEFAULT_ACCEPT_TYPES, WINHTTP_FLAG_SECURE)) {
            std::wstring headers;
            for (const auto& [name, value] : request.headers) headers += Widen(name) + L": " + Widen(value) + L"\r\n";
            const BOOL sent = WinHttpSendRequest(handle, headers.empty() ? WINHTTP_NO_ADDITIONAL_HEADERS : headers.c_str(),
                                                 headers.empty() ? 0 : static_cast<DWORD>(-1),
                                                 request.body.empty() ? WINHTTP_NO_REQUEST_DATA : const_cast<char*>(request.body.data()),
                                                 static_cast<DWORD>(request.body.size()), static_cast<DWORD>(request.body.size()), 0);
            DWORD status = 0, size = sizeof(status);
            if (sent && WinHttpReceiveResponse(handle, nullptr)
                && WinHttpQueryHeaders(handle, WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER, WINHTTP_HEADER_NAME_BY_INDEX, &status, &size, WINHTTP_NO_HEADER_INDEX)) {
                out.reached = true;
                out.status = static_cast<int>(status);
                char buffer[8192];
                DWORD read = 0;
                while (WinHttpReadData(handle, buffer, sizeof buffer, &read) && read > 0) {
                    out.body.append(buffer, read);
                    if (out.body.size() > kMaxBody) { out.body.clear(); out.status = 0; break; }
                }
            }
            WinHttpCloseHandle(handle);
        }
        WinHttpCloseHandle(connection);
    }
    WinHttpCloseHandle(session);
#endif
    return out;
}

std::shared_ptr<HttpCall> HttpSend(HttpRequest request) {
    auto state = std::make_shared<HttpCall::State>();
    std::thread([state, request = std::move(request)]() {
        HttpResponse response = HttpSendBlocking(request);
        {
            std::lock_guard<std::mutex> lock(state->mutex);
            state->response = std::move(response);
        }
        state->done = true;
    }).detach();
    return std::make_shared<HttpCall>(state);
}

} // namespace Bazuko::Online
