#include "character/Gltf.h"

#define CGLTF_IMPLEMENTATION
#include <cgltf.h>

#include <webp/decode.h>

#include <filesystem>
#include <fstream>
#include <stdexcept>

#include <glm/gtc/type_ptr.hpp>
#define GLM_ENABLE_EXPERIMENTAL
#include <glm/gtx/matrix_decompose.hpp>

namespace bazuko {

namespace {

[[noreturn]] void fail(const std::string& path, const std::string& what) {
    throw std::runtime_error("glTF " + path + ": " + what);
}

Image decodeImage(const std::string& path) {
    std::ifstream f(path, std::ios::binary);
    if (!f) fail(path, "no se pudo abrir la textura");
    std::vector<std::uint8_t> bytes((std::istreambuf_iterator<char>(f)), {});
    Image img;
    int w = 0, h = 0;
    std::uint8_t* px = WebPDecodeRGBA(bytes.data(), bytes.size(), &w, &h);
    if (!px) fail(path, "textura WebP inválida");
    img.width = w;
    img.height = h;
    img.rgba.assign(px, px + static_cast<size_t>(w) * h * 4);
    WebPFree(px);
    return img;
}

}  // namespace

int GltfModel::findNode(const std::string& name) const {
    for (size_t i = 0; i < nodes.size(); ++i)
        if (nodes[i].name == name) return static_cast<int>(i);
    return -1;
}

GltfModel loadGltf(const std::string& path, const GltfLoadOptions& options) {
    cgltf_options opts{};
    cgltf_data* data = nullptr;
    if (cgltf_parse_file(&opts, path.c_str(), &data) != cgltf_result_success) fail(path, "no se pudo leer o interpretar");
    struct Guard { cgltf_data* d; ~Guard() { cgltf_free(d); } } guard{data};
    if (cgltf_load_buffers(&opts, data, path.c_str()) != cgltf_result_success) fail(path, "no se pudieron cargar los buffers");

    GltfModel model;
    auto indexOf = [](const auto* base, const auto* p) { return p ? static_cast<int>(p - base) : -1; };

    // ----- nodos -----
    model.nodes.resize(data->nodes_count);
    for (size_t i = 0; i < data->nodes_count; ++i) {
        const cgltf_node& n = data->nodes[i];
        GltfNode& g = model.nodes[i];
        g.name = n.name ? n.name : "";
        g.parent = indexOf(data->nodes, n.parent);
        for (size_t c = 0; c < n.children_count; ++c) g.children.push_back(indexOf(data->nodes, n.children[c]));
        if (n.has_matrix) {
            glm::vec3 skew;
            glm::vec4 persp;
            glm::decompose(glm::make_mat4(n.matrix), g.scale, g.rotation, g.translation, skew, persp);
        } else {
            if (n.has_translation) g.translation = {n.translation[0], n.translation[1], n.translation[2]};
            if (n.has_rotation) g.rotation = glm::quat(n.rotation[3], n.rotation[0], n.rotation[1], n.rotation[2]);  // w, x, y, z
            if (n.has_scale) g.scale = {n.scale[0], n.scale[1], n.scale[2]};
        }
        g.mesh = indexOf(data->meshes, n.mesh);
        g.skin = indexOf(data->skins, n.skin);
    }
    if (data->scene) {
        for (size_t i = 0; i < data->scene->nodes_count; ++i) model.roots.push_back(indexOf(data->nodes, data->scene->nodes[i]));
    } else {
        for (size_t i = 0; i < model.nodes.size(); ++i)
            if (model.nodes[i].parent < 0) model.roots.push_back(static_cast<int>(i));
    }

    // ----- skins -----
    for (size_t s = 0; s < data->skins_count; ++s) {
        const cgltf_skin& skin = data->skins[s];
        GltfSkin g;
        for (size_t j = 0; j < skin.joints_count; ++j) {
            const int node = indexOf(data->nodes, skin.joints[j]);
            g.joints.push_back(node);
            model.nodes[node].isJoint = true;
        }
        g.inverseBind.assign(skin.joints_count, glm::mat4(1.0f));
        if (skin.inverse_bind_matrices) {
            for (size_t j = 0; j < skin.joints_count; ++j) {
                float m[16];
                cgltf_accessor_read_float(skin.inverse_bind_matrices, j, m, 16);
                g.inverseBind[j] = glm::make_mat4(m);
            }
        }
        model.skins.push_back(std::move(g));
    }

    // ----- imágenes y materiales -----
    const std::string dir = std::filesystem::path(path).parent_path().string();
    if (options.loadImages) {
        // Solo se decodifican las texturas de color base: los mapas normales (hasta 4096²) no se usan.
        std::vector<bool> used(data->images_count, false);
        for (size_t m = 0; m < data->materials_count; ++m) {
            const cgltf_material& cm = data->materials[m];
            if (!cm.has_pbr_metallic_roughness) continue;
            const cgltf_texture* t = cm.pbr_metallic_roughness.base_color_texture.texture;
            if (!t) continue;
            const cgltf_image* img = t->webp_image ? t->webp_image : t->image;
            const int idx = img ? static_cast<int>(img - data->images) : -1;
            if (idx >= 0) used[idx] = true;
        }
        model.images.resize(data->images_count);
        for (size_t i = 0; i < data->images_count; ++i) {
            if (!used[i]) continue;
            const cgltf_image& im = data->images[i];
            if (!im.uri) fail(path, "imagen sin uri (incrustadas no soportadas)");
            std::string uri(im.uri);
            if (uri.rfind("data:", 0) == 0) fail(path, "imágenes en data: no soportadas");
            model.images[i] = decodeImage((std::filesystem::path(dir) / uri).lexically_normal().string());
        }
    }
    for (size_t m = 0; m < data->materials_count; ++m) {
        const cgltf_material& cm = data->materials[m];
        GltfMaterial g;
        g.name = cm.name ? cm.name : "";
        g.doubleSided = cm.double_sided;
        g.alpha = cm.alpha_mode == cgltf_alpha_mode_blend ? GltfMaterial::Alpha::Blend
                  : cm.alpha_mode == cgltf_alpha_mode_mask ? GltfMaterial::Alpha::Mask : GltfMaterial::Alpha::Opaque;
        g.alphaCutoff = cm.alpha_cutoff;
        if (cm.has_pbr_metallic_roughness) {
            const auto& pbr = cm.pbr_metallic_roughness;
            g.baseColor = {pbr.base_color_factor[0], pbr.base_color_factor[1], pbr.base_color_factor[2], pbr.base_color_factor[3]};
            if (const cgltf_texture* t = pbr.base_color_texture.texture) {
                // EXT_texture_webp guarda la imagen en `webp_image`
                const cgltf_image* img = t->webp_image ? t->webp_image : t->image;
                g.baseColorImage = indexOf(data->images, img);
            }
        }
        model.materials.push_back(std::move(g));
    }

    // ----- mallas -----
    for (size_t m = 0; m < data->meshes_count; ++m) {
        const cgltf_mesh& cm = data->meshes[m];
        GltfMesh mesh;
        mesh.name = cm.name ? cm.name : "";
        for (size_t p = 0; p < cm.primitives_count; ++p) {
            const cgltf_primitive& cp = cm.primitives[p];
            if (cp.type != cgltf_primitive_type_triangles) fail(path, "solo se soportan triángulos");
            GltfPrimitive prim;
            prim.material = indexOf(data->materials, cp.material);
            for (size_t a = 0; a < cp.attributes_count; ++a) {
                const cgltf_attribute& at = cp.attributes[a];
                const cgltf_accessor* acc = at.data;
                const size_t n = acc->count;
                auto readFloats = [&](std::vector<float>& out, int comps) {
                    out.resize(n * comps);
                    for (size_t i = 0; i < n; ++i) cgltf_accessor_read_float(acc, i, &out[i * comps], comps);
                };
                switch (at.type) {
                    case cgltf_attribute_type_position: readFloats(prim.positions, 3); break;
                    case cgltf_attribute_type_normal: readFloats(prim.normals, 3); break;
                    case cgltf_attribute_type_texcoord:
                        if (at.index == 0) readFloats(prim.uvs, 2);
                        break;
                    case cgltf_attribute_type_weights:
                        if (at.index == 0) readFloats(prim.weights, 4);
                        break;
                    case cgltf_attribute_type_joints:
                        if (at.index == 0) {
                            prim.joints.resize(n * 4);
                            for (size_t i = 0; i < n; ++i) {
                                cgltf_uint j[4];
                                cgltf_accessor_read_uint(acc, i, j, 4);
                                for (int k = 0; k < 4; ++k) prim.joints[i * 4 + k] = static_cast<std::uint16_t>(j[k]);
                            }
                        }
                        break;
                    default:
                        if (at.name && std::string(at.name) == "_VID") readFloats(prim.vertexIds, 1);
                        break;
                }
            }
            if (prim.positions.empty()) fail(path, "primitiva sin posiciones");
            const size_t vertices = prim.vertexCount();
            if (prim.normals.empty()) prim.normals.assign(vertices * 3, 0.0f);
            if (prim.uvs.empty()) prim.uvs.assign(vertices * 2, 0.0f);
            if (cp.indices) {
                prim.indices.resize(cp.indices->count);
                for (size_t i = 0; i < cp.indices->count; ++i) prim.indices[i] = static_cast<std::uint32_t>(cgltf_accessor_read_index(cp.indices, i));
            } else {
                for (size_t i = 0; i < vertices; ++i) prim.indices.push_back(static_cast<std::uint32_t>(i));
            }
            mesh.primitives.push_back(std::move(prim));
        }
        model.meshes.push_back(std::move(mesh));
    }

    // ----- animaciones -----
    for (size_t a = 0; a < data->animations_count; ++a) {
        const cgltf_animation& ca = data->animations[a];
        GltfAnimation anim;
        anim.name = ca.name ? ca.name : "";
        for (size_t c = 0; c < ca.channels_count; ++c) {
            const cgltf_animation_channel& ch = ca.channels[c];
            if (!ch.target_node || !ch.sampler) continue;
            GltfChannel g;
            g.node = indexOf(data->nodes, ch.target_node);
            int comps = 3;
            switch (ch.target_path) {
                case cgltf_animation_path_type_translation: g.path = GltfChannel::Path::Translation; break;
                case cgltf_animation_path_type_rotation: g.path = GltfChannel::Path::Rotation; comps = 4; break;
                case cgltf_animation_path_type_scale: g.path = GltfChannel::Path::Scale; break;
                default: continue;  // pesos de morph: no se usan
            }
            if (ch.sampler->interpolation == cgltf_interpolation_type_cubic_spline) fail(path, "CUBICSPLINE no soportado");
            g.step = ch.sampler->interpolation == cgltf_interpolation_type_step;
            const cgltf_accessor* in = ch.sampler->input;
            const cgltf_accessor* out = ch.sampler->output;
            g.times.resize(in->count);
            for (size_t i = 0; i < in->count; ++i) cgltf_accessor_read_float(in, i, &g.times[i], 1);
            g.values.resize(out->count * comps);
            for (size_t i = 0; i < out->count; ++i) cgltf_accessor_read_float(out, i, &g.values[i * comps], comps);
            if (!g.times.empty()) anim.duration = std::max<double>(anim.duration, g.times.back());
            anim.channels.push_back(std::move(g));
        }
        model.animations.push_back(std::move(anim));
    }
    return model;
}

}  // namespace bazuko
