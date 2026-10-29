// src/data/recipes.js
// Recetas de crafteo: ingredientes (id item -> cantidad) -> resultado.
// Todos los ingredientes salen de la basura, la tienda o el dealer (ver tests/crafting.test.js).

export const RECIPES = [
  {
    id: 'radioTransistor',
    name: 'Radio transistor AM/FM',
    emoji: '📻',
    result: 'radioTransistor',
    qty: 1,
    ingredients: {
      chatarra: 1,
      cable: 2,
      pilas: 1
    }
  },

  {
    id: 'arma',
    name: 'Arma casera',
    emoji: '🗡️',
    result: 'arma',
    qty: 1,
    ingredients: {
      chatarra: 2,
      cable: 1,
      madera: 1
    }
  },
  {
    id: 'cuchillo',
    name: 'Cuchillo',
    emoji: '🔪',
    result: 'cuchillo',
    qty: 1,
    ingredients: {
      chatarra: 1,
      madera: 1
    }
  },
  {
    id: 'botella_picada',
    name: 'Botella picada',
    emoji: '🍾',
    result: 'botella_picada',
    qty: 1,
    ingredients: {
      botella: 1,
      lata: 1
    }
  },
  {
    id: 'curita',
    name: 'Curita',
    emoji: '🩹',
    result: 'curita',
    qty: 2,
    ingredients: {
      botella: 1,
      carton: 1
    }
  },
  {
    id: 'antibiotico',
    name: 'Antibiótico',
    emoji: '💊',
    result: 'antibiotico',
    qty: 1,
    ingredients: {
      pastilla: 1,
      botella: 1
    }
  },
  {
    id: 'rifa',
    name: 'Cartón de rifa',
    emoji: '🎟️',
    result: 'rifa',
    qty: 1,
    ingredients: {
      carton: 2,
      lata: 1
    }
  },
  {
    id: 'hierba',
    name: 'Hierba seca',
    emoji: '🌿',
    result: 'hierba',
    qty: 2,
    ingredients: {
      carton: 1,
      madera: 1
    }
  }
];
