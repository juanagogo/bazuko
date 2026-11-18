#pragma once
// «Limpieza social» (LimpiezaSocialSystem.js y SquadMember.js del original): de noche, a veces, una camioneta negra llega por la
// calle, frena junto al jugador y se bajan tres hombres de negro con pasamontanas y pistola. El jefe se queda junto a la camioneta
// senalando y dando la orden; los otros dos persiguen al jugador y lo cascan a cachazos tras un aviso visible (levantan la pistola).
// Si lo alcanzan, los golpes siguen aunque este tambaleando. Si se les escapa, vuelven, se suben y la camioneta se va.
// Viajan sentados adentro; al frenar se bajan con la animacion de bajarse del carro (CarExit) abriendo cada uno su puerta, que dejan
// abierta, y al volver se suben con la de subirse (CarEnter) y la cierran: la camioneta arranca cuando los tres estan sentados.
// Es el tono mas delicado del juego: sin cuentas, sin logros, sin exclamacion en el recorte ni en el aviso de llegada.
// Solo logica (sin dibujo ni modelos): la usa Simulation y la prueba tests/LimpiezaSocialTest.cpp.
#include <glm/glm.hpp>
#include <algorithm>
#include <array>
#include <cmath>
#include <functional>
#include <random>
#include <string>
#include <vector>

namespace Bazuko::Limpieza {

struct Params {
    float checkEvery = 45.0f;     // s de juego entre tiradas de noche
    float chance = 0.12f;         // probabilidad por tirada
    float cooldown = 300.0f;      // s minimos entre una visita y otra
    float approach = 55.0f;       // m que recorre la camioneta antes de frenar
    float leave = 70.0f;          // m que recorre al irse antes de desaparecer
    float cruise = 13.0f;         // m/s
    float braking = 7.0f;         // m/s2 (frena en seco)
    float acceleration = 4.0f;
    float reachMin = 3.0f, reachMax = 20.0f;   // m del carril al jugador para poder llegar
    float sampleStep = 2.0f;
    float dropDelay = 0.6f;       // s entre que frena y que se abren las puertas
    float suvLength = 5.2f, suvWidth = 1.95f;
    // bajarse y subirse (los clips CarExit y CarEnter de los conductores del trafico, en el marco de la camioneta: +x adelante, +y a la derecha)
    glm::vec2 stance{-0.44f, 1.71f};   // donde queda de pie quien se baja por la puerta delantera derecha (perfil de la Hilux)
    float rearShift = 0.97f;           // m que las puertas de atras quedan detras de las de adelante
    float boardSpeed = 1.9f;           // los clips se reproducen 1,9x: estos no se demoran
    float exitOut = 4.2f;              // s de CarExit hasta quedar de pie (lo que sigue del clip es cerrar la puerta: ellos la dejan abierta)
    float enterLength = 4.5f;          // s de CarEnter
    std::array<float, 3> exitDelay{{0.0f, 0.25f, 0.5f}};   // s de clip que espera cada uno antes de abrir su puerta
    // los tres de a pie
    float chaseSpeed = 5.2f;      // mas rapido que caminar, algo mas lento que correr
    float walkSpeed = 1.8f;       // el jefe, al volver a la camioneta
    float attackRange = 1.4f;
    float windup = 0.4f;          // levanta la pistola antes del cachazo: tiempo para zafarse
    float strikeTime = 0.16f;
    float recover = 0.3f;
    float attackCooldown = 0.75f;
    int damageMin = 20, damageMax = 30;
    float giveUpTime = 22.0f;
    float giveUpDistance = 32.0f;
    float shoutMin = 2.6f, shoutMax = 4.2f;
};

inline const std::array<const char*, 6> kLeaderOrders{{
    "¡Ese es! ¡Cásquenlo!", "¡Denle a ese chirrete hijueputa!", "¡Limpien la calle, muchachos!",
    "¡Que no se les vuele ese ñero!", "¡Denle duro, que aquí no queremos viciosos!", "¡Rápido, que esto no se puede ver!"}};
inline const std::array<const char*, 8> kThugInsults{{
    "¡Chirrete hijueputa!", "¡Venga pa' acá, chirrete hijueputa!", "¡Venga pa' acá, gonorrea!", "¡Quieto, malparido!",
    "¡Se le acabó la vagancia, ñero!", "¡Corra, corra, que igual lo cogemos!", "¡Hijueputa, no se me esconda!", "¡Usted aquí sobra, pirobo!"}};

// Recorrido cerrado de la calle: `sample(d)` da posicion y direccion a `d` m (se repite pasado `length`)
struct Route {
    float length = 0.0f;
    std::function<void(float, glm::vec3&, glm::vec3&)> sample;
};

enum class State { Idle, Arriving, Stopped, Out, Leaving };
// Idle: fuera de juego. Seated: sentado en la camioneta. Exiting / Entering: bajandose o subiendose (board = tiempo del clip).
enum class Act { Idle, Seated, Exiting, Entering, Order, Chase, Windup, Strike, Recover, Return };

struct Member {
    bool leader = false;
    Act act = Act::Idle;
    glm::vec3 position{0.0f, -50.0f, 0.0f};
    glm::vec3 door{0.0f};
    float yaw = 0.0f;              // atan2(x, z), como los peatones
    float timer = 0.0f, stateTimer = 0.0f, attackTimer = 0.0f, shoutTimer = 0.0f, staggerTimer = 0.0f;
    float attackTime = -1.0f;      // >= 0 desde que levanta la pistola hasta que la baja
    float point = 0.0f;            // 0 brazo abajo, 1 senalando (el jefe), suavizado
    float animTime = 0.0f;
    float board = 0.0f;            // tiempo de CarExit / CarEnter (negativo: todavia espera su turno)
    bool moving = false;
    float speed = 0.0f;
    std::string bubble;
    float bubbleTime = 0.0f;
    // de pie en la calle: se le puede pegar, estorba y persigue
    bool Active() const { return act != Act::Idle && act != Act::Seated && act != Act::Exiting && act != Act::Entering; }
    bool Boarding() const { return act == Act::Exiting || act == Act::Entering; }
    bool Seated() const { return act == Act::Seated; }
};

struct Event {
    enum Kind { Arrived, DroppedOff, Swing, Hit, Miss, GaveUp, Left } kind;
    int damage = 0;
    glm::vec3 from{0.0f};          // de donde viene el golpe (posicion de quien pega)
};

struct Context {
    glm::vec3 player{0.0f};
    bool canChase = true;          // false durmiendo o muerto
    bool isNight = false;
    bool allowSpawn = true;        // false cerca del cambuche, durmiendo o en pantallas
    bool playerDown = false;       // en el piso: el siguiente golpe es cuando se pare
};

class System {
public:
    Params params;
    std::function<bool(float, float)> walkable;   // se puede pisar (por defecto, todo)
    std::function<float(float, float)> ground;    // altura del suelo (por defecto, 0)

