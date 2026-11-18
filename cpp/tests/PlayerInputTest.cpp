// Entrada del jugador: MoveDirection debe dar exactamente lo que daba el bloque original de main() (tercera persona relativa a la camara e
// isometrica en las demas vistas) para las 16 combinaciones de W/A/S/D y cualquier giro de camara.
#include "game/PlayerInput.hpp"

#include <cstdio>
#include <cstring>
#include <random>

using namespace Bazuko;

static int failures = 0;
#define CHECK(condition, message) do { \
    if (!(condition)) { ++failures; std::printf("FALLO (%d): %s\n", __LINE__, message); } \
} while (0)

namespace {
bool Down(bool w, bool a, bool s, bool d, int which) { return which == 0 ? w : which == 1 ? a : which == 2 ? s : d; }

// copia literal del codigo anterior de main()
glm::vec3 Reference(bool w, bool a, bool s, bool d, bool thirdPerson, float camYaw) {
    glm::vec3 moveDir(0.0f);
    if (thirdPerson) {
        glm::vec3 forward = glm::normalize(glm::vec3(std::sin(camYaw), 0.0f, std::cos(camYaw)));
        glm::vec3 right = glm::normalize(glm::vec3(std::cos(camYaw), 0.0f, -std::sin(camYaw)));
        if (Down(w, a, s, d, 0)) moveDir -= forward;
        if (Down(w, a, s, d, 2)) moveDir += forward;
        if (Down(w, a, s, d, 1)) moveDir -= right;
        if (Down(w, a, s, d, 3)) moveDir += right;
    } else {
        if (Down(w, a, s, d, 0)) moveDir += glm::vec3(-1.0f, 0.0f, -1.0f);
        if (Down(w, a, s, d, 2)) moveDir += glm::vec3( 1.0f, 0.0f,  1.0f);
        if (Down(w, a, s, d, 1)) moveDir += glm::vec3(-1.0f, 0.0f,  1.0f);
        if (Down(w, a, s, d, 3)) moveDir += glm::vec3( 1.0f, 0.0f, -1.0f);
    }
    return moveDir;
}
bool SameBits(float x, float y) { return std::memcmp(&x, &y, sizeof(float)) == 0; }
}

int main() {
    std::mt19937 random(7);
    std::uniform_real_distribution<float> angle(-12.0f, 12.0f);
    long cases = 0;
    for (int keys = 0; keys < 16; ++keys) {
        for (int mode = 0; mode < 2; ++mode) {
            for (int i = 0; i < 2000; ++i) {
                PlayerInput in;
                in.forward = keys & 1; in.left = (keys >> 1) & 1; in.back = (keys >> 2) & 1; in.right = (keys >> 3) & 1;
                const float yaw = i == 0 ? 0.0f : angle(random);
                const glm::vec3 mine = MoveDirection(in, mode == 1, yaw);
                const glm::vec3 old = Reference(in.forward, in.left, in.back, in.right, mode == 1, yaw);
                ++cases;
                if (!SameBits(mine.x, old.x) || !SameBits(mine.y, old.y) || !SameBits(mine.z, old.z)) { std::printf("DIVERGE teclas %d modo %d yaw %f\n", keys, mode, yaw); ++failures; keys = 16; mode = 2; break; }
            }
        }
    }
    std::printf("Direccion de movimiento: %ld casos identicos\n", cases);
    PlayerInput idle;
    CHECK(glm::length(MoveDirection(idle, true, 1.0f)) == 0.0f, "sin teclas no hay movimiento");
    PlayerInput back; back.forward = true; back.back = true;
    CHECK(glm::length(MoveDirection(back, true, 0.7f)) < 1e-6f, "adelante y atras se anulan");
    if (failures == 0) std::printf("Entrada del jugador: todo correcto\n");
    return failures == 0 ? 0 : 1;
}
