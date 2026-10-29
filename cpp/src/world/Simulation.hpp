#pragma once
#include "Atmosphere.hpp"
#include "Climate.hpp"

#include "CityLayout.hpp"
#include "BirdFlock.hpp"
#include "../renderer/Model.hpp"
#include <glm/glm.hpp>
#include "VehicleKinematics.hpp"
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
    // Pelea: reaccion a un golpe del jugador y respuesta (un peaton golpeado puede devolver los golpes)
    int reaction = 0;                 // 0 ninguna, 1 golpe en la cara, 2 en el pecho, 3 en las piernas, 4 derribado (caida, suelo y levantarse)
    float reactionTime = 0.0f;
    bool aggressive = false;
    float aggressionRemaining = 0.0f;
    float punchCooldown = 0.0f;
    float punchTime = -1.0f;          // >= 0 mientras lanza un punetazo
    bool punchLanded = false;
    bool punchCross = false;
    // Burbuja de conversacion (Npc.js del original): frase flotante sobre la cabeza
    std::string bubbleText;
    float bubbleRemaining = 0.0f;
    float bubbleCooldown = 0.0f;
    float health = 30.0f;             // mucha menos vida que el jugador (100): tres golpes o patadas lo derriban para siempre
    bool dead = false;
    bool fleeAfterPunch = false;      // descubierto robando: golpea una vez al jugador y huye
    // Conductor que se bajo de su vehiculo: `vehicleIndex` es el carro o la moto a la que vuelve cuando el jugador se aleja
    int vehicleIndex = -1;
    bool returning = false;           // camina de regreso al vehiculo (a `returnTarget`)
    bool departed = false;            // ya subio de nuevo: queda fuera de juego hasta que otro conductor reutilice la casilla
    glm::vec3 returnTarget{0.0f};
};

struct PedestrianAppearance {
    bool worn = false;               // ropa vieja y gastada (El Cartucho)
    std::string roles;               // rol de cada pieza: B cuerpo, C ropa, S calzado, H pelo, D barba, T sombrero
    int hitFaceClip = -1, hitChestClip = -1, hitLegsClip = -1;
    int fallClip = -1, lyingClip = -1, getUpClip = -1;
    int jabClip = -1, crossClip = -1;
    std::vector<std::shared_ptr<Model>> parts;
    int walkClip = -1;
    int idleClip = -1;
    int sitClip = -1;
    int runClip = -1;       // huida
    int relaxedClip = -1;   // reposo relajado con cambio de peso (variedad al esperar)
};

// Medidas que usan las animaciones del conductor de un vehiculo (marco del carro: frente +X, lado del conductor +Y, metros desde
// el centro del vehiculo). `suffix` elige los clips ajustados a ese modelo (CarEnter_<suffix>, CarDrive_<suffix>...).
struct DriverProfile {
    bool valid = false;
    std::string suffix;
    glm::vec2 seat{0.0f, 0.42f};      // donde se sienta (bajo la cadera)
    glm::vec2 stance{-0.46f, 1.20f};  // donde se para junto a la puerta o al flanco al subir y bajar
    float hipsZ = 0.0f;               // altura de la cadera sentado (0 = sin dato)
    float roofZ = 0.0f;               // altura del techo sobre el suelo del vehiculo (0 = sin dato)
};

// Conductor de un vehiculo del trafico: sentado, frenando para bajarse, bajandose, a pie (peleando), volviendo o subiendose.
// Swapping: el acompanante pasa al asiento del conductor (murio quien manejaba). Abandoned: el vehiculo queda quieto sin conductor.
enum class DriverState { Seated, Braking, Exiting, OnFoot, Returning, Entering, Swapping, Abandoned };
struct DriverInfo {
    DriverState state = DriverState::Seated;
    float timer = 0.0f;       // segundos en el estado actual (en Absent: espera antes de que el vehiculo siga)
    float boost = 0.0f;       // s que le quedan acelerando para huir
    float cooldown = 0.0f;    // s sin poder reaccionar de nuevo
    size_t appearance = 0;
    size_t pedestrianIndex = 0;
    glm::vec3 color{0.65f, 0.55f, 0.42f};   // color de la ropa: el mismo sentado, bajandose y a pie
    float shade = 0.0f;                      // tono del pelo y desfase de animacion (animationOffset del peaton)
    float idle = 0.0f;                       // s que lleva a pie sin pelear ni huir (si pasa de 1,5 s vuelve al vehiculo)
    // Acompanante del asiento delantero: si el conductor muere, pasa a manejar
    bool hasPassenger = false;
    size_t passengerAppearance = 0;
    glm::vec3 passengerColor{0.5f, 0.4f, 0.3f};
    float passengerShade = 0.0f;
};