    explicit System(uint32_t seed = 20261111u) : m_Random(seed) {
        m_Members[0].leader = true;
        m_Cooldown = params.cooldown * 0.5f;
    }

    State GetState() const { return m_State; }
    bool Active() const { return m_State != State::Idle; }
    const std::array<Member, 3>& Members() const { return m_Members; }
    std::array<Member, 3>& Members() { return m_Members; }
    glm::vec3 SuvPosition() const { return m_SuvPosition; }
    float SuvYaw() const { return m_SuvYaw; }   // atan2(-dir.z, dir.x): el frente es +X local, como el trafico
    float SuvSpeed() const { return m_Speed; }
    bool SuvBraking() const { return m_Braking; }
    float WheelTurn() const { return m_Wheel; }
    float Cooldown() const { return m_Cooldown; }

    // Busca un tramo de calle cerca del jugador y manda la camioneta. true si viene.
    bool Trigger(const glm::vec3& player, const std::vector<Route>& routes) {
        if (Active()) return false;
        int bestRoute = -1;
        float bestAt = 0.0f, bestDistance = 1.0e9f;
        for (size_t r = 0; r < routes.size(); ++r) {
            if (!routes[r].sample || routes[r].length <= 0.0f) continue;
            for (float d = 0.0f; d < routes[r].length; d += params.sampleStep) {
                glm::vec3 p, dir;
                routes[r].sample(d, p, dir);
                const float distance = std::hypot(p.x - player.x, p.z - player.z);
                if (distance < params.reachMin || distance > params.reachMax || distance >= bestDistance) continue;
                bestDistance = distance; bestRoute = static_cast<int>(r); bestAt = d;
            }
        }
        if (bestRoute < 0) return false;
        m_Route = bestRoute;
        m_StopAt = bestAt;
        m_Distance = bestAt - params.approach;
        m_Speed = params.cruise;
        m_State = State::Arriving;
        m_Timer = 0.0f;
        m_Cooldown = params.cooldown;
        m_GaveUp = false;
        Place(routes);
        for (Member& m : m_Members) { EnterCar(m); m.act = Act::Seated; }   // vienen los tres adentro
        return true;
    }

