#pragma once
// Pedidos HTTPS a los servicios de cuentas (Cognito y el API del juego). Cada pedido corre en un hilo aparte, para no congelar el lobby
// ni la partida, y se consulta con Done()/Result(). Solo se manda un User-Agent generico ("Bazuko/1.0") y lo que el pedido trae;
// nada de esto se escribe en el registro, porque los cuerpos llevan contrasenas o tokens.
// En Windows usa WinHTTP (valida el certificado con el sistema). En otros sistemas aun no hay cliente: Available() es falso.
#include <memory>
#include <string>
#include <utility>
#include <vector>

namespace Bazuko::Online {

struct HttpRequest {
    std::string method = "POST";
    std::string url;                                            // solo https:// (un http:// se rechaza)
    std::vector<std::pair<std::string, std::string>> headers;
    std::string body;
    int timeoutMs = 10000;
};

struct HttpResponse {
    bool reached = false;   // hubo respuesta del servidor (falso: sin internet, nombre que no resuelve, tiempo agotado o certificado malo)
    int status = 0;
    std::string body;
};

class HttpCall {
public:
    bool Done() const;
    HttpResponse Result() const;   // valido cuando Done()
    struct State;
    explicit HttpCall(std::shared_ptr<State> state) : m_State(std::move(state)) {}
private:
    std::shared_ptr<State> m_State;
};

bool HttpAvailable();
std::shared_ptr<HttpCall> HttpSend(HttpRequest request);   // empieza ya, en su hilo
HttpResponse HttpSendBlocking(const HttpRequest& request);  // para pruebas y herramientas

} // namespace Bazuko::Online
