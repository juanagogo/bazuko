// Banco de animación dentro de sala.html (herramienta de pruebas, no del juego).
//
// Detiene el bucle propio de la sala y avanza el jugador cuadro a cuadro con un guion de teclas, con el
// mismo `Player.update` del juego y un `dt` fijo. En cada cuadro guarda los cuaterniones locales de los
// huesos principales, la punta de cada pie y las articulaciones de brazos, cabeza y piernas en el mundo, y
// el rumbo del cuerpo (para medidas.js) y, si toca, dibuja el cuadro en
// una hoja de contactos con la cámara de perfil (o girada `camara.angulo` grados hacia el frente: 45 es de
// tres cuartos y -90 desde atrás). `camara.inclinacion` la sube mirando hacia abajo (grados) y `camara.fov` cambia
// el campo de visión: con -90, 12,6° (0,22 rad), 5,5 m y 55° es la cámara del juego detrás del jugador.
//
//   const { correrCaso } = await import('/tools/animacion/banco.js');
//   const r = await correrCaso(window.__sala, caso);   // r.cuadros, r.hoja (PNG en data URL), r.reposo
//
// Caso: { nombre, dt = 1/60, cuadros, asentar = 60, inicio: [x, z], rumbo,
//         suelo: { borde, alto } | null,            // alto para x < borde, 0 después
//         guion: [{ desde, hasta, teclas: [...], pulsar: [...] }],   // pulsar: solo en `desde`
//         captura: { desde, hasta, cada }, camara: { distancia, alto, seguirY, angulo, inclinacion, fov, ventana, escala, juego },
//         vistas: { sufijo: camara } }                   // más hojas de la misma corrida, en r.hojas[sufijo]
const HUESOS_REALISTA = ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'LeftUpLeg', 'LeftLeg', 'LeftFoot',
  'RightUpLeg', 'RightLeg', 'RightFoot', 'LeftArm', 'LeftForeArm', 'RightArm', 'RightForeArm'];
const HUESOS_LIVIANO = ['hips', 'spine', 'head', 'leftUpLeg', 'leftLeg', 'leftFoot', 'rightUpLeg', 'rightLeg', 'rightFoot',
  'leftArm', 'leftForeArm', 'rightArm', 'rightForeArm'];
// Articulaciones cuya posición en el mundo se guarda en cada cuadro (brazos, rodillas y tronco de medidas.js; las
// clavículas dan la línea del pecho).
const MUNDO = ['Hips', 'Neck', 'Head', 'LeftArm', 'LeftForeArm', 'LeftHand', 'RightArm', 'RightForeArm', 'RightHand',
  'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg', 'RightLeg', 'RightFoot', 'LeftShoulder', 'RightShoulder'];

let THREE = null;
async function three() {
  if (THREE) return THREE;
  // El mismo módulo que usa la sala (dependencia ya optimizada por Vite), no una segunda copia.
  const url = performance.getEntriesByType('resource').map(e => e.name).find(n => /\/\.vite\/deps\/three\.js/.test(n));
  THREE = await import(/* @vite-ignore */ url ?? '/node_modules/three/build/three.module.js');
  return THREE;
}

function huesosDe(player) {
  const character = player.character;
  if (character.ragdollRig) {
    const rig = character.ragdollRig;
    const liviano = name => rig[name[0].toLowerCase() + name.slice(1)];
    return {
      lista: HUESOS_LIVIANO.filter(n => rig[n]).map(n => [n, rig[n]]),
      pies: [rig.leftFoot, rig.rightFoot],
      tobillos: [rig.leftFoot, rig.rightFoot],
      mundo: MUNDO.map(n => [n, liviano(n)]).filter(([, b]) => b)
    };
  }
  const porNombre = name => character.group.getObjectByName(`mixamorig${name}`);
  return {
    lista: HUESOS_REALISTA.map(n => [n, porNombre(n)]).filter(([, b]) => b),
    pies: [porNombre('LeftToeBase') ?? porNombre('LeftFoot'), porNombre('RightToeBase') ?? porNombre('RightFoot')],
    tobillos: [porNombre('LeftFoot'), porNombre('RightFoot')],
    mundo: MUNDO.map(n => [n, porNombre(n)]).filter(([, b]) => b)
  };
}

function plataforma(sala, T, suelo) {
  sala.__plataforma?.removeFromParent();
  sala.__plataforma = null;
  if (!suelo?.alto) return;
  const largo = 30;
  const mesh = new T.Mesh(new T.BoxGeometry(largo, suelo.alto, 6), new T.MeshStandardMaterial({ color: 0x8a8378, roughness: .9 }));
  mesh.position.set(suelo.borde - largo / 2, suelo.alto / 2, 0);
  mesh.castShadow = mesh.receiveShadow = true;
  sala.scene.add(mesh);
  sala.__plataforma = mesh;
}

