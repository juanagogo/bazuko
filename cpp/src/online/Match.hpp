#pragma once
// Estadisticas de una partida por internet para la clasificacion (US3).
// MatchTally: lo que el anfitrion ve de cada jugador (tiempo dentro, dias que pasan, plata que gana, peleas que gana y veces que cae), sin red.
// MatchReporter: cada cuenta avisa que esta en la sala; el anfitrion manda lo visto cada minuto y al salir. Si no hay internet, lo guarda y lo reintenta.
// El servidor solo acredita a cuentas que avisaron ellas mismas y dentro de lo que cabe en el tiempo real (servicios/src/reglas/partidas.ts).
#include <map>
#include <memory>
#include <string>
#include <vector>

#include "online/Social.hpp"

namespace Bazuko::Online {

class Session;

class MatchTally {
public:
    struct Seen { std::string name; bool down = false; bool hasMoney = false; double money = 0.0; };
    // Un cuadro: quienes estan en la sala ahora. El tiempo corre solo para ellos; quien no aparece salio (y si vuelve, sigue sumando)
    void Observe(double nowSeconds, const std::vector<Seen>& players);
    void Hit(const std::string& attacker, const std::string& victim, double nowSeconds);   // un golpe de un jugador a otro
    void NewDay();   // paso la medianoche en el mundo de la sala: un dia mas para cada uno de los presentes
    std::vector<MatchResult> Take();   // lo acumulado desde la ultima vez (solo quien tiene algo) y vuelve a cero

    static constexpr double kKnockWindow = 4.0;        // la caida cuenta como pelea ganada si el golpe fue hace menos de esto
    static constexpr double kMaxMoneyStep = 200000.0;  // un salto mayor de plata no es ganancia (el anfitrion le devolvio su perfil)

private:
    struct Player {
        double seconds = 0.0, money = 0.0, lastMoney = 0.0, lastHitAt = -1e9, lastSeen = 0.0;
        long long days = 0, fights = 0, deaths = 0;
        bool present = false, down = false, hasMoney = false;
        std::string lastAttacker;
    };
    std::map<std::string, Player> m_Players;
    double m_Last = -1.0;
};

class MatchReporter {
public:
    explicit MatchReporter(Session& account) : m_Account(account) {}
    // Al entrar a una sala por internet (con el codigo del relevo). Sin sesion iniciada no hace nada
    void Begin(const std::string& roomCode, bool host);
    void BecomeHost();   // el anfitrion se fue y la sala sigue conmigo
    void End();          // al salir: el anfitrion manda lo que falte
    void Update(double nowSeconds);
    bool Active() const { return !m_Code.empty(); }
    bool Host() const { return m_Host; }
    const std::string& Code() const { return m_Code; }
    MatchTally& Tally() { return m_Tally; }

    static constexpr double kReportEvery = 60.0;

private:
    void Send();
    Session& m_Account;
    std::string m_Code;
    bool m_Host = false, m_Present = false;
    std::shared_ptr<HttpCall> m_PresentCall, m_ResultCall;
    double m_PresentRetryAt = 0.0, m_NextReport = 0.0, m_Now = 0.0;
    MatchTally m_Tally;
    std::vector<MatchResult> m_Pending, m_InFlight;
};

void MergeResults(std::vector<MatchResult>& into, const std::vector<MatchResult>& more);   // suma por nombre (sin mayusculas)

} // namespace Bazuko::Online
