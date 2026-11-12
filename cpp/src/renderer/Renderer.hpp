#pragma once
#include "SubstanceLook.hpp"
#include <algorithm>
#include <memory>
#include <vector>
#include <glm/glm.hpp>
#include "Camera.hpp"
#include "Shader.hpp"
#include "Buffer.hpp"
#include "Mesh.hpp"

namespace Bazuko {

class Texture;

struct alignas(16) CameraBlockData {
    glm::mat4 view;
    glm::mat4 projection;
    glm::mat4 viewProjection;
    glm::vec3 cameraPos;
    float time;
};

struct alignas(16) LightBlockData {
    glm::vec3 sunDir;
    float _pad0 = 0.0f;
    glm::vec3 sunColor;
    float _pad1 = 0.0f;
    glm::vec3 ambientColor;
    float _pad2 = 0.0f;
    glm::vec3 fogColor;
    float fogDensity = 0.012f;
    // Farolas encendidas cerca del jugador (las mas cercanas): xyz posicion y w alcance; rgb color y w intensidad
    static constexpr int kMaxLampLights = 256;   // las luces se reparten en clusters (ver Renderer::BuildClusters): cada fragmento solo evalua las de su celda
    int lampCount = 0;
    int _pad3[3] = {0, 0, 0};
    glm::vec4 lampPosition[kMaxLampLights] = {};
    glm::vec4 lampColor[kMaxLampLights] = {};
};

class Renderer {
public:
    Renderer();
    ~Renderer() = default;

    void SetViewport(int x, int y, int width, int height);
    void BeginScene(const Camera& camera, float time);
    void EndScene();
    // Escala de resolucion interna (calidad grafica): la escena se dibuja en un buffer de ese tamano y se escala a la ventana.
    // Va alrededor de BeginScene/EndScene del mundo; la vista previa del personaje no lo usa.
    // HDR: la escena se dibuja siempre en un buffer RGBA16F y la pasada final aplica el mapeo tonal ACES (BAZUKO_NOHDR=1 lo desactiva para comparar)
    // Post-proceso sobre el buffer HDR (calidad media y alta): SSAO con `aoSamples` muestras (0 lo apaga) y bloom de `bloomStrength` (0 lo apaga)
    void SetPostEffects(int aoSamples, float bloomStrength) { m_AoSamples = aoSamples; m_BloomStrength = bloomStrength; }
    // Rayos de luz del sol (calidad alta): `strength` 0 los apaga, `toSun` es la direccion hacia el sol y `color` su tono
    void SetLightShafts(float strength, const glm::vec3& toSun, const glm::vec3& color) { m_ShaftStrength = strength; m_ShaftToSun = toSun; m_ShaftColor = color; }
    // Niebla por altura: `amount` 0..1 espesa el aire cerca del suelo (la bruma de los cerros); 0 deja la niebla uniforme
    void SetHeightFog(float amount) { m_HeightFog = amount; }
    // Reflejos en pantalla de los charcos: trazan el rayo reflejado contra el cuadro anterior (color y profundidad). Calidad media y alta, camara en perspectiva
    void SetScreenReflections(bool enabled) { m_ScreenReflections = enabled; }
    // Reflejos con la normal de cada pixel (G-buffer + pasada en pantalla): calidad alta; en media se usa el cuadro anterior, que no necesita G-buffer
    void SetGBufferReflections(bool enabled) { m_GBufferReflections = enabled; }
    // Niebla volumetrica (calidad alta): `density` es la extincion por metro cerca del suelo (0 la apaga); recorre los rayos de vista con la sombra del sol
    void SetVolumetricFog(float density) { m_VolumeDensity = density; }
    void SetToneMapping(bool enabled) { m_ToneMapping = enabled; }
    void SetExposure(float exposure) { m_Exposure = exposure; }
    void SetRenderScale(float scale) { m_RenderScale = std::clamp(scale, 0.5f, 2.0f); }
    float GetRenderScale() const { return m_RenderScale; }
    void BeginScaledTarget();
    void EndScaledTarget();

