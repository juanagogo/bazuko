import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {BODY_SPECS,buildCarGeometry} from '../src/vehicles/SlopGeometry.js';
test('compacto: el interior bloquea la vista desde el baul abierto',()=>{
 const geometry=buildCarGeometry(BODY_SPECS.audio_hatch,false),material=new THREE.MeshBasicMaterial(),mesh=new THREE.Mesh(geometry,material);mesh.updateMatrixWorld();
 for(const x of [-.65,0,.65])for(const y of [.7,1.4,1.6]){
  const ray=new THREE.Raycaster(new THREE.Vector3(x,y,-4),new THREE.Vector3(0,0,1));
  const hits=ray.intersectObject(mesh);assert.ok(hits.some(h=>h.point.z< -1.85),`calle visible: ${x},${y}`);
 }
 geometry.dispose();material.dispose();
});
