import {
  createElement, Recycle, Store, Droplets, Moon, Sun, CloudRain, CloudDrizzle, Cloud, CloudLightning,
  Backpack, Pause, X, ArrowUp, HandCoins, Search, Bed, Tent, Package, Coins, Sandwich, Coffee, Pill,
  Thermometer, TriangleAlert, ShoppingBag, Hammer, Flame, Footprints, Trash2, Volume2, VolumeX, Save,
  Smartphone, Watch, GlassWater, Utensils, Heart, Smile, Bath, Layers, Box, Play, Check, Lock, Bandage,
  Banknote, Croissant, Wrench, Map, MapPin, Scissors, Shirt, User, Dices, RotateCcw, RotateCw, Sparkles,
  Crown, Eye, IdCard, PersonStanding, Palette, Radio, CloudSun, CloudMoon, CloudFog, Wind, Zap, Droplet,
  Cigarette, Clock, Settings, Keyboard, ChartColumn, Dog,
} from 'lucide';

const ICONS = {
  recycle: Recycle, store: Store, droplets: Droplets, moon: Moon, sun: Sun, rain: CloudRain,
  drizzle: CloudDrizzle, cloud: Cloud, storm: CloudLightning, backpack: Backpack, pause: Pause, x: X,
  arrow: ArrowUp, hand: HandCoins, search: Search, bed: Bed, tent: Tent, package: Package, coins: Coins,
  sandwich: Sandwich, coffee: Coffee, pill: Pill, thermometer: Thermometer, alert: TriangleAlert,
  bag: ShoppingBag, hammer: Hammer, flame: Flame, run: Footprints, trash: Trash2, sound: Volume2,
  mute: VolumeX, save: Save, phone: Smartphone, watch: Watch, water: GlassWater, food: Utensils,
  heart: Heart, smile: Smile, bath: Bath, layers: Layers, box: Box, play: Play, check: Check,
  lock: Lock, bandage: Bandage, banknote: Banknote, bread: Croissant, wrench: Wrench, map: Map, pin: MapPin,
  scissors: Scissors, shirt: Shirt, user: User, dice: Dices, rotl: RotateCcw, rotr: RotateCw, sparkles: Sparkles,
  crown: Crown, eye: Eye, idcard: IdCard, body: PersonStanding, palette: Palette, radio: Radio,
  'cloud-sun': CloudSun, 'cloud-moon': CloudMoon, fog: CloudFog, wind: Wind, zap: Zap, droplet: Droplet,
  cigarette: Cigarette, clock: Clock, settings: Settings, keyboard: Keyboard, chart: ChartColumn, dog: Dog,
};

export const hasIcon = (name) => name in ICONS;

/** Devuelve un SVG de lucide con trazo uniforme. */
export function icon(name, { size = 24, stroke = 2.25 } = {}) {
  const node = ICONS[name] ?? ICONS.box;
  const el = createElement(node);
  el.setAttribute('width', size);
  el.setAttribute('height', size);
  el.setAttribute('stroke-width', stroke);
  el.setAttribute('aria-hidden', 'true');
  return el;
}

export function setIcon(target, name, opts) {
  target.replaceChildren(icon(name, opts));
}
