import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GRADO, colorDeNoche, gradoDeColor } from '../src/core/gradoColor.js';
import { SceneManager } from '../src/core/Scene.js';

const NOCHE = 1.22;
const DESPEJADO = { cloudCover: .1, rainIntensity: 0, fogDensity: 1, flash: 0 };
const NUBLADO = { cloudCover: .85, rainIntensity: 0, fogDensity: 1, flash: 0 };
const LLOVIZNA = { cloudCover: .92, rainIntensity: .3, fogDensity: 1.25, flash: 0 };
const luma = ([r, g, b]) => r * .2126 + g * .7152 + b * .0722;
const gris = value => [value, value, value];
// La noche como era antes de aclararla: la vara para medir cuánto sube lo oscuro.
const NOCHE_HONDA = { ...GRADO, pieHonduraNoche: .16, subidaNoche: 0, apagadoNoche: .3, sombraNoche: [.72, .93, 1.3] };

test('de noche lo que queda lejos de los faroles se alcanza a ver', () => {
  for (const oscuro of [.005, .02, .04]) {
    const antes = luma(gradoDeColor(gris(oscuro), NOCHE, NOCHE_HONDA));
    const ahora = luma(gradoDeColor(gris(oscuro), NOCHE));
    assert.ok(ahora >= antes * 1.5, `un gris de ${oscuro} sube al menos la mitad (${(ahora / antes).toFixed(3)})`);
    assert.ok(ahora <= oscuro * 1.5, 'sin llegar a bruma: sigue siendo sombra');
  }
  // La penumbra sigue fría y lo que alumbra el farol no cambia.
  const asfalto = gradoDeColor([.026, .019, .014], NOCHE);
  assert.ok(asfalto[2] > asfalto[0] * 1.05, 'lo más oscuro sigue virando al azul');
  const farol = [.58, .4, .19];
  const antes = gradoDeColor(farol, NOCHE, NOCHE_HONDA), ahora = gradoDeColor(farol, NOCHE);
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(ahora[i] / antes[i] - 1) < .02, 'el pozo de sodio queda igual');
  // La subida es solo de lo más oscuro y la curva sigue creciendo a cualquier hora.
  assert.ok(Math.abs(luma(gradoDeColor(gris(.2), NOCHE)) / .2 - 1) < .03);
  for (let exposicion = .75; exposicion <= 1.23; exposicion += .01) {
    let previo = -1;
    for (let i = 1; i <= 400; i++) {
      const sale = luma(gradoDeColor(gris(i / 400), exposicion));
      assert.ok(sale > previo, `sube en ${i / 400} con exposición ${exposicion.toFixed(2)}`);
      previo = sale;
    }
  }
});

test('una mañana nublada o una tarde con llovizna no llevan el color de la noche', () => {
  const manager = new SceneManager();
  const exposicion = (hora, clima) => {
    manager.setTimeOfDay(hora, clima, 1);
    return manager.scene.userData.toneMappingExposure;
  };
  for (const clima of [NUBLADO, LLOVIZNA]) {
    for (const hora of [7.5, 17, 17.6]) {
      assert.ok(colorDeNoche(exposicion(hora, clima)) <= .1, `a las ${hora} el color es de día`);
    }
    assert.equal(colorDeNoche(exposicion(22, clima)), 1);
  }
  assert.equal(colorDeNoche(exposicion(22, DESPEJADO)), 1);
  assert.equal(colorDeNoche(exposicion(12, DESPEJADO)), 0);
  // Antes de salir el sol y recién puesto, con los faroles prendidos, la penumbra ya va por la mitad del azul.
  for (const hora of [6, 18]) {
    const color = colorDeNoche(exposicion(hora, DESPEJADO));
    assert.ok(color > .35 && color < .8, `a las ${hora} despejado: ${color.toFixed(2)}`);
  }
  // La sombra de la tarde con llovizna queda gris; la de la noche, azul.
  const tarde = gradoDeColor(gris(.04), exposicion(17.6, LLOVIZNA));
  assert.ok(tarde[2] / tarde[0] < 1.15, 'sombra gris con llovizna');
  const noche = gradoDeColor(gris(.04), exposicion(22, LLOVIZNA));
  assert.ok(noche[2] / noche[0] > 1.5, 'sombra azul de noche');
  // El pie sigue su propio paso, más temprano: al caer la tarde la sombra ya va camino de la de noche.
  assert.ok(GRADO.nocheDesde < GRADO.colorNocheDesde && GRADO.nocheHasta < GRADO.colorNocheHasta);
  const sombra = e => luma(gradoDeColor(gris(.05), e));
  assert.ok(sombra(GRADO.colorNocheDesde) > sombra(1.05) && sombra(GRADO.colorNocheDesde) <= sombra(NOCHE) * 1.02);
});