    // Recuperacion tras morir o recargar: todos arriba y la camioneta desaparece.
    void Reset() {
        for (Member& m : m_Members) EnterCar(m);
        m_State = State::Idle;
        m_Route = -1;
        m_Speed = 0.0f;
        m_Braking = false;
    }

    // Un golpe del jugador: ni huye ni cae; aguanta, se frena un instante y, si volvia a la camioneta, vuelve por el.
    bool TakeHit(size_t index) {
        if (index >= m_Members.size() || !m_Members[index].Active()) return false;
        Member& m = m_Members[index];
        m.staggerTimer = 0.2f;
        if (m.act == Act::Return && !m.leader) m.act = Act::Chase;
        if (m.bubbleTime <= 0.0f) Say(m, "¡Ah, se las pica de bravo! ¡Ahora sí lo matamos!", 3.0f);
        return true;
    }

    // En pausa no se llama (dt 0): el mezclador no reescribe huesos quietos y las poses sumadas se acumularian.
    std::vector<Event> Update(float dt, const Context& ctx, const std::vector<Route>& routes) {
        std::vector<Event> events;
        if (dt <= 0.0f) return events;
        for (Member& m : m_Members) m.bubbleTime = std::max(0.0f, m.bubbleTime - dt);
        if (!Active()) {
            m_Cooldown = std::max(0.0f, m_Cooldown - dt);
            if (!ctx.isNight || !ctx.allowSpawn || m_Cooldown > 0.0f) return events;
            m_CheckTimer += dt;
            if (m_CheckTimer < params.checkEvery) return events;
            m_CheckTimer = 0.0f;
            if (Unit() < params.chance) Trigger(ctx.player, routes);
            return events;
        }
        if (m_Route < 0 || static_cast<size_t>(m_Route) >= routes.size()) { Reset(); return events; }
        m_Timer += dt;
        if (m_State == State::Arriving) Arrive(dt, ctx, routes, events);
        else if (m_State == State::Stopped) { if (m_Timer >= params.dropDelay) DropOff(ctx, routes, events); }
        else if (m_State == State::Out) Hunt(dt, ctx, events);
        else if (m_State == State::Leaving) Leave(dt, routes, events);
        for (Member& m : m_Members) {
            if (!m.Active()) continue;
            m.animTime += dt;
            const float target = m.leader && m.act == Act::Order && m.timer > 0.5f ? 1.0f : 0.0f;
            m.point += (target - m.point) * (1.0f - std::exp(-dt * 7.0f));
        }
        return events;
    }

private:
    std::mt19937 m_Random;
    std::array<Member, 3> m_Members{};
    State m_State = State::Idle;
    int m_Route = -1;
    float m_Distance = 0.0f, m_StopAt = 0.0f, m_Speed = 0.0f, m_Timer = 0.0f, m_CheckTimer = 0.0f, m_Cooldown = 0.0f, m_Wheel = 0.0f;
    bool m_Braking = false, m_GaveUp = false;
    glm::vec3 m_SuvPosition{0.0f}, m_SuvDirection{1.0f, 0.0f, 0.0f};
    float m_SuvYaw = 0.0f;

    float Unit() { return std::uniform_real_distribution<float>(0.0f, 1.0f)(m_Random); }
    float Ground(float x, float z) const { return ground ? ground(x, z) : 0.0f; }
    bool Walkable(float x, float z) const { return !walkable || walkable(x, z); }