// Vehiculo por piezas (hechas en Blender): carroceria y ruedas con su centro de giro. Las ruedas giran al rodar y las delanteras
// orientan la direccion; las piezas comparten la textura del modelo completo.
struct VehicleParts {
    struct Wheel {
        std::shared_ptr<Model> model;
        glm::vec3 center{0.0f};   // centro de la rueda en el espacio del modelo
        bool front = false;
        float radius = 0.1f;      // radio en el espacio del modelo
    };
    std::shared_ptr<Model> body;
    std::vector<Wheel> wheels;
    glm::vec3 forward{1.0f, 0.0f, 0.0f};   // frente del vehiculo en el espacio del modelo
    glm::vec3 rollAxis{0.0f, 0.0f, 1.0f};  // eje de giro de las ruedas (arriba x frente): positivo = rodar hacia delante
    // Modelos con cabina (Raptor, Renault 6): traen su propia escala y los asientos donde se sientan el conductor y los pasajeros.
    // Las coordenadas son las del modelo (glTF, frente +Z); `fit` lo lleva al espacio del carro (frente +X, suelo en Y 0).
    struct Seat { glm::vec3 position{0.0f}; float yaw = 0.0f; bool driver = false; };
    std::vector<Seat> seats;
    DriverProfile driver;   // medidas de las animaciones del conductor (json "driver")
    // Puerta del conductor como pieza aparte (solo los modelos cuya puerta es un objeto propio): gira sobre su bisagra al abrir
    std::shared_ptr<Model> door;
    bool hasPaint = false;       // tiene material "Paint": se puede teñir (los taxis van de amarillo)
    glm::vec3 doorHinge{0.0f};   // bisagra en el espacio del modelo (borde delantero, eje vertical)
    glm::mat4 fit{1.0f};
    bool ownFit = false;
    float scale = 1.0f;   // metros por unidad del modelo cuando ownFit
    float length = 4.5f, width = 1.9f;   // medidas del carro en metros cuando ownFit
    float wheelbase = 0.0f;              // distancia entre ejes en metros cuando ownFit
    bool valid() const { return body && !wheels.empty(); }
};

