import {createSlopVehicle} from './SlopVehicle.js';
export async function createVehicleVisual(mode,options){
 if(!['actual','slop'].includes(mode))throw new Error('Representación de vehículo no válida');
 return createSlopVehicle(options);
}
