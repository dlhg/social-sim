/** Loads a Tiled JSON (.tmj) map and renders tile layers to a Canvas 2D context. */

import type { Waypoint } from "./types";

interface TiledTileset {
  firstgid: number;
  columns: number;
  tilewidth: number;
  tileheight: number;
  image: string;
  tilecount: number;
}

interface TiledLayer {
  name: string;
  type: string;
  data?: number[];
  objects?: TiledObject[];
  width?: number;
  height?: number;
  visible: boolean;
  properties?: TiledProperty[];
}

interface TiledObject {
  id: number;
  name: string;
  x: number;
  y: number;
  point?: boolean;
  properties?: TiledProperty[];
}

interface TiledProperty {
  name: string;
  type: string;
  value: string;
}

interface TiledMap {
  width: number;
  height: number;
  tilewidth: number;
  tileheight: number;
  layers: TiledLayer[];
  tilesets: TiledTileset[];
}

export class TilemapRenderer {
  private map: TiledMap | null = null;
  private tilesetImage: HTMLImageElement | null = null;
  private tileset: TiledTileset | null = null;
  ready = false;

  /** Pre-rendered layer canvases (rendered once at native tile size). */
  private groundCanvas: OffscreenCanvas | null = null;
  private objectCanvas: OffscreenCanvas | null = null;

  /** Collision grid — true = blocked. */
  collisionGrid: boolean[] = [];

  /** Waypoints parsed from object layers. */
  waypoints: Waypoint[] = [];

  async load(mapUrl: string) {
    const resp = await fetch(mapUrl);
    this.map = await resp.json();

    const ts = this.map!.tilesets[0];
    this.tileset = ts;

    // Resolve tileset image relative to the map URL
    const mapBase = mapUrl.substring(0, mapUrl.lastIndexOf("/") + 1);
    const imgUrl = mapBase + ts.image.replace(/\\/g, "/");

    await new Promise<void>((resolve, reject) => {
      const img = new Image();
      img.onload = () => { this.tilesetImage = img; resolve(); };
      img.onerror = reject;
      img.src = imgUrl;
    });

    // Categorize layers
    const groundLayers: TiledLayer[] = [];
    const objectTileLayers: TiledLayer[] = [];

    for (const layer of this.map!.layers) {
      if (layer.type === "objectgroup") {
        this.parseWaypoints(layer);
        continue;
      }
      if (layer.type !== "tilelayer") continue;

      const lower = layer.name.toLowerCase();
      if (lower.includes("collis") || lower.includes("object")) {
        objectTileLayers.push(layer);
        // Build collision grid from any non-zero tile
        if (this.collisionGrid.length === 0) {
          this.collisionGrid = layer.data!.map(id => id !== 0);
        } else {
          // Merge: mark blocked if any collision-like layer has a tile
          layer.data!.forEach((id, i) => {
            if (id !== 0) this.collisionGrid[i] = true;
          });
        }
      } else if (lower === "ground") {
        groundLayers.push(layer);
      } else {
        // Additional tile layers (decorations, etc.) render on top of ground
        objectTileLayers.push(layer);
      }
    }

    // Pre-render layers to offscreen canvases
    this.groundCanvas = this.prerenderLayers(groundLayers);
    this.objectCanvas = this.prerenderLayers(objectTileLayers);

    this.ready = true;
  }

  get mapWidth() { return this.map?.width ?? 0; }
  get mapHeight() { return this.map?.height ?? 0; }

  private parseWaypoints(layer: TiledLayer) {
    if (!layer.objects || !this.map) return;

    for (const obj of layer.objects) {
      if (!obj.point || !obj.name) continue;

      // Convert pixel coords to grid coords
      const gridX = Math.floor(obj.x / this.map.tilewidth);
      const gridY = Math.floor(obj.y / this.map.tileheight);

      // Derive id from name: lowercase, spaces to underscores
      const id = obj.name.toLowerCase().replace(/\s+/g, "_");

      // Get mood from object properties, fall back to layer properties
      const objMood = obj.properties?.find(p => p.name === "mood")?.value;
      const layerMood = layer.properties?.find(p => p.name === "mood")?.value;
      const mood = objMood ?? layerMood ?? "social";

      this.waypoints.push({
        id,
        name: obj.name,
        position: { x: gridX, y: gridY },
        mood: mood as Waypoint["mood"],
        description: `${obj.name}, a ${mood} spot`,
      });
    }
  }

  private prerenderLayers(layers: TiledLayer[]): OffscreenCanvas | null {
    if (!this.tilesetImage || !this.tileset || !this.map || layers.length === 0) return null;

    const { columns, firstgid, tilewidth, tileheight } = this.tileset;
    const mapW = this.map.width;
    const mapH = this.map.height;

    const canvas = new OffscreenCanvas(mapW * tilewidth, mapH * tileheight);
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;

    for (const layer of layers) {
      if (!layer.data) continue;
      for (let row = 0; row < mapH; row++) {
        for (let col = 0; col < mapW; col++) {
          const tileId = layer.data[row * mapW + col];
          if (tileId === 0) continue;

          const localId = tileId - firstgid;
          const srcCol = localId % columns;
          const srcRow = Math.floor(localId / columns);

          ctx.drawImage(
            this.tilesetImage!,
            srcCol * tilewidth, srcRow * tileheight, tilewidth, tileheight,
            col * tilewidth, row * tileheight, tilewidth, tileheight,
          );
        }
      }
    }

    return canvas;
  }

  /** Draw ground layers (call before NPCs). */
  drawGround(ctx: CanvasRenderingContext2D, offsetX: number, offsetY: number, tileSize: number) {
    this.drawCached(ctx, this.groundCanvas, offsetX, offsetY, tileSize);
  }

  /** Draw object layers (call before NPCs). */
  drawObjects(ctx: CanvasRenderingContext2D, offsetX: number, offsetY: number, tileSize: number) {
    this.drawCached(ctx, this.objectCanvas, offsetX, offsetY, tileSize);
  }

  private drawCached(
    ctx: CanvasRenderingContext2D,
    cached: OffscreenCanvas | null,
    offsetX: number,
    offsetY: number,
    tileSize: number,
  ) {
    if (!cached || !this.map) return;

    ctx.imageSmoothingEnabled = false;
    const destW = this.map.width * tileSize;
    const destH = this.map.height * tileSize;
    ctx.drawImage(cached, offsetX, offsetY, destW, destH);
  }
}
