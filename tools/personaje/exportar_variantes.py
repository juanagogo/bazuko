# Exporta el personaje realista por piezas para el creador del juego.
#
# Por cada cuerpo del catálogo (sexo × edad) genera:
#   public/models/personaje/<cuerpo>/cuerpo.gltf       cuerpo + ojos + cejas + pestañas + esqueleto Mixamo
#   public/models/personaje/<cuerpo>/<pieza>.gltf      cada pelo, barba, ropa y calzado ajustado a ese cuerpo
#   public/models/personaje/<cuerpo>/lod/…             versión liviana para la gente lejana: cuerpo proxy de
#                                                      MakeHuman (~3k triángulos) y piezas simplificadas (Decimate)
# y las texturas compartidas en public/models/personaje/texturas/.
# Además escribe public/models/personaje/catalogo.json con lo exportado y, por pieza,
# los vértices del cuerpo que tapa (para ocultarlos y que la piel no atraviese la ropa).
#
# Uso: blender -b --python tools/personaje/exportar_variantes.py -- [solo_cuerpo] [--piezas=id1,id2]
#   --piezas: exporta solo esas piezas en cada cuerpo (sin rehacer cuerpo.gltf) y las suma al catálogo
#             existente; sirve para añadir piezas nuevas sin tener instalados los assets de las demás.
import json
import os
import sys
import bpy
from bl_ext.blender_org.mpfb.services.humanservice import HumanService
from bl_ext.blender_org.mpfb.services.targetservice import TargetService
from bl_ext.blender_org.mpfb.services.assetservice import AssetService

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(ROOT, "public", "models", "personaje")
CAT = json.load(open(os.path.join(HERE, "catalogo.json"), encoding="utf-8"))
MAX_TEX = 1024
PROXY = {"hombre": "male1591/male1591.proxy", "mujer": "female1605/female1605.proxy"}
DECIMATE = {"hair": 0.5, "clothes": 0.35}  # proporción de caras que se conservan en el LOD
ALPHA_PARTS = ("hair", "beard", "moustache", "eyebrow", "eyelash", "short0", "afro", "long0", "ponytail", "bob0")

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
PIECES = next((set(a.split("=", 1)[1].split(",")) for a in argv if a.startswith("--piezas=")), None)
argv = [a for a in argv if not a.startswith("--")]
ONLY = argv[0] if argv else None


# ---------- materiales: Principled simple que el exportador glTF entiende ----------

def pick_images(mat):
    color = normal = None
    if not mat or not mat.use_nodes:
        return None, None
    for n in mat.node_tree.nodes:
        if n.type != 'TEX_IMAGE' or not n.image:
            continue
        name = n.image.name.lower()
        if "objnorm" in name:
            continue  # normal en espacio objeto: no sirve como normal map
        if any(k in name for k in ("norm", "nrm", "bump")):
            normal = normal or n.image
        elif any(k in name for k in ("spec", "_ao", "rough", "litsphere", "sss")):
            continue
        else:
            color = color or n.image
    return color, normal


def shrink(img):
    if img and max(img.size) > MAX_TEX and not img.get("shrunk"):
        f = MAX_TEX / max(img.size)
        img.scale(int(img.size[0] * f), int(img.size[1] * f))
        img["shrunk"] = True


def to_pbr(obj, alpha):
    for slot in obj.material_slots:
        old = slot.material
        if old and old.get("pbr"):
            continue
        color, normal = pick_images(old)
        mat = bpy.data.materials.new((old.name if old else obj.name) + "_pbr")
        mat["pbr"] = True
        mat.use_nodes = True
        nt = mat.node_tree
        bsdf = nt.nodes.get("Principled BSDF")
        bsdf.inputs["Roughness"].default_value = 0.85
        if color:
            shrink(color)
            tex = nt.nodes.new("ShaderNodeTexImage")
            tex.image = color
            nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
            if alpha:
                nt.links.new(tex.outputs["Alpha"], bsdf.inputs["Alpha"])
        elif old and old.use_nodes and old.node_tree.nodes.get("Principled BSDF"):
            bsdf.inputs["Base Color"].default_value = old.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value
        if normal:
            shrink(normal)
            normal.colorspace_settings.name = "Non-Color"
            ntex = nt.nodes.new("ShaderNodeTexImage")
            ntex.image = normal
            nmap = nt.nodes.new("ShaderNodeNormalMap")
            nt.links.new(ntex.outputs["Color"], nmap.inputs["Color"])
            nt.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
        slot.material = mat