    void Submit(const Mesh& mesh, const glm::mat4& transform, const glm::vec4& albedo = glm::vec4(1.0f), bool useTexture = false, bool doubleSided = false, const std::vector<glm::mat4>* skinMatrices = nullptr, int alphaMode = 0, float alphaCutoff = 0.5f, const Texture* specularTexture = nullptr, const Texture* normalTexture = nullptr);
    void SetWireframe(bool wireframe);
    // Separacion en metros (espacio del modelo) a lo largo de la normal: evita que la piel atraviese la ropa y el calzado
    void SetPushOut(float meters) { m_PushOut = meters; }
    // Amplitud en metros del vaiven de los arboles por el viento (0 = quietos); se aplica en el vertex shader
    void SetSway(float meters) { m_Sway = meters; }
    void SetGrass(bool on) { m_Grass = on; }   // las matas de pasto: gradiente de la raiz a la punta, variacion por mata y balanceo
    // Desplazamiento de las coordenadas de textura de lo que se dibuja a continuacion (letreros que corren)
    void SetUvOffset(const glm::vec2& offset) { m_UvOffset = offset; }
    // Acabado metalico de lo que se dibuja a continuacion: metallic 0..1 (pintura metalizada, aros) y rugosidad 0..1 (0 = espejo)
    void SetFinish(float metallic, float roughness) { m_Metallic = metallic; m_Roughness = roughness; }
    // Filtro de color de toda la escena (1, 1, 0 = sin cambios)
    void SetColorGrade(float contrast, float saturation, float hueDegrees) {
        m_Contrast = contrast;
        m_Saturation = saturation;
        m_HueDegrees = hueDegrees;
    }

    // Filtro de una sustancia sobre la imagen final (ver SubstanceLook.hpp): color, capa y estela; `active = false` no toca nada
    void SetSubstanceLook(const SubstanceLook& look) { m_Substance = look; }

    // Humedad del suelo 0..1 (lluvia): oscurece un poco y da brillo de charco a las superficies horizontales
    void SetWetness(float wetness) { m_Wetness = std::clamp(wetness, 0.0f, 1.0f); }

    // Iluminacion en espacio lineal con texturas sRGB (por defecto activa; BAZUKO_GAMMA=0 la apaga)
    void SetGammaCorrect(bool enabled) { m_GammaCorrect = enabled; }
    bool GetGammaCorrect() const { return m_GammaCorrect; }

    // Dibuja sin iluminacion (bombillas, ventanas): el color es el propio albedo
    void SetUnlit(bool unlit) { m_Unlit = unlit; }
    // Cielo: sin iluminacion ni niebla (estrellas)
    void SetSky(bool sky) { m_Sky = sky; }
    // Agua: oleaje en el vertex shader y color por profundidad, reflejo del cielo y brillo del sol en el fragment (textura en la unidad 0)
    void SetWater(bool water) { m_Water = water; }

    // Sombras: mapa de profundidad de la luz del sol o la luna alrededor del jugador. Se llena con lo que se dibujo en el cuadro
    // (solo lo que esta a la vista) y lo usa el cuadro siguiente. `resolution` 0 las apaga; `radius` es el alcance en metros.
    void ConfigureShadows(int resolution, float radius);
    void SetShadowCaster(bool caster) { m_ShadowCaster = caster; }   // false: el suelo y lo plano no proyectan
    void SetShadowStatic(bool isStatic) { m_ShadowStatic = isStatic; }   // la ciudad fija se dibuja en el mapa solo al recentrar
    // Al final del cuadro: `toLight` apunta de la escena hacia la luz. Deja el framebuffer y la vista como estaban.
    void RenderShadowMap(const glm::vec3& toLight, const glm::vec3& focus);
    // Sombra lejana (calidad alta): un segundo mapa de 1024 px y 170 m de radio con lo que se dibujo (sin personajes animados) que se rehace cada ~1,5 s;
    // da sombra a los edificios y al viaducto mas alla del alcance del mapa cercano
    void SetFarShadows(bool enabled) { m_FarEnabled = enabled; }
    bool ShadowsActive() const { return m_ShadowResolution > 0 && m_ShadowValid; }