test('al atardecer despejado el sol bajo pinta rosado y el relleno es malva; a mediodía no', () => {
  const manager = new SceneManager();
  manager.setTimeOfDay(12, DESPEJADO, 1);
  const mediodia = manager.ambient.color.clone(), solAlto = manager.sun.color.clone();
  assert.ok(mediodia.g > mediodia.r, 'a mediodía el relleno es el del cielo');
  manager.setTimeOfDay(17.6, DESPEJADO, 1);
  const tarde = manager.ambient.color.clone(), solBajo = manager.sun.color.clone();
  assert.ok(tarde.r > tarde.g * 1.1 && tarde.b > tarde.g * 1.1, 'malva: el verde es el canal más bajo');
  assert.ok(solBajo.r > solBajo.b * 1.8 && solBajo.b > solBajo.g * .75, 'sol rosado, no naranja');
  assert.ok(solAlto.g > solAlto.b && solAlto.g / solAlto.r > .8, 'el sol alto sigue casi blanco');
  // Con el cielo cerrado no hay arrebol: el relleno queda gris.
  manager.setTimeOfDay(17.6, NUBLADO, 1);
  const cubierto = manager.ambient.color;
  assert.ok(cubierto.g > cubierto.r * .97, 'nublado sin malva');
  // Recién puesto el sol la sombra sigue malva y el relleno no baja del de la noche.
  manager.setTimeOfDay(18, DESPEJADO, 1);
  assert.ok(manager.ambient.color.r > manager.ambient.color.g);
  assert.ok(manager.ambient.intensity >= 1.3);
  // Con el sol bajo todavía arriba el cielo alumbra la calle más que a mediodía, y sube y baja sin saltos.
  const relleno = hora => {
    manager.setTimeOfDay(hora, DESPEJADO, 1);
    return manager.ambient.intensity;
  };
  assert.ok(relleno(17.6) > relleno(12) * 1.3 && relleno(17.6) > relleno(18) * 1.15);
  let previo = relleno(5);
  for (let hora = 5; hora <= 19; hora += 1 / 60) {
    const ahora = relleno(hora);
    assert.ok(Math.abs(ahora - previo) < .03, `relleno sin saltos a las ${hora.toFixed(2)}`);
    previo = ahora;
  }
});

