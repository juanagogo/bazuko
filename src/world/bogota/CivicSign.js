// Paneles de acceso. Los pictogramas se pintan una vez en el atlas de la nomenclatura.
const COLORS = {
  park: '#244d42', plaza: '#704a3a', market: '#784326', landmark: '#384a5c'
};

function drawSymbol(ctx, kind) {
  ctx.beginPath();
  if (kind === 'park') {
    ctx.moveTo(16, 24); ctx.lineTo(16, 32);
    ctx.moveTo(7, 32); ctx.lineTo(25, 32);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(16, 14, 10, 0, Math.PI * 2); ctx.fill();
  } else if (kind === 'plaza') {
    ctx.moveTo(3, 21); ctx.quadraticCurveTo(16, 34, 29, 21); ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(16, 31); ctx.lineTo(16, 26);
    ctx.moveTo(16, 19); ctx.lineTo(16, 8);
    ctx.moveTo(6, 16); ctx.quadraticCurveTo(7, 5, 16, 16);
    ctx.quadraticCurveTo(25, 5, 26, 16); ctx.stroke();
  } else if (kind === 'market') {
    ctx.moveTo(2, 15); ctx.lineTo(6, 6); ctx.lineTo(26, 6); ctx.lineTo(30, 15); ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(6, 17); ctx.lineTo(6, 29); ctx.lineTo(26, 29); ctx.lineTo(26, 17);
    ctx.moveTo(6, 23); ctx.lineTo(26, 23); ctx.stroke();
  } else {
    ctx.fillRect(3, 17, 7, 14); ctx.fillRect(12, 10, 8, 21); ctx.fillRect(22, 4, 7, 27);
  }
}

export function drawCivicPlate(ctx, x, y, width, height, name, kind) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = COLORS[kind];
  ctx.fillRect(0, 0, width, height);
  const ink = '#fff3d8';
  ctx.lineWidth = 1.5; ctx.strokeStyle = ink;
  ctx.strokeRect(4, 4, width - 8, height - 8);
  ctx.fillStyle = '#d3ae69'; ctx.fillRect(52, 12, 2, height - 24);
  ctx.save();
  ctx.translate(12, 14);
  ctx.fillStyle = ink; ctx.strokeStyle = ink; ctx.lineWidth = 2.5;
  drawSymbol(ctx, kind);
  ctx.restore();

  // La jerarquía sigue el nombre real. «Plaza de mercado» necesita leerse completo.
  const parts = /^(Parque|Plaza) (.+)$/i.exec(name);
  const title = parts?.[2] ?? name;
  ctx.fillStyle = ink; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  if (parts) {
    ctx.font = 'bold 12px Arial, sans-serif';
    ctx.fillText(parts[1].toUpperCase(), 63, 18);
  }
  let size = 26;
  do { ctx.font = `bold ${size--}px Arial, sans-serif`; }
  while (size > 12 && ctx.measureText(title).width > width - 75);
  ctx.fillText(title, 63, parts ? 40 : height / 2);
  ctx.restore();
}
