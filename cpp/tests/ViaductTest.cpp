// Pruebas del viaducto elevado y de las capas de movimiento (logica pura).
#include "world/Viaduct.hpp"

#include <cstdio>

using namespace Bazuko;

static int g_failures = 0;
#define CHECK(cond, ...)                                                        \
    do {                                                                        \
        if (!(cond)) {                                                          \
            ++g_failures;                                                       \
            std::printf("FALLO (%s:%d): %s -> ", __FILE__, __LINE__, #cond);    \
            std::printf(__VA_ARGS__);                                           \
            std::printf("\n");                                                  \
        }                                                                       \
    } while (0)

int main() {
    using namespace Viaduct;

    // Alturas (marco del original): a ras fuera del tablero, 7,82 m en la cresta, sin saltos y con pendiente acotada
    CHECK(Height(-200.0f) == kBase && Height(kEndZ) == kBase && Height(kEndZ + 5.0f) == kBase, "fuera del tablero va a ras");
    CHECK(std::fabs(Height(100.0f) - 7.82f) < 0.001f, "la cresta mide 7,82 m: %.3f", Height(100.0f));
    float previous = Height(kStartZ - 5.0f), worstJump = 0.0f, worstSlope = 0.0f;
    for (float z = kStartZ - 5.0f; z <= kEndZ + 5.0f; z += 0.05f) {
        const float h = Height(z);
        worstJump = std::max(worstJump, std::fabs(h - previous));
        worstSlope = std::max(worstSlope, std::fabs(Slope(z)));
        previous = h;
    }
    CHECK(worstJump < 0.03f, "salto de altura entre dos pasos de 5 cm: %.3f", worstJump);
    CHECK(worstSlope < 0.40f, "pendiente maxima: %.3f", worstSlope);
    for (float z = kStartZ; z < kCrestStartZ; z += 0.5f) CHECK(Height(z + 0.5f) >= Height(z), "la rampa norte sube de forma continua en %.1f", z);

    // El eje se desvia 44 m hacia el este para rodear Colpatria y vuelve a X 75; los carriles lo siguen sin saltos
    CHECK(BridgeCenter(40.0f) == kAxisX && std::fabs(BridgeCenter(154.0f) - (kAxisX + kDetourOffset)) < 0.01f &&
          std::fabs(BridgeCenter(300.0f) - kAxisX) < 0.01f, "el rodeo llega a 44 m en Z 154");
    for (float z = 60.0f; z < 280.0f; z += 0.5f) {
        CHECK(std::fabs(BusPathX(z + 0.5f) - BusPathX(z)) < 1.2f, "el carril salta en z=%.1f", z);
        CHECK(std::fabs(Lateral(BridgeCenter(z), z)) < 0.001f, "el eje no esta a distancia cero de si mismo en z=%.1f", z);
    }

    // Fuera del tablero (a mas de 7 m del eje, en cualquier punto de la curva) no se esta sobre el tablero ni a su altura
    for (float z = 60.0f; z < 280.0f; z += 1.0f) {
        for (float offset = kHalfWidth + 0.5f; offset < 45.0f; offset += 0.5f) {
            for (float side : {-1.0f, 1.0f}) {
                const float x = BridgeCenter(z) + side * offset;
                CHECK(!Covers(x, z) || std::fabs(Lateral(x, z)) <= kHalfWidth + 0.05f,
                      "(%.1f, %.1f) a %.1f m del eje cuenta como sobre el tablero (lateral %.2f)", x, z, offset, Lateral(x, z));
            }
        }
    }

    // El rumbo del bus en las curvas es suave: sin ruido entre cuadros consecutivos (a 8 m/s y 240 FPS avanza ~3 cm por cuadro)
    {
        float worstNoise = 0.0f;
        for (float lane : {71.5f, 78.5f}) {
            for (float direction : {-1.0f, 1.0f}) {
                float lastYaw = 0.0f, lastStep = 0.0f;
                int count = 0;
                for (float z = 70.0f; z < 270.0f; z += 0.03f, ++count) {
                    const glm::vec2 heading = BusHeading(z, lane, direction);
                    const float yaw = std::atan2(-heading.x, -heading.y);
                    const float step = std::remainder(yaw - lastYaw, 6.2831853f);   // cambio de rumbo entre cuadros (sin el salto de +-pi)
                    if (count >= 2) worstNoise = std::max(worstNoise, std::fabs(step - lastStep));
                    lastStep = step;
                    lastYaw = yaw;
                }
            }
        }
        std::printf("ruido maximo del rumbo del bus (segunda diferencia, rad): %.6f\n", worstNoise);
        CHECK(worstNoise < 0.0004f, "el rumbo del bus tiembla en las curvas: %.6f rad", worstNoise);
    }

    // Subir al tablero solo por el extremo bajo; por debajo se pasa en la cresta
    float y = 0.0f;
    bool onDeck = false;
    onDeck = StepLayer(onDeck, kAxisX, kStartZ - 1.0f, y);
    CHECK(!onDeck && y == 0.0f, "antes de la rampa se esta en la calle");
    onDeck = StepLayer(onDeck, kAxisX, kStartZ + 0.5f, y);
    CHECK(onDeck && y > 0.0f && y <= kBoardHeight, "se sube al entrar por el extremo bajo (y=%.2f)", y);
    for (float z = kStartZ + 0.5f; z < kEndZ - 0.5f; z += 0.1f) {
        onDeck = StepLayer(onDeck, BridgeCenter(z), z, y);
        CHECK(onDeck && std::fabs(y - Height(z)) < 0.001f, "se mantiene sobre el tablero hasta el final (z=%.1f)", z);
        if (!onDeck) break;
    }
    onDeck = StepLayer(onDeck, kAxisX, kEndZ + 9.0f, y);
    CHECK(!onDeck && y == 0.0f, "al salir por el extremo sur vuelve a la calle");

    bool below = false;
    below = StepLayer(below, kAxisX, 100.0f, y);
    CHECK(!below && y == 0.0f, "bajo la cresta se pasa por debajo, en la calle");
    below = StepLayer(below, kAxisX, kStartZ + 8.0f, y);
    CHECK(!below, "no se sube a la rampa por la mitad");
    CHECK(BlockedOnGround(kAxisX, kStartZ + 9.0f) && !BlockedOnGround(kAxisX, kStartZ + 0.5f) && !BlockedOnGround(kAxisX, 100.0f),
          "el muro bajo de la rampa bloquea, el extremo y la cresta no");
    CHECK(!BlockedOnGround(kAxisX + kHalfWidth + 1.0f, kStartZ + 4.0f), "fuera del tablero no hay muro");

    // Barandas
    const auto onNormal = [](float z, float offset) {
        const glm::vec2 n = BridgeNormal(z);
        return glm::vec2(BridgeCenter(z) + n.x * offset, z + n.y * offset);
    };
    const glm::vec2 rail = onNormal(100.0f, kWalkHalfWidth), middle = onNormal(100.0f, 0.0f), walk = onNormal(100.0f, 5.0f);
    CHECK(BlockedOnDeck(rail.x, rail.y, 0.35f) && !BlockedOnDeck(middle.x, middle.y, 0.35f) && !BlockedOnDeck(walk.x, walk.y, 0.35f),
          "las barandas limitan el paso");

    // Pilares: cada 14 m desde Z 50, 4 m al oeste del carril de ida, y ninguno sobre una calle
    const auto isRoad = [](float, float z) { return (z > 70.0f && z < 84.0f) || (z > 150.0f && z < 166.0f); };
    const auto pillars = PillarPositions(isRoad);
    CHECK(pillars.size() >= 12, "hay pilares (%zu)", pillars.size());
    for (const glm::vec2& pillar : pillars) {
        CHECK(!isRoad(pillar.x, pillar.y), "un pilar invade una calle en z=%.1f", pillar.y);
        CHECK(std::fabs(pillar.x - (BusPathX(pillar.y) - 4.0f)) < 0.001f, "los pilares quedan junto al carril");
    }

    if (g_failures == 0) std::printf("Viaduct: todo OK\n");
    return g_failures == 0 ? 0 : 1;
}