    void Place(const std::vector<Route>& routes) {
        const Route& route = routes[static_cast<size_t>(m_Route)];
        float d = std::fmod(m_Distance, route.length);
        if (d < 0.0f) d += route.length;
        route.sample(d, m_SuvPosition, m_SuvDirection);
        m_SuvPosition.y = 0.0f;   // los carriles van a nivel de calle, como el trafico
        m_SuvDirection.y = 0.0f;
        if (glm::dot(m_SuvDirection, m_SuvDirection) > 1.0e-6f) m_SuvDirection = glm::normalize(m_SuvDirection);
        m_SuvYaw = std::atan2(-m_SuvDirection.z, m_SuvDirection.x);
    }

public:
    // Puerta `i`: 0 el jefe (copiloto, a la derecha), 1 la de atras a la derecha, 2 la de atras a la izquierda
    static float DoorSide(size_t i) { return i == 2 ? -1.0f : 1.0f; }
    // donde queda de pie quien se baja por la puerta `i` (el final de CarExit; el comienzo de CarEnter)
    glm::vec3 DoorPoint(size_t i) const {
        const glm::vec3 right(-m_SuvDirection.z, 0.0f, m_SuvDirection.x);   // derecha de quien va mirando hacia adelante
        glm::vec3 at = m_SuvPosition + m_SuvDirection * (params.stance.x - (i > 0 ? params.rearShift : 0.0f)) + right * (params.stance.y * DoorSide(i));
        at.y = Ground(at.x, at.z);
        return at;
    }
private:
    // al terminar de bajarse mira hacia afuera de la camioneta
    float OutwardYaw(size_t i) const {
        const glm::vec3 out = glm::vec3(-m_SuvDirection.z, 0.0f, m_SuvDirection.x) * DoorSide(i);
        return std::atan2(out.x, out.z);
    }

    void Say(Member& m, const char* text, float seconds) { m.bubble = text; m.bubbleTime = seconds; }

    void EnterCar(Member& m) {
        m.act = Act::Idle;
        m.moving = false;
        m.speed = 0.0f;
        m.attackTime = -1.0f;
        m.point = 0.0f;
        m.position = glm::vec3(0.0f, -50.0f, 0.0f);
        m.bubbleTime = 0.0f;
    }

    void Arrive(float dt, const Context& ctx, const std::vector<Route>& routes, std::vector<Event>& events) {
        const float left = m_StopAt - m_Distance;
        // frena para quedar justo al lado; si el jugador esta en el carril, frena antes de pisarlo
        const float nose = params.suvLength * 0.5f + 1.2f;
        const glm::vec3 toPlayer = ctx.player - m_SuvPosition;
        const float ahead = toPlayer.x * m_SuvDirection.x + toPlayer.z * m_SuvDirection.z;
        const float lateral = std::abs(toPlayer.x * m_SuvDirection.z - toPlayer.z * m_SuvDirection.x);
        const float stopDistance = m_Speed * m_Speed / (2.0f * params.braking);
        // a toda velocidad tambien alcanza a frenar: se cuenta lo que necesita para detenerse con el doble de freno
        const bool blocked = lateral < params.suvWidth * 0.5f + 0.6f && ahead > 0.0f && ahead < nose + 1.0f + stopDistance * 0.5f + 1.0f;
        m_Braking = blocked || left <= stopDistance + 0.5f;
        m_Speed = m_Braking ? std::max(0.0f, m_Speed - params.braking * (blocked ? 2.0f : 1.0f) * dt)
                            : std::min(params.cruise, m_Speed + params.acceleration * dt);
        if (left < 0.05f || (blocked && m_Speed < 0.3f)) m_Speed = 0.0f;
        const float step = std::min(m_Speed * dt, std::max(0.0f, left));
        m_Distance += step;
        m_Wheel += step;
        Place(routes);
        if (m_Speed == 0.0f || m_Distance >= m_StopAt - 0.05f) {
            m_Speed = 0.0f;
            m_State = State::Stopped;
            m_Timer = 0.0f;
            events.push_back({Event::Arrived});
        }
    }

    void DropOff(const Context&, const std::vector<Route>&, std::vector<Event>& events) {
        for (size_t i = 0; i < m_Members.size(); ++i) {
            Member& m = m_Members[i];
            m.door = DoorPoint(i);
            m.position = m.door;
            m.yaw = OutwardYaw(i);
            m.act = Act::Exiting;
            m.board = -params.exitDelay[i];
            m.timer = 0.0f;
            m.attackTimer = 0.5f;
            m.attackTime = -1.0f;
            m.staggerTimer = 0.0f;
            m.animTime = Unit();
            m.shoutTimer = m.leader ? 0.4f : 1.2f + Unit() * 1.5f;
        }
        Say(m_Members[0], kLeaderOrders[0], 3.0f);
        m_Members[0].shoutTimer = 3.2f;
        m_State = State::Out;
        m_Timer = 0.0f;
        m_Braking = false;
        events.push_back({Event::DroppedOff});
    }

