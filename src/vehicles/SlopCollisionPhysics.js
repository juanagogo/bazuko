// Adapted directly from mrdoob/slop-newyork 1b54e165/js/traffic.js and controllers.js.
// Copyright (c) 2026 Mr.doob. MIT; see THIRD_PARTY_NOTICES.md.
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
export const MOTION_FIELDS=['vx','vz','yawOffset','yawVel','yawRate','steer','pitch','pitchVel','roll','rollVel','heaveY','heaveVel','dl','dlv','angularVel'];
export function initializeMotion(owner){for(const key of MOTION_FIELDS)owner[key]??=0;return owner;}
  const satHit = { nx: 0, nz: 0, pen: 0, localX: 0, localZ: 0, pSin: 0, pCos: 1 };
export function overlapWithPlayer(relX, relZ, rotY, halfW, halfL, pH, pHalfW, pHalfL) {
    const sinY = Math.sin(rotY);
    const cosY = Math.cos(rotY);
    const localX = relX * cosY - relZ * sinY;
    const localZ = relX * sinY + relZ * cosY;
    const pSin = Math.sin(pH);
    const pCos = Math.cos(pH);
    const pLocalX = relX * pCos - relZ * pSin;
    const pLocalZ = relX * pSin + relZ * pCos;
    const alignCos = Math.abs(Math.cos(pH - rotY));
    const alignSin = Math.abs(Math.sin(pH - rotY));

    const extX = halfW + pHalfW * alignCos + pHalfL * alignSin;
    const extZ = halfL + pHalfW * alignSin + pHalfL * alignCos;
    const pExtX = pHalfW + halfW * alignCos + halfL * alignSin;
    const pExtZ = pHalfL + halfW * alignSin + halfL * alignCos;

    const penX = extX - Math.abs(localX);
    const penZ = extZ - Math.abs(localZ);
    const pPenX = pExtX - Math.abs(pLocalX);
    const pPenZ = pExtZ - Math.abs(pLocalZ);
    if (!(penX > 0 && penZ > 0 && pPenX > 0 && pPenZ > 0)) return null;

    let nx, nz, pen;
    if (penX < penZ) {
      const signX = localX >= 0 ? 1 : -1;
      nx = cosY * signX;
      nz = -sinY * signX;
      pen = penX;
    } else {
      const signZ = localZ >= 0 ? 1 : -1;
      nx = sinY * signZ;
      nz = cosY * signZ;
      pen = penZ;
    }
    if (pPenX < pen) {
      const signPX = pLocalX >= 0 ? 1 : -1;
      nx = pCos * signPX;
      nz = -pSin * signPX;
      pen = pPenX;
    }
    if (pPenZ < pen) {
      const signPZ = pLocalZ >= 0 ? 1 : -1;
      nx = pSin * signPZ;
      nz = pCos * signPZ;
      pen = pPenZ;
    }

    satHit.nx = nx;
    satHit.nz = nz;
    satHit.pen = pen;
    satHit.localX = localX;
    satHit.localZ = localZ;
    satHit.pSin = pSin;
    satHit.pCos = pCos;
    return satHit;
  }

export function pose(v, dt) {
    const yaw = Math.atan2(v.tx, v.tz) - v.nose;
    let dYaw = yaw - v.yaw;
    dYaw -= Math.round(dYaw / (Math.PI * 2)) * Math.PI * 2;
    v.yaw = yaw;
    v.yawRate += (dYaw / dt - v.yawRate) * Math.min(1, dt * 8);
    const wheelbase = 2 * v.axle;
    const steer = clamp(Math.atan((wheelbase * v.yawRate) / Math.max(v.speed, 0.5)), -0.6, 0.6);
    v.steer += (steer - v.steer) * Math.min(1, dt * 10);

    const turn = v.move.turn;
    if (Math.abs(v.dl) > 0.3 && Math.abs(v.dlv) > 0.05) v.blink = v.dl > 0 ? -1 : 1;
    else if (turn !== 'S' && (v.conn || v.edge.len - v.s < 35)) v.blink = turn === 'R' ? 1 : -1;
    else v.blink = 0;

    v.pitchVel += ((-0.008 * v.acc - v.pitch) * 68.0 - v.pitchVel * 10.8) * dt;
    v.pitch = clamp(v.pitch + v.pitchVel * dt, -0.22, 0.22);
    v.rollVel += ((0.01 * v.speed * v.yawRate - v.roll) * 68.0 - v.rollVel * 10.8) * dt;
    v.roll = clamp(v.roll + v.rollVel * dt, -0.26, 0.26);
    v.yawOffset += v.yawVel * dt;
    v.yawVel += (-v.yawOffset * 18.0 - v.yawVel * 6.8) * dt;
    v.yawOffset = clamp(v.yawOffset * Math.exp(-4.5 * dt), -0.85, 0.85);
  }

