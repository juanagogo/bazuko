#include "LiveStream.hpp"
#include <miniaudio.h>
#include <algorithm>
#include <atomic>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <mutex>
#include <thread>
#include <vector>
#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <winhttp.h>
#endif

namespace Bazuko {

namespace {

using Clock = std::chrono::steady_clock;

// Origen de bytes: la red o un archivo local. Read bloquea hasta tener algo, el fin o un error.
class ByteSource {
public:
    virtual ~ByteSource() = default;
    virtual bool Open(const std::string& url, std::string& error) = 0;
    virtual size_t Read(uint8_t* out, size_t bytes) = 0;   // 0 = fin o error
    virtual void Abort() {}                                // desde otro hilo: suelta una lectura bloqueada
};

class FileSource : public ByteSource {
public:
    ~FileSource() override { if (m_File) std::fclose(m_File); }
    bool Open(const std::string& url, std::string& error) override {
        m_File = std::fopen(url.substr(5).c_str(), "rb");   // "file:"
        if (!m_File) error = "no se pudo abrir el archivo";
        return m_File != nullptr;
    }
    size_t Read(uint8_t* out, size_t bytes) override { return std::fread(out, 1, bytes, m_File); }
private:
    FILE* m_File = nullptr;
};

#ifdef _WIN32
class HttpSource : public ByteSource {
public:
    ~HttpSource() override { Close(); }
    bool Open(const std::string& url, std::string& error) override {
        const int wideLength = MultiByteToWideChar(CP_UTF8, 0, url.c_str(), -1, nullptr, 0);
        std::wstring wide(static_cast<size_t>(std::max(wideLength, 1)), L'\0');
        MultiByteToWideChar(CP_UTF8, 0, url.c_str(), -1, wide.data(), wideLength);
        wchar_t host[256], path[2048], extra[2048];
        URL_COMPONENTS parts{};
        parts.dwStructSize = sizeof(parts);
        parts.lpszHostName = host; parts.dwHostNameLength = 256;
        parts.lpszUrlPath = path; parts.dwUrlPathLength = 2048;
        parts.lpszExtraInfo = extra; parts.dwExtraInfoLength = 2048;
        if (!WinHttpCrackUrl(wide.c_str(), 0, 0, &parts)) { error = "direccion invalida"; return false; }
        m_Session = WinHttpOpen(L"Bazuko/1.0", WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY, WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0);
        if (!m_Session) { error = "sin acceso a la red"; return false; }
        WinHttpSetTimeouts(m_Session, 8000, 8000, 8000, 12000);
        m_Connection = WinHttpConnect(m_Session, std::wstring(host, parts.dwHostNameLength).c_str(), parts.nPort, 0);
        if (!m_Connection) { error = "no se pudo conectar"; return false; }
        const std::wstring target = std::wstring(path, parts.dwUrlPathLength) + std::wstring(extra, parts.dwExtraInfoLength);
        const DWORD flags = parts.nScheme == INTERNET_SCHEME_HTTPS ? WINHTTP_FLAG_SECURE : 0;
        m_Request = WinHttpOpenRequest(m_Connection, L"GET", target.c_str(), nullptr, WINHTTP_NO_REFERER, WINHTTP_DEFAULT_ACCEPT_TYPES, flags);
        if (!m_Request) { error = "no se pudo pedir la senal"; return false; }
        // sin la cabecera Icy-MetaData el flujo llega como MP3 puro, sin metadatos intercalados
        if (!WinHttpSendRequest(m_Request, WINHTTP_NO_ADDITIONAL_HEADERS, 0, WINHTTP_NO_REQUEST_DATA, 0, 0, 0) || !WinHttpReceiveResponse(m_Request, nullptr)) {
            error = "sin respuesta de la emisora"; return false;
        }
        DWORD status = 0, size = sizeof(status);
        WinHttpQueryHeaders(m_Request, WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER, WINHTTP_HEADER_NAME_BY_INDEX, &status, &size, WINHTTP_NO_HEADER_INDEX);
        if (status != 200) { error = "la emisora respondio " + std::to_string(status); return false; }
        wchar_t type[128] = {};
        size = sizeof(type);
        if (WinHttpQueryHeaders(m_Request, WINHTTP_QUERY_CONTENT_TYPE, WINHTTP_HEADER_NAME_BY_INDEX, type, &size, WINHTTP_NO_HEADER_INDEX)) {
            const std::wstring contentType(type);
            if (contentType.find(L"aac") != std::wstring::npos || contentType.find(L"mpegurl") != std::wstring::npos || contentType.find(L"ogg") != std::wstring::npos) {
                error = "codec no soportado (solo MP3)"; return false;
            }
        }
        return true;
    }
    void Abort() override { Close(); }
    size_t Read(uint8_t* out, size_t bytes) override {
        DWORD read = 0;
        if (!WinHttpReadData(m_Request, out, static_cast<DWORD>(std::min<size_t>(bytes, 16384)), &read)) return 0;
        return read;
    }
private:
    void Close() {
        if (m_Request) WinHttpCloseHandle(m_Request);
        if (m_Connection) WinHttpCloseHandle(m_Connection);
        if (m_Session) WinHttpCloseHandle(m_Session);
        m_Request = m_Connection = m_Session = nullptr;
    }
    HINTERNET m_Session = nullptr, m_Connection = nullptr, m_Request = nullptr;
};
#endif

// Una conexion: su hilo, su origen y el buffer de muestras mono que llena el hilo y vacia el audio.
struct Session {
    std::atomic<bool> stop{false};
    std::atomic<LiveStream::State> state{LiveStream::State::Connecting};
    std::atomic<size_t> readIndex{0}, writeIndex{0};   // monotonicos; la muestra i esta en `ring[i % size]`
    std::vector<float> ring;
    std::string error;
    std::mutex errorMutex;
    std::thread worker;
    Clock::time_point startedAt = Clock::now();
    std::unique_ptr<ByteSource> source;
    // Lo primero que llego se guarda un rato: el decodificador sondea el formato y vuelve al inicio, y un flujo en vivo no retrocede.
    std::vector<uint8_t> head;
    size_t position = 0;          // por donde va leyendo el decodificador (dentro de `head` o ya en el flujo)
    bool rewindable = true;       // deja de serlo al pasar de kHeadLimit
    static constexpr size_t kHeadLimit = 256 * 1024;
    size_t Fetch(uint8_t* out, size_t bytes) {
        size_t got = 0;
        if (position < head.size()) {   // repite lo ya recibido tras un rebobinado
            got = std::min(bytes, head.size() - position);
            std::copy(head.begin() + static_cast<std::ptrdiff_t>(position), head.begin() + static_cast<std::ptrdiff_t>(position + got), out);
            position += got;
            return got;
        }
        got = source->Read(out, bytes);
        if (got > 0 && rewindable) {
            if (head.size() + got <= kHeadLimit) head.insert(head.end(), out, out + got); else { rewindable = false; head.clear(); head.shrink_to_fit(); position = 0; return got; }
        }
        if (rewindable) position = head.size();
        return got;
    }
};

ma_result DecoderRead(ma_decoder* decoder, void* out, size_t bytes, size_t* read) {
    auto* session = static_cast<Session*>(decoder->pUserData);
    *read = 0;
    if (session->stop.load()) return MA_SUCCESS;
    *read = session->Fetch(static_cast<uint8_t*>(out), bytes);
    return MA_SUCCESS;   // 0 bytes = fin del flujo
}

ma_result DecoderSeek(ma_decoder* decoder, ma_int64 offset, ma_seek_origin origin) {
    auto* session = static_cast<Session*>(decoder->pUserData);
    if (std::getenv("BAZUKO_LOG_STREAM")) std::fprintf(stderr, "seek %lld origen %d%c", static_cast<long long>(offset), static_cast<int>(origin), 10);
    if (origin == ma_seek_origin_start) {   // volver al inicio solo mientras siga guardado
        if (!session->rewindable || offset < 0 || static_cast<size_t>(offset) > session->head.size()) return MA_ERROR;
        session->position = static_cast<size_t>(offset);
        return MA_SUCCESS;
    }
    if (origin != ma_seek_origin_current || offset < 0) return MA_ERROR;   // el final de un flujo en vivo no existe
    uint8_t scratch[2048];   // avanzar (saltar una etiqueta ID3, por ejemplo) se hace leyendo y descartando
    while (offset > 0) {
        const size_t got = session->Fetch(scratch, static_cast<size_t>(std::min<ma_int64>(offset, static_cast<ma_int64>(sizeof(scratch)))));
        if (got == 0) return MA_ERROR;
        offset -= static_cast<ma_int64>(got);
    }
    return MA_SUCCESS;
}

void Fail(Session& session, const std::string& message) {
    {
        std::lock_guard<std::mutex> lock(session.errorMutex);
        session.error = message;
    }
    session.state = LiveStream::State::Failed;
}

void Run(Session& session, std::string url, uint32_t rate) {
    std::string error;
    if (!session.source) { Fail(session, "sin red en esta plataforma"); return; }
    if (!session.source->Open(url, error)) { Fail(session, error); return; }
    ma_decoder_config config = ma_decoder_config_init(ma_format_f32, 2, rate);
    config.encodingFormat = ma_encoding_format_mp3;
    ma_decoder decoder;
    const ma_result initResult = ma_decoder_init(DecoderRead, DecoderSeek, &session, &config, &decoder);
    if (std::getenv("BAZUKO_LOG_STREAM")) std::fprintf(stderr, "init decodificador: %d\n", static_cast<int>(initResult));
    if (initResult != MA_SUCCESS) { Fail(session, "no se pudo decodificar el flujo (MP3)"); return; }
    std::vector<float> block(1024 * 2);
    const size_t capacity = session.ring.size();
    while (!session.stop.load()) {
        ma_uint64 frames = 0;
        const ma_result result = ma_decoder_read_pcm_frames(&decoder, block.data(), 1024, &frames);
        if (std::getenv("BAZUKO_LOG_STREAM") && (frames < 1024 || result != MA_SUCCESS)) std::fprintf(stderr, "lectura: %llu cuadros, resultado %d, escritos %zu%c", static_cast<unsigned long long>(frames), static_cast<int>(result), session.writeIndex.load(), 10);
        if (frames == 0 || result != MA_SUCCESS) { if (!session.stop.load()) Fail(session, "se corto la senal"); break; }
        size_t pending = static_cast<size_t>(frames), offset = 0;
        while (pending > 0 && !session.stop.load()) {
            const size_t writeAt = session.writeIndex.load(std::memory_order_relaxed);
            const size_t used = writeAt - session.readIndex.load(std::memory_order_acquire);
            if (used >= capacity) { std::this_thread::sleep_for(std::chrono::milliseconds(5)); continue; }   // lleno: el ritmo lo manda el audio
            const size_t room = std::min(pending, capacity - used);
            for (size_t i = 0; i < room; ++i) session.ring[(writeAt + i) % capacity] = 0.5f * (block[(offset + i) * 2] + block[(offset + i) * 2 + 1]);
            session.writeIndex.store(writeAt + room, std::memory_order_release);
            pending -= room; offset += room;
        }
        if (session.state.load() == LiveStream::State::Connecting && session.writeIndex.load() >= rate / 2) session.state = LiveStream::State::Playing;   // medio segundo de colchon
    }
    ma_decoder_uninit(&decoder);
}

} // namespace

struct LiveStream::Impl {
    uint32_t rate = 48000;
    mutable std::mutex mutex;          // protege el cambio de sesion (Start/Stop frente a Read)
    std::shared_ptr<Session> session;
};

LiveStream::LiveStream(uint32_t outputRate) : m_Impl(std::make_unique<Impl>()) { m_Impl->rate = outputRate; }
LiveStream::~LiveStream() { Stop(); }

void LiveStream::Start(const std::string& url) {
    Stop();
    auto session = std::make_shared<Session>();
    session->ring.assign(static_cast<size_t>(m_Impl->rate) * 4, 0.0f);   // 4 s de colchon
    const uint32_t rate = m_Impl->rate;
    Session* raw = session.get();
    if (url.rfind("file:", 0) == 0) session->source = std::make_unique<FileSource>();
#ifdef _WIN32
    else session->source = std::make_unique<HttpSource>();
#endif
    session->worker = std::thread([raw, url, rate] { Run(*raw, url, rate); });
    std::lock_guard<std::mutex> lock(m_Impl->mutex);
    m_Impl->session = std::move(session);
}

void LiveStream::Stop() {
    std::shared_ptr<Session> old;
    {
        std::lock_guard<std::mutex> lock(m_Impl->mutex);
        old = std::move(m_Impl->session);
    }
    if (!old) return;
    old->stop = true;
    if (old->source) old->source->Abort();   // si esta esperando bytes de la red, la lectura termina ya
    if (old->worker.joinable()) old->worker.join();   // la lectura de red tiene plazo (WinHttpSetTimeouts), asi que no se cuelga
}

LiveStream::State LiveStream::GetState() const {
    std::lock_guard<std::mutex> lock(m_Impl->mutex);
    return m_Impl->session ? m_Impl->session->state.load() : State::Idle;
}

std::string LiveStream::Error() const {
    std::lock_guard<std::mutex> lock(m_Impl->mutex);
    if (!m_Impl->session) return {};
    std::lock_guard<std::mutex> errorLock(m_Impl->session->errorMutex);
    return m_Impl->session->error;
}

double LiveStream::SecondsSinceStart() const {
    std::lock_guard<std::mutex> lock(m_Impl->mutex);
    return m_Impl->session ? std::chrono::duration<double>(Clock::now() - m_Impl->session->startedAt).count() : 0.0;
}

size_t LiveStream::BufferedFrames() const {
    std::lock_guard<std::mutex> lock(m_Impl->mutex);
    return m_Impl->session ? m_Impl->session->writeIndex.load() - m_Impl->session->readIndex.load() : 0;
}

size_t LiveStream::Read(float* mono, size_t frames) {
    std::unique_lock<std::mutex> lock(m_Impl->mutex, std::try_to_lock);
    if (!lock.owns_lock() || !m_Impl->session) return 0;
    Session& session = *m_Impl->session;
    if (session.state.load() == State::Connecting) return 0;   // hasta el colchon de medio segundo no suena; si la senal se corta, lo que quedo en el buffer se termina de oir
    const size_t capacity = session.ring.size();
    const size_t readAt = session.readIndex.load(std::memory_order_relaxed);
    const size_t available = session.writeIndex.load(std::memory_order_acquire) - readAt;
    const size_t count = std::min(frames, available);
    for (size_t i = 0; i < count; ++i) mono[i] = session.ring[(readAt + i) % capacity];
    session.readIndex.store(readAt + count, std::memory_order_release);
    return count;
}

} // namespace Bazuko