    glm::vec3 GetCameraPosition() const { return m_CameraData.cameraPos; }   // posicion de la camara en el cuadro actual (halos que la miran)
    Shader& GetDefaultShader() { return *m_DefaultShader; }
    LightBlockData& GetLighting() { return m_LightingData; }

private:
    struct ShadowDraw {
        const Mesh* mesh = nullptr;
        glm::mat4 model{1.0f};
        int alphaMode = 0;
        float alphaCutoff = 0.5f, albedoAlpha = 1.0f, sway = 0.0f, pushOut = 0.0f;
        unsigned int texture = 0;
        bool useTexture = false;
        std::vector<glm::mat4> skin;
    };
    void RecordShadowCaster(const Mesh& mesh, const glm::mat4& transform, const glm::vec4& albedo, bool useTexture, int alphaMode, float alphaCutoff,
                            const std::vector<glm::mat4>* skinMatrices);
    void DrawShadowCasters(const std::vector<ShadowDraw>& casters, bool cull);
    void DestroyShadowResources();

    std::unique_ptr<Shader> m_ShadowShader;
    std::vector<ShadowDraw> m_StaticCasters, m_DynamicCasters, m_FarCasters;
    bool m_FarEnabled = false, m_FarValid = false, m_FarRecording = false;
    unsigned int m_FarTexture = 0, m_FarFbo = 0;
    int m_FarFrame = 0;
    static constexpr int kFarResolution = 1024;
    static constexpr float kFarRadius = 170.0f;
    // Tercera cascada: 450 m de radio y 1024 px con solo la geometria estatica de la ciudad (edificios, torre, viaducto); se rehace al recentrarse
    unsigned int m_UltraTexture = 0, m_UltraFbo = 0;
    bool m_UltraValid = false;
    static constexpr int kUltraResolution = 1024;
    static constexpr float kUltraRadius = 450.0f;
    glm::mat4 m_UltraLightViewProjection{1.0f}, m_UltraMatrix{1.0f};
    glm::vec3 m_UltraCenter{0.0f}, m_UltraLight{0.0f, 1.0f, 0.0f};
    glm::mat4 m_FarLightViewProjection{1.0f}, m_FarMatrix{1.0f};
    glm::vec3 m_FarCenter{0.0f};
    unsigned int m_ShadowTexture = 0, m_ShadowFbo = 0, m_StaticShadowTexture = 0, m_StaticShadowFbo = 0;
    int m_ShadowResolution = 0;
    float m_ShadowRadius = 50.0f;
    glm::mat4 m_LightViewProjection{1.0f}, m_ShadowMatrix{1.0f};
    glm::vec3 m_ShadowCenter{0.0f}, m_ShadowLightDirection{0.0f, 1.0f, 0.0f};
    bool m_ShadowValid = false, m_StaticCaptured = false, m_StaticDirty = true;
    bool m_ShadowCaster = true, m_ShadowStatic = false;

    std::unique_ptr<Shader> m_DefaultShader;
    std::unique_ptr<UniformBuffer> m_CameraUBO;
    std::unique_ptr<UniformBuffer> m_LightUBO;
    std::unique_ptr<UniformBuffer> m_SkinUBO;

