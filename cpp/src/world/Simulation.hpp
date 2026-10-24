#pragma once

#include "CityLayout.hpp"
#include "../renderer/Model.hpp"
#include <glm/glm.hpp>
#include <array>
#include <cstdint>
#include <algorithm>
#include <functional>
#include <memory>
#include <random>
#include <string>
#include <utility>
#include <vector>

namespace Bazuko {

struct Pedestrian {
    glm::vec3 position{0.0f};
    glm::vec3 target{0.0f};
    float speed = 1.1f;
    float scale = 1.0f;
    float yaw = 0.0f;
    float animationTime = 0.0f;
    float animationOffset = 0.0f;
    float robberyCooldown = 0.0f;
    float fleeRemaining = 0.0f;
    float splatRemaining = 0.0f;
    glm::vec3 fleeDirection{0.0f};
    size_t appearance = 0;
    bool moving = false;
    glm::vec3 color{0.65f, 0.55f, 0.42f};
    std::vector<glm::vec3> route;
    size_t nextWaypoint = 0;
};

struct PedestrianAppearance {
    std::vector<std::shared_ptr<Model>> parts;
    int walkClip = -1;
    int idleClip = -1;
};

struct TrafficVehicle {
    glm::vec3 position{0.0f};
    glm::vec3 previousPosition{0.0f};
    glm::vec3 direction{1.0f, 0.0f, 0.0f};
    float speed = 5.0f;
    float cruiseSpeed = 5.0f;
    float length = 3.0f;
    float width = 1.35f;
    float yaw = 0.0f;
    glm::vec3 color{0.75f, 0.18f, 0.12f};
    bool bus = false;
    bool taxi = false;
    bool parked = false;
    bool mirrorsAvailable = true;
    bool horizontalLane = true;
    float wheelRotation = 0.0f;
    float laneCoordinate = 0.0f;
    size_t routeIndex = 0;
    float distance = 0.0f;
    float routeLength = 0.0f;
    float nextDistance = 0.0f;
    float nextSpeed = 0.0f;
    bool blockedForPerson = false;
    std::vector<glm::vec3> route;
    std::vector<float> routeCumulative;
    size_t nextWaypoint = 0;
};

struct RobberyOutcome {
    bool attempted = false;
    bool successful = false;
    bool caught = false;
    float money = 0.0f;
};

struct StreetVendor {
    glm::vec3 position{0.0f};
    glm::vec3 serverPosition{0.0f};
    glm::vec3 facing{0.0f, 0.0f, 1.0f};
    std::string name;
    bool fritanga = false;
    size_t appearance = 0;
};

struct PickupItem {
    size_t itemIndex = 0;
    glm::vec3 position{0.0f};
    bool container = false;
    bool available = true;
    float cooldownRemaining = 0.0f;
};

class Simulation {
public:
    explicit Simulation(const CityLayout& city, uint32_t seed = 42,
                        std::function<void(size_t, size_t)> modelLoadProgress = {});
    void Update(float dt, const glm::vec3& playerPosition);
    bool IsBlocked(const glm::vec3& position, float radius) const;
    bool GetVehicleImpact(const glm::vec3& position, float& speed, glm::vec3& direction) const;
    const std::vector<TrafficVehicle>& GetTrafficVehicles() const { return m_Traffic; }
    size_t GetParkedCarCount() const { return m_ParkedCars.size(); }
    const glm::vec3& GetBusPosition() const { return m_BusPosition; }
    float GetBusSpeed() const { return m_BusSpeed; }
    void Render(Renderer& renderer, float time, const glm::vec3& focusPosition) const;
    std::vector<PickupItem> CollectPickups(const glm::vec3& position, float radius);
    bool CollectPickup(size_t index, PickupItem& pickup);
    void RestorePickup(const PickupItem& pickup);
    const std::vector<PickupItem>& GetPickups() const { return m_Pickups; }
    size_t GetNearbyCar(const glm::vec3& position, float radius) const;
    size_t GetNearbyParkedCar(const glm::vec3& position, float radius) const;
    size_t GetNearbyPedestrian(const glm::vec3& position, float radius) const;
    size_t GetNearbyVendor(const glm::vec3& position, float radius) const;
    const StreetVendor& GetVendor(size_t index) const { return m_StreetVendors.at(index); }
    size_t GetStreetVendorCount() const { return m_StreetVendors.size(); }
    bool IsNearDealer(const glm::vec3& position, float radius) const;
    const glm::vec3& GetDealerPosition() const { return m_DealerPosition; }
    bool IsNearShop(const glm::vec3& position, float radius) const;
    bool IsNearRecycler(const glm::vec3& position, float radius) const;
    const glm::vec3& GetRecyclerPosition() const { return m_RecyclerPosition; }
    bool IsNearDog(const glm::vec3& position, float radius) const;
    void BefriendDog();
    bool PetDog();
    bool IsDogFriend() const { return m_DogIsFriend; }
    const glm::vec3& GetDogPosition() const { return m_DogPosition; }
    void SetDogState(bool isFriend, const glm::vec3& position, int coat);
    void SetDogCoat(int coat) { m_DogCoat = std::clamp(coat, 0, 3); }
    bool StealCar(size_t index);
    bool StealParkedCar(size_t index);
    RobberyOutcome RobPedestrian(size_t index, bool direct, const glm::vec3& source);
    void DropPoop(const glm::vec3& position);
    bool ThrowPoop(const glm::vec3& position, const glm::vec3& direction);
    size_t ConsumePoopHitCount() { return std::exchange(m_PoopHitCount, 0); }
    float GetDayProgress() const { return m_DayProgress; }
    bool IsRaining() const { return m_IsRaining; }
    void SetDayProgress(float progress) { m_Clock = std::clamp(progress, 0.0f, 1.0f); m_DayProgress = m_Clock; }
    bool IsNight() const { return m_DayProgress > 0.78f || m_DayProgress < 0.22f; }
    size_t GetPedestrianCount() const { return m_Pedestrians.size(); }
    size_t GetTrafficCount() const { return m_Traffic.size(); }
    size_t GetMissionProgress() const { return m_MissionProgress; }
    size_t GetMissionTarget() const { return m_MissionTarget; }
    bool IsMissionStarted() const { return m_MissionStarted; }
    bool IsMissionComplete() const { return m_MissionComplete; }
    const glm::vec3& GetMissionNpcPosition() const { return m_MissionNpcPosition; }
    bool IsNearMissionNpc(const glm::vec3& position, float radius) const;
    void StartMission() { m_MissionStarted = true; }
    void CompleteMission() { m_MissionComplete = true; }
    void ResetMission() { m_MissionProgress = 0; m_MissionStarted = false; m_MissionComplete = false; }
    bool CompleteMissionItem() { if (m_MissionProgress >= m_MissionTarget) return false; ++m_MissionProgress; return true; }
    void SetMissionProgress(size_t progress) { m_MissionProgress = std::min(progress, m_MissionTarget); }

private:
    struct Pigeon {
        glm::vec3 position{0.0f};
        glm::vec3 target{0.0f};
        float flightRemaining = 0.0f;
        float phase = 0.0f;
        size_t parkIndex = 0;
    };
    struct TrafficSignal {
        glm::vec3 stopPosition{0.0f};
        glm::vec3 polePosition{0.0f};
        glm::vec3 approachDirection{0.0f};
        float yaw = 0.0f;
        size_t phaseGroup = 0;
    };
    struct PoopProjectile {
        glm::vec3 position{0.0f};
        glm::vec3 velocity{0.0f};
        float lifetime = 5.0f;
    };
    struct GroundPoop {
        glm::vec3 position{0.0f};
        float lifetime = 45.0f;
    };

