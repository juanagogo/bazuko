import * as THREE from 'three';

// Relieve repetible a escala física. Las celdas del vinilo tienen valles entre granos
// y la aleación y el caucho tienen un grano más fino e irregular.
function ruido(x, y, semilla) {
  let h = Math.imul(x + semilla, 374761393) + Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function mapaDeRelieve(vinilo) {
  const lado = 256, celdas = vinilo ? 29 : 53;
  const envolver = n => (n % celdas + celdas) % celdas;
  const semillas = Array.from({ length: celdas*celdas }, (_, i) => {
    const x=i%celdas, y=Math.floor(i/celdas);
    return [.15+.70*ruido(x,y,13), .15+.70*ruido(x,y,29)];
  });
  const alturas = new Float32Array(lado*lado);
  for (let y=0; y<lado; y++) for (let x=0; x<lado; x++) {
    const px=x*celdas/lado, py=y*celdas/lado, ix=Math.floor(px), iy=Math.floor(py);
    let primero=Infinity, segundo=Infinity;
    for (let dy=-1;dy<=1;dy++) for (let dx=-1;dx<=1;dx++) {
      const s=semillas[envolver(ix+dx)+celdas*envolver(iy+dy)];
      const ox=px-ix-dx-s[0], oy=py-iy-dy-s[1], d=ox*ox+oy*oy;
      if (d<primero) { segundo=primero; primero=d; } else if (d<segundo) segundo=d;
    }
    const borde=Math.sqrt(segundo)-Math.sqrt(primero), grano=ruido(x,y,91);
    alturas[y*lado+x]=vinilo ? .85*Math.tanh(borde*5)+grano*.15 : .42*Math.exp(-primero*3)+.58*grano;
  }
  const rgba=new Uint8Array(lado*lado*4), borde=lado-1;
  for (let y=0;y<lado;y++) for (let x=0;x<lado;x++) {
    const gx=alturas[y*lado+((x-1)&borde)]-alturas[y*lado+((x+1)&borde)];
    const gy=alturas[((y-1)&borde)*lado+x]-alturas[((y+1)&borde)*lado+x];
    const inv=1/Math.hypot(gx,gy,1), i=(y*lado+x)*4;
    rgba[i]=Math.round(127.5*(1+gx*inv));
    rgba[i+1]=Math.round(127.5*(1+gy*inv));
    rgba[i+2]=Math.round(127.5*(1+inv)); rgba[i+3]=255;
  }
  const mapa=new THREE.DataTexture(rgba,lado,lado);
  mapa.name=vinilo?'Grano del vinilo del asiento':'Microrrelieve de fundición y caucho';
  mapa.wrapS=mapa.wrapT=THREE.RepeatWrapping;
  mapa.magFilter=THREE.LinearFilter;
  mapa.minFilter=THREE.LinearMipmapLinearFilter;
  mapa.generateMipmaps=true;
  mapa.anisotropy=4;
  mapa.needsUpdate=true;
  return mapa;
}

export function crearMaterialesMT09(acabados) {
  const fino=mapaDeRelieve(false), vinilo=mapaDeRelieve(true);
  return acabados.map(([name, opciones, intensidad, tapizado]) => {
    const material=new THREE.MeshPhysicalMaterial({name,vertexColors:true,...opciones});
    if (intensidad) {
      material.normalMap=tapizado?vinilo:fino;
      material.normalScale.setScalar(intensidad);
    }
    return material;
  });
}

// Cada triángulo usa la proyección más próxima a su normal. Al cambiar de plano
// se duplica sólo el vértice de la costura para que la textura nunca cruce una cara estirada.
export function proyectarUV(b) {
  const cantidad=b.count, usados=new Uint8Array(cantidad), porPlano=new Int32Array(cantidad*3);
  const uv=new Array(cantidad*2).fill(0), escala=27;
  function indice(id, plano) {
    const clave=id*3+plano;
    if (porPlano[clave]) return porPlano[clave]-1;
    let destino=id;
    if (usados[id]) {
      destino=b.count++;
      for (let c=0;c<3;c++) { b.P.push(b.P[id*3+c]); b.N.push(b.N[id*3+c]); }
      for (let c=0;c<4;c++) b.C.push(b.C[id*4+c]);
    }
    usados[id]=1;
    porPlano[clave]=destino+1;
    const x=b.P[id*3], y=b.P[id*3+1], z=b.P[id*3+2];
    uv[destino*2]=(plano===0 ? z : x)*escala;
    uv[destino*2+1]=(plano===1 ? z : y)*escala;
    return destino;
  }
  for (let i=0;i<b.I.length;i+=3) {
    const a=b.I[i]*3, c=b.I[i+1]*3, d=b.I[i+2]*3;
    const x=Math.abs(b.N[a]+b.N[c]+b.N[d]);
    const y=Math.abs(b.N[a+1]+b.N[c+1]+b.N[d+1]);
    const z=Math.abs(b.N[a+2]+b.N[c+2]+b.N[d+2]);
    const plano=x>y && x>z ? 0 : y>z ? 1 : 2;
    for (let j=i;j<i+3;j++) b.I[j]=indice(b.I[j],plano);
  }
  return new THREE.Float32BufferAttribute(uv,2);
}