export function knockOn(v, vehicles, reportCollision=()=>{}, spawnCollisionSparks=()=>{}) {
    for (const o of vehicles) {
      if (o === v || !o.edge) continue;
      const dx = o.x - v.x;
      const dz = o.z - v.z;
      const dist = Math.hypot(dx, dz);
      if (dist > v.half + o.half || dist < 0.001) continue;
      if (Math.abs(dz * v.tx - dx * v.tz) > v.halfWidth + o.halfWidth) continue; // side by side
      const nx = dx / dist;
      const nz = dz / dist;
      const relVn = (v.vx - o.vx) * nx + (v.vz - o.vz) * nz;
      if (relVn <= 0.5) continue;
      const approachSpeed = (v.tx * v.speed + v.vx - o.tx * o.speed - o.vx) * nx
        + (v.tz * v.speed + v.vz - o.tz * o.speed - o.vz) * nz;
      reportCollision(o, v, (v.x + o.x) * 0.5, 0.56, (v.z + o.z) * 0.5, nx, nz, approachSpeed);
      const transfer = relVn * 0.68;
      o.vx += nx * transfer;
      o.vz += nz * transfer;
      v.vx -= nx * transfer * 0.45;
      v.vz -= nz * transfer * 0.45;
      const across = nz * o.tx - nx * o.tz; // hit from the side spins it
      const along = nx * o.tx + nz * o.tz;
      o.yawVel += across * Math.min(2.8, relVn * 0.22);
      o.rollVel += across * Math.min(8.0, relVn) * 0.18;
      o.pitchVel -= along * Math.min(8.0, relVn) * 0.14;
      if (relVn > 2.2) spawnCollisionSparks((v.x + o.x) * 0.5, 0.56, (v.z + o.z) * 0.5, nx, nz, relVn);
    }
  }