// Bus articulado por piezas hechas en Blender: N secciones unidas por N-1 fuelles flexibles y ruedas que giran (el bus del juego base tiene
// dos secciones y seis ruedas; el Transmilenio biarticulado, tres y ocho).
// Cada seccion sigue el eje del carril por separado, asi que en las curvas del puente el bus se dobla en las articulaciones;
// las ruedas giran al rodar y las del primer eje viran. Las coordenadas de las piezas son las del modelo original (glTF, frente +Z).
struct ArticulatedBus {
    struct Wheel {
        std::shared_ptr<Model> model;
        glm::vec3 center{0.0f};
        float radius = 0.4f;
        int axle = 0;
        bool front = false;
        int section = -1;   // seccion a la que va unida (-1: se deduce del eje, como en el biarticulado)
    };
    std::vector<std::shared_ptr<Model>> sections;
    // Fuelles: mallas con tres huesos (extremo delantero, centro, extremo trasero) que se deforman entre dos secciones contiguas
    std::vector<std::shared_ptr<Model>> bellows;
    std::vector<float> reference;   // Z del modelo donde cada seccion se ancla al eje del carril
    std::vector<float> pivotZ;      // Z del modelo de las articulaciones (centro de los fuelles)
    std::vector<Wheel> wheels;
    std::shared_ptr<Mesh> signMesh;          // letrero LED del frente: tira curva con la textura de puntos
    std::shared_ptr<Texture> signTexture;
    float signColumns = 1.0f;                // columnas de la tira completa (se desplaza por UV)
    // Ocupantes (coordenadas del modelo): el conductor va sentado en `driver` (punto sobre el asiento) y los pasajeros de pie
    // ocupan casillas del pasillo; cada bus llena unas cuantas segun un reparto fijo.
    struct Occupant { glm::vec3 position{0.0f}; float yaw = 0.0f; };
    Occupant driver;
    bool hasDriver = false;
    std::vector<Occupant> standing;
    float scale = 0.01f;     // metros por unidad del modelo
    float centerZ = 0.0f;    // Z del modelo en el centro del bus
    float groundY = 0.0f;    // Y del modelo en el suelo
    bool valid() const {
        if (sections.size() < 2 || wheels.empty() || pivotZ.size() + 1 != sections.size() || reference.size() != sections.size()) return false;
        for (const auto& section : sections) if (!section) return false;
        return true;
    }
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
    DriverInfo driver;       // quien conduce y que hace
    bool holdStop = false;   // el conductor pidio detenerse (se baja a pelear)
    BicycleState bike;       // pose cinematica (eje trasero y direccion): lo que se dibuja; la ruta solo la guia
    float wheelbase = 2.6f;  // distancia entre ejes (m)
    int variant = 0;       // 0 modelos comunes (vehiculo1/2); 1..N modelos con cabina e interior (Raptor, Renault 6, Jetta...)
    int emergency = 0;     // 0 carro comun, 1 ambulancia, 2 patrulla de policia, 3 moto de policia (rondan por las mismas rutas)
    bool parked = false;
    bool mirrorsAvailable = true;
    bool horizontalLane = true;
    float wheelRotation = 0.0f;
    float laneCoordinate = 0.0f;
    size_t routeIndex = 0;
    float distance = 0.0f;
    float routeLength = 0.0f;
    float nextDistance = 0.0f;
    // Cambio de manzana: mientras cruza de un circuito al contiguo recorre un tramo recto corto y despues pasa al circuito destino
    int connectorRoute = -1;
    float connectorLength = 0.0f;
    float connectorTargetDistance = 0.0f;
    float nextSpeed = 0.0f;
    bool blockedForPerson = false;
    bool yieldingForTraffic = false;
    bool waitingAtSignal = false;
    float forcingRemaining = 0.0f;   // s restantes de paso forzado tras un atasco
    float stalledTime = 0.0f;   // s seguidos detenido sin semaforo ni peaton
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

// Servicio de bus articulado por el carril exclusivo: recorre la troncal de extremo a extremo, para unos segundos en
// la estacion y reaparece en el extremo opuesto. `direction` -1 va hacia el norte (-Z) y +1 hacia el sur (+Z).
struct BusState {
    glm::vec3 position{0.0f};
    glm::vec3 previousPosition{0.0f};
    float speed = 0.0f;
    float dwellRemaining = 0.0f;
    float wheelRotation = 0.0f;
    float startZ = 0.0f;
    float endZ = 0.0f;
    float stationZ = 0.0f;
    float direction = -1.0f;
    float laneX = 0.0f;               // carril del eje del viaducto (78,5 hacia el norte, 71,5 hacia el sur)
    glm::vec2 heading{0.0f, -1.0f};   // direccion de la marcha (x, z): sigue la curva del rodeo de Colpatria
    bool servedStation = false;
    // Sobre el viaducto: a esa altura no interactua con lo que pasa por la calle inferior
    bool Elevated() const { return position.y > 1.6f; }
};

struct StreetVendor {
    glm::vec3 position{0.0f};
    glm::vec3 serverPosition{0.0f};
    glm::vec3 facing{0.0f, 0.0f, 1.0f};
    std::string name;
    bool fritanga = false;
    size_t appearance = 0;
    std::vector<std::string> items;   // ids del catalogo que vende este puesto
};
struct StreetLamp {
    glm::vec3 position{0.0f};
    float yaw = 0.0f;
};

// Colision en planta de un objeto fijo: circulo (half.x = radio) o caja orientada (half = semiejes locales)
struct PropCollider {
    glm::vec2 center{0.0f};
    glm::vec2 half{0.0f};
    float cosYaw = 1.0f, sinYaw = 0.0f;
    bool box = false;
};

struct PickupItem {
    size_t itemIndex = 0;        // variante visual de la bolsa (no es un objeto del inventario)
    glm::vec3 position{0.0f};
    bool container = false;
    bool available = true;
    float cooldownRemaining = 0.0f;
    std::vector<std::string> guaranteedLoot;   // materiales de la reserva del cambuche que siempre trae esta bolsa
    std::vector<std::string> pendingLoot;      // objetos que no cupieron en el costal y siguen en la bolsa
    bool pendingSorted = false;
};

struct ShadowPerson {
    glm::vec3 position{0.0f};
    float yaw = 0.0f;
    float lifetime = 20.0f;
    bool dissolving = false;
    float opacity = 0.78f;
};

struct CambucheState {
    bool base = false;
    bool techo = false;
    bool paredes = false;
    bool cama = false;
    bool fogon = false;
    bool vela = false;

    bool IsBuilt(const std::string& pieceId) const {
        if (pieceId == "base") return base;
        if (pieceId == "techo") return techo;
        if (pieceId == "paredes") return paredes;
        if (pieceId == "cama") return cama;
        if (pieceId == "fogon") return fogon;
        if (pieceId == "vela") return vela;
        return false;
    }

