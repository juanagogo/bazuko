#pragma once
// Donde estan las cuentas: region y cliente del grupo de usuarios de Cognito (salen de `npm run deploy` en servicios/, archivo salida.json).
// Se fijan al compilar (-DBAZUKO_CUENTAS_REGION=... -DBAZUKO_CUENTAS_CLIENTE=...) y se pueden cambiar sin recompilar con las variables
// de entorno del mismo nombre. Sin cliente no hay cuentas: el lobby lo dice y el multijugador sigue como antes.
#include <cstdlib>
#include <string>

#include "online/Cognito.hpp"

#ifndef BAZUKO_CUENTAS_REGION_DEFAULT
#define BAZUKO_CUENTAS_REGION_DEFAULT ""
#endif
#ifndef BAZUKO_CUENTAS_API_DEFAULT
#define BAZUKO_CUENTAS_API_DEFAULT ""
#endif
#ifndef BAZUKO_CUENTAS_CLIENTE_DEFAULT
#define BAZUKO_CUENTAS_CLIENTE_DEFAULT ""
#endif

namespace Bazuko::Online {

inline CognitoConfig AccountConfig() {
    CognitoConfig config{BAZUKO_CUENTAS_REGION_DEFAULT, BAZUKO_CUENTAS_CLIENTE_DEFAULT, BAZUKO_CUENTAS_API_DEFAULT};
    if (const char* region = std::getenv("BAZUKO_CUENTAS_REGION"); region && *region) config.region = region;
    if (const char* client = std::getenv("BAZUKO_CUENTAS_CLIENTE"); client && *client) config.clientId = client;
    if (const char* api = std::getenv("BAZUKO_CUENTAS_API"); api && *api) config.api = api;
    while (!config.api.empty() && config.api.back() == '/') config.api.pop_back();
    if (!HttpAvailable()) config.clientId.clear();   // sin cliente HTTPS en esta plataforma: como si no hubiera cuentas
    return config;
}

} // namespace Bazuko::Online
