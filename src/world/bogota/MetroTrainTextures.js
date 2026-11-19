// Pintura, vidrio y rótulos del tren que se ve desde la Caracas.
import * as THREE from 'three';
import { withVisualRandom } from './VisualRandom.js';

const CELL = 128, COLS = 8, ROWS = 2;
const COLORS = {
  rojo: '#d82d40', rojoTecho: '#b93340', rojoSombra: '#7f222c', amarillo: '#f5c631',
  plata: '#d3d5d1', bajo: '#596063', caucho: '#303437', negro: '#202a30',
  junta: '#151c20', vidrio: '#26383e', parabrisas: '#293c43', respiradero: '#748088',
  metro: '#d82d40', pruebas: '#20262a', insignia: '#202a30', cola: '#b82c3d'
};
const NAMES = Object.keys(COLORS);

function cell(name) {
  const i = NAMES.indexOf(name);
  return [i % COLS, Math.floor(i / COLS)];
}

export function trainRect(name) {
  const [x, y] = cell(name), pad = 3 / CELL;
  return [(x + pad) / COLS, 1 - (y + 1 - pad) / ROWS, (x + 1 - pad) / COLS, 1 - (y + pad) / ROWS];
}

function glazing(ctx, front) {
  const shade = ctx.createLinearGradient(0, 0, 0, CELL);
  shade.addColorStop(0, front ? '#4c5862' : '#34424a');
  shade.addColorStop(.43, front ? '#354850' : '#354650');
  shade.addColorStop(.65, '#213037');
  shade.addColorStop(1, '#151b20');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, CELL, CELL);
  ctx.fillStyle = 'rgba(177,206,218,.11)';
  ctx.beginPath(); ctx.moveTo(4, 15); ctx.lineTo(70, 4); ctx.lineTo(121, 4);
  ctx.lineTo(13, 35); ctx.closePath(); ctx.fill();
  ctx.fillStyle = 'rgba(222,227,220,.17)';
  ctx.fillRect(11, 14, CELL - 22, 2);
  ctx.fillStyle = 'rgba(124,146,152,.09)';
  ctx.fillRect(0, 88, CELL, 6);
}

function pruebas(ctx, color) {
  ctx.fillStyle = color;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = '800 26px monospace';
  ctx.fillText('PRUEBAS', CELL / 2, CELL / 2, CELL - 11);
}

function mapas() {
  if (typeof document === 'undefined') return {};
  const pinta = (emisivo) => {
    const canvas = document.createElement('canvas');
    canvas.width = CELL * COLS;
    canvas.height = CELL * ROWS;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    for (const [name, color] of Object.entries(COLORS)) {
      const [x, y] = cell(name);
      ctx.save(); ctx.translate(x * CELL, y * CELL);
      ctx.fillStyle = emisivo ? '#000000' : color;
      ctx.fillRect(0, 0, CELL, CELL);
      if (emisivo) {
        if (name === 'pruebas') pruebas(ctx, '#ffbc4b');
        if (name === 'cola') { ctx.fillStyle = '#da293d'; ctx.fillRect(0, 0, CELL, CELL); }
        if (name === 'vidrio') { ctx.fillStyle = '#101a20'; ctx.fillRect(0, 0, CELL, CELL); }
      } else if (name === 'vidrio' || name === 'parabrisas') {
        glazing(ctx, name === 'parabrisas');
      } else if (name === 'respiradero') {
        for (let i = 10; i < CELL; i += 9) {
          ctx.fillStyle = '#40494c'; ctx.fillRect(0, i, CELL, 4);
          ctx.fillStyle = '#8e9698'; ctx.fillRect(0, i + 4, CELL, 1);
        }
      } else if (name === 'plata' || name === 'rojo' || name === 'rojoTecho') {
        const glare = ctx.createLinearGradient(0, 0, 0, CELL);
        glare.addColorStop(0, 'rgba(250,245,230,.12)');
        glare.addColorStop(.4, 'rgba(250,245,230,.035)');
        glare.addColorStop(1, 'rgba(29,32,34,.14)');
        ctx.fillStyle = glare; ctx.fillRect(0, 0, CELL, CELL);
      } else if (name === 'metro' || name === 'insignia') {
        ctx.fillStyle = '#fff0de'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.font = '900 24px system-ui, sans-serif';
        ctx.fillText('METRO', CELL / 2, 48);
        ctx.fillText('BOGOTÁ', CELL / 2, 79);
      } else if (name === 'pruebas') {
        pruebas(ctx, '#ffbc4b');
      }
      ctx.restore();
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    return texture;
  };
  return { map: pinta(false), emissiveMap: pinta(true) };
}

export function metroTrainMaterials() {
  const { map = null, emissiveMap = null } = withVisualRandom(mapas);
  const coat = (name, color, roughness, metalness) => new THREE.MeshStandardMaterial({
    name, map, color: map ? '#ffffff' : color, roughness, metalness
  });
  return {
    carroceria: coat('Rojo del Metro', COLORS.rojo, .38, .16),
    remate: coat('Remates del Metro', COLORS.plata, .46, .33),
    vidrio: new THREE.MeshStandardMaterial({ name: 'Vidrios del Metro', map, emissiveMap,
      color: map ? '#ffffff' : COLORS.vidrio, emissive: '#ffffff', emissiveIntensity: emissiveMap ? .5 : 0,
      metalness: .28, roughness: .23 }),
    faro: new THREE.MeshBasicMaterial({ name: 'Faros del Metro', color: '#ffefd4', toneMapped: false })
  };
}
