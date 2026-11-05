#include "character/CharacterLibrary.h"

#include <algorithm>
#include <cctype>
#include <filesystem>
#include <regex>
#include <set>
#include <stdexcept>

namespace bazuko {

namespace {

std::string lower(std::string s) {
    for (char& c : s) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    return s;
}

const std::regex kHairLike("hair|short0|afro|long0|ponytail|bob0");
const std::regex kSoftAlpha("beard|moustache|eyebrow|eyelash");

struct Setup {
    float cutoff = 0;
    bool blend = false, doubleSided = false, polygonOffset = false;
};

// Reglas de setupMaterial de RealisticCharacter.js según el nombre de la malla y su categoría.
Setup classify(const std::string& nodeName, PartKind kind) {
    const std::string n = lower(nodeName);
    Setup s;
    if (kind == PartKind::Hair || std::regex_search(n, kHairLike)) {
        s.cutoff = 0.08f;
        s.doubleSided = true;
    } else if (std::regex_search(n, kSoftAlpha)) {
        s.cutoff = 0.02f;
        s.blend = true;
        s.doubleSided = true;
    } else if (kind == PartKind::Clothes || kind == PartKind::Shoes) {
        s.polygonOffset = true;
    }
    return s;
}

}  // namespace

CharacterLibrary::CharacterLibrary(const Catalog& catalog, const LookData& look, std::string modelsDir, GpuSink& sink, int maxTextureSize)
    : catalog_(catalog), look_(look), dir_(std::move(modelsDir)), sink_(sink), maxTexture_(maxTextureSize) {}

GltfModel& CharacterLibrary::model(const std::string& rel, bool withImages) {
    const std::string key = rel + (withImages ? "" : "#noimg");
    auto it = models_.find(key);
    if (it == models_.end()) {
        GltfLoadOptions opts;
        opts.loadImages = withImages;
        it = models_.emplace(key, std::make_unique<GltfModel>(loadGltf(dir_ + "/" + rel, opts))).first;
    }
    return *it->second;
}

namespace {

// Reduce a la mitad promediando bloques de 2x2.
Image halve(const Image& in) {
    Image out;
    out.width = std::max(1, in.width / 2);
    out.height = std::max(1, in.height / 2);
    out.srgb = in.srgb;
    out.repeat = in.repeat;
    out.rgba.resize(static_cast<size_t>(out.width) * out.height * 4);
    for (int y = 0; y < out.height; ++y)
        for (int x = 0; x < out.width; ++x)
            for (int c = 0; c < 4; ++c) {
                int sum = 0;
                for (int dy = 0; dy < 2; ++dy)
                    for (int dx = 0; dx < 2; ++dx) {
                        const int sx = std::min(in.width - 1, x * 2 + dx), sy = std::min(in.height - 1, y * 2 + dy);
                        sum += in.rgba[(static_cast<size_t>(sy) * in.width + sx) * 4 + c];
                    }
                out.rgba[(static_cast<size_t>(y) * out.width + x) * 4 + c] = static_cast<std::uint8_t>((sum + 2) / 4);
            }
    return out;
}

}  // namespace

int CharacterLibrary::textureFor(const std::string& path, GltfModel& m, int image) {
    if (image < 0) return -1;
    const std::string key = path + "#" + std::to_string(image);
    auto it = textureIds_.find(key);
    if (it != textureIds_.end()) return it->second;
    Image& img = m.images[image];
    if (img.rgba.empty()) return -1;
    if (maxTexture_ > 0) {
        while (img.width > maxTexture_ || img.height > maxTexture_) img = halve(img);
    }
    const int id = sink_.uploadTexture(img);
    std::vector<std::uint8_t>().swap(img.rgba);  // ya está en la GPU: se libera la copia de CPU
    return textureIds_[key] = id;
}

const CharacterLibrary::BodyAssets& CharacterLibrary::bodyAssets(const std::string& key, const std::string& bodyPath) {
    auto it = bodies_.find(key);
    if (it != bodies_.end()) return it->second;

    if (!anims_) {
        // Animaciones descargadas de Mixamo si están; si no, las de prueba (idle / walk / run).
        for (const char* name : {"animaciones.glb", "animaciones-prueba.glb"}) {
            if (std::filesystem::exists(dir_ + "/" + name)) {
                anims_ = std::make_unique<GltfModel>(loadGltf(dir_ + "/" + name, {false}));
                break;
            }
        }
        if (!anims_) throw std::runtime_error("No hay animaciones del personaje en " + dir_);
        animRig_ = std::make_unique<Rig>(Rig::fromGltf(*anims_));
    }
    BodyAssets assets;
    assets.rig = std::make_shared<Rig>(Rig::fromGltf(model(bodyPath, false)));
    Retargeter retargeter(*animRig_, *assets.rig);
    for (const std::string& name : characterClipNames()) {
        for (const GltfAnimation& a : anims_->animations) {
            if (lower(a.name) == name) {
                assets.clips[name] = std::make_shared<Clip>(retargeter.retarget(a));
                break;
            }
        }
    }
    return bodies_.emplace(key, std::move(assets)).first->second;
}

std::shared_ptr<const CharacterBlueprint> CharacterLibrary::build(const Look& lookIn, bool lod) {
    Look look = lookIn;
    look.real = catalog_.normalize(look.real);
    const RealLook& real = look.real;
    const BodyDef& body = catalog_.bodyFor(real);
    const std::string folder = "personaje/" + body.id + "/";

    auto pieceOf = [&](const std::string& id) -> const BodyPiece* {
        auto it = body.pieces.find(id);
        return it == body.pieces.end() ? nullptr : &it->second;
    };
    const BodyPiece* clothes = pieceOf(real.ropa);
    const bool useLod = lod && clothes && !clothes->lod.empty();

    const std::string sig = body.id + (useLod ? ":lod" : "") + "|" + real.pelo + "|" + real.barba + "|" + real.ropa + "|" + real.calzado + "|" +
                            std::to_string(look.piel) + "|" + std::to_string(look.peloColor);
    auto cached = blueprints_.find(sig);
    if (cached != blueprints_.end()) return cached->second;

    const std::string bodyPath = folder + (useLod ? "lod/cuerpo.gltf" : "cuerpo.gltf");
    GltfModel& bodyModel = model(bodyPath);
    const BodyAssets& assets = bodyAssets(body.id + (useLod ? ":lod" : ""), folder + (useLod ? "lod/cuerpo.gltf" : "cuerpo.gltf"));

    struct PartRef { std::string category; const BodyPiece* info; };
    std::vector<PartRef> parts;
    for (auto [cat, id] : {std::pair<const char*, const std::string&>{"pelo", real.pelo}, {"barba", real.barba}, {"ropa", real.ropa}, {"calzado", real.calzado}}) {
        const BodyPiece* info = pieceOf(id);
        if (info && !info->file.empty()) parts.push_back({cat, info});
    }

    // Vértices del cuerpo tapados por la ropa y el calzado (solo en la versión completa).
    std::set<int> hidden;
    std::string hiddenKey;
    if (!useLod) {
        for (const PartRef& p : parts) {
            hiddenKey += ":" + p.category + "=" + (p.category == "pelo" ? real.pelo : p.category == "barba" ? real.barba : p.category == "ropa" ? real.ropa : real.calzado);
            for (int v : p.info->hidden) hidden.insert(v);
        }
    }

    const Rgb skinTone = paletteTone(look_.palettes.at("piel"), look.piel, 2, 0.25);
    const Rgb hairTone = paletteTone(look_.palettes.at("pelo"), look.peloColor, 0, 0.15);

    auto bp = std::make_shared<CharacterBlueprint>();
    bp->rig = assets.rig;
    bp->clips = assets.clips;
    bp->look = look;
    bp->lod = useLod;
    bp->bodyId = body.id;

    auto addModel = [&](const std::string& path, GltfModel& m, PartKind kind, bool isBodyModel) {
        for (size_t n = 0; n < m.nodes.size(); ++n) {
            const GltfNode& node = m.nodes[n];
            if (node.mesh < 0 || node.skin < 0) continue;
            const std::string lname = lower(node.name);
            const GltfSkin& skin = m.skins[node.skin];
            for (const GltfPrimitive& prim : m.meshes[node.mesh].primitives) {
                MeshPart part;
                part.name = node.name;
                part.kind = isBodyModel ? (lname.find("body") != std::string::npos ? PartKind::Body : PartKind::Other) : kind;
                for (int j : skin.joints) {
                    const int bone = assets.rig->boneIndex(m.nodes[j].name);
                    if (bone < 0) throw std::runtime_error("hueso sin equivalente en el cuerpo: " + m.nodes[j].name);
                    part.jointNodes.push_back(bone);
                }
                part.inverseBind = skin.inverseBind;

                const GltfMaterial* mat = prim.material >= 0 ? &m.materials[prim.material] : nullptr;
                const Setup setup = classify(node.name, part.kind == PartKind::Other && isBodyModel ? PartKind::Other : part.kind);
                part.alphaCutoff = setup.cutoff;
                part.blend = setup.blend;
                part.doubleSided = setup.doubleSided || (mat && mat->doubleSided);
                part.polygonOffset = setup.polygonOffset;
                part.castShadow = !useLod;  // lejos: sin sombra propia
                if (mat) part.gpuTexture = textureFor(path, m, mat->baseColorImage);

                // tinte: piel en el cuerpo, color del pelo en pelo, barba y cejas
                if (part.kind == PartKind::Body) part.tint = skinTone;
                else if (part.kind == PartKind::Hair || part.kind == PartKind::Beard || lname.find("eyebrow") != std::string::npos) part.tint = hairTone;

                // índices: el cuerpo pierde los triángulos con algún vértice tapado
                std::vector<std::uint32_t> indices = prim.indices;
                std::string key = path + "|" + std::to_string(n);
                if (part.kind == PartKind::Body && !hidden.empty() && !prim.vertexIds.empty()) {
                    std::vector<std::uint32_t> kept;
                    kept.reserve(indices.size());
                    for (size_t i = 0; i + 2 < indices.size(); i += 3) {
                        const auto id = [&](std::uint32_t v) { return static_cast<int>(std::lround(prim.vertexIds[v])); };
                        if (hidden.count(id(indices[i])) || hidden.count(id(indices[i + 1])) || hidden.count(id(indices[i + 2]))) continue;
                        kept.insert(kept.end(), {indices[i], indices[i + 1], indices[i + 2]});
                    }
                    indices = std::move(kept);
                    key += hiddenKey;
                }
                part.triangles = indices.size() / 3;

                auto cachedMesh = meshIds_.find(key);
                if (cachedMesh == meshIds_.end()) {
                    std::vector<float> vertices;
                    const size_t count = prim.vertexCount();
                    vertices.reserve(count * 16);
                    for (size_t v = 0; v < count; ++v) {
                        for (int k = 0; k < 3; ++k) vertices.push_back(prim.positions[v * 3 + k]);
                        for (int k = 0; k < 3; ++k) vertices.push_back(prim.normals[v * 3 + k]);
                        for (int k = 0; k < 2; ++k) vertices.push_back(prim.uvs[v * 2 + k]);
                        for (int k = 0; k < 4; ++k) vertices.push_back(prim.joints.empty() ? 0.0f : static_cast<float>(prim.joints[v * 4 + k]));
                        for (int k = 0; k < 4; ++k) vertices.push_back(prim.weights.empty() ? (k == 0 ? 1.0f : 0.0f) : prim.weights[v * 4 + k]);
                    }
                    cachedMesh = meshIds_.emplace(key, sink_.uploadSkinnedMesh(vertices, indices)).first;
                }
                part.gpuMesh = cachedMesh->second;
                bp->parts.push_back(std::move(part));
            }
        }
    };

    addModel(bodyPath, bodyModel, PartKind::Body, true);
    for (const PartRef& p : parts) {
        const std::string file = folder + (useLod && !p.info->lod.empty() ? p.info->lod : p.info->file);
        const PartKind kind = p.category == "pelo" ? PartKind::Hair : p.category == "barba" ? PartKind::Beard
                              : p.category == "ropa" ? PartKind::Clothes : PartKind::Shoes;
        addModel(file, model(file), kind, false);
    }
    blueprints_[sig] = bp;
    return bp;
}

}  // namespace bazuko
