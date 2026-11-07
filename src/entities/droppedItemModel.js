import * as THREE from 'three';

/** Modelos pequeños originales: cada familia conserva una silueta reconocible. */
export function createDroppedItemModel(id) {
  const group = new THREE.Group();
  group.name = `objeto-soltado-${id}`;
  const materials = new Map();
  const material = color => {
    if (!materials.has(color)) materials.set(color, new THREE.MeshLambertMaterial({ color, flatShading: true }));
    return materials.get(color);
  };
  const part = (geometry, color, x = 0, y = 0, z = 0) => {
    const mesh = new THREE.Mesh(geometry, material(color));
    mesh.position.set(x, y, z);
    group.add(mesh);
    return mesh;
  };
  const box = (w, h, d, color, x = 0, y = 0, z = 0) => part(new THREE.BoxGeometry(w, h, d), color, x, y, z);
  const cylinder = (r, h, color, x = 0, y = 0, z = 0) => part(new THREE.CylinderGeometry(r, r, h, 12), color, x, y, z);
  const sphere = (r, color, x = 0, y = 0, z = 0) => part(new THREE.SphereGeometry(r, 12, 8), color, x, y, z);
  const ring = (r, tube, color, x = 0, y = 0, z = 0) => part(new THREE.TorusGeometry(r, tube, 6, 16), color, x, y, z);
  if (['botella', 'agua', 'refresco', 'jarabe', 'pegante'].includes(id)) {
    const color = { botella: 0x63b98e, agua: 0x59b9e3, refresco: 0xb94d32, jarabe: 0x905326, pegante: 0xd9a447 }[id];
    cylinder(.12, .32, color, 0, .16);
    cylinder(.06, .12, color, 0, .38);
    cylinder(.065, .035, 0xeeeecc, 0, .45);
    cylinder(.124, .11, 0xf3e8c6, 0, .18);
  } else if (id === 'lata' || id === 'lataComida') {
    cylinder(.16, .23, id === 'lata' ? 0xa6b2ba : 0x297bb7, 0, .12);
    cylinder(.165, .025, 0xd9e0df, 0, .245);
    ring(.055, .013, 0x616b70, 0, .264).rotation.x = Math.PI / 2;
  } else if (id === 'cafe' || id === 'tintico') {
    cylinder(.13, .2, 0xf1d4a0, 0, .1);
    cylinder(.115, .012, 0x3e2115, 0, .205);
    ring(.075, .025, 0xf1d4a0, .16, .12);
  } else if (id === 'pan') {
    const loaf = sphere(.23, 0xc8924f, 0, .15);
    loaf.scale.set(1.4, .65, .85);
    for (const x of [-.13, 0, .13]) box(.025, .015, .22, 0xf2d394, x, .29);
  } else if (id === 'carton' || id === 'rifa') {
    box(.58, .06, .4, id === 'carton' ? 0xb28a52 : 0xe8d995, 0, .03);
    if (id === 'rifa') for (const x of [-.15, 0, .15]) box(.065, .006, .18, 0xa84848, x, .064);
    else box(.56, .008, .035, 0xe6c68c, 0, .065);
  } else if (id === 'madera' || id === 'lona' || id === 'colchon') {
    if (id === 'madera') for (let i = 0; i < 3; i++) box(.85, .055, .12, 0x96633c, 0, .03 + i * .055, (i - 1) * .09);
    if (id === 'lona') {
      box(.65, .13, .48, 0x2974bd, 0, .065);
      for (const x of [-.23, 0, .23]) box(.015, .008, .48, 0x6097ce, x, .134);
    }
    if (id === 'colchon') {
      box(.68, .17, 1, 0xa19077, 0, .085);
      for (const z of [-.3, 0, .3]) box(.6, .008, .03, 0x766550, 0, .175, z);
    }
  } else if (id === 'cable') {
    for (let i = 0; i < 3; i++) ring(.17, .025, 0xb96636, 0, .04 + i * .035).rotation.x = Math.PI / 2;
  } else if (id === 'moneda' || id === 'anillo' || id === 'reloj') {
    if (id === 'moneda') cylinder(.16, .045, 0xd4ad4d, 0, .025);
    if (id === 'anillo') {
      ring(.12, .025, 0xd4ad4d, 0, .13);
      part(new THREE.OctahedronGeometry(.065), 0x7ad4e4, 0, .27);
    }
    if (id === 'reloj') {
      box(.16, .025, .52, 0x6b4630, 0, .02);
      const face = cylinder(.14, .045, 0xc2a45a, 0, .055);
      face.add(new THREE.Mesh(new THREE.CylinderGeometry(.115, .115, .048, 12), material(0xede8d7)));
      box(.015, .01, .1, 0x292d30, 0, .085, .03);
    }
  } else if (id === 'radio' || id === 'radioTransistor') {
    box(.48, .28, .2, 0x41464a, 0, .14);
    box(.21, .18, .015, 0x161a1c, -.09, .14, .11);
    box(.12, .06, .02, 0x9cbead, .13, .19, .115);
    cylinder(.018, .3, 0xbfc9cc, .18, .4).rotation.z = -.25;
  } else if (id === 'retrovisor') {
    box(.36, .24, .08, 0x33383b, 0, .12);
    box(.3, .18, .01, 0x97c3d0, 0, .12, .05);
    box(.12, .04, .06, 0x33383b, .21, .06);
  } else if (id === 'pilas') {
    for (const x of [-.07, .07]) {
      cylinder(.055, .25, 0x3b4146, x, .125);
      cylinder(.057, .075, 0xcaa84c, x, .22);
      cylinder(.025, .025, 0xd5dedc, x, .268);
    }
  } else if (id === 'vela' || id === 'cigarrillo') {
    cylinder(id === 'vela' ? .09 : .025, .3, 0xe9dfb9, 0, .15);
    cylinder(id === 'vela' ? .012 : .026, .04, id === 'vela' ? 0x37302a : 0xba7d39, 0, .32);
  } else if (id === 'cepillo') {
    box(.04, .04, .4, 0x4fa7b5, 0, .03);
    box(.08, .055, .13, 0xeeeecc, 0, .065, -.14);
  } else if (id === 'popo' || id === 'hierba' || id === 'carbon') {
    const color = { popo: 0x69472d, hierba: 0x607b36, carbon: 0x34393b }[id];
    for (let i = 0; i < 3; i++) {
      const piece = sphere(.13 - i * .025, color, (i - 1) * .09, .1 + i * .04);
      piece.scale.y = .6;
    }
  } else if (id === 'arma' || id === 'chatarra') {
    box(.08, .08, .5, 0x747e82, 0, .07);
    box(.35, .08, .1, id === 'arma' ? 0x845b3d : 0x747e82, 0, .09, .14);
    if (id === 'chatarra') ring(.1, .035, 0x9b6340, .13, .05).rotation.x = Math.PI / 2;
  } else {
    // Paquetes y tratamientos: color y marcas distintivas, además del nombre flotante.
    const colors = { jabon: 0x9bc7c1, vendaje: 0xddd5b2, curita: 0xc49c73, vacuna: 0xdde5eb,
      antibiotico: 0xf1eee1, antiparasitario: 0x89b389, pomada: 0xc999a6, pastilla: 0xa091c5 };
    box(.34, .1, .23, colors[id] ?? 0xbca984, 0, .055);
    box(.14, .008, .035, 0xa64143, 0, .11);
    box(.035, .008, .14, 0xa64143, 0, .11);
  }
  // Apoya cualquier silueta exactamente sobre el suelo.
  group.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(group);
  group.position.y -= bounds.min.y;
  return group;
}