export async function prepararBanco(sala) {
  const T = await three();
  if (!sala.__banco) {
    sala._loop = () => {}; // el bucle de la sala deja de avanzar: aquí manda el guion
    sala.__banco = true;
  }
  return T;
}

export async function correrCaso(sala, caso) {
  const T = await prepararBanco(sala);
  const dt = caso.dt ?? 1 / 60;
  const player = sala.player, input = sala.input, rig = sala.cameraRig, cam = rig.camera;
  const suelo = (x) => (caso.suelo && x < caso.suelo.borde ? caso.suelo.alto : 0);
  plataforma(sala, T, caso.suelo);
  // Las teclas mueven sobre los ejes del mundo (como la cámara isométrica): +X es D.
  const modoJuego = !!caso.camara?.juego;
  rig.mode = modoJuego ? 'third-person' : 'isometric';
  cam.userData.cameraMode = rig.mode;
  sala.animationPreview.stop();
  const [x0, z0] = caso.inicio ?? [0, 0];
  player.position.set(x0, suelo(x0), z0);
  player.root.position.copy(player.position);
  player.root.rotation.set(0, caso.rumbo ?? Math.PI / 2, 0);
  player.velocity.set(0, 0, 0);
  player.resetGrounding();
  player.action = null; player.actionTimer = 0;
  player._faceYaw = null;
  input.keys = {}; input._gamepadKeys = {}; input.pressedThisFrame.clear();
  if (modoJuego) { rig.yaw = (caso.camara.yaw ?? 0); rig.pitch = caso.camara.pitch ?? .22; rig._snap = true; }

  const { lista, pies, tobillos, mundo } = huesosDe(player);
  const v = new T.Vector3();
  const muestra = (i) => {
    player.root.updateMatrixWorld(true);
    const huesos = {}, posiciones = {};
    for (const [nombre, hueso] of lista) huesos[nombre] = hueso.quaternion.toArray().map(n => +n.toFixed(6));
    for (const [nombre, hueso] of mundo) posiciones[nombre] = hueso.getWorldPosition(v).toArray().map(n => +n.toFixed(4));
    const [izq, der] = pies.map(p => p.getWorldPosition(v).toArray().map(n => +n.toFixed(4)));
    const [tIzq, tDer] = tobillos.map(p => p?.getWorldPosition(v).toArray().map(n => +n.toFixed(4)) ?? null);
    return {
      i, dt, y: +player.position.y.toFixed(4), x: +player.position.x.toFixed(4), z: +player.position.z.toFixed(4),
      vy: +(player.jumpVelocity ?? 0).toFixed(3), enSuelo: !!player.isGrounded, suelo: suelo(player.position.x),
      estado: player.state, accion: player.action, landing: +(player.landing ?? 0).toFixed(3), velocidad: +(player.speed ?? 0).toFixed(3),
      camaraY: +cam.position.y.toFixed(4), rumbo: +player.root.rotation.y.toFixed(5), huesos, mundo: posiciones,
      pies: { izq, der }, tobillos: { izq: tIzq, der: tDer }
    };
  };

  const paso = (i) => {
    input.keys = {};
    for (const tramo of caso.guion ?? []) {
      if (i < tramo.desde || i > (tramo.hasta ?? tramo.desde)) continue;
      for (const tecla of tramo.teclas ?? []) input.keys[tecla] = true;
      if (i === tramo.desde) for (const tecla of tramo.pulsar ?? []) input.pressedThisFrame.add(tecla);
    }
    player.update(dt, cam, null, suelo, sala.npcs);
    for (const npc of sala.npcs) npc.update(dt, { player });
    input.endFrame();
  };

  // Asentar: unos cuadros quietos para que las mezclas de un caso anterior no entren en la medida.
  for (let i = -(caso.asentar ?? 60); i < 0; i++) paso(i);
  const quieto = muestra(-1);
  const reposo = Math.min(quieto.pies.izq[1], quieto.pies.der[1]) - suelo(player.position.x);
  // Altura de la articulación de la cabeza de pie: medidas.js escala con ella el mentón y la coronilla.
  const cabeza = quieto.mundo.Head ? quieto.mundo.Head[1] - suelo(player.position.x) : null;

  // Hoja de contactos
  const captura = caso.captura ?? { desde: 0, hasta: caso.cuadros - 1, cada: 1 };
  const indices = [];
  for (let i = captura.desde; i <= captura.hasta; i += captura.cada ?? 1) indices.push(i);
  const columnas = caso.columnas ?? 12;
  // Una hoja por cámara: la del caso y las de `caso.vistas` ({ sufijo: camara }), todas de la misma corrida. Cada
  // cuadro muestra `camara.ventana` metros (ancho y alto) alrededor del punto de mira, a `camara.escala` px por metro.
  const vistas = [['', caso.camara], ...Object.entries(caso.vistas ?? {})].map(([sufijo, propia]) => {
    const camara = { distancia: 7, alto: 1.25, seguirY: false, angulo: 0, inclinacion: 0, fov: 30, ventana: [1.8, 3], escala: 250 / 3, ...(propia ?? {}) };
    const tileW = Math.round(camara.ventana[0] * camara.escala), tileH = Math.round(camara.ventana[1] * camara.escala);
    const hoja = document.createElement('canvas');
    hoja.width = columnas * tileW;
    hoja.height = Math.ceil(indices.length / columnas) * tileH + 24;
    const ctx = hoja.getContext('2d');
    ctx.fillStyle = '#1d1f22'; ctx.fillRect(0, 0, hoja.width, hoja.height);
    ctx.fillStyle = '#e8e2d4'; ctx.font = '14px monospace';
    ctx.fillText(`${caso.nombre}${sufijo ? '-' + sufijo : ''}  (${player.modelKind}, dt=${dt.toFixed(4)})`, 6, 17);
    const giro = camara.angulo * Math.PI / 180, inclinacion = camara.inclinacion * Math.PI / 180;
    return {
      sufijo, hoja, ctx, camara, giro, tileW, tileH, juego: !sufijo && modoJuego,
      visible: 2 * camara.distancia * Math.tan(camara.fov * Math.PI / 360),
      lejos: camara.distancia * Math.cos(inclinacion), arriba: camara.distancia * Math.sin(inclinacion)
    };
  });
  let tile = 0;
  const y0 = player.position.y;

  const cuadros = [];
  for (let i = 0; i < caso.cuadros; i++) {
    paso(i);
    if (modoJuego) rig.follow(player.position, dt, null, player.speed, input.isRunning);
    cuadros.push(muestra(i));
    if (!indices.includes(i)) continue;
    const p = player.position;
    const col = tile % columnas, fila = Math.floor(tile / columnas);
    for (const { ctx, camara, giro, tileW, tileH, juego, visible, lejos, arriba } of vistas) {
      const dx = col * tileW, dy = 24 + fila * tileH;
      const objetivoY = camara.alto + (camara.seguirY ? p.y - y0 : 0) + y0;
      if (!juego) {
        cam.fov = camara.fov; cam.updateProjectionMatrix();
        cam.position.set(p.x + Math.sin(giro) * lejos, objetivoY + arriba, p.z + Math.cos(giro) * lejos);
        cam.lookAt(p.x, objetivoY, p.z);
        cam.updateMatrixWorld();
      }
      sala.sceneMgr.followTarget(p, sala.hour);
      sala.renderer.render(sala.scene, cam, player.root, [sala.sceneMgr.sun]);
      const lienzo = sala.canvas;
      const ppm = lienzo.height / visible;
      const w = camara.ventana[0] * ppm, h = camara.ventana[1] * ppm;
      const sx = lienzo.width / 2 - w / 2, sy = lienzo.height / 2 - h / 2;
      if (juego) ctx.drawImage(lienzo, 0, 0, lienzo.width, lienzo.height, dx, dy, tileW, tileH);
      else ctx.drawImage(lienzo, sx, sy, w, h, dx, dy, tileW, tileH);
      const c = cuadros.at(-1);
      ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(dx, dy, tileW, 30);
      ctx.fillStyle = c.enSuelo ? '#cfe8c0' : '#ffd38a';
      ctx.font = '11px monospace';
      ctx.fillText(`${i} ${c.enSuelo ? 'suelo' : 'aire'} vy${c.vy.toFixed(1)}`, dx + 3, dy + 12);
      ctx.fillText(`y${(c.y - y0).toFixed(2)} ${c.estado}${c.landing ? ' L' + c.landing.toFixed(2) : ''}`, dx + 3, dy + 25);
      ctx.strokeStyle = '#000'; ctx.strokeRect(dx + .5, dy + .5, tileW - 1, tileH - 1);
    }
    tile++;
  }
  input.keys = {};
  const [principal, ...otras] = vistas;
  return {
    nombre: caso.nombre, modelo: player.modelKind, reposo: +reposo.toFixed(4), cabeza: cabeza === null ? null : +cabeza.toFixed(4), cuadros,
    hoja: principal.hoja.toDataURL('image/png'), hojas: Object.fromEntries(otras.map(v => [v.sufijo, v.hoja.toDataURL('image/png')]))
  };
}
