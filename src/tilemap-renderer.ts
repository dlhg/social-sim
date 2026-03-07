/** Loads a Tiled JSON (.tmj) map and renders tile layers to a Canvas 2D context. */

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
  data: number[];
  width: number;
  height: number;
  visible: boolean;
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

  /** Layers to render as ground (behind everything). */
  private groundLayers: TiledLayer[] = [];
  /** Layers to render as objects (on top of ground). */
  private objectLayers: TiledLayer[] = [];
  /** Collision grid — true = blocked. */
  collisionGrid: boolean[] = [];

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
    for (const layer of this.map!.layers) {
      if (layer.type !== "tilelayer") continue;
      const lower = layer.name.toLowerCase();
      if (lower.includes("collis") || lower.includes("object")) {
        this.objectLayers.push(layer);
        if (this.collisionGrid.length === 0) {
          this.collisionGrid = layer.data.map(id => id !== 0);
        }
      } else {
        this.groundLayers.push(layer);
      }
    }

    // Pre-render layers to offscreen canvases
    this.groundCanvas = this.prerenderLayers(this.groundLayers);
    this.objectCanvas = this.prerenderLayers(this.objectLayers);

    this.ready = true;
  }

  get mapWidth() { return this.map?.width ?? 0; }
  get mapHeight() { return this.map?.height ?? 0; }

  private prerenderLayers(layers: TiledLayer[]): OffscreenCanvas | null {
    if (!this.tilesetImage || !this.tileset || !this.map || layers.length === 0) return null;

    const { columns, firstgid, tilewidth, tileheight } = this.tileset;
    const mapW = this.map.width;
    const mapH = this.map.height;

    const canvas = new OffscreenCanvas(mapW * tilewidth, mapH * tileheight);
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;

    for (const layer of layers) {
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
