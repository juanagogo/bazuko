"""Calcula, para cada vehiculo con cabina, las medidas que usan las animaciones de conductor (marco del carro, en metros) y las
guarda en el bloque "driver" de su json y en profiles.json (que lee Blender)."""
import json, math
BASE = 'C:/Users/raull/Documentos/Proyectos/bazuko/public/models/vehiculos/'
OUT = 'C:/Users/raull/AppData/Local/Temp/claude/C--Users-raull-Documentos-Proyectos-bazuko/c1ddfc87-171b-4219-8267-ee9f6fcb8e2a/scratchpad/profiles.json'
STEMS = ['raptor', 'renault6', 'jetta', 'mercedes', 'modelx', 'crafter', 'hilux']

profiles = {}
for stem in STEMS:
    j = json.load(open(BASE + stem + '.json', encoding='utf-8'))
    lo, hi = j['min'], j['max']
    s = j['targetLength'] / (hi[2] - lo[2])
    cz = (lo[2] + hi[2]) / 2; cx = (lo[0] + hi[0]) / 2; ly = lo[1]
    def car(p): return ((p[2] - cz) * s, (p[0] - cx) * s, (p[1] - ly) * s)   # marco del carro: frente +X, conductor +Y, arriba +Z
    seat = car(j['seats'][0]['pos'])
    seat_xy = (seat[0], seat[1]); surface = seat[2]
    hips_z = surface + 0.10
    height = (hi[1] - lo[1]) * s
    half_w = (hi[0] - lo[0]) * s * 0.5
    if 'steering' in j:
        wheel = car(j['steering'])
        seat_xy = (wheel[0] - 0.46, wheel[1])      # el volante medido manda: la cadera queda a 46 cm detras de su centro
    else:
        wheel = (seat[0] + 0.45, seat[1], hips_z + 0.27)
    wheel_r = 0.22 if stem in ('crafter', 'hilux') else 0.19
    floor_z = max(0.0, surface - 0.50)
    length = j['targetLength']
    door_len = max(0.95, min(1.25, 1.05 * length / 4.4))
    spec = {
        'hinge': (seat_xy[0] + 0.74, half_w + 0.02), 'door_len': door_len, 'seat': seat_xy, 'hips_z': hips_z,
        'wheel': wheel, 'wheel_r': wheel_r,
        'ped_l': (wheel[0] + 0.04, seat_xy[1] + 0.17, floor_z + 0.12), 'ped_r': (wheel[0] + 0.08, seat_xy[1] - 0.10, floor_z + 0.13),
        'handle_z': min(1.15, max(0.85, surface + 0.46)), 'roof_z': height,
    }
    if 'door' in j:
        # medidas reales de la puerta como pieza: la bisagra, el largo y la altura de la manija salen de su malla
        hx, hy_, hz_ = car(j['door']['hinge'])
        spec['hinge'] = (hx, hy_); spec['door_len'] = j['door']['length'] * s
        spec['handle_z'] = min(1.2, max(0.8, (j['door']['zmin'] - ly) * s + 0.62 * (j['door']['zmax'] - j['door']['zmin']) * s))
    if 'door' in j or stem in ('raptor', 'renault6', 'mercedes'):
        profiles[stem] = {k: (list(v) if isinstance(v, tuple) else v) for k, v in spec.items()}
    # puerta y asiento para el juego: la entidad entra por E0 (a un costado del conductor) y se sienta en `seat`
    e0 = (spec['hinge'][0] - 1.24 * spec['door_len'] / 1.05, spec['hinge'][1] + 0.28)
    j['driver'] = {'profile': stem, 'seat': [round(seat_xy[0], 3), round(seat_xy[1], 3)], 'stance': [round(e0[0], 3), round(e0[1], 3)],
                   'hipsZ': round(hips_z, 3)}
    json.dump(j, open(BASE + stem + '.json', 'w', encoding='utf-8'), indent=1)
    print(stem, 'asiento', [round(x, 2) for x in seat], 'volante', [round(x, 2) for x in wheel], 'mitad ancho', round(half_w, 2), 'puerta', round(door_len, 2))
json.dump(profiles, open(OUT, 'w'), indent=1)