def material_from_mhmat(obj, mhclo_path):
    """Respaldo cuando MPFB no crea material: usa diffuse/normal del .mhmat junto al .mhclo."""
    folder = os.path.dirname(mhclo_path)
    mhmats = [f for f in os.listdir(folder) if f.endswith(".mhmat")]
    if not mhmats:
        return
    textures = {}
    for line in open(os.path.join(folder, mhmats[0]), encoding="utf-8", errors="ignore"):
        parts = line.split(None, 1)
        if len(parts) == 2 and parts[0] in ("diffuseTexture", "normalmapTexture"):
            textures[parts[0]] = os.path.join(folder, parts[1].strip())
    mat = bpy.data.materials.new(obj.name + "_mhmat")
    mat.use_nodes = True
    nt = mat.node_tree
    for key, label in (("diffuseTexture", "diffuse"), ("normalmapTexture", "normal")):
        if key in textures and os.path.exists(textures[key]):
            tex = nt.nodes.new("ShaderNodeTexImage")
            tex.image = bpy.data.images.load(textures[key])
            tex.image.name = os.path.splitext(os.path.basename(textures[key]))[0] + ("_norm" if label == "normal" else "")
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    print("  MATERIAL desde", mhmats[0])


def export(objs, rig, path, tex_dir="../texturas"):
    bpy.ops.object.select_all(action='DESELECT')
    rig.select_set(True)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format='GLTF_SEPARATE',
        export_texture_dir=tex_dir,  # relativo al .gltf: las texturas se comparten entre todos los cuerpos
        use_selection=True,
        export_apply=True,
        export_animations=False,
        export_morph=False,
        export_attributes=True,     # exporta _VID (índice original del vértice del cuerpo)
        export_image_format='WEBP',
        export_yup=True,
    )


# ---------- por cuerpo ----------

def build_body(body, lod=False):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    info = {
        "name": "personaje",
        "phenotype": {
            "gender": 1.0 if body["sexo"] == "hombre" else 0.0,
            "age": body["age"], "muscle": 0.45, "weight": 0.4,
            "proportions": 0.45, "height": 0.45, "cupsize": 0.45, "firmness": 0.45,
            "race": CAT["raza"],
        },
        "rig": "mixamo",
        "eyes": "low-poly/low-poly.mhclo",
        "eyebrows": "" if lod else "eyebrow001/eyebrow001.mhclo",
        "eyelashes": "" if lod else "eyelashes01/eyelashes01.mhclo",
        "teeth": "", "tongue": "", "hair": "", "proxy": PROXY[body["sexo"]] if lod else "",
        "targets": [], "clothes": [],
        "skin_mhmat": body["skin"],
        "skin_material_type": "MAKESKIN",
        "eyes_material_type": "MAKESKIN",
        "skin_material_settings": {}, "eyes_material_settings": {}, "expressions": [],
    }
    settings = HumanService.get_default_deserialization_settings()
    settings["subdiv_levels"] = 0
    basemesh = HumanService.deserialize_from_dict(info, settings)
    TargetService.bake_targets(basemesh)
    rig = basemesh.parent

    # índice original de cada vértice: sobrevive a la máscara de helpers al exportar
    attr = basemesh.data.attributes.new("_VID", 'FLOAT', 'POINT')
    for i in range(len(basemesh.data.vertices)):
        attr.data[i].value = float(i)

    meshes = [o for o in bpy.data.objects if o.type == 'MESH']
    if lod:
        # el cuerpo liviano es el proxy (se renombra para que el juego lo reconozca como "body")
        proxy = next(o for o in meshes if o is not basemesh and any(k in o.name for k in ("1591", "1605")))
        proxy.name = "personaje.body_lod"
        meshes = [o for o in meshes if o is not basemesh]
    for o in meshes:
        to_pbr(o, alpha=any(k in o.name.lower() for k in ALPHA_PARTS))
    return basemesh, rig, meshes