    void SetBuilt(const std::string& pieceId, bool built = true) {
        if (pieceId == "base") base = built;
        else if (pieceId == "techo") techo = built;
        else if (pieceId == "paredes") paredes = built;
        else if (pieceId == "cama") cama = built;
        else if (pieceId == "fogon") fogon = built;
        else if (pieceId == "vela") vela = built;
    }
};

class Simulation {
public:
    using ModelLoadProgress = std::function<void(size_t completed, size_t total, const std::string& name)>;
    explicit Simulation(const CityLayout& city, uint32_t seed = 42,
                        ModelLoadProgress modelLoadProgress = {});
    void Update(float dt, const glm::vec3& playerPosition);
    void SetPlayerFacing(const glm::vec2& facing) { m_PlayerFacing = glm::length(facing) > 0.01f ? glm::normalize(facing) : glm::vec2(0.0f, 1.0f); }
    bool IsBlocked(const glm::vec3& position, float radius) const;
    // Objetos fijos de la calle (arboles, postes, semaforos, puestos, recicladora): un circulo o una caja orientada en planta
    bool HitsProp(float x, float z, float radius) const;
    bool GetVehicleImpact(const glm::vec3& position, float& speed, glm::vec3& direction) const;
    const std::vector<TrafficVehicle>& GetTrafficVehicles() const { return m_Traffic; }
    size_t GetParkedCarCount() const { return m_ParkedCars.size(); }
    const std::vector<TrafficVehicle>& GetParkedCars() const { return m_ParkedCars; }
    // Los dos buses de la troncal: uno hacia el norte (carril este) y otro hacia el sur (carril oeste)
    const std::vector<BusState>& GetBuses() const { return m_Buses; }
    const glm::vec3& GetBusPosition() const { return m_Buses.front().position; }
    float GetBusSpeed() const { return m_Buses.front().speed; }
    void Render(Renderer& renderer, float time, const glm::vec3& focusPosition) const;
    std::vector<PickupItem> CollectPickups(const glm::vec3& position, float radius);
    bool CollectPickup(size_t index, PickupItem& pickup);
    void RestorePickup(const PickupItem& pickup);
    // Devuelve a la reserva renovable el botin garantizado de una bolsa ya vaciada: la proxima bolsa que aparezca lo trae.
    void RecycleGuaranteedLoot(const std::vector<std::string>& loot);
    const std::vector<PickupItem>& GetPickups() const { return m_Pickups; }
    // Pelea. HitPedestrian: el golpe del jugador alcanza al peaton mas cercano delante (kind 1 cara, 2 pecho, 3 piernas: derriba).
    // ConsumePlayerHit: un peaton agresivo que acierta devuelve el tipo de golpe y de donde viene.
    bool HitPedestrian(const glm::vec3& from, const glm::vec2& forward, float reach, int kind);
    bool ConsumePlayerHit(int& kind, glm::vec3& fromDirection);
    // Burbujas de los peatones cercanos: posicion sobre la cabeza, texto y opacidad
    struct PedestrianBubble { glm::vec3 position; std::string text; float alpha; };
    std::vector<PedestrianBubble> GetPedestrianBubbles(const glm::vec3& focus) const;
    void SetPlayerHygiene(float hygiene) { m_PlayerHygiene = hygiene; }
    // Posiciones de los elementos fijos de la calle (para pruebas de colocacion)
    std::vector<glm::vec3> StreetLampPositions() const { std::vector<glm::vec3> r; for (const auto& l : m_StreetLamps) r.push_back(l.position); return r; }
    std::vector<glm::vec3> TrafficSignalPoles() const { std::vector<glm::vec3> r; for (const auto& s : m_TrafficSignals) r.push_back(s.polePosition); return r; }
    const std::vector<StreetVendor>& GetStreetVendors() const { return m_StreetVendors; }
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
    // Caricia animada: el jugador se agacha frente al perro. BeginPet lo manda a sentarse delante (a `distance` m) y EndPet lo deja
    // celebrar (reverencia de juego y un salto). CanPetDog respeta el enfriamiento de las caricias.
    bool CanPetDog() const { return m_DogIsFriend && m_DogPetCooldown <= 0.0f && !m_DogPetting; }
    void BeginPet(const glm::vec3& playerPosition, float playerYaw);
    void EndPet();
    bool IsDogPetting() const { return m_DogPetting; }
    bool IsDogReadyForPet() const { return m_DogPetting && m_DogPetStage == 3 && !m_DogBusy; }   // ya esta sentado delante, de frente
    bool IsDogFriend() const { return m_DogIsFriend; }
    const glm::vec3& GetDogPosition() const { return m_DogPosition; }
    void SetDogState(bool isFriend, const glm::vec3& position, int coat);
    void SetDogCoat(int coat) { m_DogCoat = std::clamp(coat, 0, 3); }
    // Tamano (0,6 a 1,6) y accesorio de El Chato: 0 ninguno, 1 bufanda roja, 2 gorra bogotana, 3 collar azul
    void SetDogLook(float size, int accessory) {
        m_DogSize = std::clamp(size, 0.6f, 1.6f);
        m_DogAccessory = std::clamp(accessory, 0, 3);
    }
    bool StealCar(size_t index);
    // Conductores: robarles el retrovisor o golpear el vehiculo los provoca (huyen acelerando o se bajan a pelear y despues vuelven)
    bool ProvokeDriver(size_t index);
    bool HitVehicle(const glm::vec3& from, const glm::vec2& forward, float reach);
    bool StealParkedCar(size_t index);
    RobberyOutcome RobPedestrian(size_t index, bool direct, const glm::vec3& source);
    void DropPoop(const glm::vec3& position);
    bool ThrowPoop(const glm::vec3& position, const glm::vec3& direction);
    size_t ConsumePoopHitCount() { return std::exchange(m_PoopHitCount, 0); }
    // Farolas mas cercanas al foco (posicion de la bombilla), para encender solo las que se ven
    // Cada elemento: posicion de la bombilla (xyz) y atenuacion 0..1 (w) que apaga suavemente la ultima de la lista
    // para que no aparezcan de golpe al avanzar.
    std::vector<glm::vec4> GetNearestLampLights(const glm::vec3& focus, size_t maxCount, float maxDistance) const;
    // 0..1: las bombillas se dibujan encendidas
    void SetLampGlow(float glow) { m_LampGlow = glow; }
    float GetDayProgress() const { return m_DayProgress; }
    bool IsRaining() const { return m_RainIntensity > Climate::kRainThreshold; }
    // Intensidad de la lluvia 0..1: sube y baja despacio, y cambia de ritmo mientras llovizna
    float GetRainIntensity() const { return m_RainIntensity; }
    // Niebla baja 0..1 (neblina de los cerros)
    float GetMist() const { return m_Mist; }
    // Hora del dia 0..24
    float GetHour() const { return m_DayProgress * 24.0f; }
    // Humedad 0..1: sube con la llovizna (hasta 0,25/s) y se seca despacio (0,04/s); el suelo se ve mojado
    float GetWetness() const { return m_ReducedWeather ? 0.0f : m_Wetness; }
    // Aviso del ultimo cambio de clima (nullptr si no hay ninguno pendiente); se consume al leerlo
    const char* ConsumeWeatherChange() { const char* toast = m_WeatherToast; m_WeatherToast = nullptr; return toast; }
    // Dia de juego (1 = primer dia), temporada vigente y estado del tiempo; el dia sube al pasar la medianoche y al dormir
    int GetDay() const { return m_Day; }
    void SetDay(int day) { m_Day = std::max(1, day); }
    const Climate::Season& GetSeason() const { return Climate::SeasonForDay(m_Day); }
    Climate::Weather GetWeather() const { return m_WeatherType; }
    // Cobertura de nubes 0..1, viento 0..1 y destello del relampago 0..1.8 (dos destellos seguidos)
    float GetCloudCover() const { return m_ReducedWeather ? 0.0f : m_CloudCover; }
    float GetWind() const { return m_Wind; }
    float GetLightningFlash() const { return m_ReducedWeather ? 0.0f : m_LightningFlash; }
    // Dormir en el cambuche: amanece a las 6:00 del dia siguiente (o de este mismo dia si aun es de madrugada)
    void SleepUntilMorning() { if (m_DayProgress >= 0.30f) ++m_Day; SetDayProgress(0.30f); }
    void SetWeather(Climate::Weather weather) { m_WeatherType = weather; m_WeatherRemaining = 180.0f; }
    // Calidad baja: menos gotas y sin suelo mojado
    void SetReducedWeather(bool reduced) { m_ReducedWeather = reduced; }
    void SetDayProgress(float progress) { m_Clock = std::clamp(progress, 0.0f, 1.0f); m_DayProgress = m_Clock; }
    // Noche de 20:00 a 6:00, como el original
    bool IsNight() const { return m_DayProgress >= 20.0f / 24.0f || m_DayProgress < 6.0f / 24.0f; }
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

