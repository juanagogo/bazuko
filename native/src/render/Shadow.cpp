#include "render/Shadow.h"

#include <cmath>

#include <glm/gtc/matrix_transform.hpp>

namespace bazuko {

ShadowFrame computeShadowFrame(const Vec3& target, const Vec3& toSun, double halfExtent, int mapSize, double lightDistance) {
    const glm::vec3 dir(static_cast<float>(toSun.x), static_cast<float>(toSun.y), static_cast<float>(toSun.z));
    glm::vec3 center(static_cast<float>(target.x), static_cast<float>(target.y), static_cast<float>(target.z));

    // Ajuste al texel: el centro se expresa en una vista de luz FIJA (no centrada en el objetivo) y se redondea
    // a la rejilla del mapa; así el mapa solo se desplaza en saltos de texel y las sombras no tiemblan.
    const glm::mat4 base = glm::lookAt(dir * static_cast<float>(lightDistance), glm::vec3(0), glm::vec3(0, 1, 0));
    const float texel = static_cast<float>(2 * halfExtent / mapSize);
    glm::vec4 c = base * glm::vec4(center, 1.0f);
    c.x = std::round(c.x / texel) * texel;
    c.y = std::round(c.y / texel) * texel;
    c.z = std::round(c.z / texel) * texel;  // la profundidad no afecta a los texels, pero estabiliza la matriz
    center = glm::vec3(glm::inverse(base) * c);

    ShadowFrame f;
    f.view = glm::lookAt(center + dir * static_cast<float>(lightDistance), center, glm::vec3(0, 1, 0));
    const float h = static_cast<float>(halfExtent);
    f.proj = glm::ortho(-h, h, -h, h, static_cast<float>(kShadowNear), static_cast<float>(kShadowFar));
    f.viewProj = f.proj * f.view;
    f.texMatrix = glm::translate(glm::mat4(1.0f), glm::vec3(0.5f)) * glm::scale(glm::mat4(1.0f), glm::vec3(0.5f)) * f.viewProj;
    return f;
}

}  // namespace bazuko