def export_body(body, manifest, lod=False):
    basemesh, rig, meshes = build_body(body, lod)
    folder = os.path.join(OUT, body["id"], "lod" if lod else "")
    os.makedirs(folder, exist_ok=True)
    tex_dir = "../../texturas" if lod else "../texturas"
    if PIECES is None:
        export(meshes, rig, os.path.join(folder, "cuerpo.gltf"), tex_dir)
        print("CUERPO", body["id"], "LOD" if lod else "")

    if lod or PIECES is not None:
        entry = next(c for c in manifest["cuerpos"] if c["id"] == body["id"])
    else:
        entry = {"id": body["id"], "sexo": body["sexo"], "edad": body["edad"], "piezas": {}}
    for cat, items in CAT["piezas"].items():
        for item in items:
            if item.get("sexo") and item["sexo"] != body["sexo"]:
                continue
            if PIECES is not None and item["id"] not in PIECES and item["assets"]:
                continue
            if not item["assets"]:
                if not lod:
                    entry["piezas"][item["id"]] = {"file": None, "oculta": []}
                continue
            added = []
            for spec in item["assets"]:
                subdir, rel = spec.split(":")
                path = AssetService.find_asset_absolute_path(rel, asset_subdir=subdir)
                asset_type = "hair" if subdir == "hair" else "clothes"
                obj = HumanService.add_mhclo_asset(path, basemesh, asset_type=asset_type, subdiv_levels=0, material_type="MAKESKIN")
                if not any(s.material for s in obj.material_slots):
                    material_from_mhmat(obj, path)
                to_pbr(obj, alpha=(subdir == "hair" or any(k in obj.name.lower() for k in ALPHA_PARTS)))
                if lod:
                    dec = obj.modifiers.new("LOD", 'DECIMATE')
                    dec.ratio = DECIMATE["hair" if subdir == "hair" else "clothes"]
                added.append(obj)
            # vértices del cuerpo tapados por esta pieza (grupos "Delete.<asset>")
            hidden = set()
            for g in basemesh.vertex_groups:
                if g.name.startswith("Delete."):
                    gi = g.index
                    for v in basemesh.data.vertices:
                        if any(e.group == gi and e.weight > 0.5 for e in v.groups):
                            hidden.add(v.index)
            export(added, rig, os.path.join(folder, f"{item['id']}.gltf"), tex_dir)
            if lod:
                entry["piezas"][item["id"]]["lod"] = f"lod/{item['id']}.gltf"
            else:
                entry["piezas"][item["id"]] = {"file": f"{item['id']}.gltf", "oculta": sorted(hidden)}
            names = [o.name for o in added]
            for obj in added:
                HumanService.unload_mhclo_asset(basemesh, obj)  # también borra el objeto
            for n in names:
                if n in bpy.data.objects:
                    bpy.data.objects.remove(bpy.data.objects[n], do_unlink=True)
            for g in list(basemesh.vertex_groups):
                if g.name.startswith("Delete."):
                    basemesh.vertex_groups.remove(g)
            print("  PIEZA", item["id"], len(hidden), "vértices ocultos")
    if not lod and PIECES is None:
        manifest["cuerpos"].append(entry)


os.makedirs(os.path.join(OUT, "texturas"), exist_ok=True)
manifest_path = os.path.join(OUT, "catalogo.json")
manifest = {"cuerpos": []}
if PIECES is not None:
    manifest = json.load(open(manifest_path, encoding="utf-8"))
elif ONLY and os.path.exists(manifest_path):
    manifest = json.load(open(manifest_path, encoding="utf-8"))
    manifest["cuerpos"] = [c for c in manifest["cuerpos"] if c["id"] != ONLY]

for body in CAT["cuerpos"]:
    if ONLY and body["id"] != ONLY:
        continue
    export_body(body, manifest)
    export_body(body, manifest, lod=True)

# Etiquetas para el creador (sin rutas de assets)
manifest["piezas"] = {cat: [{k: v for k, v in it.items() if k != "assets"} for it in items]
                      for cat, items in CAT["piezas"].items()}
manifest["cuerpos"].sort(key=lambda c: [b["id"] for b in CAT["cuerpos"]].index(c["id"]))
json.dump(manifest, open(manifest_path, "w", encoding="utf-8"), ensure_ascii=False)
print("LISTO", manifest_path)
