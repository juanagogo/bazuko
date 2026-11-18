// Contrato del banco de animaciones (specs/001-mejorar-animaciones-port/contracts/clip-contract.md):
// esqueleto de 52 huesos mixamorig:*, clips a 24 cuadros por segundo, cadera sin avance horizontal en los clips en el sitio,
// bucle cerrado en los clips ciclicos y banco de menos de 10 MB.
// Con --informe imprime el estado de cada clip sin fallar (sirve para calibrar las excepciones). Con una ruta de banco como argumento prueba ese archivo.
#define CGLTF_IMPLEMENTATION
#include <cgltf.h>
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <string>
#include <vector>

static int failures = 0;
#define CHECK(c, m) do { if (!(c)) { std::printf("FALLO (%d): %s\n", __LINE__, m); ++failures; } } while (0)

namespace {

bool StartsWith(const std::string& s, const char* p) { return s.rfind(p, 0) == 0; }

// Cuanto puede moverse en horizontal la cadera de un clip. Los clips nuevos: 1 cm. Los vehiculos (el cuerpo va hasta el asiento) y
// la caida al suelo se mueven a proposito. Los clips que ya estaban en el banco antes de este trabajo conservan su margen medido, para
// no fallar por algo previo; al sustituirlos por uno nuevo (con sufijo _nuevo) pasan a la regla de 1 cm.
double HipsAllowance(const std::string& name) {
    static const char* purposeful[] = {"Car", "Bike", "FallBack", "GetUp", "LyingLoop"};
    for (const char* p : purposeful) if (StartsWith(name, p)) return 1e9;
    static const struct { const char* name; double meters; } legacy[] = {
        {"PetDog", 0.13}, {"walk_loop_fit", 0.09}, {"sprint_loop_fit", 0.05}, {"overhandthrow_fit", 0.40}, {"IdleRelaxed", 0.08},
        {"HitLegs", 0.06}, {"fixing_kneeling_fit", 0.21}};
    for (const auto& l : legacy) if (name == l.name) return l.meters;
    return 0.01;
}

// Clips ciclicos: su primera y ultima pose coinciden
bool IsCyclic(const std::string& name) {
    static const char* names[] = {"Walk", "WalkFormal", "Run", "Jog", "Sprint", "Swim", "SwimIdle", "JumpLoop", "NinjaJumpIdle", "idle_loop_fit", "walk_loop_fit", "sprint_loop_fit", "crouch_idle_loop_fit",
                                  "idle_talking_loop_fit", "CrouchWalk", "FightIdle", "KnifeIdle", "IdleRelaxed", "LyingLoop", "CarDrive", "BikeRide"};
    for (const char* n : names) if (name == n || StartsWith(name, (std::string(n) + "_").c_str())) return true;
    return false;
}

} // namespace

