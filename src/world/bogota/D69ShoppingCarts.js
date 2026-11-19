import { Matrix4 } from 'three';
import { rgb, shade } from './MeshKit.js';

const STEEL = rgb('#a1a9a7'), ZINC = rgb('#bfc4be'), RUBBER = rgb('#303433');
const GRIP = rgb('#3a7153'), HUB = rgb('#757a76');
const WHEEL_RADIUS = .055;
const CART_COUNT = 5;
const PITCH = .44;

function wheel(kit, x, y, z, yaw, matrix) {
  matrix.makeRotationY(yaw).setPosition(x, y + WHEEL_RADIUS, z);
  kit.matrix = matrix;
  kit.revolve([
    [.019, -.025, shade(HUB, .88)], [WHEEL_RADIUS, -.021, RUBBER],
    [WHEEL_RADIUS, .021, RUBBER], [.019, .025, HUB]
  ], 8);
  // Horquilla desplazada del eje, con las dos patas alrededor de la rueda.
  kit.tube([[-.027, .008, 0], [-.027, .066, .018], [.027, .066, .018], [.027, .008, 0]], .008, 3, shade(ZINC, .7), { caps: false });
  kit.box(0, .079, .018, .039, .021, .039, shade(STEEL, .72), { skip: 'ny' });
  kit.matrix = null;
  for (const side of [-1, 1]) {
    const ax = Math.cos(yaw) * side, az = -Math.sin(yaw) * side;
    kit.disc([x + ax * .0253, y + WHEEL_RADIUS, z + az * .0253], [ax, 0, az], .019, 8, HUB, { edge: shade(HUB, .74) });
  }
}

export function addD69ShoppingCarts(kit, { x, y, lastZ }) {
  const caster = new Matrix4();
  const previousLight = kit.alphaValue;
  for (let i = 0; i < CART_COUNT; i++) {
    const z = lastZ - i * PITCH;
    const steel = shade(STEEL, i % 2 ? .9 : 1), zinc = shade(ZINC, i === 0 ? 1.04 : .95);
    const at = (dx, height, dz) => [x + dx, y + height, z + dz];
    const wire = (a, b, radius = .007, color = steel, sides = 3) => kit.tube([at(...a), at(...b)], radius, sides, color, { caps: false, twist: 0 });
    // La canasta se estrecha hacia el frente y queda unos centímetros por encima de la anterior al entrar.
    const rim = t => [.18 + .073 * t, .794 + .032 * t, -.359 + .708 * t];
    const base = t => [.14 + .052 * t, .527 - .074 * t, -.325 + .591 * t];
    const sideAt = (side, t, h) => {
      const a = base(t), b = rim(t);
      return [side * (a[0] + (b[0] - a[0]) * h), a[1] + (b[1] - a[1]) * h, a[2] + (b[2] - a[2]) * h];
    };

    // Los perfiles brillantes recogen la luz del plafón existente; ruedas y bastidor quedan en sombra.
    kit.alphaValue = .24;
    for (const side of [-1, 1]) {
      wire(sideAt(side, 0, 1), sideAt(side, 1, 1), .015, zinc, 5);
      wire(sideAt(side, 0, 0), sideAt(side, 1, 0), .011, steel, 4);
      for (const h of [.32, .63]) wire(sideAt(side, 0, h), sideAt(side, 1, h), .0085);
      for (const t of [0, .16, .32, .49, .66, .83, 1]) wire(sideAt(side, t, 0), sideAt(side, t, 1));
    }
    for (const h of [0, .32, .63, 1]) wire(sideAt(-1, 0, h), sideAt(1, 0, h), h === 1 ? .015 : .0085, h === 1 ? zinc : steel, 4);
    for (const u of [-.67, -.33, 0, .33, .67]) wire([base(0)[0] * u, ...base(0).slice(1)], [rim(0)[0] * u, ...rim(0).slice(1)]);
    for (const t of [.18, .38, .58, .78]) wire(sideAt(-1, t, 0), sideAt(1, t, 0), .008);

    // La tapa trasera gira hacia dentro cuando otra canasta la empuja. Solo la última queda colgada.
    const gate = (u, t) => [u * (.242 - .057 * t), .818 - (i ? .026 : .356) * t, .339 - (i ? .368 : .074) * t];
    for (const t of [0, .53, 1]) wire(gate(-1, t), gate(1, t), t === 0 ? .012 : .009, t === 0 ? zinc : steel, 4);
    for (const u of [-1, -.5, 0, .5, 1]) wire(gate(u, 0), gate(u, 1));

    kit.alphaValue = .12;
    for (const side of [-1, 1]) {
      kit.tube([at(side * .236, .95, .402), at(side * .235, .804, .335),
        at(side * .217, .151, .294), at(side * .122, .149, -.252)], .016, 4, shade(steel, .81), { caps: false });
      wire([side * .122, .15, -.252], [side * .142, .53, -.3], .013, shade(steel, .8), 4);
      wheel(kit, x + side * .122, y, z - .27, side * (.16 - i * .045), caster);
      wheel(kit, x + side * .214, y, z + .272, side * (.04 + i * .03), caster);
    }
    wire([-.122, .149, -.252], [.122, .149, -.252], .013, shade(steel, .85), 4);
    kit.alphaValue = .21;
    kit.tube([at(-.242, .95, .402), at(-.211, .955, .417), at(.211, .955, .417), at(.242, .95, .402)],
      .022, 5, i === 1 ? shade(GRIP, .78) : GRIP);
  }
  kit.alphaValue = previousLight;
}