export function collideVehicles(v,pe,{push=.5,onCollision=()=>{},sparks=()=>{}}={}){
 if(Math.abs(v.position.y-pe.position.y)>(v.bus?2.8:1.6))return null;
 const player={entity:pe,halfW:pe.halfW,halfL:pe.halfL,push};let result=null;
 const shove=(body,dx,dz)=>body.shove(dx,dz);
 const reportCollision=(a,b,x,y,z,nx,nz,speed)=>{if(speed<=.5)return;result={a,b,x,y:v.position.y+y,z,nx,nz,speed,kind:'vehicle'};onCollision(result);};
 const spawnCollisionSparks=(x,y,z,nx,nz,speed)=>sparks(x,v.position.y+y,z,nx,nz,speed);
  function collideWithPlayer(v, rotY, halfW, halfL) {
    const pe = player.entity;
    const relX = pe.position.x - v.x;
    const relZ = pe.position.z - v.z;
    if (Math.abs(relX) > halfL + 3 || Math.abs(relZ) > halfL + 3) return;
    const hit = overlapWithPlayer(relX, relZ, rotY, halfW, halfL, pe.heading || 0, player.halfW, player.halfL);
    if (!hit) return;
    const { nx, nz, pen, localX, localZ, pSin, pCos } = hit;
    const massRatio = v.bus ? 0.15 : v.isSUV ? 0.58 : 1.0 - player.push;
    const pPush = 1.0 - massRatio;
    pe.position.x += nx * pen * pPush;
    pe.position.z += nz * pen * pPush;
    if (pe.mesh) pe.mesh.position.copy(pe.position);
    shove(v, -nx * pen * massRatio, -nz * pen * massRatio);

    const sinY = Math.sin(rotY);
    const cosY = Math.cos(rotY);
    const pSpeed = pe.speed || 0;
    const pvx = pSin * pSpeed + (pe.vx || 0);
    const pvz = pCos * pSpeed + (pe.vz || 0);
    const cvx = v.tx * v.speed + v.vx;
    const cvz = v.tz * v.speed + v.vz;
    const approachSpeed = (pvx - cvx) * (-nx) + (pvz - cvz) * (-nz);
    if (approachSpeed <= 0) return;

    const jImpulse = (1.0 + 0.28) * approachSpeed;
    const cImpulse = v.bus ? approachSpeed * 0.22 : jImpulse * massRatio * 0.92;
    v.vx -= nx * cImpulse;
    v.vz -= nz * cImpulse;
    v.speed *= v.bus ? 0.55 : 0.35;

    const localNx = nx * cosY - nz * sinY;
    const localNz = nx * sinY + nz * cosY;
    if (!v.bus) {
      const torque = localZ * localNx - localX * localNz;
      v.yawVel -= torque * Math.min(4.2, approachSpeed * 0.26);
      v.yawOffset = clamp(v.yawOffset - torque * Math.min(0.35, approachSpeed * 0.025), -0.65, 0.65);
      v.pitchVel -= localNz * Math.min(12.0, approachSpeed) * 0.18;
      v.rollVel += localNx * Math.min(12.0, approachSpeed) * 0.24;
    }

    const contactLocalX = clamp(localX, -halfW, halfW);
    const contactLocalZ = clamp(localZ, -halfL, halfL);
    const contactX = v.x + contactLocalX * cosY + contactLocalZ * sinY;
    const contactZ = v.z - contactLocalX * sinY + contactLocalZ * cosY;
    if (pe.type !== 'person') reportCollision(pe, v, contactX, v.bus ? 0.65 : 0.58, contactZ, nx, nz, approachSpeed);

    if (typeof pe.speed === 'number') {
      const headOnDot = Math.abs(pSin * nx + pCos * nz);
      pe.speed *= 1.0 - (v.bus ? 0.68 : 0.50) * headOnDot;
      if (pe.type === 'car') {
        const pImpulse = v.bus ? approachSpeed * 0.65 : jImpulse * pPush * 0.48;
        pe.vx = (pe.vx || 0) + nx * pImpulse;
        pe.vz = (pe.vz || 0) + nz * pImpulse;
        const pLocalNx = nx * pCos - nz * pSin;
        const pLocalNz = nx * pSin + nz * pCos;
        if (!v.bus) {
          const pRelX = (contactX - pe.position.x) * pCos - (contactZ - pe.position.z) * pSin;
          const pRelZ = (contactX - pe.position.x) * pSin + (contactZ - pe.position.z) * pCos;
          const pTorque = pRelZ * pLocalNx - pRelX * pLocalNz;
          pe.angularVel = (pe.angularVel || 0) + pTorque * Math.min(3.0, approachSpeed * 0.18) * pPush;
        }
        const kick = Math.min(v.bus ? 16.0 : 14.0, approachSpeed);
        pe.pitchVel = (pe.pitchVel || 0) + pLocalNz * kick * (v.bus ? 0.22 : 0.18);
        pe.rollVel = (pe.rollVel || 0) - pLocalNx * kick * (v.bus ? 0.28 : 0.24);
        pe.heaveVel = (pe.heaveVel || 0) + Math.min(v.bus ? 1.6 : 1.4, approachSpeed * (v.bus ? 0.14 : 0.11));
      }
    }
    if (approachSpeed > 1.8) spawnCollisionSparks(contactX, v.bus ? 0.65 : 0.58, contactZ, nx, nz, approachSpeed);
  }


 collideWithPlayer(v,v.heading,v.halfWidth,v.half);return result;
}

export function wallResponse(pe,nx,nz,depth,onCollision=()=>{}){
 pe.position.x+=nx*depth;pe.position.z+=nz*depth;
 const sinH=Math.sin(pe.heading),cosH=Math.cos(pe.heading),totalVx=sinH*pe.speed+(pe.vx||0),totalVz=cosH*pe.speed+(pe.vz||0),vn=-(totalVx*nx+totalVz*nz);
 if(vn<=.5)return;
 const headOn=Math.abs(sinH*nx+cosH*nz),sideDot=cosH*nx-sinH*nz;
 pe.vx=(pe.vx||0)+nx*vn*.42;pe.vz=(pe.vz||0)+nz*vn*.42;
 if(headOn>.72)pe.speed=-pe.speed*.25;
 else{pe.speed*=1-.62*headOn;pe.angularVel=(pe.angularVel||0)+sideDot*(sinH*nx+cosH*nz>=0?-1:1)*Math.min(3.2,vn*.22);}
 pe.pitchVel=(pe.pitchVel||0)+(sinH*nx+cosH*nz)*Math.min(14,vn)*.16;
 pe.rollVel=(pe.rollVel||0)-sideDot*Math.min(14,vn)*.22;
 pe.heaveVel=(pe.heaveVel||0)+Math.min(1.4,vn*.11);
 onCollision({kind:'building',x:pe.position.x,y:pe.position.y+.56,z:pe.position.z,nx,nz,speed:vn});
}