    // Cambuche (Refugio de 6 piezas)
    bool IsNearCambuche(const glm::vec3& position, float radius = 3.5f) const {
        return glm::distance(glm::vec2(position.x, position.z), glm::vec2(112.98f, 94.64f)) < radius;
    }
    const glm::vec3& GetCambuchePosition() const { return m_CambuchePosition; }
    const glm::vec3& GetCambucheSpawnPosition() const { return m_CambucheSpawnPosition; }
    const CambucheState& GetCambucheState() const { return m_CambucheState; }
    void SetCambucheState(const CambucheState& state) { m_CambucheState = state; }
    bool BuildCambuchePiece(const std::string& pieceId);

    // Psicosis / Sombras espectrales (Gente Sombra)
    void UpdatePsychosis(float dt, const glm::vec3& playerPosition, float severity);
    const std::vector<ShadowPerson>& GetShadowPeople() const { return m_ShadowPeople; }

private:
    // Las aves viven en BirdFlock (world/BirdFlock.hpp): posan en suelo, arboles y postes por todo el mapa.
    enum class RatState {
        Idle,
        Scurrying,
        Scavenging,
        Fleeing
    };
    struct Rat {
        glm::vec3 position{0.0f};
        glm::vec3 target{0.0f};
        float yaw = 0.0f;
        float targetYaw = 0.0f;
        float speed = 0.0f;
        float stateTimer = 0.0f;
        float animTime = 0.0f;
        float sniffOffset = 0.0f;
        RatState state = RatState::Idle;
        float fleeRemaining = 0.0f;
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
    void UpdateDrivers(float dt, const glm::vec3& playerPosition);
    void AssignVehicleModel(TrafficVehicle& vehicle);
    void OnDriverDeath(size_t index);                   // el conductor murio: pasa el acompanante o queda abandonado
    void RespawnAbandoned(TrafficVehicle& vehicle);     // fuera de la vista: el vehiculo se retira y aparece otro con conductor   // elige un modelo con puerta que se abre para carros del trafico y estacionados
    void VehiclePose(const TrafficVehicle& vehicle, glm::vec3& position, float& yaw) const;
    DriverProfile ProfileFor(const TrafficVehicle& vehicle) const;
    glm::vec3 VehicleLocalToWorld(const glm::vec3& position, float yaw, const glm::vec2& carFrame) const;
    glm::vec3 m_LastPlayerPosition{0.0f};
    void UpdateTraffic(float dt);
    void UpdateBus(float dt);
    void UpdatePickups(float dt, const glm::vec3& playerPosition);
    void UpdatePigeons(float dt, const glm::vec3& playerPosition);
    void BuildBirdSpots();
    void UpdateRats(float dt, const glm::vec3& playerPosition);
    void UpdatePoop(float dt);

