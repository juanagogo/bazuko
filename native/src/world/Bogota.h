#pragma once

#include <memory>
#include <string>
#include <vector>

#include "core/MathTypes.h"
#include "world/BusService.h"
#include "world/CityLayout.h"
#include "world/CollisionWorld.h"
#include "world/PedestrianNavigation.h"
#include "world/TrafficRoute.h"

namespace bazuko {

struct Spot {
    double x, z;
};

struct ParkingSpot {
    double x, z, rot;
};

struct Reserved {
    Spot spawn, sell, bed, dealer, craft, shop;
    std::vector<const Spot*> all() const { return {&spawn, &sell, &bed, &dealer, &craft, &shop}; }
};

enum class VendorKind { Chaza, Fritanga };

struct Vendor {
    double x, z, rotY;
    VendorKind kind;
    std::string title;
    std::vector<std::string> items;  // ids de ítems que vende
};

// Lógica del distrito de Bogotá (centro: Santa Inés / El Cartucho y la Av. Caracas), sin render.
// Ejes: x = oriente↔occidente, z = norte↔sur. Un tile mide 2 m.
class Bogota {
public:
    Bogota();

    int width() const { return map_.width(); }
    int height() const { return map_.height(); }
    int layoutVersion() const { return kWorldLayoutVersion; }
    double populationScale() const { return populationScale_; }
    const TileMap& map() const { return map_; }
    const Reserved& reserved() const { return reserved_; }
    const std::vector<Vendor>& vendors() const { return vendors_; }

    bool isWalkableAt(double wx, double wz) const;
    double groundHeightAt(double x, double z) const;  // cota del tile bajo (x, z)
    bool isNearReserved(double x, double z, double dist = 6) const;
    Vec3 migrateSavedPosition(const Vec3& p, int version) const { return migrateStreetPosition(p, version); }

    // Puntos de aparición de basura y carros: tiles de andén/tierra/césped/plaza lejos de lo reservado.
    std::vector<Spot> spawnGrid() const;
    // Puestos de parqueo: calzada pegada al andén, lejos de cruces y de la troncal.
    std::vector<ParkingSpot> parkingSpots() const;
    // Seis circuitos de tráfico entre las calles principales.
    std::vector<TrafficRoute> trafficRoutes() const;
    BusRoute busRoute() const;
    // Tramos de tiles sólidos unidos en cajas, más la estación de la troncal.
    CollisionWorld buildCollisions() const;
    // Red de peatones con los cruces y bloqueos de este distrito.
    PedestrianNavigation createPedestrianNavigation() const;
    // Posiciones iniciales de los peatones (centro + barrios nuevos). Los vendedores van aparte.
    std::vector<Vec3> pedestrianSpawns(const PedestrianNavigation& nav) const;

private:
    TileMap map_;
    double populationScale_;
    Reserved reserved_;
    std::vector<Vendor> vendors_;
};

}  // namespace bazuko
