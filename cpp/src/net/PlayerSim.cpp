#include "PlayerSim.hpp"

#include <algorithm>
#include <cmath>

namespace Bazuko::Net {

const Movement::World& FlatWorld() {
    static const Movement::World world = [] {
        Movement::World w;
        w.canStand = [](float x, float z) { return x >= 0.0f && x <= 400.0f && z >= -74.0f && z <= 322.0f; };
        w.vehicleImpact = [](const glm::vec3&, float&, glm::vec3&) { return false; };
        w.knockDown = [](float, const glm::vec3&) {};
        w.ragdollStep = [](float) { return glm::vec3(0.0f); };
        w.placeSafely = [](const glm::vec3& wanted) { return wanted; };
        w.ragdollReleased = []() {};
        w.groundHeight = [](float, float) { return 0.0f; };
        w.lakeFloorMinY = -100.0f;
        return w;
    }();
    return world;
}

void ApplyInput(PlayerSession& session, const PlayerInput& input, const Movement::World& world, float dt) {
    const glm::vec3 direction(input.moveX, 0.0f, input.moveZ);
    session.playerCrouching = (input.buttons & kCrouch) != 0;
    const Movement::SpeedResult speed = Movement::ComputeSpeed(session, {(input.buttons & kRun) != 0, 0.0f, false, false});
    Movement::Step(session, world, dt, direction, speed.speed);
}

PlayerInput Quantized(const PlayerInput& input) {
    BitWriter writer;
    Write(writer, input);
    BitReader reader(writer.Data());
    ReadType(reader);
    const auto back = ReadInput(reader);
    return back ? *back : input;
}

PlayerSnapshot MakeSnapshot(uint8_t id, const PlayerSession& s) {
    PlayerSnapshot snapshot;
    snapshot.id = id;
    snapshot.x = s.position.x; snapshot.y = s.position.y; snapshot.z = s.position.z;
    snapshot.yaw = s.playerYaw;
    snapshot.vx = std::clamp(s.playerVelocity.x, -kMaxVelocity, kMaxVelocity);
    snapshot.vz = std::clamp(s.playerVelocity.z, -kMaxVelocity, kMaxVelocity);
    snapshot.speed = std::sqrt(s.playerVelocity.x * s.playerVelocity.x + s.playerVelocity.z * s.playerVelocity.z);
    snapshot.flags = static_cast<uint8_t>((s.playerKnockedDown ? 2 : 0) | (s.needs[3] <= 0.0f ? 4 : 0));
    return snapshot;
}

} // namespace Bazuko::Net
