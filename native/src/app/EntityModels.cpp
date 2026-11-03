#include "app/EntityModels.h"

#include <cmath>

#include <glm/gtc/matrix_transform.hpp>

namespace bazuko {

namespace {

using glm::mat4;
using glm::vec3;

mat4 at(double x, double y, double z, double rotY = 0, double scale = 1) {
    mat4 m = glm::translate(mat4(1.0f), vec3(static_cast<float>(x), static_cast<float>(y), static_cast<float>(z)));
    m = glm::rotate(m, static_cast<float>(rotY), vec3(0, 1, 0));
    return glm::scale(m, vec3(static_cast<float>(scale)));
}

Rgb hex(std::uint32_t h) { return rgbFromHex(h); }

// Carro: la carrocería va aparte para teñirla con la pintura; el resto lleva sus colores. Frente = +X.
void buildCar(MeshBuilder& body, MeshBuilder& detail) {
    const Rgb white{1, 1, 1};
    body.box({-2.15f, 0.25f, -0.88f}, {2.15f, 1.0f, 0.88f}, white, true);
    body.box({-1.2f, 1.0f, -0.78f}, {0.95f, 1.5f, 0.78f}, white);  // cabina
    const Rgb glass = hex(0x2c3a46), tire = hex(0x151515), lamp = hex(0xfff2b8), tail = hex(0xb01818), chrome = hex(0x9aa0a6);
    detail.box({-1.15f, 1.02f, -0.8f}, {0.9f, 1.46f, 0.8f}, glass);  // cristales (asoman por los lados)
    detail.box({-1.25f, 1.0f, -0.7f}, {1.0f, 1.5f, 0.7f}, glass);
    for (float x : {-1.35f, 1.35f})
        for (float z : {-0.88f, 0.88f}) {
            detail.setTransform(at(x, 0.36, z) * glm::rotate(mat4(1.0f), 1.5708f, vec3(1, 0, 0)));
            detail.cylinder(0.36f, 0.36f, 0.22f, 10, tire);
        }
    detail.setTransform(mat4(1.0f));
    for (float z : {-0.6f, 0.6f}) {
        detail.box({2.12f, 0.6f, z - 0.18f}, {2.18f, 0.8f, z + 0.18f}, lamp);
        detail.box({-2.18f, 0.6f, z - 0.18f}, {-2.12f, 0.8f, z + 0.18f}, tail);
    }
    detail.box({2.1f, 0.3f, -0.8f}, {2.2f, 0.5f, 0.8f}, chrome);  // defensa
    detail.box({-2.2f, 0.3f, -0.8f}, {-2.1f, 0.5f, 0.8f}, chrome);
}

void buildTaxiSign(MeshBuilder& m) { m.box({-0.3f, 1.5f, -0.3f}, {0.3f, 1.7f, 0.3f}, hex(0xfff2b8)); }

void buildBag(MeshBuilder& bag, MeshBuilder& knot) {
    bag.setTransform(at(0, 0.3, 0) * glm::scale(mat4(1.0f), vec3(1.0f, 0.85f, 1.0f)));
    bag.uvSphere(0.34f, 10, 8, hex(0x1d2a22));
    bag.setTransform(at(0.1, 0.5, 0.05));
    bag.uvSphere(0.17f, 8, 6, hex(0x26382c));
    bag.setTransform(at(-0.15, 0.42, -0.1));
    bag.uvSphere(0.14f, 8, 6, hex(0x172019));
    knot.setTransform(at(0, 0.58, 0));
    knot.cone(0.1f, 0.2f, 8, hex(0x1d2a22));
}

void buildDealer(MeshBuilder& m) {
    m.setTransform(at(0, 0.9, 0));
    m.capsule(0.28f, 0.7f, 4, 8, hex(0x14141a));  // abrigo oscuro
    m.setTransform(at(0, 1.78, 0));
    m.uvSphere(0.2f, 8, 6, hex(0x14141a));  // capucha
    m.setTransform(at(0.0, 1.76, 0.16));
    m.uvSphere(0.12f, 8, 6, hex(0x8a6a50));  // cara en sombra
    m.setTransform(mat4(1.0f));
}

void buildShop(MeshBuilder& b, MeshBuilder& awning) {
    b.box({-2.6f, 0, -1.8f}, {2.6f, 3.0f, 1.8f}, hex(0xd9c9a3));
    b.box({-2.8f, 3.0f, -2.0f}, {2.8f, 3.2f, 2.0f}, hex(0x6b4a2f));
    b.box({-1.6f, 0.9f, 1.8f}, {1.6f, 2.2f, 1.86f}, hex(0x3a4a58));  // vitrina
    awning.box({-2.8f, 2.4f, 1.8f}, {2.8f, 2.55f, 3.0f}, hex(0xc8281e));
    for (int i = 0; i < 5; ++i)
        awning.box({-2.8f + i * 1.12f, 2.41f, 1.8f}, {-2.8f + i * 1.12f + 0.56f, 2.56f, 3.0f}, hex(0xf3ede2));
}

void buildCraft(MeshBuilder& m) {
    m.box({-0.8f, 0.8f, -0.45f}, {0.8f, 0.9f, 0.45f}, hex(0x8a6a44));
    for (float x : {-0.7f, 0.7f})
        for (float z : {-0.35f, 0.35f}) m.box({x - 0.05f, 0, z - 0.05f}, {x + 0.05f, 0.8f, z + 0.05f}, hex(0x5e4630));
    m.box({-0.3f, 0.9f, -0.2f}, {0.1f, 0.96f, 0.2f}, hex(0xb9b9b9));
}

// Piezas del cambuche en el orden de GameData::cambuche: base, techo, paredes, cama, fogón, vela.
void buildCambuche(MeshBuilder (&p)[6]) {
    p[0].box({-1.6f, 0, -1.2f}, {1.6f, 0.08f, 1.2f}, hex(0x8b7355));
    p[1].box({-1.8f, 2.0f, -1.4f}, {1.8f, 2.1f, 1.4f}, hex(0x2f6fb0));  // lona azul
    for (float x : {-1.6f, 1.6f})
        for (float z : {-1.2f, 1.2f}) p[2].box({x - 0.06f, 0, z - 0.06f}, {x + 0.06f, 2.0f, z + 0.06f}, hex(0x5e4630));
    p[2].box({-1.6f, 0.1f, -1.2f}, {1.6f, 1.9f, -1.14f}, hex(0xa68b5b));
    p[2].box({-1.6f, 0.1f, -1.2f}, {-1.54f, 1.9f, 1.2f}, hex(0xa68b5b));
    p[3].box({0.3f, 0.12f, -1.0f}, {1.5f, 0.5f, -0.1f}, hex(0x7a3b3b));
    p[4].setTransform(at(-0.9, 0.08, 0.8));
    p[4].cylinder(0.3f, 0.3f, 0.35f, 8, hex(0x555555), true, false);
    p[5].box({-0.04f, 0.5f, -0.04f}, {0.04f, 0.8f, 0.04f}, hex(0xf2ead0));
    p[5].setTransform(mat4(1.0f));
}

void buildMarkers(MeshBuilder& amber, MeshBuilder& red, MeshBuilder& aura, MeshBuilder& bar, MeshBuilder& green) {
    amber.ring(0.5f, 0.62f, 28, hex(0xffb020));
    red.ring(1.0f, 1.12f, 36, hex(0xe53a2a));
    aura.uvSphere(0.75f, 12, 8, hex(0xffd75a));
    green.ring(0.9f, 1.05f, 36, hex(0x3ddc84));
    bar.box({0, 0, -0.05f}, {1, 0.1f, 0.05f}, hex(0x7fe38a));
}

}  // namespace

Rgb EntityModels::paintColor(int index) {
    static const std::uint32_t paints[] = {0x2f6fb0, 0xc0392b, 0x7d8288, 0xe8e3d6, 0x1f1f1f, 0x3f7a3a, 0x7a4fa0, 0x0f6b6b};
    return hex(paints[((index % 8) + 8) % 8]);
}

EntityModels::EntityModels(Renderer& r) {
    MeshBuilder a, b, c, d;
    buildBag(a, b);
    bag_ = r.uploadMesh(a);
    bagKnot_ = r.uploadMesh(b);
    MeshBuilder amber, red, aura, bar, green;
    buildMarkers(amber, red, aura, bar, green);
    ringGreen_ = r.uploadMesh(green);
    ringAmber_ = r.uploadMesh(amber);
    ringRed_ = r.uploadMesh(red);
    aura_ = r.uploadMesh(aura);
    bar_ = r.uploadMesh(bar);

    MeshBuilder body, detail;
    buildCar(body, detail);
    buildTaxiSign(detail);
    carBody_ = r.uploadMesh(body);
    carDetail_ = r.uploadMesh(detail);

    MeshBuilder dealer, shop, awn, craft;
    buildDealer(dealer);
    buildShop(shop, awn);
    buildCraft(craft);
    dealer_ = r.uploadMesh(dealer);
    shop_ = r.uploadMesh(shop);
    shopAwning_ = r.uploadMesh(awn);
    craft_ = r.uploadMesh(craft);

    MeshBuilder parts[6];
    buildCambuche(parts);
    for (int i = 0; i < 6; ++i) cambuche_[i] = r.uploadMesh(parts[i]);

    // Bus articulado: dos cuerpos unidos por el fuelle.
    MeshBuilder bus, busD;
    const float L = static_cast<float>(kBusLength) / 2, W = static_cast<float>(kBusWidth) / 2;
    bus.box({-L, 0.45f, -W}, {L, 3.1f, W}, hex(0xb3232b));
    busD.box({-L + 0.2f, 1.6f, -W - 0.02f}, {L - 0.2f, 2.7f, W + 0.02f}, hex(0x27333d));
    busD.box({-L, 3.1f, -W}, {L, 3.18f, W}, hex(0xdddddd));
    busD.box({-0.5f, 0.5f, -W - 0.03f}, {0.5f, 3.0f, W + 0.03f}, hex(0x1c1c1c));  // fuelle
    for (float x : {-L * 0.7f, L * 0.55f, L * 0.9f})
        for (float z : {-W, W}) {
            busD.setTransform(at(x, 0.5, z) * glm::rotate(mat4(1.0f), 1.5708f, vec3(1, 0, 0)));
            busD.cylinder(0.5f, 0.5f, 0.3f, 12, hex(0x151515));
        }
    busD.setTransform(mat4(1.0f));
    bus_ = r.uploadMesh(bus);
    busDetail_ = r.uploadMesh(busD);
}

void EntityModels::collect(const Entities& e, const GameState& state, const Vec3& player, double time, const InteractionView& view,
                           std::vector<MeshDraw>& out) const {
    auto push = [&](int mesh, const mat4& model, Rgb tint = {1, 1, 1}, float alpha = 1, bool unlit = false, bool shadow = true,
                    bool noDepth = false) {
        MeshDraw d;
        d.mesh = mesh;
        d.model = model;
        d.tint = tint;
        d.alpha = alpha;
        d.unlit = unlit;
        d.castShadow = shadow;
        d.noDepthTest = noDepth;
        out.push_back(d);
    };
    auto near = [&](const Vec3& p, double range) { return std::hypot(p.x - player.x, p.z - player.z) < range; };

    for (size_t i = 0; i < e.pickups.size(); ++i) {
        const Pickup& p = e.pickups[i];
        if (p.used || !near(p.position, 60)) continue;
        const double wobble = std::sin(time * 2 + static_cast<double>(i)) * 0.02;
        const mat4 base = at(p.position.x, p.position.y + wobble, p.position.z, static_cast<double>(i));
        push(bag_, base);
        push(bagKnot_, base);
        const double pulse = 1 + std::sin(time * 3 + static_cast<double>(i)) * 0.08;
        push(ringAmber_, at(p.position.x, p.position.y + 0.04, p.position.z, time * 1.2, pulse), {1, 1, 1}, 0.9f, true, false);
        if (view.boost) push(aura_, at(p.position.x, p.position.y + 0.4, p.position.z), {1, 1, 1}, 0.28f, true, false);
        if (p.sorting) {
            const double f = std::min(1.0, p.sortProgress / view.sortTime);
            mat4 m = glm::translate(mat4(1.0f), vec3(static_cast<float>(p.position.x - 0.5), static_cast<float>(p.position.y + 1.1),
                                                     static_cast<float>(p.position.z)));
            push(bar_, glm::scale(m, vec3(static_cast<float>(f), 1, 1)), {1, 1, 1}, 1, true, false, true);
        }
    }

    for (size_t i = 0; i < e.cars.size(); ++i) {
        const ParkedCar& c = e.cars[i];
        if (!near(c.position, 120)) continue;
        const mat4 m = at(c.position.x, c.position.y, c.position.z, c.rotation);
        push(carBody_, m, c.taxi ? hex(0xf2c300) : paintColor(c.paint));
        push(carDetail_, m);
        if (!c.used) push(ringRed_, at(c.position.x, c.position.y + 0.05, c.position.z, time, 1 + std::sin(time * 3) * 0.06), {1, 1, 1}, 0.85f, true, false);
    }

    // Los edificios se retrasan para que su fachada quede a ~0,5 m del punto de interacción y el jugador
    // pueda llegar hasta ahí sin que lo frene su propia colisión.
    auto place = [&](int mesh, const Place& p, double back = 0, bool unlit = false) {
        if (near(p.position, 140)) push(mesh, at(p.position.x, p.position.y, p.position.z - back), {1, 1, 1}, 1, unlit);
    };
    // La recicladora y el cambuche viven en edificios/lotes del mundo: solo llevan un marcador en el suelo.
    for (const Place* p : {&e.recycler, &e.cambuche})
        if (near(p->position, 140))
            push(ringGreen_, at(p->position.x, p->position.y + 0.05, p->position.z, time * 0.8, 1 + std::sin(time * 2.5) * 0.05), {1, 1, 1}, 0.8f, true, false);
    place(shop_, e.shop, kShopBack);
    place(shopAwning_, e.shop, kShopBack);
    place(craft_, e.craft);
    if (state.clock.isNight()) place(dealer_, e.dealer);
    for (int i = 0; i < 6; ++i)
        if (state.hasBuilt(std::array<const char*, 6>{"base", "techo", "paredes", "cama", "fogon", "vela"}[i]) && near(e.cambuche.position, 140))
            push(cambuche_[i], at(e.cambuche.position.x, e.cambuche.position.y, e.cambuche.position.z));
}

void EntityModels::collectTraffic(const TrafficSystem& traffic, const BusService& bus, std::vector<MeshDraw>& out) const {
    int idx = 0;
    for (const TrafficVehicle& v : traffic.vehicles()) {
        const bool taxi = idx % 4 == 0;
        const mat4 m = at(v.position.x, v.position.y, v.position.z, v.rotationY);
        MeshDraw body;
        body.mesh = carBody_;
        body.model = m;
        body.tint = taxi ? hex(0xf2c300) : paintColor(idx);
        out.push_back(body);
        MeshDraw d;
        d.mesh = carDetail_;
        d.model = m;
        out.push_back(d);
        ++idx;
    }
    if (bus.opacity() > 0) {
        const mat4 m = at(bus.position.x, bus.position.y, bus.position.z, 0);
        MeshDraw a;
        a.mesh = bus_;
        a.model = m;
        a.alpha = static_cast<float>(bus.opacity());
        out.push_back(a);
        a.mesh = busDetail_;
        out.push_back(a);
    }
}

}  // namespace bazuko