    // Avanza CarExit / CarEnter. Al terminar de bajarse queda en la calle; al terminar de subirse, sentado.
    void Board(Member& m, float dt) {
        if (!m.Boarding()) return;
        m.board += dt * params.boardSpeed;
        if (m.act == Act::Exiting && m.board >= params.exitOut) {
            m.act = m.leader ? Act::Order : Act::Chase;
            m.timer = 0.0f;
        } else if (m.act == Act::Entering && m.board >= params.enterLength) {
            m.act = Act::Seated;
        }
    }

    void Hunt(float dt, const Context& ctx, std::vector<Event>& events) {
        bool thugsBack = true, allIn = true;
        for (size_t i = 1; i < m_Members.size(); ++i) {
            Member& m = m_Members[i];
            Board(m, dt);
            if (m.act != Act::Entering && m.act != Act::Seated) thugsBack = false;
            if (!m.Seated()) allIn = false;
            if (!m.Active()) continue;
            const Event::Kind result = Think(m, dt, ctx, false);
            if (result == Event::Swing || result == Event::Hit || result == Event::Miss) {
                Event e{result};
                e.from = m.position;
                if (result == Event::Hit) e.damage = params.damageMin + static_cast<int>(std::round(Unit() * static_cast<float>(params.damageMax - params.damageMin)));
                events.push_back(e);
            } else if (result == Event::GaveUp && !m_GaveUp) {
                m_GaveUp = true;
                events.push_back({Event::GaveUp});
            }
        }
        // el jefe se sube cuando sus muchachos ya volvieron; la camioneta arranca con los tres sentados
        Member& leader = m_Members[0];
        Board(leader, dt);
        if (leader.Active()) Think(leader, dt, ctx, thugsBack);
        if (!leader.Seated()) allIn = false;
        if (allIn) {
            m_State = State::Leaving;
            m_Timer = 0.0f;
            m_GaveUp = false;
        }
    }

    void Leave(float dt, const std::vector<Route>& routes, std::vector<Event>& events) {
        m_Speed = std::min(params.cruise * 1.2f, m_Speed + params.acceleration * 1.5f * dt);
        const float step = m_Speed * dt;
        m_Distance += step;
        m_Wheel += step;
        m_Braking = false;
        Place(routes);
        if (m_Distance - m_StopAt > params.leave) { Reset(); events.push_back({Event::Left}); }
    }

    void Face(Member& m, const glm::vec3& at, float dt, float rate) {
        float diff = std::atan2(at.x - m.position.x, at.z - m.position.z) - m.yaw;
        diff = std::remainder(diff, 6.28318530718f);
        m.yaw += diff * std::min(1.0f, dt * rate);
    }

    // Camina hacia `target` hasta quedar a `stop`; si el paso cae donde no se puede pisar, se desliza por un eje. Devuelve lo que falta.
    float MoveTowards(Member& m, const glm::vec3& target, float speed, float dt, float stop) {
        glm::vec3 toward(target.x - m.position.x, 0.0f, target.z - m.position.z);
        const float distance = glm::length(toward);
        if (distance <= stop) return distance;
        toward /= distance;
        const float step = std::min(distance - stop, speed * dt);
        glm::vec3 next = m.position + toward * step;
        if (!Walkable(next.x, next.z)) {
            if (Walkable(next.x, m.position.z)) next.z = m.position.z;
            else if (Walkable(m.position.x, next.z)) next.x = m.position.x;
            else next = m.position;
        }
        next.y = Ground(next.x, next.z);
        const float moved = std::hypot(next.x - m.position.x, next.z - m.position.z);
        m.moving = moved > 1.0e-5f;
        m.speed = moved / dt;
        m.position = next;
        return std::hypot(target.x - next.x, target.z - next.z);
    }

    bool CanReach(const Member& m, const glm::vec3& player, float range) const {
        return std::hypot(player.x - m.position.x, player.z - m.position.z) <= range && std::abs(player.y - m.position.y) < 1.2f;
    }

