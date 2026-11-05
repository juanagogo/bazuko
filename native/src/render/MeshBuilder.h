#pragma once

#include <cstdint>
#include <vector>

#include <glm/glm.hpp>

#include "core/MathTypes.h"

namespace bazuko {

// Geometría en CPU. Cada vértice: posición, normal, color lineal, UV e id de casa (12 floats).
// Las primitivas se generan en coordenadas locales y se transforman con la matriz actual.
class MeshBuilder {
public:
    static constexpr int kFloatsPerVertex = 12;

    // --- transformación actual (identidad por defecto) ---
    void setTransform(const glm::mat4& m);
    const glm::mat4& transform() const { return m_; }
    // Id de casa para los vértices siguientes (0 = no pertenece a ninguna).
    void setHouse(unsigned id) { house_ = static_cast<float>(id); }

    // --- primitivas ---
    // Cuadrilátero con UV por esquina. Si el sentido de las esquinas no coincide con `normal` se corrige.
    void quad(const glm::vec3& a, const glm::vec3& b, const glm::vec3& c, const glm::vec3& d, const glm::vec3& normal,
              const Rgb& color, glm::vec2 uvA = {0, 0}, glm::vec2 uvB = {1, 0}, glm::vec2 uvC = {1, 1},
              glm::vec2 uvD = {0, 1});
    // Caja entre min y max; `bottom` añade la cara inferior. UV 0..1 por cara.
    void box(const glm::vec3& min, const glm::vec3& max, const Rgb& color, bool bottom = false);
    // Cara vertical entre dos alturas a lo largo de un borde horizontal.
    void wall(const glm::vec2& from, const glm::vec2& to, float y0, float y1, const glm::vec3& normal, const Rgb& color);
    // Cilindro vertical (o tronco) centrado en x,z con base en y0; radios de base y tapa.
    void cylinder(float radiusBottom, float radiusTop, float height, int segments, const Rgb& color, bool caps = true,
                  bool open = false);
    void cone(float radius, float height, int segments, const Rgb& color);
    // Esfera de baja resolución (icosfera subdividida `detail` veces) con sombreado plano o suave.
    void sphere(float radius, int detail, const Rgb& color, bool flat = true);
    // SphereGeometry de three.js: esfera (o casquete) con segmentos en horizontal y vertical.
    // phi recorre en horizontal y theta en vertical desde el polo +y.
    void uvSphere(float radius, int widthSegments, int heightSegments, const Rgb& color, float phiStart = 0,
                  float phiLength = 6.283185307f, float thetaStart = 0, float thetaLength = 3.141592654f);
    // CapsuleGeometry: cilindro de `length` con tapas semiesféricas (altura total length + 2·radius), centrada.
    void capsule(float radius, float length, int capSegments, int radialSegments, const Rgb& color);
    // TorusGeometry: anillo en el plano XY (eje Z).
    void torus(float radius, float tube, int radialSegments, int tubularSegments, const Rgb& color);
    // Anillo plano horizontal (mirando hacia +y) entre dos radios.
    void ring(float inner, float outer, int segments, const Rgb& color);
    // Disco horizontal mirando hacia +y.
    void disc(float radius, int segments, const Rgb& color);

    bool empty() const { return indices_.empty(); }
    const std::vector<float>& vertices() const { return vertices_; }
    const std::vector<std::uint32_t>& indices() const { return indices_; }
    size_t triangleCount() const { return indices_.size() / 3; }
    size_t vertexCount() const { return vertices_.size() / kFloatsPerVertex; }
    void append(const MeshBuilder& other);  // concatena otra malla (ya transformada)
    // Igual, pero sobrescribe el id de casa de todos sus vértices.
    void appendWithHouse(const MeshBuilder& other, unsigned houseId);
    // Triángulo suelto con normal plana (y sentido de giro según la normal calculada).
    void tri(const glm::vec3& a, const glm::vec3& b, const glm::vec3& c, const Rgb& color);
    // Límites de todos los vértices.
    bool computeBounds(glm::vec3& min, glm::vec3& max) const;

private:
    void vertex(const glm::vec3& p, const glm::vec3& n, const Rgb& c, glm::vec2 uv);
    // Invierte los triángulos desde `firstIndex` cuyo sentido de giro contradice la normal de sus vértices.
    void orient(size_t firstIndex);
    void triangle(const glm::vec3& a, const glm::vec3& b, const glm::vec3& c, const Rgb& color, bool flatNormal,
                  const glm::vec3* na = nullptr, const glm::vec3* nb = nullptr, const glm::vec3* nc = nullptr);

    glm::mat4 m_{1.0f};
    glm::mat3 nm_{1.0f};
    float house_ = 0;
    std::vector<float> vertices_;
    std::vector<std::uint32_t> indices_;
};

}  // namespace bazuko
