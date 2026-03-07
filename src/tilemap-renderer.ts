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

  /** Layers to render as ground (behind everything). */
  private groundLayers: TiledLayer[] = [];
  /** Layers to render as objects (on top of ground, name contains "collision" or "object"). */
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
        // Build collision grid from any non-zero tile
        if (this.collisionGrid.length === 0) {
          this.collisionGrid = layer.data.map(id => id !== 0);
        }
      } else {
        this.groundLayers.push(layer);
      }
    }

    this.ready = true;
  }

  get mapWidth() { return this.map?.width ?? 0; }
  get mapHeight() { return this.map?.height ?? 0; }

  /** Draw ground layers (call before NPCs). */
  drawGround(ctx: CanvasRenderingContext2D, offsetX: number, offsetY: number, tileSize: number) {
    for (const layer of this.groundLayers) {
      this.drawLayer(ctx, layer, offsetX, offsetY, tileSize);
    }
  }

  /** Draw object layers (call before NPCs — depth interleaving can come later). */
  drawObjects(ctx: CanvasRenderingContext2D, offsetX: number, offsetY: number, tileSize: number) {
    for (const layer of this.objectLayers) {
      this.drawLayer(ctx, layer, offsetX, offsetY, tileSize);
    }
  }

  private drawLayer(
    ctx: CanvasRenderingContext2D,
    layer: TiledLayer,
    offsetX: number,
    offsetY: number,
    tileSize: number,
  ) {
    if (!this.tilesetImage || !this.tileset || !this.map) return;

    const { columns, firstgid, tilewidth, tileheight } = this.tileset;
    const mapW = this.map.width;
    const mapH = this.map.height;

    // Viewport culling — determine visible tile range
    const startCol = Math.max(0, Math.floor(-offsetX / tileSize));
    const startRow = Math.max(0, Math.floor(-offsetY / tileSize));
    const endCol = Math.min(mapW, Math.ceil((-offsetX + ctx.canvas.width / (window.devicePixelRatio || 1)) / tileSize));
    const endRow = Math.min(mapH, Math.ceil((-offsetY + ctx.canvas.height / (window.devicePixelRatio || 1)) / tileSize));

    // Crisp pixel art
    ctx.imageSmoothingEnabled = false;

    for (let row = startRow; row < endRow; row++) {
      for (let col = startCol; col < endCol; col++) {
        const tileId = layer.data[row * mapW + col];
        if (tileId === 0) continue;

        const localId = tileId - firstgid;
        const srcCol = localId % columns;
        const srcRow = Math.floor(localId / columns);
        const sx = srcCol * tilewidth;
        const sy = srcRow * tileheight;

        const dx = offsetX + col * tileSize;
        const dy = offsetY + row * tileSize;

        ctx.drawImage(
          this.tilesetImage,
          sx, sy, tilewidth, tileheight,
          dx, dy, tileSize, tileSize,
        );
      }
    }
  }
}