    void Shout(Member& m, float dt) {
        m.shoutTimer -= dt;
        if (m.shoutTimer > 0.0f) return;
        m.shoutTimer = params.shoutMin + Unit() * (params.shoutMax - params.shoutMin);
        if (m.leader) Say(m, kLeaderOrders[static_cast<size_t>(Unit() * 5.999f)], 2.6f);
        else Say(m, kThugInsults[static_cast<size_t>(Unit() * 7.999f)], 2.6f);
    }

    // Devuelve Swing, Hit, Miss, GaveUp, Left (ya subio) o Arrived (nada que contar)
    Event::Kind Think(Member& m, float dt, const Context& ctx, bool recall) {
        m.moving = false;
        m.speed = 0.0f;
        if (!m.Active()) return Event::Arrived;
        m.timer += dt;
        m.attackTimer = std::max(0.0f, m.attackTimer - dt);
        m.staggerTimer = std::max(0.0f, m.staggerTimer - dt);
        const float toPlayer = std::hypot(ctx.player.x - m.position.x, ctx.player.z - m.position.z);

        if (m.leader) {
            if (m.act == Act::Return) return GoHome(m, dt) ? Event::Left : Event::Arrived;
            if (recall) { m.act = Act::Return; return Event::Arrived; }
            Face(m, ctx.player, dt, 6.0f);   // de pie junto a la camioneta, senalando a la victima
            Shout(m, dt);
            return Event::Arrived;
        }
        if (m.act != Act::Return && (recall || !ctx.canChase || m.timer > params.giveUpTime || toPlayer > params.giveUpDistance)) {
            m.act = Act::Return;
            m.attackTime = -1.0f;
            return Event::GaveUp;
        }
        if (m.act == Act::Return) { GoHome(m, dt); return Event::Arrived; }
        if (m.attackTime >= 0.0f) m.attackTime += dt;
        if (m.staggerTimer > 0.0f) return Event::Arrived;

        Face(m, ctx.player, dt, 10.0f);
        if (m.act == Act::Windup || m.act == Act::Strike || m.act == Act::Recover) {
            m.stateTimer -= dt;
            if (m.act == Act::Windup) {
                if (m.stateTimer <= 0.0f) { m.act = Act::Strike; m.stateTimer = params.strikeTime; }
                return Event::Arrived;
            }
            if (m.act == Act::Strike) {
                if (m.stateTimer > 0.0f) return Event::Arrived;
                m.act = Act::Recover;
                m.stateTimer = params.recover;
                m.attackTimer = params.attackCooldown;
                // solo conecta si el jugador sigue al alcance al bajar la pistola (y no esta en el piso)
                return CanReach(m, ctx.player, params.attackRange + 0.4f) && !ctx.playerDown ? Event::Hit : Event::Miss;
            }
            if (m.stateTimer <= 0.0f) { m.act = Act::Chase; m.attackTime = -1.0f; }
            return Event::Arrived;
        }
        Shout(m, dt);
        if (m.attackTimer <= 0.0f && CanReach(m, ctx.player, params.attackRange) && !ctx.playerDown) {
            m.act = Act::Windup;
            m.stateTimer = params.windup;
            m.attackTime = 0.0f;
            return Event::Swing;
        }
        MoveTowards(m, ctx.player, params.chaseSpeed, dt, params.attackRange * 0.75f);
        return Event::Arrived;
    }

    bool GoHome(Member& m, float dt) {
        const float speed = m.leader ? params.walkSpeed : params.chaseSpeed * 0.7f;
        const float left = MoveTowards(m, m.door, speed, dt, 0.2f);
        Face(m, m.door, dt, 6.0f);
        if (left <= 0.3f || m.timer > params.giveUpTime + 25.0f) {   // si algo le corta el paso, igual se sube
            m.position = m.door;
            m.act = Act::Entering;
            m.board = 0.0f;
            m.moving = false;
            m.speed = 0.0f;
            m.attackTime = -1.0f;
            m.point = 0.0f;
            for (size_t i = 0; i < m_Members.size(); ++i) if (&m_Members[i] == &m) m.yaw = OutwardYaw(i);
            return true;
        }
        return false;
    }
};

}  // namespace Bazuko::Limpieza
