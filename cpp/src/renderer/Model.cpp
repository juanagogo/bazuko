#include "Model.hpp"
#include "../core/Log.hpp"

#define CGLTF_IMPLEMENTATION
#include <cgltf.h>

#include <algorithm>
#include <glm/gtc/quaternion.hpp>
#include <filesystem>
#include <functional>
#include <limits>
#include <glm/gtc/type_ptr.hpp>

namespace Bazuko {

std::shared_ptr<Model> Model::LoadFromFile(const std::string& filepath) {
    cgltf_options options{};
    cgltf_data* data = nullptr;
    if (cgltf_parse_file(&options, filepath.c_str(), &data) != cgltf_result_success) {
        LogError("Error al parsear GLTF: {}", filepath);
        return nullptr;
    }
    if (cgltf_load_buffers(&options, data, filepath.c_str()) != cgltf_result_success) {
        LogError("Error al cargar buffers de GLTF: {}", filepath);
        cgltf_free(data);
        return nullptr;
    }

    auto model = std::make_shared<Model>();
    model->m_Nodes.resize(data->nodes_count);
    for (cgltf_size i = 0; i < data->nodes_count; ++i) {
        const cgltf_node& source = data->nodes[i];
        auto& node = model->m_Nodes[i];
        if (source.name) node.name = source.name;
        if (source.has_translation) node.translation = {source.translation[0], source.translation[1], source.translation[2]};
        if (source.has_rotation) node.rotation = glm::normalize(glm::quat(source.rotation[3], source.rotation[0], source.rotation[1], source.rotation[2]));
        if (source.has_scale) node.scale = {source.scale[0], source.scale[1], source.scale[2]};
        if (source.parent) node.parent = static_cast<int>(cgltf_node_index(data, source.parent));
    }
    std::vector<glm::mat4> nodeWorldTransforms(model->m_Nodes.size(), glm::mat4(1.0f));
    std::vector<bool> nodeWorldResolved(model->m_Nodes.size(), false);
    std::function<glm::mat4(size_t)> resolveNodeWorld = [&](size_t index) {
        if (nodeWorldResolved[index]) return nodeWorldTransforms[index];
        const auto& node = model->m_Nodes[index];
        const glm::mat4 local = glm::translate(glm::mat4(1.0f), node.translation)
            * glm::mat4_cast(node.rotation) * glm::scale(glm::mat4(1.0f), node.scale);
        nodeWorldTransforms[index] = node.parent >= 0
            ? resolveNodeWorld(static_cast<size_t>(node.parent)) * local : local;
        nodeWorldResolved[index] = true;
        return nodeWorldTransforms[index];
    };
    for (size_t i = 0; i < model->m_Nodes.size(); ++i) resolveNodeWorld(i);
    model->m_BoundsMinimum = glm::vec3(std::numeric_limits<float>::max());
    model->m_BoundsMaximum = glm::vec3(std::numeric_limits<float>::lowest());
    const std::filesystem::path modelDirectory = std::filesystem::path(filepath).parent_path();
    std::vector<std::shared_ptr<Texture>> textures(data->textures_count);
    for (cgltf_size i = 0; i < data->textures_count; ++i) {
        const cgltf_texture& sourceTexture = data->textures[i];
        const cgltf_image* image = sourceTexture.webp_image ? sourceTexture.webp_image : sourceTexture.image;
        if (!image) continue;
        if (image->buffer_view) {
            const auto* imageData = cgltf_buffer_view_data(image->buffer_view);
            if (imageData) {
                textures[i] = Texture::LoadFromMemory(imageData, image->buffer_view->size,
                                                       image->mime_type ? image->mime_type : "");
            } else {
                LogError("No se pudieron leer los bytes de la textura glTF embebida: {} (imagen {}).",
                         filepath, static_cast<size_t>(i));
            }
        } else if (image->uri && !std::string(image->uri).starts_with("data:")) {
            const std::filesystem::path imagePath = (modelDirectory / image->uri).lexically_normal();
            if (std::filesystem::exists(imagePath)) textures[i] = std::make_shared<Texture>(imagePath.string());
        }
    }

    for (cgltf_size ni = 0; ni < data->nodes_count; ++ni) {
        const cgltf_node& node = data->nodes[ni];
        if (!node.mesh) continue;
        for (cgltf_size p = 0; p < node.mesh->primitives_count; ++p) {
            const cgltf_primitive& prim = node.mesh->primitives[p];
            if (prim.type != cgltf_primitive_type_triangles) continue;
            const cgltf_accessor* positions = nullptr;
            const cgltf_accessor* normals = nullptr;
            const cgltf_accessor* uvs = nullptr;
            const cgltf_accessor* joints = nullptr;
            const cgltf_accessor* weights = nullptr;
            for (cgltf_size a = 0; a < prim.attributes_count; ++a) {
                const auto& attr = prim.attributes[a];
                if (attr.type == cgltf_attribute_type_position) positions = attr.data;
                else if (attr.type == cgltf_attribute_type_normal) normals = attr.data;
                else if (attr.type == cgltf_attribute_type_texcoord && attr.index == 0) uvs = attr.data;
                else if (attr.type == cgltf_attribute_type_joints && attr.index == 0) joints = attr.data;
                else if (attr.type == cgltf_attribute_type_weights && attr.index == 0) weights = attr.data;
            }
            if (!positions) continue;
            std::vector<Vertex> vertices(positions->count);
            for (cgltf_size i = 0; i < positions->count; ++i) {
                float value[4]{};
                cgltf_accessor_read_float(positions, i, value, 3);
                vertices[i].position = {value[0], value[1], value[2]};
                const glm::vec3 worldPosition = glm::vec3(nodeWorldTransforms[ni] * glm::vec4(vertices[i].position, 1.0f));
                model->m_BoundsMinimum = glm::min(model->m_BoundsMinimum, worldPosition);
                model->m_BoundsMaximum = glm::max(model->m_BoundsMaximum, worldPosition);
                if (normals) {
                    cgltf_accessor_read_float(normals, i, value, 3);
                    vertices[i].normal = {value[0], value[1], value[2]};
                } else vertices[i].normal = {0, 1, 0};
                if (uvs) {
                    cgltf_accessor_read_float(uvs, i, value, 2);
                    vertices[i].uv = {value[0], value[1]};
                }
                if (joints) {
                    cgltf_accessor_read_float(joints, i, value, 4);
                    vertices[i].joints = {value[0], value[1], value[2], value[3]};
                }
                if (weights) {
                    cgltf_accessor_read_float(weights, i, value, 4);
                    vertices[i].weights = {value[0], value[1], value[2], value[3]};
                }
            }
            std::vector<uint32_t> indices;
            if (prim.indices) {
                indices.resize(prim.indices->count);
                for (cgltf_size i = 0; i < prim.indices->count; ++i)
                    indices[i] = static_cast<uint32_t>(cgltf_accessor_read_index(prim.indices, i));
            } else {
                indices.resize(vertices.size());
                for (size_t i = 0; i < indices.size(); ++i) indices[i] = static_cast<uint32_t>(i);
            }

            ModelPart part;
            part.mesh = std::make_shared<Mesh>(vertices, indices);
            if (node.skin) {
                const cgltf_skin& skin = *node.skin;
                part.jointNodes.reserve(skin.joints_count);
                part.inverseBindMatrices.reserve(skin.joints_count);
                for (cgltf_size joint = 0; joint < skin.joints_count; ++joint) {
                    part.jointNodes.push_back(cgltf_node_index(data, skin.joints[joint]));
                    glm::mat4 inverseBind(1.0f);
                    if (skin.inverse_bind_matrices) {
                        float matrix[16]{};
                        cgltf_accessor_read_float(skin.inverse_bind_matrices, joint, matrix, 16);
                        inverseBind = glm::make_mat4(matrix);
                    }
                    part.inverseBindMatrices.push_back(inverseBind);
                }
            }
            if (prim.material) {
                const auto& material = *prim.material;
                const auto& pbr = material.pbr_metallic_roughness;
                part.baseColor = {pbr.base_color_factor[0], pbr.base_color_factor[1], pbr.base_color_factor[2], pbr.base_color_factor[3]};
                if (pbr.base_color_texture.texture) {
                    const auto textureIndex = cgltf_texture_index(data, pbr.base_color_texture.texture);
                    if (textureIndex < textures.size()) part.texture = textures[textureIndex];
                }
                part.alphaMode = static_cast<int>(material.alpha_mode);
                part.alphaCutoff = material.alpha_cutoff;
                part.doubleSided = material.double_sided;
            }
            model->m_Parts.push_back(std::move(part));
            std::vector<size_t> chain;
            int ancestor = static_cast<int>(ni);
            while (ancestor >= 0) {
                chain.push_back(static_cast<size_t>(ancestor));
                ancestor = model->m_Nodes[static_cast<size_t>(ancestor)].parent;
            }
            std::reverse(chain.begin(), chain.end());
            model->m_PartNodes.push_back(std::move(chain));
        }
    }
    if (model->m_Parts.empty()) {
        model->m_BoundsMinimum = glm::vec3(0.0f);
        model->m_BoundsMaximum = glm::vec3(0.0f);
        model->m_GroundAnchor = glm::vec3(0.0f);
    } else {
        const float groundThreshold = model->m_BoundsMinimum.y
            + (model->m_BoundsMaximum.y - model->m_BoundsMinimum.y) * 0.04f;
        glm::vec2 groundSum(0.0f);
        size_t groundVertexCount = 0;
        for (cgltf_size ni = 0; ni < data->nodes_count; ++ni) {
            const cgltf_node& node = data->nodes[ni];
            if (!node.mesh) continue;
            for (cgltf_size primitiveIndex = 0; primitiveIndex < node.mesh->primitives_count; ++primitiveIndex) {
                const cgltf_primitive& primitive = node.mesh->primitives[primitiveIndex];
                const cgltf_accessor* positions = nullptr;
                for (cgltf_size attributeIndex = 0; attributeIndex < primitive.attributes_count; ++attributeIndex) {
                    const cgltf_attribute& attribute = primitive.attributes[attributeIndex];
                    if (attribute.type == cgltf_attribute_type_position) {
                        positions = attribute.data;
                        break;
                    }
                }
                if (!positions) continue;
                for (cgltf_size vertexIndex = 0; vertexIndex < positions->count; ++vertexIndex) {
                    float value[3]{};
                    if (!cgltf_accessor_read_float(positions, vertexIndex, value, 3)) continue;
                    const glm::vec3 point = glm::vec3(nodeWorldTransforms[ni] * glm::vec4(value[0], value[1], value[2], 1.0f));
                    if (point.y <= groundThreshold) {
                        groundSum += glm::vec2(point.x, point.z);
                        ++groundVertexCount;
                    }
                }
            }
        }
        const glm::vec3 boundsCenter = (model->m_BoundsMinimum + model->m_BoundsMaximum) * 0.5f;
        model->m_GroundAnchor = {boundsCenter.x, model->m_BoundsMinimum.y, boundsCenter.z};
        if (groundVertexCount > 0) {
            const glm::vec2 center = groundSum / static_cast<float>(groundVertexCount);
            model->m_GroundAnchor.x = center.x;
            model->m_GroundAnchor.z = center.y;
        }
    }

    std::unordered_map<std::string, size_t> targetNodesByName;
    for (size_t i = 0; i < model->m_Nodes.size(); ++i) if (!model->m_Nodes[i].name.empty()) targetNodesByName.emplace(model->m_Nodes[i].name, i);
    for (cgltf_size ai = 0; ai < data->animations_count; ++ai) {
        const cgltf_animation& animation = data->animations[ai];
        size_t samplerBase = model->m_AnimationSamplers.size();
        AnimationClip clip;
        clip.name = animation.name ? animation.name : "clip_" + std::to_string(ai);
        for (cgltf_size si = 0; si < animation.samplers_count; ++si) {
            const auto& source = animation.samplers[si];
            AnimationSampler sampler;
            sampler.components = cgltf_num_components(source.output->type);
            sampler.interpolation = source.interpolation == cgltf_interpolation_type_step ? 1 : source.interpolation == cgltf_interpolation_type_cubic_spline ? 2 : 0;
            sampler.times.resize(source.input->count);
            sampler.values.resize(source.output->count);
            for (cgltf_size i = 0; i < source.input->count; ++i) {
                float time = 0.0f;
                cgltf_accessor_read_float(source.input, i, &time, 1);
                sampler.times[i] = time;
                clip.duration = std::max(clip.duration, time);
            }
            for (cgltf_size i = 0; i < source.output->count; ++i) {
                float value[4]{};
                cgltf_accessor_read_float(source.output, i, value, sampler.components);
                sampler.values[i] = {value[0], sampler.components > 1 ? value[1] : 0.0f, sampler.components > 2 ? value[2] : 0.0f, sampler.components > 3 ? value[3] : 0.0f};
            }
            model->m_AnimationSamplers.push_back(std::move(sampler));
        }
        for (cgltf_size ci = 0; ci < animation.channels_count; ++ci) {
            const auto& channel = animation.channels[ci];
            if (!channel.target_node || channel.target_path == cgltf_animation_path_type_weights) continue;
            int path = channel.target_path == cgltf_animation_path_type_translation ? 0 : channel.target_path == cgltf_animation_path_type_rotation ? 1 : channel.target_path == cgltf_animation_path_type_scale ? 2 : -1;
            if (path >= 0) {
                const size_t sourceNode = cgltf_node_index(data, channel.target_node);
                if (!channel.target_node->name) continue;
                auto target = targetNodesByName.find(channel.target_node->name);
                if (target == targetNodesByName.end()) continue;
                const size_t channelIndex = model->m_AnimationChannels.size();
                const auto& sourceRest = model->m_Nodes[sourceNode];
                model->m_AnimationChannels.push_back({target->second, samplerBase + cgltf_animation_sampler_index(&animation, channel.sampler), path, sourceNode, sourceRest.translation, sourceRest.rotation, sourceRest.scale});
                clip.channels.push_back(channelIndex);
            }
        }
        if (!clip.channels.empty()) model->m_AnimationClips.push_back(std::move(clip));
    }
    cgltf_free(data);
    LogInfo("Modelo GLTF cargado: {} ({} partes, {} canales de animación)", filepath, model->m_Parts.size(), model->m_AnimationChannels.size());
    return model;
}

void Model::SetAnimationSource(const Model& source, const std::unordered_map<std::string, std::string>& clipAliases) {
    m_AnimationChannels.clear();
    m_AnimationSamplers = source.m_AnimationSamplers;
    m_AnimationClips = source.m_AnimationClips;
    for (auto& clip : m_AnimationClips) {
        const auto alias = clipAliases.find(clip.name);
        if (alias != clipAliases.end()) clip.name = alias->second;
    }
    m_AnimationSourceNodes = source.m_Nodes;
    m_SourceToTargetNode.assign(source.m_Nodes.size(), -1);
    m_SourceRestWorldRotations.resize(source.m_Nodes.size(), glm::quat(1.0f, 0.0f, 0.0f, 0.0f));
    m_TargetRestWorldRotations.resize(m_Nodes.size(), glm::quat(1.0f, 0.0f, 0.0f, 0.0f));
    std::unordered_map<std::string, size_t> targetNodes;
    for (size_t i = 0; i < m_Nodes.size(); ++i) {
        if (!m_Nodes[i].name.empty()) targetNodes.emplace(m_Nodes[i].name, i);
    }
    const auto worldRotations = [](const std::vector<AnimationNode>& nodes) {
        std::vector<glm::quat> rotations(nodes.size(), glm::quat(1.0f, 0.0f, 0.0f, 0.0f));
        std::vector<bool> resolved(nodes.size(), false);
        std::function<glm::quat(size_t)> resolve = [&](size_t index) {
            if (resolved[index]) return rotations[index];
            const auto& node = nodes[index];
            rotations[index] = node.parent >= 0
                ? glm::normalize(resolve(static_cast<size_t>(node.parent)) * node.rotation)
                : node.rotation;
            resolved[index] = true;
            return rotations[index];
        };
        for (size_t i = 0; i < nodes.size(); ++i) resolve(i);
        return rotations;
    };
    const auto worldPositions = [](const std::vector<AnimationNode>& nodes) {
        std::vector<glm::vec3> positions(nodes.size(), glm::vec3(0.0f));
        std::vector<glm::mat4> matrices(nodes.size(), glm::mat4(1.0f));
        std::vector<bool> resolved(nodes.size(), false);
        std::function<void(size_t)> resolve = [&](size_t index) {
            if (resolved[index]) return;
            const auto& node = nodes[index];
            const glm::mat4 local = glm::translate(glm::mat4(1.0f), node.translation) * glm::mat4_cast(node.rotation) * glm::scale(glm::mat4(1.0f), node.scale);
            if (node.parent >= 0) {
                const size_t parent = static_cast<size_t>(node.parent);
                resolve(parent);
                matrices[index] = matrices[parent] * local;
            } else matrices[index] = local;
            positions[index] = glm::vec3(matrices[index][3]);
            resolved[index] = true;
        };
        for (size_t i = 0; i < nodes.size(); ++i) resolve(i);
        return positions;
    };
    m_SourceRestWorldRotations = worldRotations(source.m_Nodes);
    auto sourcePositions = worldPositions(source.m_Nodes);
    const auto findNode = [](const std::vector<AnimationNode>& nodes, const std::string& suffix) {
        for (size_t i = 0; i < nodes.size(); ++i)
            if (nodes[i].name.size() >= suffix.size() && nodes[i].name.compare(nodes[i].name.size() - suffix.size(), suffix.size(), suffix) == 0) return static_cast<int>(i);
        return -1;
    };
    const int sourceLeft = findNode(source.m_Nodes, "LeftUpLeg"), sourceRight = findNode(source.m_Nodes, "RightUpLeg");
    const int targetLeft = findNode(m_Nodes, "LeftUpLeg"), targetRight = findNode(m_Nodes, "RightUpLeg");
    auto targetPositions = worldPositions(m_Nodes);
    glm::vec3 sourceSide(0.0f), targetSide(0.0f);
    if (sourceLeft >= 0 && sourceRight >= 0) sourceSide = sourcePositions[static_cast<size_t>(sourceLeft)] - sourcePositions[static_cast<size_t>(sourceRight)];
    if (targetLeft >= 0 && targetRight >= 0) targetSide = targetPositions[static_cast<size_t>(targetLeft)] - targetPositions[static_cast<size_t>(targetRight)];
    sourceSide.y = targetSide.y = 0.0f;
    if (glm::length(sourceSide) > 0.0001f && glm::length(targetSide) > 0.0001f) {
        const glm::vec3 from = glm::normalize(sourceSide), to = glm::normalize(targetSide);
        const glm::vec3 axis = glm::cross(from, to);
        if (glm::length(axis) > 0.0001f)
            m_AnimationOrientationCorrection = glm::angleAxis(std::acos(std::clamp(glm::dot(from, to), -1.0f, 1.0f)), glm::normalize(axis));
    }
    for (size_t i = 0; i < source.m_Nodes.size(); ++i) {
        auto target = targetNodes.find(source.m_Nodes[i].name);
        if (target != targetNodes.end()) m_SourceToTargetNode[i] = static_cast<int>(target->second);
    }
    const auto rotationBetween = [](const glm::vec3& from, const glm::vec3& to) {
        const glm::vec3 a = glm::normalize(from), b = glm::normalize(to);
        const float dot = std::clamp(glm::dot(a, b), -1.0f, 1.0f);
        const glm::vec3 axis = glm::cross(a, b);
        if (glm::length(axis) < 1e-5f) return glm::quat(1.0f, 0.0f, 0.0f, 0.0f);
        return glm::normalize(glm::quat(1.0f + dot, axis.x, axis.y, axis.z));
    };
    std::vector<size_t> targetOrder(m_Nodes.size());
    for (size_t i = 0; i < targetOrder.size(); ++i) targetOrder[i] = i;
    const auto depth = [&](size_t index) {
        size_t result = 0;
        for (int parent = m_Nodes[index].parent; parent >= 0 && result < m_Nodes.size(); parent = m_Nodes[static_cast<size_t>(parent)].parent) ++result;
        return result;
    };
    std::stable_sort(targetOrder.begin(), targetOrder.end(), [&](size_t a, size_t b) { return depth(a) < depth(b); });
    for (const size_t targetIndex : targetOrder) {
        const std::string& name = m_Nodes[targetIndex].name;
        const bool limb = name.ends_with("LeftArm") || name.ends_with("RightArm") || name.ends_with("LeftForeArm") || name.ends_with("RightForeArm") ||
            name.ends_with("LeftUpLeg") || name.ends_with("RightUpLeg") || name.ends_with("LeftLeg") || name.ends_with("RightLeg");
        if (!limb) continue;
        const auto mappedBone = std::find(m_SourceToTargetNode.begin(), m_SourceToTargetNode.end(), static_cast<int>(targetIndex));
        if (mappedBone == m_SourceToTargetNode.end()) continue;
        const size_t sourceBone = static_cast<size_t>(mappedBone - m_SourceToTargetNode.begin());
        size_t targetChild = m_Nodes.size(), sourceChild = source.m_Nodes.size();
        for (size_t child = 0; child < m_Nodes.size(); ++child) {
            if (m_Nodes[child].parent != static_cast<int>(targetIndex)) continue;
            const auto mappedChild = std::find(m_SourceToTargetNode.begin(), m_SourceToTargetNode.end(), static_cast<int>(child));
            if (mappedChild == m_SourceToTargetNode.end()) continue;
            targetChild = child;
            sourceChild = static_cast<size_t>(mappedChild - m_SourceToTargetNode.begin());
            break;
        }
        if (targetChild >= m_Nodes.size() || sourceChild >= source.m_Nodes.size()) continue;
        targetPositions = worldPositions(m_Nodes);
        const glm::vec3 targetDirection = targetPositions[targetChild] - targetPositions[targetIndex];
        const glm::vec3 sourceDirection = m_AnimationOrientationCorrection * (sourcePositions[sourceChild] - sourcePositions[sourceBone]);
        if (glm::length(targetDirection) < 1e-5f || glm::length(sourceDirection) < 1e-5f) continue;
        const auto currentWorld = worldRotations(m_Nodes);
        const glm::quat parentWorld = m_Nodes[targetIndex].parent >= 0
            ? currentWorld[static_cast<size_t>(m_Nodes[targetIndex].parent)]
            : glm::quat(1.0f, 0.0f, 0.0f, 0.0f);
        const glm::quat alignedWorld = glm::normalize(rotationBetween(targetDirection, sourceDirection) * currentWorld[targetIndex]);
        m_Nodes[targetIndex].rotation = glm::normalize(glm::inverse(parentWorld) * alignedWorld);
    }
    m_TargetRestWorldRotations = worldRotations(m_Nodes);
    std::vector<size_t> channelMap(source.m_AnimationChannels.size(), std::numeric_limits<size_t>::max());
    for (size_t i = 0; i < source.m_AnimationChannels.size(); ++i) {
        const auto& channel = source.m_AnimationChannels[i];
        if (channel.sourceNodeIndex >= source.m_Nodes.size()) continue;
        const auto& sourceNode = source.m_Nodes[channel.sourceNodeIndex];
        auto target = targetNodes.find(sourceNode.name);
        if (target == targetNodes.end()) continue;
        AnimationChannel mapped = channel;
        mapped.nodeIndex = target->second;
        mapped.sourceRestTranslation = sourceNode.translation;
        mapped.sourceRestRotation = sourceNode.rotation;
        mapped.sourceRestScale = sourceNode.scale;
        channelMap[i] = m_AnimationChannels.size();
        m_AnimationChannels.push_back(mapped);
    }
    for (auto& clip : m_AnimationClips) {
        for (size_t& channel : clip.channels) channel = channel < channelMap.size() ? channelMap[channel] : std::numeric_limits<size_t>::max();
        std::erase(clip.channels, std::numeric_limits<size_t>::max());
    }
}

int Model::FindAnimationClip(const std::string& name) const {
    for (size_t i = 0; i < m_AnimationClips.size(); ++i) {
        if (m_AnimationClips[i].name == name) return static_cast<int>(i);
    }
    return -1;
}

void Model::Draw(Renderer& renderer, const glm::mat4& transform, const glm::vec4& tint,
                 float animationTime, bool animate, int animationClip, int alphaModeOverride) const {
    auto nodes = m_Nodes;
    if (animate && animationClip >= 0 && static_cast<size_t>(animationClip) < m_AnimationClips.size()) {
        const auto& clip = m_AnimationClips[static_cast<size_t>(animationClip)];
        if (clip.duration > 0.0f) {
            const float time = std::fmod(std::max(animationTime, 0.0f), clip.duration);
            auto sourcePose = m_AnimationSourceNodes;
            for (size_t channelIndex : clip.channels) {
                if (channelIndex >= m_AnimationChannels.size()) continue;
                const auto& channel = m_AnimationChannels[channelIndex];
                const auto& sampler = m_AnimationSamplers[channel.samplerIndex];
                if (sampler.times.empty() || sampler.values.empty()) continue;
                auto upper = std::upper_bound(sampler.times.begin(), sampler.times.end(), time);
                size_t next = upper == sampler.times.end() ? sampler.times.size() - 1 : static_cast<size_t>(upper - sampler.times.begin());
                size_t prev = next == 0 ? 0 : next - 1;
                float start = sampler.times[prev], end = sampler.times[next];
                float alpha = sampler.interpolation == 1 || end <= start ? 0.0f : std::clamp((time - start) / (end - start), 0.0f, 1.0f);
                size_t stride = sampler.interpolation == 2 ? 3 : 1;
                size_t a = prev * stride + (stride == 3 ? 1 : 0);
                size_t b = next * stride + (stride == 3 ? 1 : 0);
                glm::vec4 value = glm::mix(sampler.values[a], sampler.values[b], alpha);
                if (channel.path == 1 && sampler.interpolation == 0 && next != prev) {
                    const glm::quat first = glm::normalize(glm::quat(sampler.values[a].w, sampler.values[a].x, sampler.values[a].y, sampler.values[a].z));
                    const glm::quat second = glm::normalize(glm::quat(sampler.values[b].w, sampler.values[b].x, sampler.values[b].y, sampler.values[b].z));
                    const glm::quat interpolated = glm::normalize(glm::slerp(first, second, alpha));
                    value = glm::vec4(interpolated.x, interpolated.y, interpolated.z, interpolated.w);
                }
                if (sampler.interpolation == 2 && next != prev) {
                    float interval = end - start;
                    float t2 = alpha * alpha;
                    float t3 = t2 * alpha;
                    glm::vec4 outTangent = sampler.values[prev * 3 + 2] * interval;
                    glm::vec4 inTangent = sampler.values[next * 3] * interval;
                    value = (2.0f * t3 - 3.0f * t2 + 1.0f) * sampler.values[a]
                          + (t3 - 2.0f * t2 + alpha) * outTangent
                          + (-2.0f * t3 + 3.0f * t2) * sampler.values[b]
                          + (t3 - t2) * inTangent;
                }
                auto& node = sourcePose[channel.sourceNodeIndex];
                if (channel.path == 1) {
                    glm::quat sourceRotation = glm::normalize(glm::quat(value.w, value.x, value.y, value.z));
                    node.rotation = sourceRotation;
                }
            }
            std::vector<glm::quat> sourceWorld(sourcePose.size(), glm::quat(1.0f, 0.0f, 0.0f, 0.0f));
            std::vector<bool> sourceResolved(sourcePose.size(), false);
            std::function<glm::quat(size_t)> resolveSource = [&](size_t index) {
                if (sourceResolved[index]) return sourceWorld[index];
                const auto& node = sourcePose[index];
                sourceWorld[index] = node.parent >= 0
                    ? glm::normalize(resolveSource(static_cast<size_t>(node.parent)) * node.rotation)
                    : node.rotation;
                sourceResolved[index] = true;
                return sourceWorld[index];
            };
            for (size_t i = 0; i < sourcePose.size(); ++i) resolveSource(i);
            std::vector<glm::quat> targetWorld(nodes.size(), glm::quat(1.0f, 0.0f, 0.0f, 0.0f));
            std::vector<bool> targetResolved(nodes.size(), false);
            std::function<glm::quat(size_t)> resolveTarget = [&](size_t index) {
                if (targetResolved[index]) return targetWorld[index];
                auto& node = nodes[index];
                const glm::quat parentWorld = node.parent >= 0 ? resolveTarget(static_cast<size_t>(node.parent)) : glm::quat(1.0f, 0.0f, 0.0f, 0.0f);
                glm::quat desiredWorld = glm::normalize(parentWorld * node.rotation);
                for (size_t sourceIndex = 0; sourceIndex < m_SourceToTargetNode.size(); ++sourceIndex) {
                    if (m_SourceToTargetNode[sourceIndex] != static_cast<int>(index)) continue;
                    const glm::quat delta = glm::normalize(sourceWorld[sourceIndex] * glm::inverse(m_SourceRestWorldRotations[sourceIndex]));
                    desiredWorld = glm::normalize(m_AnimationOrientationCorrection * delta * glm::inverse(m_AnimationOrientationCorrection) * m_TargetRestWorldRotations[index]);
                    break;
                }
                node.rotation = glm::normalize(glm::inverse(parentWorld) * desiredWorld);
                targetWorld[index] = desiredWorld;
                targetResolved[index] = true;
                return desiredWorld;
            };
            for (size_t i = 0; i < nodes.size(); ++i) resolveTarget(i);
        }
    }
    std::vector<glm::mat4> nodeWorldTransforms(nodes.size(), glm::mat4(1.0f));
    std::vector<bool> worldResolved(nodes.size(), false);
    std::function<glm::mat4(size_t)> resolveWorld = [&](size_t index) {
        if (worldResolved[index]) return nodeWorldTransforms[index];
        const auto& node = nodes[index];
        const glm::mat4 local = glm::translate(glm::mat4(1.0f), node.translation) * glm::mat4_cast(node.rotation) * glm::scale(glm::mat4(1.0f), node.scale);
        nodeWorldTransforms[index] = node.parent >= 0 ? resolveWorld(static_cast<size_t>(node.parent)) * local : local;
        worldResolved[index] = true;
        return nodeWorldTransforms[index];
    };
    for (size_t i = 0; i < nodes.size(); ++i) resolveWorld(i);
    for (size_t i = 0; i < m_Parts.size(); ++i) {
        const auto& part = m_Parts[i];
        if (part.texture) part.texture->BindUnit(0);
        const size_t meshNode = m_PartNodes[i].empty() ? 0 : m_PartNodes[i].back();
        const glm::mat4 meshWorld = m_PartNodes[i].empty() ? glm::mat4(1.0f) : nodeWorldTransforms[meshNode];
        std::vector<glm::mat4> skinMatrices;
        const size_t jointCount = std::min({part.jointNodes.size(), part.inverseBindMatrices.size(), size_t{128}});
        skinMatrices.reserve(jointCount);
        if (jointCount > 0) {
            const glm::mat4 inverseMeshWorld = glm::inverse(meshWorld);
            for (size_t joint = 0; joint < jointCount; ++joint) {
                const size_t jointNode = part.jointNodes[joint];
                if (jointNode >= nodeWorldTransforms.size()) continue;
                skinMatrices.push_back(inverseMeshWorld * nodeWorldTransforms[jointNode] * part.inverseBindMatrices[joint]);
            }
        }
        const int alphaMode = alphaModeOverride >= 0 ? alphaModeOverride : part.alphaMode;
        renderer.Submit(*part.mesh, transform * meshWorld, tint * part.baseColor,
                        static_cast<bool>(part.texture), part.doubleSided, &skinMatrices,
                        alphaMode, part.alphaCutoff);
    }
}
} // namespace Bazuko
