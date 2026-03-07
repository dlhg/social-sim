// ── Sprite animation system for 16x16-grid character spritesheets ──
//
// Spritesheets: "Modern tiles_Free" pack
// Frame size: 16px wide × 32px tall (characters are 1 tile wide, 2 tiles tall)
// Animation sheets (_run_, _idle_anim_): 24 frames in a single row
//   → 6 frames per direction: Down(0-5), Up(6-11), Left(12-17), Right(18-23)
// Static idle (_idle_): 4 frames, 1 per direction

const FRAME_W = 16;
const FRAME_H = 32;
const FRAMES_PER_DIR = 6;

// Direction → frame offset multiplier
const DIR_DOWN = 3;
const DIR_UP = 1;
const DIR_LEFT = 2;
const DIR_RIGHT = 0;

const IDLE_FRAME_MS = 180;
const RUN_FRAME_MS = 100;

// Available character sprite names in the asset pack
const SPRITE_NAMES = ["Adam", "Alex", "Amelia", "Bob"] as const;
type SpriteName = (typeof SPRITE_NAMES)[number];

// Map known NPC IDs to specific sprites
const NPC_SPRITE_MAP: Record<string, SpriteName> = {
  alice: "Amelia",
  bob: "Bob",
  victor: "Adam",
  mara: "Alex",
};

interface SpriteImages {
  idle: HTMLImageElement;
  run: HTMLImageElement;
}

interface AnimState {
  dir: number;
  frame: number;
  lastAdvance: number;
  wasMoving: boolean;
}

function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

export class SpriteSystem {
  private sprites = new Map<SpriteName, SpriteImages>();
  private anims = new Map<string, AnimState>();
  private autoPool = new Map<string, SpriteName>();
  private autoIdx = 0;
  ready = false;

  async load(): Promise<void> {
    const base = "/assets/Modern%20tiles_Free/Characters_free";
    await Promise.all(
      SPRITE_NAMES.map(async (name) => {
        const [idle, run] = await Promise.all([
          loadImg(`${base}/${name}_idle_anim_16x16.png`),
          loadImg(`${base}/${name}_run_16x16.png`),
        ]);
        this.sprites.set(name, { idle, run });
      })
    );
    this.ready = true;
  }

  private resolve(npcId: string): SpriteName {
    const explicit = NPC_SPRITE_MAP[npcId];
    if (explicit) return explicit;
    let assigned = this.autoPool.get(npcId);
    if (!assigned) {
      assigned = SPRITE_NAMES[this.autoIdx++ % SPRITE_NAMES.length];
      this.autoPool.set(npcId, assigned);
    }
    return assigned;
  }

  /**
   * Draw an NPC sprite. Returns true if drawn, false if caller should fallback.
   *
   * @param cx    Screen X center of the tile
   * @param feetY Screen Y where the character's feet should land
   * @param w     Draw width
   * @param h     Draw height
   * @param dx    Grid movement delta X (-1, 0, or 1)
   * @param dy    Grid movement delta Y (-1, 0, or 1)
   */
  draw(
    ctx: CanvasRenderingContext2D,
    npcId: string,
    cx: number,
    feetY: number,
    w: number,
    h: number,
    dx: number,
    dy: number,
    moving: boolean,
    now: number,
  ): boolean {
    if (!this.ready) return false;

    const imgs = this.sprites.get(this.resolve(npcId));
    if (!imgs) return false;

    // Get or create animation state
    let a = this.anims.get(npcId);
    if (!a) {
      a = { dir: DIR_DOWN, frame: 0, lastAdvance: now, wasMoving: false };
      this.anims.set(npcId, a);
    }

    // Update facing direction from movement
    if (dx !== 0 || dy !== 0) {
      if (Math.abs(dx) >= Math.abs(dy)) {
        a.dir = dx > 0 ? DIR_RIGHT : DIR_LEFT;
      } else {
        a.dir = dy > 0 ? DIR_DOWN : DIR_UP;
      }
    }

    // Reset frame on idle↔run transition
    if (moving !== a.wasMoving) {
      a.frame = 0;
      a.lastAdvance = now;
      a.wasMoving = moving;
    }

    // Advance animation frame
    const interval = moving ? RUN_FRAME_MS : IDLE_FRAME_MS;
    if (now - a.lastAdvance >= interval) {
      a.frame = (a.frame + 1) % FRAMES_PER_DIR;
      a.lastAdvance = now;
    }

    // Source rect from the appropriate sheet
    const sheet = moving ? imgs.run : imgs.idle;
    const sx = (a.dir * FRAMES_PER_DIR + a.frame) * FRAME_W;

    // Draw with nearest-neighbor for crisp pixel art
    const prev = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(sheet, sx, 0, FRAME_W, FRAME_H, cx - w / 2, feetY - h, w, h);
    ctx.imageSmoothingEnabled = prev;

    return true;
  }
}