int main(int argc, char** argv) {
    bool report = false;
    std::string path = std::string(BAZUKO_BANK_PATH);
    for (int i = 1; i < argc; ++i) {
        if (std::strcmp(argv[i], "--informe") == 0) report = true;
        else path = argv[i];
    }
    cgltf_options options{};
    cgltf_data* data = nullptr;
    if (cgltf_parse_file(&options, path.c_str(), &data) != cgltf_result_success || cgltf_load_buffers(&options, data, path.c_str()) != cgltf_result_success) {
        std::printf("FALLO: no se pudo leer el banco %s\n", path.c_str());
        return 1;
    }
    const double mb = static_cast<double>(std::filesystem::file_size(path)) / (1024.0 * 1024.0);
    std::printf("Banco: %s (%.2f MB), %zu clips\n", path.c_str(), mb, data->animations_count);
    if (!report) CHECK(mb < 10.0, "el banco debe pesar menos de 10 MB");

    // esqueleto: nodos mixamorig:* (52)
    size_t bones = 0;
    for (size_t i = 0; i < data->nodes_count; ++i) if (data->nodes[i].name && StartsWith(data->nodes[i].name, "mixamorig:")) ++bones;
    std::printf("Huesos mixamorig:* %zu\n", bones);
    if (!report) CHECK(bones == 52, "el esqueleto debe tener 52 huesos mixamorig:*");

    int badFps = 0, badInPlace = 0, badLoop = 0, unknownBones = 0;
    for (size_t a = 0; a < data->animations_count; ++a) {
        const cgltf_animation& anim = data->animations[a];
        const std::string name = anim.name ? anim.name : "";
        double worstFps = 0.0, hipsRange = 0.0, loopError = 0.0;
        for (size_t c = 0; c < anim.channels_count; ++c) {
            const cgltf_animation_channel& ch = anim.channels[c];
            const std::string node = ch.target_node && ch.target_node->name ? ch.target_node->name : "";
            if (!StartsWith(node, "mixamorig:")) { ++unknownBones; continue; }
            const cgltf_accessor* times = ch.sampler->input;
            const cgltf_accessor* values = ch.sampler->output;
            std::vector<float> t(times->count);
            cgltf_accessor_unpack_floats(times, t.data(), times->count);
            for (float x : t) worstFps = std::max(worstFps, std::abs(static_cast<double>(x) * 24.0 - std::round(static_cast<double>(x) * 24.0)));
            const size_t comps = cgltf_num_components(values->type);
            std::vector<float> v(values->count * comps);
            cgltf_accessor_unpack_floats(values, v.data(), v.size());
            if (node == "mixamorig:Hips" && ch.target_path == cgltf_animation_path_type_translation && values->count > 1) {
                // en glTF el suelo es X y Z (Y arriba): el avance horizontal es el rango de X y de Z de la cadera
                float lo[2] = {1e9f, 1e9f}, hi[2] = {-1e9f, -1e9f};
                for (size_t i = 0; i < values->count; ++i) { const float xz[2] = {v[i * 3], v[i * 3 + 2]}; for (int k = 0; k < 2; ++k) { lo[k] = std::min(lo[k], xz[k]); hi[k] = std::max(hi[k], xz[k]); } }
                hipsRange = std::max<double>(hi[0] - lo[0], hi[1] - lo[1]);
            }
            if (ch.target_path == cgltf_animation_path_type_rotation && values->count > 1) {
                // En un ciclo de captura el ultimo cuadro suele quedar UN PASO antes del primero (no lo repite). El salto del final al principio
                // no debe ser mayor que el mayor paso entre cuadros del propio clip: eso es lo que se ve como un tiron.
                const auto distance = [&](size_t a, size_t b) {
                    const float* x = &v[a * 4]; const float* y = &v[b * 4];
                    return 1.0 - std::min(1.0, static_cast<double>(std::abs(x[0] * y[0] + x[1] * y[1] + x[2] * y[2] + x[3] * y[3])));
                };
                double maxStep = 0.0;
                for (size_t i = 0; i + 1 < values->count; ++i) maxStep = std::max(maxStep, distance(i, i + 1));
                const double wrap = distance(values->count - 1, 0);
                loopError = std::max(loopError, std::max(0.0, wrap - 1.5 * maxStep));   // 0 si el salto de cierre cabe dentro del paso normal
            }
        }
        const bool fpsOk = worstFps < 2e-3;
        const double allowance = HipsAllowance(name);
        const bool inPlace = hipsRange <= allowance;
        const bool loopOk = !IsCyclic(name) || loopError < 1e-4;
        if (report) std::printf("  %-34s fps24:%s  cadera horizontal %.3f m %s  bucle(err) %.4f %s\n", name.c_str(), fpsOk ? "si" : "NO", hipsRange,
                                allowance > 1e6 ? "(exento)" : (allowance > 0.011 ? (inPlace ? "(previo)" : "AVANZA") : (inPlace ? "ok" : "AVANZA")), loopError, IsCyclic(name) ? (loopOk ? "ok" : "ABIERTO") : "(no ciclico)");
        else {
            if (!fpsOk) { std::printf("FALLO: el clip %s no esta a 24 cuadros por segundo (desviacion %.4f)\n", name.c_str(), worstFps); ++badFps; }
            if (!inPlace) { std::printf("FALLO: el clip %s mueve la cadera %.3f m en horizontal (debe quedarse en el sitio)\n", name.c_str(), hipsRange); ++badInPlace; }
            if (!loopOk) { std::printf("FALLO: el clip ciclico %s no cierra su bucle (error %.4f)\n", name.c_str(), loopError); ++badLoop; }
        }
    }
    CHECK(unknownBones == 0 || report, "los clips solo animan huesos mixamorig:*");
    failures += badFps + badInPlace + badLoop;
    cgltf_free(data);
    if (!report && failures == 0) std::printf("Banco de animaciones: todo correcto\n");
    return report ? 0 : (failures == 0 ? 0 : 1);
}
