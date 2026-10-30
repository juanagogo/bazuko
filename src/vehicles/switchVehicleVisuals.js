/** Cambio transaccional: todas las geometrías se preparan antes de sustituirlas. */
export async function switchVehicleVisuals(cars,mode) {
  if(!['actual','slop'].includes(mode))throw new Error('Representación de vehículo no válida');
  const results=await Promise.allSettled(cars.map(car=>car.prepareVisualMode(mode)));
  const failure=results.find(result=>result.status==='rejected');
  if(failure){for(const result of results)if(result.status==='fulfilled')result.value.release();throw failure.reason;}
  for(const result of results)result.value.commit();
}