    bool FindSidewalkPoint(glm::vec3& point, const glm::vec3& center, float radius);
    bool FindSidewalkPath(const glm::vec3& start, const glm::vec3& target, std::vector<glm::vec3>& path) const;
    void UpdatePedestrians(float dt, const glm::vec3& playerPosition);
    void UpdateTraffic(float dt);
    void UpdateBus(float dt);
    void UpdatePickups(float dt, const glm::vec3& playerPosition);
    void UpdatePigeons(float dt, const glm::vec3& playerPosition);
    void UpdatePoop(float dt);

    const CityLayout& m_City;
    std::mt19937 m_Random;
    std::uniform_real_distribution<float> m_Unit{0.0f, 1.0f};
    std::vector<Pedestrian> m_Pedestrians;
    std::vector<TrafficVehicle> m_Traffic;
    std::vector<TrafficVehicle> m_ParkedCars;
    std::vector<PickupItem> m_Pickups;
    std::vector<float> m_CarCooldowns;
    std::vector<float> m_ParkedCarCooldowns;
    std::vector<std::vector<glm::vec3>> m_TrafficRoutes;
    std::shared_ptr<Mesh> m_PedestrianBody;
    std::shared_ptr<Mesh> m_PedestrianHead;
    std::vector<PedestrianAppearance> m_PedestrianAppearances;
    std::shared_ptr<Model> m_PedestrianAnimation;
    std::shared_ptr<Mesh> m_CarBody;
    std::shared_ptr<Mesh> m_CarCabin;
    std::shared_ptr<Mesh> m_CarGlass;
    std::shared_ptr<Mesh> m_CarRoof;
    std::shared_ptr<Mesh> m_CarWheel;
    std::shared_ptr<Mesh> m_CarRim;
    std::shared_ptr<Mesh> m_CarLamp;
    std::shared_ptr<Mesh> m_CarMirrorMesh;
    std::shared_ptr<Mesh> m_CarMirrorGlass;
    std::shared_ptr<Mesh> m_CarTaxiSign;
    std::shared_ptr<Mesh> m_BusBody;
    std::shared_ptr<Mesh> m_BusWindows;
    std::shared_ptr<Mesh> m_BusWindshield;
    std::shared_ptr<Mesh> m_BusJoint;
    std::shared_ptr<Mesh> m_BusWheel;
    std::shared_ptr<Mesh> m_BusRim;
    std::shared_ptr<Mesh> m_BusPlatform;
    std::shared_ptr<Mesh> m_BusStationGlass;
    std::shared_ptr<Mesh> m_BusCanopy;
    std::shared_ptr<Mesh> m_BusStationPost;
    std::shared_ptr<Mesh> m_BusStationSign;
    std::shared_ptr<Mesh> m_PickupMesh;
    std::vector<std::shared_ptr<Mesh>> m_PickupMeshes;
    std::shared_ptr<Model> m_CarModel;
    std::shared_ptr<Model> m_TaxiModel;
    std::shared_ptr<Model> m_BusModel;
    std::shared_ptr<Model> m_TrashBagModel;
    std::shared_ptr<Model> m_TrashContainerModel;
    std::shared_ptr<Model> m_ShelterModel;
    std::shared_ptr<Model> m_StreetLampModel;
    std::shared_ptr<Model> m_TrafficSignalModel;
    glm::mat4 m_CarModelFit{1.0f};
    glm::mat4 m_TaxiModelFit{1.0f};
    glm::mat4 m_BusModelFit{1.0f};
    glm::mat4 m_TrashBagModelFit{1.0f};
    glm::mat4 m_TrashContainerModelFit{1.0f};
    glm::mat4 m_ShelterModelFit{1.0f};
    glm::mat4 m_StreetLampModelFit{1.0f};
    glm::mat4 m_TrafficSignalModelFit{1.0f};
    std::shared_ptr<Mesh> m_StreetLampPole;
    std::shared_ptr<Mesh> m_StreetLampHead;
    std::vector<glm::vec3> m_StreetLamps;
    std::shared_ptr<Mesh> m_DogBody;
    std::shared_ptr<Mesh> m_DogHead;
    std::shared_ptr<Mesh> m_DogSnout;
    std::shared_ptr<Mesh> m_DogEar;
    std::shared_ptr<Mesh> m_DogLeg;
    std::shared_ptr<Mesh> m_DogCollar;
    std::shared_ptr<Mesh> m_DogTail;
    std::shared_ptr<Mesh> m_TreeTrunk;
    std::shared_ptr<Mesh> m_TreeCanopy;
    std::shared_ptr<Mesh> m_PigeonBody;
    std::shared_ptr<Mesh> m_PigeonWing;
    std::shared_ptr<Mesh> m_RainDrop;
    std::shared_ptr<Mesh> m_SignalPole;
    std::shared_ptr<Mesh> m_SignalHead;
    std::shared_ptr<Mesh> m_SignalLamp;
    std::shared_ptr<Mesh> m_PoopMesh;
    std::shared_ptr<Mesh> m_GroundPoopMesh;
    std::shared_ptr<Mesh> m_VendorCounter;
    std::shared_ptr<Mesh> m_VendorLeg;
    std::shared_ptr<Mesh> m_VendorGoods;
    std::shared_ptr<Mesh> m_VendorCanopy;
    std::shared_ptr<Mesh> m_VendorCanopyStripe;
    std::shared_ptr<Mesh> m_VendorPole;
    std::shared_ptr<Mesh> m_VendorGrill;
    std::shared_ptr<Mesh> m_VendorCoal;
    std::shared_ptr<Mesh> m_VendorFood;
    std::vector<StreetVendor> m_StreetVendors;
    glm::vec3 m_RecyclerPosition{-5.0f, 0.15f, 0.0f};
    glm::vec3 m_DealerPosition{-45.0f, 0.15f, -20.0f};
    std::shared_ptr<Mesh> m_RecyclerBody;
    std::shared_ptr<Mesh> m_RecyclerRoof;
    std::shared_ptr<Mesh> m_RecyclerSign;
    std::shared_ptr<Mesh> m_RecyclerSack;
    std::shared_ptr<Mesh> m_RecyclerScale;
    std::shared_ptr<Mesh> m_DealerLantern;
    std::vector<PoopProjectile> m_PoopProjectiles;
    std::vector<GroundPoop> m_GroundPoops;
    size_t m_PoopHitCount = 0;
    std::vector<TrafficSignal> m_TrafficSignals;
    std::vector<glm::vec3> m_TreePositions;
    std::vector<glm::vec3> m_GrassPositions;
    std::array<std::vector<glm::vec3>, 3> m_ParkGrassPositions;
    std::vector<Pigeon> m_Pigeons;
    std::vector<glm::vec3> m_RainOffsets;
    float m_WeatherRemaining = 180.0f;
    bool m_IsRaining = true;
    glm::vec3 m_DogPosition{4.0f, 0.0f, 4.0f};
    float m_DogYaw = 0.0f;
    float m_DogTime = 0.0f;
    float m_DogPetCooldown = 0.0f;
    int m_DogCoat = 0;
    bool m_DogIsFriend = false;
    glm::vec3 m_BusPosition{0.0f};
    glm::vec3 m_BusPreviousPosition{0.0f};
    float m_BusStartZ = 0.0f;
    float m_BusEndZ = 0.0f;
    float m_BusStationZ = 0.0f;
    float m_BusSpeed = 0.0f;
    float m_BusDwellRemaining = 0.0f;
    float m_BusWheelRotation = 0.0f;
    float m_BusStationX = 0.0f;
    bool m_BusServedStation = false;
    std::shared_ptr<Mesh> m_MissionMarker;
    glm::vec3 m_MissionNpcPosition{3.0f, 0.0f, 0.0f};
    float m_PickupSpawnTimer = 0.0f;
    float m_Elapsed = 0.0f;
    size_t m_MissionProgress = 0;
    size_t m_MissionTarget = 5;
    bool m_MissionStarted = false;
    bool m_MissionComplete = false;
    float m_Clock = 0.30f;
    float m_DayProgress = 0.30f;
    float m_PedestrianSpawnTimer = 0.0f;
};

} // namespace Bazuko