    // Clustered forward shading: el volumen visible se divide en 16 x 9 x 24 celdas (profundidad logaritmica) y cada una lista las luces que la tocan
    static constexpr int kClusterX = 16, kClusterY = 9, kClusterZ = 24;
    void BuildClusters(const Camera& camera);
    unsigned int m_ClusterTableBuffer = 0, m_ClusterIndexBuffer = 0;
    unsigned int m_ClusterTableTexture = 0, m_ClusterIndexTexture = 0;   // solo en OpenGL 4.1: las mismas tablas como texture buffers
    size_t m_ClusterIndexCapacity = 0;
    std::vector<std::vector<uint32_t>> m_ClusterLists;
    std::vector<uint32_t> m_ClusterTable, m_ClusterIndices;
    CameraBlockData m_CameraData{};
    LightBlockData m_LightingData{};
    bool m_Wireframe = false;
    bool m_GammaCorrect = true;
    float m_PushOut = 0.0f;
    float m_Sway = 0.0f;
    bool m_Grass = false;
    glm::vec2 m_UvOffset{0.0f};
    float m_Metallic = 0.0f;
    float m_Roughness = 0.5f;
    float m_RenderScale = 1.0f;
    bool m_ToneMapping = true;
    float m_Exposure = 1.0f;
    bool m_HdrTarget = true;
    // Post-proceso: la profundidad se resuelve a una textura, el SSAO se calcula a media resolucion y el bloom usa una cadena de 5 reducciones
    static constexpr int kBloomLevels = 5;
    void EnsurePostResources(int width, int height);
    void RunPostEffects();
    void DrawFullscreen(Shader& shader);
    float m_ShaftStrength = 0.0f;
    glm::vec3 m_ShaftToSun{0.0f, 1.0f, 0.0f}, m_ShaftColor{1.0f, 0.85f, 0.6f};
    float m_HeightFog = 0.0f;
    float m_VolumeDensity = 0.0f;
    unsigned int m_VolumeTexture = 0, m_VolumeFbo = 0;
    bool m_PostVolumeReady = false;
    std::unique_ptr<Shader> m_VolumeShader;
    bool m_ScreenReflections = false;
    bool m_GBufferReflections = false;
    bool m_PreviousFrameValid = false;   // el cuadro anterior (color y profundidad resueltos) esta disponible para los reflejos
    glm::mat4 m_PreviousViewProjection{1.0f};
    int m_AoSamples = 0;
    float m_BloomStrength = 0.0f;
    int m_PostWidth = 0, m_PostHeight = 0;
    unsigned int m_AoTexture[2] = {0, 0}, m_AoFbo[2] = {0, 0};
    unsigned int m_BloomTexture[kBloomLevels] = {}, m_BloomFbo[kBloomLevels] = {};
    bool m_PostAoReady = false, m_PostBloomReady = false;
    std::unique_ptr<Shader> m_SsaoShader, m_SsaoBlurShader, m_BloomDownShader, m_BloomUpShader;
    unsigned int m_ScaledFbo = 0;
    unsigned int m_ScaledColor = 0;
    std::unique_ptr<Shader> m_PresentShader;   // copia la imagen escalada a la ventana multimuestra
    unsigned int m_PresentVao = 0;
    unsigned int m_ScaledDepth = 0;
    unsigned int m_MsFbo = 0, m_MsColor = 0, m_MsDepth = 0;
    // G-buffer de los reflejos en pantalla: segundo destino de color (RGBA8: normal octaedrica, reflectividad) que se resuelve a una textura
    unsigned int m_MsNormal = 0, m_ScaledNormal = 0, m_SsrTexture = 0, m_SsrFbo = 0;
    bool m_GBufferActive = false, m_PostSsrReady = false;
    std::unique_ptr<Shader> m_SsrShader;   // destino multimuestra cuando se renderiza a otra escala
    int m_ScaledWidth = 0;
    int m_ScaledHeight = 0;
    int m_ScreenViewport[4] = {0, 0, 0, 0};
    bool m_ScaledActive = false;
    bool m_Unlit = false;
    bool m_Sky = false;
    bool m_Water = false;
    float m_Wetness = 0.0f;
    float m_Contrast = 1.0f;
    float m_Saturation = 1.0f;
    SubstanceLook m_Substance;
    unsigned int m_TrailTexture = 0, m_TrailFbo = 0;   // estela de las sustancias: promedio de los ultimos cuadros en media resolucion
    int m_TrailWidth = 0, m_TrailHeight = 0;
    bool m_TrailHasData = false;
    float m_HueDegrees = 0.0f;
};

} // namespace Bazuko
