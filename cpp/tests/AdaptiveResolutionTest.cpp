// Pruebas de AdaptiveResolution (mismas reglas que AdaptiveResolution.js del juego web).
#include "core/AdaptiveResolution.hpp"

#include <cmath>
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

// Alimenta `seconds` de cuadros a `fps` constantes; devuelve cuantas veces cambio algo
static int Feed(AdaptiveResolution& adaptive, float fps, float seconds) {
    int changes = 0;
    const int frames = static_cast<int>(fps * seconds);
    for (int frame = 0; frame < frames; ++frame)
        if (adaptive.Sample(1000.0f / fps)) ++changes;
    return changes;
}

int main() {
    AdaptiveResolution adaptive(1.25f);
    CHECK(adaptive.ratio == 1.25f && adaptive.pressure == 0, "empieza en el limite");

    // Con 60 FPS no cambia nada
    CHECK(Feed(adaptive, 60.0f, 20.0f) == 0 && adaptive.ratio == 1.25f, "60 FPS estables");

    // Un tiron aislado no baja la calidad
    adaptive.Sample(400.0f);
    CHECK(adaptive.ratio == 1.25f, "un tiron aislado");

    // 40 FPS sostenidos: baja de a 0,15 cada ventana de 3 s hasta 0,75
    adaptive.SetLimit(1.25f);
    Feed(adaptive, 40.0f, 3.1f);
    CHECK(std::fabs(adaptive.ratio - 1.10f) < 1e-4f, "primera bajada: %.2f", adaptive.ratio);
    Feed(adaptive, 40.0f, 3.1f * 3);
    CHECK(std::fabs(adaptive.ratio - 0.75f) < 1e-4f && adaptive.pressure == 0, "baja hasta el minimo: %.2f", adaptive.ratio);
    // En el minimo y aun lento: sube la presion (hasta 2)
    Feed(adaptive, 40.0f, 3.1f * 4);
    CHECK(adaptive.pressure == 2 && adaptive.ratio == 0.75f, "presion %d", adaptive.pressure);

    // Muy lento (20 FPS) baja rapido: 0,30 por ventana, y no hace falta esperar 3 s
    AdaptiveResolution slow(1.25f);
    Feed(slow, 20.0f, 1.2f);
    CHECK(std::fabs(slow.ratio - 0.95f) < 1e-4f, "bajada severa: %.2f", slow.ratio);

    // Recuperacion: 4 ventanas rapidas seguidas primero quitan presion y luego suben la escala
    Feed(adaptive, 70.0f, 3.1f * 4);
    CHECK(adaptive.pressure == 1, "primero baja la presion: %d", adaptive.pressure);
    Feed(adaptive, 70.0f, 3.1f * 4);
    CHECK(adaptive.pressure == 0, "presion 0: %d", adaptive.pressure);
    Feed(adaptive, 70.0f, 3.1f * 4);
    CHECK(std::fabs(adaptive.ratio - 0.90f) < 1e-4f, "sube la escala: %.2f", adaptive.ratio);

    // Con limite 0,75 (calidad baja) la minima es igual al limite
    AdaptiveResolution low(0.75f);
    Feed(low, 32.0f, 3.1f);
    CHECK(low.ratio == 0.75f && low.pressure == 1, "calidad baja: escala %.2f presion %d", low.ratio, low.pressure);

    // Cambiar de limite reinicia
    low.SetLimit(1.0f);
    CHECK(low.ratio == 1.0f && low.pressure == 0, "SetLimit reinicia");

    CHECK(!adaptive.Sample(-1.0f) && !adaptive.Sample(0.0f), "intervalos invalidos");

    // Modos de super-resolucion FSR / CAS
    const auto clampUpscaleMode = [](int mode) { return std::clamp(mode, 0, 2); };
    CHECK(clampUpscaleMode(-1) == 0, "modo menor que 0 cae en bilineal");
    CHECK(clampUpscaleMode(0) == 0, "modo 0 es bilineal");
    CHECK(clampUpscaleMode(1) == 1, "modo 1 es AMD CAS");
    CHECK(clampUpscaleMode(2) == 2, "modo 2 es AMD FSR 1.0");
    CHECK(clampUpscaleMode(5) == 2, "modo mayor que 2 cae en FSR 1.0");

    if (g_failures == 0) std::printf("AdaptiveResolution: todo OK\n");
    else std::printf("AdaptiveResolution: %d fallos\n", g_failures);
    return g_failures == 0 ? 0 : 1;
}
