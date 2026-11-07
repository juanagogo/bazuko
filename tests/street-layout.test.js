import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Bogota } from '../src/world/districts/Bogota.js';
import { Game } from '../src/core/game.js';
import * as THREE from 'three';
import { STREET_X, STREET_Z, CARRERAS, CALLES, CARACAS, SIDEWALK_TILES,
  migrateStreetPosition, WORLD_LAYOUT_VERSION } from '../src/world/bogota/StreetLayout.js';
import { CITY_WIDTH, CITY_HEIGHT } from '../src/world/bogota/CityLayout.js';

test('las calzadas conservan 12 metros y los andenes pasan de 2 a 4 metros sin reducir las manzanas', () => {
  const city = new Bogota();
  const map = city.map = city._layout();
  assert.equal(map.length, CITY_HEIGHT);
  assert.ok(map.every(row => row.length === CITY_WIDTH));
  const z = STREET_Z.tile(5), x = STREET_X.tile(18);
  for (const [a,b] of [...CARRERAS, ...CARACAS.lanes, CARACAS.busway]) {
    assert.equal((b - a + 1) * 2, 12);
    for (let i=a;i<=b;i++) assert.ok(['road','busway'].includes(map[z][i]));
  }
  for (const [a,b] of [...CARRERAS, [CARACAS.lanes[0][0],CARACAS.lanes[1][1]]]) {
    for(let i=1;i<=SIDEWALK_TILES;i++) {
      assert.equal(map[z][a-i],'sidewalk');
      assert.equal(map[z][b+i],'sidewalk');
    }
    assert.equal(map[z][a-SIDEWALK_TILES-1],'building');
    assert.equal(map[z][b+SIDEWALK_TILES+1],'building');
  }
  for (const [a,b] of CALLES) {
    assert.equal((b-a+1)*2,12);
    for(let i=a;i<=b;i++) assert.equal(map[i][x],'road');
    for(let i=1;i<=SIDEWALK_TILES;i++) {
      assert.equal(map[a-i][x],'sidewalk');
      assert.equal(map[b+i][x],'sidewalk');
    }
    assert.ok(['building','ruin'].includes(map[a-SIDEWALK_TILES-1][x]));
    assert.ok(['building','ruin'].includes(map[b+SIDEWALK_TILES+1][x]));
  }
  for (const axis of [STREET_X, STREET_Z]) {
    assert.equal(axis.world(16)-axis.world(15),2);
  }
  assert.equal(map[STREET_Z.tile(40)][STREET_X.tile(44)],'dirt');
  assert.equal(map[STREET_Z.tile(34)][STREET_X.tile(14)],'floor');
});

test('los cruces peatonales conectan ambos andenes de cada calle y de toda la Caracas', () => {
  const city=new Bogota();
  city.map=city._layout();
  city.reserved={shop:{x:STREET_X.world(34),z:STREET_Z.world(29)}};
  const nav=city._createPedestrianNavigation();
  const vertical=[...CARRERAS,[CARACAS.lanes[0][0],CARACAS.lanes[1][1]]];
  for(const [za,zb] of CALLES) for(const [xa,xb] of vertical) {
    for(const z of [za-2,za-1,zb+1,zb+2]) for(let x=xa-2;x<=xb+2;x++) assert.ok(nav.isWalkableAt(x*2,z*2),`${x},${z}`);
    for(const x of [xa-2,xa-1,xb+1,xb+2]) for(let z=za-2;z<=zb+2;z++) assert.ok(nav.isWalkableAt(x*2,z*2),`${x},${z}`);
  }
});

test('cargar y volver a guardar una partida migra su ubicación una sola vez', () => {
  const city=new Bogota();
  city.map=city._layout();
  city.isWalkableAt=(x,z)=>['sidewalk','dirt'].includes(city.map[Math.round(z/2)]?.[Math.round(x/2)]);
  const original=[89,.04,80], expected=migrateStreetPosition(original);
  let data={player:{pos:original},stats:{},clock:{},inventory:{}};
  const serializable={deserialize(){},serialize(){return {};}};
  const game=Object.assign(Object.create(Game.prototype),{
    world:{active:city},player:{position:new THREE.Vector3()},
    save:{load:()=>data,save:state=>{data=state;}},
    stats:serializable,clock:serializable,inventory:serializable,talents:serializable,diseases:serializable,zorra:serializable
  });
  game._loadIfSave();
  assert.deepEqual(game.player.position.toArray(),expected);
  game._save();
  assert.equal(data.worldLayoutVersion,WORLD_LAYOUT_VERSION);
  game._loadIfSave();
  assert.deepEqual(game.player.position.toArray(),expected);
  assert.deepEqual(migrateStreetPosition(expected,WORLD_LAYOUT_VERSION),expected);
});

test('las partidas con calles anchas conservan su ubicación entre calzadas y manzanas', () => {
  // Coordenadas de la versión 1: cambuche, andén y carril de Carrera 15.
  for(const [previous, original] of [
    [[129,.04,96],[89,.04,80]],
    [[48,.12,22],[40,.12,22]],
    [[14,0,48],[12,0,40]]
  ]) {
    const current=migrateStreetPosition(previous,1);
    const expected=migrateStreetPosition(original,0);
    for(let i=0;i<3;i++) assert.ok(Math.abs(current[i]-expected[i])<1e-8);
  }
  for(const axis of [STREET_X,STREET_Z]) for(let i=0;i<48;i+=0.125) {
    assert.ok(Math.abs(axis.original(axis.tile(i))-i)<1e-8);
  }
});