    const CityLayout& m_City;
    std::mt19937 m_Random;
    std::uniform_real_distribution<float> m_Unit{0.0f, 1.0f};
    std::vector<Pedestrian> m_Pedestrians;
    struct PlayerHit { int kind; glm::vec3 from; };
    std::vector<PlayerHit> m_PlayerHits;
    std::shared_ptr<Mesh> m_BloodMesh;
    float m_PlayerHygiene = 100.0f;
    std::vector<TrafficVehicle> m_Traffic;
    std::vector<TrafficVehicle> m_ParkedCars;
    std::vector<PickupItem> m_Pickups;
    std::vector<float> m_CarCooldowns;
    std::vector<float> m_ParkedCarCooldowns;
    std::vector<std::vector<glm::vec3>> m_TrafficRoutes;
    // Conexiones entre circuitos contiguos: en el punto `distance` de un circuito se puede seguir derecho al circuito `target`
    // (en `targetDistance`), por un tramo recto de `connectorLength` metros (0 si los circuitos comparten el carril)
    struct RouteBranch { float distance; size_t target; float targetDistance; float connectorLength; glm::vec3 from, to; };
    std::vector<std::vector<RouteBranch>> m_RouteBranches;
    std::vector<std::vector<float>> m_RouteCumulative;
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
    glm::vec3 m_CambuchePosition{112.98f, 0.0f, 94.64f};
    glm::vec3 m_CambucheSpawnPosition{112.98f, 0.0f, 97.84f};
    CambucheState m_CambucheState{};
    std::shared_ptr<Mesh> m_CambucheBaseMesh;
    std::shared_ptr<Mesh> m_CambucheMarkerMesh;
    std::shared_ptr<Mesh> m_CambucheFireMesh;
    std::shared_ptr<Mesh> m_CambucheBedMesh;
    std::shared_ptr<Model> m_StreetLampModel;
    std::shared_ptr<Model> m_TrafficSignalModel;
    std::shared_ptr<Model> m_TreeModel;
    std::shared_ptr<Model> m_VendorChairModel;
    std::shared_ptr<Model> m_VendorCartModel;
    std::shared_ptr<Model> m_GrassModel;
    std::array<std::shared_ptr<Model>, 2> m_BirdModels;
    // Aves por piezas (cuerpo, cabeza, patas, ala izquierda interior/exterior, ala derecha interior/exterior): permiten batir las alas
    // con hombro y muneca. Si faltan, se dibuja el modelo completo rigido.
    static constexpr size_t kBirdPartCount = 8;
    std::array<std::array<std::shared_ptr<Model>, kBirdPartCount>, 2> m_BirdParts;
    std::shared_ptr<Model> m_RatModel;
    std::shared_ptr<Model> m_PetModel;
    std::shared_ptr<Model> m_DogModel;   // perro.glb: El Chato con huesos animados por codigo (modelo propio del juego web)
    // Animacion del perro: marcha segun la velocidad, posturas (sentado, echado, olfateando), cola y orejas
    float m_DogSpeed = 0.0f, m_DogStill = 0.0f, m_DogPhase = 0.0f, m_DogHappy = 0.0f, m_DogHop = -1.0f;
    float m_DogSit = 0.0f, m_DogLie = 0.0f, m_DogSniff = 0.0f, m_DogHeadYaw = 0.0f;
    std::vector<Model::BoneTurn> BuildDogPose() const;
    // El Chato con animaciones propias (chato.glb: 38 clips del Pitbull): marcha, posturas, juego y caricias
    std::shared_ptr<Model> m_ChatoModel, m_ChatoLibrary;
    struct DogClips { int idle = -1, idleLook = -1, idleSniff = -1, idleAlert = -1, walk = -1, trot = -1, run = -1, turnLeft = -1, turnRight = -1,
                      sitStart = -1, sit = -1, sitEnd = -1, lieStart = -1, lie = -1, lieEnd = -1, sleepStart = -1, sleep = -1, sleepEnd = -1,
                      bowStart = -1, bow = -1, bowEnd = -1, jump = -1; } m_DogClips;
    // Nombres de huesos del modelo animado del perro (cambian segun el modelo: Labrador o el Pitbull restringido) y apoyo en el suelo
    struct DogRig {
        std::array<const char*, 4> tail{"tail_01_031", "tail_02_032", "tail_03_033", "tail_04_034"};
        const char* neck = "neck_07";
        const char* head = "head_08";
        const char* heightBone = "Spine_base_02";
        int tailAxis = 1;                                  // eje local (0 x, 1 y, 2 z) sobre el que se mueve la cola de lado a lado
        float liftSit = 0.018f, liftLie = 0.016f, liftSleep = 0.021f, liftOther = 0.003f;   // subida (m) para que la malla apoye sin hundirse
    } m_DogRig;
    std::array<float, 3> m_DogGaitSpeed{};   // m/s a ritmo natural de caminar, trotar y correr (se mide al cargar)
    enum class DogPosture { Sleep = 0, Lie = 1, Stand = 2, Sit = 3 };
    DogPosture m_DogPosture = DogPosture::Stand;
    int m_DogClip = -1, m_DogPrevClip = -1;
    float m_DogClipTime = 0.0f, m_DogPrevTime = 0.0f, m_DogFade = 0.0f, m_DogRate = 1.0f, m_DogIdleTimer = 0.0f;
    bool m_DogClipLoop = true, m_DogBusy = false;   // m_DogBusy: suena un clip que no se interrumpe (transicion de postura, salto...)
    std::vector<std::pair<int, float>> m_DogQueue;  // clips encadenados {clip, segundos en bucle (0 = una vez)}
    float m_DogQueueLoop = 0.0f;
    bool m_DogPetting = false;
    int m_DogPetStage = 0;   // 1 se acerca, 2 se sienta de frente, 3 espera la caricia, 4 celebra
    glm::vec3 m_DogPetAnchor{0.0f};
    glm::vec3 m_DogPetPlayer{0.0f};
    float m_DogYawTarget = 0.0f;
    void UpdateDogAnimation(float dt, float targetSpeed);
    void DogPlay(int clip, bool loop, float rate = 1.0f);
    float MeasureDogGait(int clip) const;
    glm::mat4 m_CarModelFit{1.0f};
    glm::mat4 m_TaxiModelFit{1.0f};
    // carro, taxi, ambulancia, patrulla, moto y despues los modelos con cabina (variant 1..N en `kCabinModels`)
    static constexpr size_t kCabinVariants = 7;
    std::array<VehicleParts, 5 + kCabinVariants> m_VehicleParts;
    VehicleParts LoadVehicleParts(const std::string& modelsRoot, const std::string& stem) const;
    ArticulatedBus m_ArticulatedBus;
    void LoadArticulatedBus(const std::string& modelsRoot);
    bool LoadArticulatedBusFrom(const std::string& folder, const char* specFile);
    void DrawArticulatedBus(Renderer& renderer, const BusState& bus, size_t busIndex, float opacity, float time, const glm::vec3& focus) const;
    std::array<std::shared_ptr<Model>, 3> m_EmergencyModels;   // ambulancia, patrulla, moto
    std::array<glm::mat4, 3> m_EmergencyFits{{glm::mat4(1.0f), glm::mat4(1.0f), glm::mat4(1.0f)}};
    glm::mat4 m_BusModelFit{1.0f};
    glm::mat4 m_TrashBagModelFit{1.0f};
    glm::mat4 m_TrashContainerModelFit{1.0f};
    glm::mat4 m_ShelterModelFit{1.0f};
    glm::mat4 m_StreetLampModelFit{1.0f};
    glm::mat4 m_TrafficSignalModelFit{1.0f};
    glm::mat4 m_TreeModelFit{1.0f};
    glm::mat4 m_VendorChairModelFit{1.0f};
    glm::mat4 m_VendorCartModelFit{1.0f};
    glm::mat4 m_GrassModelFit{1.0f};
    std::array<glm::mat4, 2> m_BirdModelFits{{glm::mat4(1.0f), glm::mat4(1.0f)}};
    glm::mat4 m_RatModelFit{1.0f};
    glm::mat4 m_PetModelFit{1.0f};
    std::shared_ptr<Mesh> m_StreetLampPole;
    std::shared_ptr<Mesh> m_StreetLampHead;
    std::shared_ptr<Mesh> m_LampBulb;
    std::shared_ptr<Mesh> m_LampHalo;
    std::vector<StreetLamp> m_StreetLamps;
    std::vector<PropCollider> m_PropColliders;
    void BuildPropColliders();
    float m_LampGlow = 0.0f;
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
    BirdFlock m_Birds{11};
    std::vector<glm::vec2> m_BirdDisturbances;
    std::vector<glm::vec3> m_RatWalkPoints;
    std::vector<Rat> m_Rats;
    std::vector<glm::vec3> m_RainOffsets;
    float m_WeatherRemaining = 180.0f;
    int m_Day = 1;
    Climate::Weather m_WeatherType = Climate::Weather::Drizzle;   // la partida empieza lloviznando, como el original
    float m_CloudCover = 0.92f;
    float m_Wind = 0.3f;
    float m_FogMultiplier = 1.25f;
    float m_LightningChance = 0.0f;
    float m_LightningFlash = 0.0f;
    float m_FlashTime = -1.0f;
    float m_NextLightning = 6.0f;
    const char* m_WeatherToast = nullptr;
    float m_RainIntensity = 0.3f;
    float m_Mist = 0.0f;
    float m_MistTarget = 0.0f;
    float m_Wetness = 0.6f;   // como el original: la partida empieza lloviznando con el suelo humedo
    bool m_ReducedWeather = false;
    glm::vec3 m_DogPosition{4.0f, 0.0f, 4.0f};
    float m_DogYaw = 0.0f;
    float m_DogTime = 0.0f;
    float m_DogPetCooldown = 0.0f;
    int m_DogCoat = 0;
    float m_DogSize = 1.0f;
    int m_DogAccessory = 0;
    std::shared_ptr<Mesh> m_DogScarf;
    std::shared_ptr<Mesh> m_DogBand;
    std::shared_ptr<Mesh> m_DogCap;
    std::shared_ptr<Mesh> m_DogVisor;
    bool m_DogIsFriend = false;
    std::vector<BusState> m_Buses;
    std::shared_ptr<Mesh> m_MissionMarker;
    glm::vec3 m_MissionNpcPosition{3.0f, 0.0f, 0.0f};
    float m_PickupSpawnTimer = 0.0f;
    std::vector<std::vector<std::string>> m_RenewableLoot;
    float m_Elapsed = 0.0f;
    std::vector<glm::vec3> m_ValidTrashSpots;  // Andenes limpios sin bloqueo
    glm::vec2 m_PlayerFacing{0.0f, 1.0f};      // Dirección de vista del jugador (XZ)
    size_t m_MissionProgress = 0;
    size_t m_MissionTarget = 5;
    bool m_MissionStarted = false;
    bool m_MissionComplete = false;
    float m_Clock = 0.30f;
    float m_DayProgress = 0.30f;
    float m_PedestrianSpawnTimer = 0.0f;
    std::vector<ShadowPerson> m_ShadowPeople;
    std::shared_ptr<Mesh> m_ShadowHeadMesh;
    std::shared_ptr<Mesh> m_ShadowEyeMesh;
    std::shared_ptr<Mesh> m_ShadowTorsoMesh;
    std::shared_ptr<Mesh> m_ShadowLegMesh;
};

} // namespace Bazuko
