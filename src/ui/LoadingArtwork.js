/** Baraja parejas completas sin repetir la última al comenzar otra vuelta. */
export function shuffledArtwork(ids, previous = null, random = Math.random) {
  const deck = [...ids];
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  if (deck.length > 1 && deck[0] === previous) [deck[0], deck[1]] = [deck[1], deck[0]];
  return deck;
}

export class LoadingArtwork {
  constructor(root, ids, baseURL = import.meta.env?.BASE_URL ?? '/') {
    this.baseURL = baseURL;
    this.root = root;
    this.ids = ids;
    this.deck = [];
    this.generation = 0;
    this.onPointer = event => {
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      const x = event.clientX / Math.max(innerWidth, 1) - .5;
      const y = event.clientY / Math.max(innerHeight, 1) - .5;
      root.style.setProperty('--loading-x', `${x * 16}px`);
      root.style.setProperty('--loading-y', `${y * 10}px`);
    };
  }

  start() {
    if (this.active || !this.ids.length) return;
    this.active = true;
    this.root.addEventListener('pointermove', this.onPointer);
    this.next();
  }

  async next() {
    const generation = this.generation;
    if (!this.deck.length) this.deck = shuffledArtwork(this.ids, this.previous);
    const id = this.deck.shift();
    const scene = document.createElement('div');
    scene.className = 'loading-art-scene';
    scene.setAttribute('aria-hidden', 'true');
    const pictures = ['fondo', 'personaje'].map((kind, index) => {
      const layer = document.createElement('div');
      layer.className = `loading-art-layer ${index ? 'loading-art-foreground' : 'loading-art-background'}`;
      const img = new Image();
      img.alt = '';
      img.decoding = 'async';
      img.fetchPriority = 'low';
      img.src = `${this.baseURL}images/pantalla-carga/${kind}_pantalla_carga_${id}.webp`;
      layer.append(img); scene.append(layer);
      return img;
    });
    let timeout;
    try {
      // La ilustración es opcional: un fallo nunca retrasa el arranque del juego.
      await Promise.race([
        Promise.all(pictures.map(img => img.decode())),
        new Promise((_, reject) => {
          this.cancelPending = () => {
            clearTimeout(timeout);
            pictures.forEach(img => img.removeAttribute?.('src'));
            reject(new Error('Galería detenida'));
          };
          timeout = setTimeout(() => reject(new Error('Imagen no disponible')), 8000);
        })
      ]);
      if (!this.active || generation !== this.generation) return;
      const old = this.current;
      this.root.prepend(scene);
      this.current = scene;
      this.previous = id;
      this.root.classList.add('has-loading-art');
      if (old) {
        old.classList.add('is-leaving');
        this.retireTimer = setTimeout(() => old.remove(), 1000);
      }
    } catch {
      // Conserva la pareja anterior o el fondo de respaldo.
    } finally {
      clearTimeout(timeout);
      if (generation === this.generation) this.cancelPending = null;
      if (this.active && generation === this.generation) this.timer = setTimeout(() => this.next(), 7500);
    }
  }

  stop({ remove = false } = {}) {
    this.active = false;
    this.generation++;
    this.cancelPending?.();
    this.cancelPending = null;
    clearTimeout(this.timer);
    clearTimeout(this.retireTimer);
    this.root.removeEventListener('pointermove', this.onPointer);
    this.root.querySelectorAll('.is-leaving').forEach(scene => scene.remove());
    if (remove) {
      this.current?.remove();
      this.current = null;
      this.root.classList.remove('has-loading-art');
    }
  }
}
