// src/systems/CraftingSystem.js
import { RECIPES } from '../data/recipes.js';
import { ITEMS } from '../data/items.js';

export class CraftingSystem {
  constructor() {
    this.recipes = RECIPES;
  }

  /** ¿Tiene el inventario los ingredientes de la receta? */
  canCraft(recipe, inventory) {
    for (const [id, qty] of Object.entries(recipe.ingredients)) {
      if (inventory.count(id) < qty) return false;
    }
    return true;
  }

  /** Craftea una receta. Devuelve el item resultante o null. */
  craft(recipe, inventory) {
    if (!this.canCraft(recipe, inventory)) return null;

    const resultItem = ITEMS[recipe.result];
    if (!resultItem) return null;

    // Quitar ingredientes (libera espacio) y añadir el resultado; si no cabe, se devuelven
    for (const [id, qty] of Object.entries(recipe.ingredients)) {
      inventory.remove(id, qty);
    }
    if (!inventory.add(resultItem, recipe.qty)) {
      for (const [id, qty] of Object.entries(recipe.ingredients)) {
        if (ITEMS[id]) inventory.add(ITEMS[id], qty);
      }
      return null;
    }

    window.dispatchEvent(new CustomEvent('craft', {
      detail: { name: resultItem.name, qty: recipe.qty }
    }));

    return resultItem;
  }

  /** Devuelve todas las recetas marcando si son crafteables */
  getAvailable(inventory) {
    return this.recipes.map((r) => ({
      ...r,
      craftable: this.canCraft(r, inventory)
    }));
  }
}
