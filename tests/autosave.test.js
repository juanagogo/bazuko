// El guardado solo: su intervalo, su enganche a la pestaña y los momentos en que no debe guardar.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Game } from '../src/core/game.js';
import { AutoSave, AUTO_SAVE_SECONDS } from '../src/systems/AutoSave.js';

const conPestana = () => {
  globalThis.window = new EventTarget();
  globalThis.document = Object.assign(new EventTarget(), { hidden: false });
};

test('el guardado solo no guarda en el primer cuadro y después guarda cada intervalo', () => {
  let veces = 0;
  const auto = new AutoSave({ guardar: () => { veces++; return true; }, puede: () => true });
  const t0 = 1000;
  assert.equal(auto.update(t0), false, 'el primer cuadro solo calibra el reloj');
  assert.equal(auto.update(t0 + AUTO_SAVE_SECONDS * 1000 - 1), false);
  assert.equal(auto.update(t0 + AUTO_SAVE_SECONDS * 1000), true);
  assert.equal(veces, 1);
  assert.equal(auto.update(t0 + AUTO_SAVE_SECONDS * 1000 + 500), false, 'el intervalo se cuenta desde el último guardado');
  assert.equal(auto.update(t0 + AUTO_SAVE_SECONDS * 2000), true);
  assert.equal(veces, 2);
});

test('esconder la pestaña o cerrarla guarda en ese momento, y soltar deja de escuchar', () => {
  conPestana();
  let guardados = 0, permitido = true;
  const auto = new AutoSave({ guardar: () => { guardados++; return true; }, puede: () => permitido });
  const soltar = auto.enganchar();
  globalThis.window.dispatchEvent(new Event('pagehide'));
  assert.equal(guardados, 1, 'cerrar la pestaña guarda');
  globalThis.document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(guardados, 1, 'seguir a la vista no guarda nada');
  globalThis.document.hidden = true;
  globalThis.document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(guardados, 2, 'esconderse guarda');
  permitido = false;
  globalThis.window.dispatchEvent(new Event('pagehide'));
  assert.equal(guardados, 2, 'sin momento firme no guarda');
  soltar();
  globalThis.window.dispatchEvent(new Event('pagehide'));
  assert.equal(guardados, 2, 'desenganchado ya no escucha');
});

test('el intervalo no guarda si el momento no lo permite, y guarda en el siguiente', () => {
  let veces = 0, permitido = false;
  const auto = new AutoSave({ guardar: () => { veces++; return true; }, puede: () => permitido });
  assert.equal(auto.update(0), false);
  assert.equal(auto.update(AUTO_SAVE_SECONDS * 1000), false, 'el momento no lo permite');
  assert.equal(veces, 0);
  permitido = true;
  assert.equal(auto.update(AUTO_SAVE_SECONDS * 2000), true);
  assert.equal(veces, 1);
});

test('no se guarda solo cargando, ni en el creador, ni muerto, ni dormido', () => {
  const juego = (extra = {}) => Object.assign(Object.create(Game.prototype), {
    _loading: false, _deathPending: false, _arrestPending: false, isSleeping: false, creator: { isOpen: false }, stats: { salud: 80 }, ...extra
  });
  assert.equal(juego()._puedeAutoguardar(), true);
  assert.equal(juego({ _loading: true })._puedeAutoguardar(), false);
  assert.equal(juego({ creator: { isOpen: true } })._puedeAutoguardar(), false);
  assert.equal(juego({ _deathPending: true })._puedeAutoguardar(), false);
  assert.equal(juego({ _arrestPending: true })._puedeAutoguardar(), false, 'preso, antes de perder la mitad del costal');
  assert.equal(juego({ isSleeping: true })._puedeAutoguardar(), false);
  assert.equal(juego({ stats: { salud: 0 } })._puedeAutoguardar(), false, 'la caída mortal todavía no abrió su pantalla');
});

test('sin almacenamiento el guardado avisa una sola vez y no se cae', () => {
  const avisos = [];
  globalThis.window = { dispatchEvent: (e) => avisos.push(e.detail) };
  const serial = { serialize: () => ({}) };
  const game = Object.assign(Object.create(Game.prototype), {
    save: { save: () => false },
    stats: serial, clock: serial, inventory: serial, talents: serial, diseases: serial,
    player: { position: { toArray: () => [0, 0, 0] }, equippedWeapon: null },
    world: { active: null }, look: {}, built: {}, costal: false, radio: null, dog: null, cart: null, gps: null,
  });
  assert.equal(game._save(), false);
  assert.equal(game._save(), false);
  assert.equal(avisos.length, 1, 'el aviso no se repite cada minuto');
  assert.equal(avisos[0].type, 'warn');
  game.save.save = () => true;
  assert.equal(game._save(), true, 'cuando vuelve a dejar, guarda y se puede volver a avisar');
  game.save.save = () => false;
  game._save();
  assert.equal(avisos.length, 2);
});
