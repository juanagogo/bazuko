#include "online/Match.hpp"

#include "online/Session.hpp"

#include <algorithm>
#include <cctype>
#include <cmath>

namespace Bazuko::Online {

namespace {
std::string Lower(std::string text) {
    for (char& c : text) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    return text;
}
} // namespace

void MatchTally::Observe(double now, const std::vector<Seen>& players) {
    const double dt = m_Last < 0.0 ? 0.0 : std::clamp(now - m_Last, 0.0, 1.0);   // un cuadro largo (carga, pausa) no regala tiempo
    m_Last = now;
    for (auto& [name, p] : m_Players) p.present = false;
    for (const Seen& seen : players) {
        if (seen.name.empty()) continue;
        Player& p = m_Players[seen.name];
        p.seconds += dt;
        p.lastSeen = now;
        p.present = true;
        if (seen.down && !p.down) {   // acaba de caer: una muerte para el, y una pelea ganada para quien lo golpeo hace poco
            ++p.deaths;
            if (now - p.lastHitAt <= kKnockWindow && !p.lastAttacker.empty() && p.lastAttacker != seen.name) {
                if (const auto it = m_Players.find(p.lastAttacker); it != m_Players.end()) ++it->second.fights;
            }
            p.lastAttacker.clear();
        }
        p.down = seen.down;
        if (seen.hasMoney) {
            if (p.hasMoney) {
                const double step = seen.money - p.lastMoney;
                if (step > 0.0 && step <= kMaxMoneyStep) p.money += step;
            }
            p.lastMoney = seen.money;
            p.hasMoney = true;
        }
    }
}

void MatchTally::Hit(const std::string& attacker, const std::string& victim, double now) {
    if (attacker.empty() || victim.empty() || attacker == victim) return;
    Player& p = m_Players[victim];
    p.lastAttacker = attacker;
    p.lastHitAt = now;
}

void MatchTally::NewDay() {
    for (auto& [name, p] : m_Players)
        if (p.present) ++p.days;
}

std::vector<MatchResult> MatchTally::Take() {
    std::vector<MatchResult> out;
    for (auto& [name, p] : m_Players) {
        MatchResult r{name, p.days, static_cast<long long>(std::floor(p.money)), p.fights, p.deaths, static_cast<long long>(std::floor(p.seconds))};
        if (r.seconds > 0 || r.days > 0 || r.money > 0 || r.fights > 0 || r.deaths > 0) out.push_back(r);
        p.seconds -= static_cast<double>(r.seconds);   // lo que no completa un segundo queda para el siguiente informe
        p.money -= static_cast<double>(r.money);
        p.days = p.fights = p.deaths = 0;
    }
    return out;
}

void MergeResults(std::vector<MatchResult>& into, const std::vector<MatchResult>& more) {
    for (const MatchResult& r : more) {
        const auto it = std::find_if(into.begin(), into.end(), [&](const MatchResult& x) { return Lower(x.name) == Lower(r.name); });
        if (it == into.end()) { into.push_back(r); continue; }
        it->days += r.days; it->money += r.money; it->fights += r.fights; it->deaths += r.deaths; it->seconds += r.seconds;
    }
}

void MatchReporter::Begin(const std::string& roomCode, bool host) {
    if (m_Account.GetState() != Session::State::SignedIn || !m_Account.ProfileOnline() || roomCode.empty()) return;
    m_Code = roomCode;
    m_Host = host;
    m_Present = false;
    m_PresentCall = ApiMatchPresent(m_Account.Config(), m_Account.AccessToken(), m_Code, m_Host);
    m_Tally = MatchTally{};
    m_Pending.clear();
    m_NextReport = m_Now + kReportEvery;
}

void MatchReporter::BecomeHost() {
    if (m_Code.empty() || m_Host) return;
    Begin(m_Code, true);   // vuelve a avisar, ahora como anfitrion; lo de antes lo acredito el anfitrion anterior
}

void MatchReporter::Send() {
    MergeResults(m_Pending, m_Tally.Take());
    if (m_Pending.empty() || m_ResultCall) return;
    if (m_Account.GetState() != Session::State::SignedIn) return;
    m_InFlight = m_Pending;
    m_Pending.clear();
    m_ResultCall = ApiMatchResult(m_Account.Config(), m_Account.AccessToken(), m_Code, m_InFlight);
}

void MatchReporter::End() {
    if (m_Code.empty()) return;
    if (m_Host && m_Present) Send();   // el pedido sigue en su hilo aunque se salga de la sala
    m_Code.clear();
    m_Host = m_Present = false;
    m_PresentCall.reset();
    m_Pending.clear();
}

void MatchReporter::Update(double now) {
    m_Now = now;
    if (m_PresentCall && m_PresentCall->Done()) {
        const HttpResponse response = m_PresentCall->Result();
        m_PresentCall.reset();
        if (response.reached && response.status >= 200 && response.status < 300) m_Present = true;
        else if (!response.reached || response.status >= 500 || response.status == 401 || response.status == 429) m_PresentRetryAt = now + 30.0;   // sin red o token vencido: otra vez en un rato
    }
    if (!m_Code.empty() && !m_Present && !m_PresentCall && m_PresentRetryAt > 0.0 && now >= m_PresentRetryAt && m_Account.GetState() == Session::State::SignedIn) {
        m_PresentRetryAt = 0.0;
        m_PresentCall = ApiMatchPresent(m_Account.Config(), m_Account.AccessToken(), m_Code, m_Host);
    }
    if (m_ResultCall && m_ResultCall->Done()) {
        const HttpResponse response = m_ResultCall->Result();
        m_ResultCall.reset();
        const bool retry = !response.reached || response.status >= 500 || response.status == 401 || response.status == 429;
        if (retry && !m_Code.empty()) MergeResults(m_Pending, m_InFlight);   // se manda con el proximo informe
        m_InFlight.clear();
    }
    if (!m_Code.empty() && m_Host && m_Present && now >= m_NextReport) {
        m_NextReport = now + kReportEvery;
        Send();
    }
}

} // namespace Bazuko::Online
