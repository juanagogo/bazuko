import { ClusteredLighting } from 'three/addons/lighting/ClusteredLighting.js';
import ClusteredLightsNode from 'three/addons/tsl/lighting/ClusteredLightsNode.js';
import { Fn, int, float, vec2, log, clamp, positionView, screenUV } from 'three/tsl';

/**
 * ClusteredLightsNode de Three 0.186 reconstruye su malla de clusters cada vez que cambia el
 * tamaño del drawing buffer (resolución adaptativa o ventana). Como su `customCacheKey` incluye
 * el compute y el shader de fragmento guarda NX/NY como constantes, cada cambio de pixelRatio
 * invalidaba la clave de luces de toda la escena y reconstruía miles de RenderObject (segundos).
 *
 * Aquí la malla se fija en el primer tamaño y cada fragmento elige su tile con `screenUV`, en la
 * misma fracción de pantalla que el compute usa en NDC. Así la iluminación es correcta a
 * cualquier resolución y la clave no cambia.
 */
export class StableClusteredLightsNode extends ClusteredLightsNode {
  static get type() { return 'StableClusteredLightsNode'; }

  updateProgram(renderer) {
    if (this._bufferSize === null) super.updateProgram(renderer);
  }

  create(width, height) {
    super.create(width, height);
    const NX = this._gridDimensions.value.x, NY = this._gridDimensions.value.y, NZ = this.zSlices;
    const screenClusterIndex = Fn(() => {
      const tile = screenUV.mul(vec2(NX, NY)).floor();
      const viewDepth = positionView.z.negate();
      const invLogFarOverNear = float(1).div(log(this._cameraFar.div(this._cameraNear)));
      const sliceFloat = log(viewDepth.div(this._cameraNear)).mul(invLogFarOverNear).mul(float(NZ));
      const zSlice = clamp(sliceFloat.floor(), float(0), float(NZ - 1));
      return int(clamp(tile.x, float(0), float(NX - 1)))
        .add(int(clamp(tile.y, float(0), float(NY - 1))).mul(int(NX)))
        .add(int(zSlice).mul(int(NX * NY)));
    });
    this._screenClusterIndex = screenClusterIndex().toVar();
  }
}

export class StableClusteredLighting extends ClusteredLighting {
  createNode(lights = []) {
    return new StableClusteredLightsNode(this.maxLights, this.tileSize, this.zSlices, this.maxLightsPerCluster).setLights(lights);
  }
}