test('el amanecer es pálido y frío: a igual altura del sol, más azul y menos teñido que la tarde', () => {
  const manager = new SceneManager();
  const uniforms = manager.skyDome.material.uniforms;
  const tinte = color => (Math.max(color.r, color.g, color.b) - Math.min(color.r, color.g, color.b)) / Math.max(color.r, color.g, color.b);
  const foto = hora => {
    manager.setTimeOfDay(hora, DESPEJADO, 1);
    return {
      altura: manager._sunDir.y, sol: manager.sun.color.clone(), fuerza: manager.sun.intensity,
      relleno: manager.ambient.color.clone(), cuanto: manager.ambient.intensity,
      horizonte: uniforms.bottomColor.value.clone(), cenit: uniforms.topColor.value.clone(),
      exposicion: manager.scene.userData.toneMappingExposure
    };
  };
  // Antes de salir el sol (6:00, la primera imagen de una partida nueva) contra recién puesto (18:00).
  const alba = foto(6), ocaso = foto(18);
  assert.ok(Math.abs(alba.altura - ocaso.altura) < .01, 'misma altura del sol');
  assert.ok(alba.relleno.b / alba.relleno.r > ocaso.relleno.b / ocaso.relleno.r * 1.1, 'relleno más frío');
  assert.ok(alba.relleno.g > alba.relleno.r, 'sin malva de mañana');
  assert.ok(tinte(alba.horizonte) < tinte(ocaso.horizonte) * .8, 'horizonte más pálido');
  assert.ok(alba.cenit.r + alba.cenit.g + alba.cenit.b > ocaso.cenit.r + ocaso.cenit.g + ocaso.cenit.b, 'cenit más claro');
  // Solo cambian los colores: la cantidad de luz y la exposición son las de la tarde.
  assert.ok(Math.abs(alba.cuanto - ocaso.cuanto) < .02 && Math.abs(alba.exposicion - ocaso.exposicion) < .01);
  // Con el sol ya arriba: pálido de mañana, rosado de tarde.
  const manana = foto(6.5), tarde = foto(17.5);
  assert.ok(Math.abs(manana.altura - tarde.altura) < .03);
  assert.ok(manana.sol.g / manana.sol.r > tarde.sol.g / tarde.sol.r * 1.25, 'sol de mañana menos rojo');
  assert.ok(tinte(manana.sol) < tinte(tarde.sol));
  // A medianoche nada salta al cambiar de tarde a mañana.
  manager.setTimeOfDay(23.999, DESPEJADO, 1);
  const antes = [uniforms.sunGlowColor.value.clone(), manager.ambient.color.clone(), uniforms.bottomColor.value.clone()];
  manager.setTimeOfDay(0, DESPEJADO, 2);
  [uniforms.sunGlowColor.value, manager.ambient.color, uniforms.bottomColor.value].forEach((color, i) => {
    for (const canal of ['r', 'g', 'b']) assert.ok(Math.abs(color[canal] - antes[i][canal]) < .002);
  });
});

test('el cielo nublado es gris perla y las nubes sueltas dejan sombra marcada', async () => {
  const { sunFieldUniforms } = await import('../src/world/bogota/SunField.js');
  const manager = new SceneManager();
  const uniforms = manager.skyDome.material.uniforms;
  const tinte = color => (Math.max(color.r, color.g, color.b) - Math.min(color.r, color.g, color.b)) / Math.max(color.r, color.g, color.b);
  const luz = color => color.r * .2126 + color.g * .7152 + color.b * .0722;
  manager.setTimeOfDay(12, NUBLADO, 1);
  const horizonte = uniforms.bottomColor.value.clone(), cenit = uniforms.topColor.value.clone();
  assert.ok(luz(horizonte) > .45 && tinte(horizonte) < .14, 'horizonte claro y casi neutro');
  assert.ok(luz(cenit) > .24 && luz(cenit) < luz(horizonte), 'cenit gris, más oscuro que el horizonte');
  assert.ok(luz(uniforms.cloudShadow.value) > .14, 'la panza de las nubes no es plomo');
  assert.equal(sunFieldUniforms.uSunCloudShade.value, 0, 'cielo cerrado: no hay sombras que corran');
  // De noche el mismo cielo cerrado sigue oscuro: el gris perla es solo del día.
  manager.setTimeOfDay(22, NUBLADO, 1);
  assert.ok(luz(uniforms.bottomColor.value) < .08);
  manager.setTimeOfDay(12, { cloudCover: .42, rainIntensity: 0, fogDensity: 1, flash: 0 }, 1);
  assert.ok(sunFieldUniforms.uSunCloudShade.value > .8, 'medio nublado: la sombra de nube se nota');
  manager.setTimeOfDay(12, DESPEJADO, 1);
  assert.equal(sunFieldUniforms.uSunCloudShade.value, 0);
  manager.setTimeOfDay(15, LLOVIZNA, 1);
  assert.equal(sunFieldUniforms.uSunCloudShade.value, 0, 'con llovizna tampoco');
});
