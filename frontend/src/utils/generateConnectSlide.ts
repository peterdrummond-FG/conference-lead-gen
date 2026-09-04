import QRCode from 'qrcode';
import ckhLogoUrl from '@/assets/brand/ckh-logo.png';

// Pulled from capturingkidshearts.org's live site (header/button color and
// logo) so the slide reads as genuinely on-brand rather than a generic QR
// code dropped onto a PowerPoint template.
const CKH_NAVY = '#215091';
const CKH_GOLD = '#D4A24C';
// City/State and the scan hint, muted enough to sit behind the headline but
// still legible on navy — the print flyer's grey (#5B6472) is not.
const MUTED_BLUE = '#A9C4E4';

// Matches $app-font-stack in css/app.scss: no webfont, deliberately, so
// nothing depends on venue WiFi at render time.
const FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

// 1080p 16:9 — drops straight onto a PowerPoint slide and fills an iPad
// held in a landscape stand.
const SLIDE_WIDTH = 1920;
const SLIDE_HEIGHT = 1080;

// Left text column.
const COL_X = 120;
const COL_WIDTH = 880;

// The logo artwork is cyan + a navy half-heart + grey "Powered by Flippen
// Group" on transparency, so the navy half and the tagline would all but
// vanish drawn straight onto the navy field. The white plate is load-bearing,
// not decoration — and it pairs visually with the QR card opposite it.
const LOGO_ASPECT = 437 / 1500;
const PLATE = { x: COL_X, y: 180, width: 600, height: 232, padding: 40 };

// Right column: QR boxed in white, vertically centered, bottom edge aligned
// with the URL line on the left so the two columns read as one block.
const QR_SIZE = 600;
const QR_CARD = { centerX: 1440, centerY: 540, size: 720 };

let cachedLogo: HTMLImageElement | null = null;

async function getLogo(): Promise<HTMLImageElement> {
  if (!cachedLogo) {
    // A Vite-bundled asset is same-origin, so the image can be decoded
    // straight into the canvas without the data-URL round trip.
    const img = new Image();
    img.src = ckhLogoUrl;
    await img.decode();
    cachedLogo = img;
  }
  return cachedLogo;
}

// Wraps to at most maxLines, ellipsising anything that still doesn't fit.
// Campaign names run long ("Texas Association of School Administrators
// Midwinter Conference"), and at slide type sizes one line will not hold them.
function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (!current || ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
      continue;
    }
    lines.push(current);
    current = word;
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && current) lines.push(current);

  if (lines.join(' ') !== words.join(' ')) {
    let last = lines[maxLines - 1] ?? '';
    while (last && ctx.measureText(`${last}…`).width > maxWidth) {
      last = last.slice(0, -1).trimEnd();
    }
    lines[maxLines - 1] = `${last}…`;
  }
  return lines;
}

// Shrinks a single line until it fits, and leaves ctx.font set to the size
// it settled on.
function fitFontSize(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  startPx: number,
  minPx: number,
  weight = 'bold',
): void {
  let size = startPx;
  for (;;) {
    ctx.font = `${weight} ${size}px ${FONT_STACK}`;
    if (size <= minPx || ctx.measureText(text).width <= maxWidth) return;
    size -= 1;
  }
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
  ctx.fill();
}

async function renderQrCanvas(url: string): Promise<HTMLCanvasElement> {
  const qrCanvas = document.createElement('canvas');
  await QRCode.toCanvas(qrCanvas, url, {
    width: QR_SIZE,
    margin: 1,
    color: { dark: CKH_NAVY, light: '#FFFFFF' },
  });
  return qrCanvas;
}

export interface ConnectSlideDetails {
  eventName: string;
  city: string;
  state: string;
  intakeUrl: string;
}

// Draws the CKH-branded "scan to connect" slide onto an offscreen canvas.
// Split out from the download so the artwork can be rendered and inspected
// on its own.
export async function renderConnectSlide(
  details: ConnectSlideDetails,
): Promise<HTMLCanvasElement> {
  const [logo, qrCanvas] = await Promise.all([getLogo(), renderQrCanvas(details.intakeUrl)]);

  const canvas = document.createElement('canvas');
  canvas.width = SLIDE_WIDTH;
  canvas.height = SLIDE_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get a 2D canvas context for the connect slide.');

  // Solid navy field — this is a backlit screen, not paper, so it wants
  // maximum contrast rather than the print flyer's cream.
  ctx.fillStyle = CKH_NAVY;
  ctx.fillRect(0, 0, SLIDE_WIDTH, SLIDE_HEIGHT);

  // Logo on its white plate
  ctx.fillStyle = '#FFFFFF';
  roundedRect(ctx, PLATE.x, PLATE.y, PLATE.width, PLATE.height, 24);
  const logoWidth = PLATE.width - PLATE.padding * 2;
  const logoHeight = logoWidth * LOGO_ASPECT;
  ctx.drawImage(
    logo,
    PLATE.x + PLATE.padding,
    PLATE.y + (PLATE.height - logoHeight) / 2,
    logoWidth,
    logoHeight,
  );

  // Headline + gold accent rule, standing in for the print flyer's nested
  // gold border.
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#FFFFFF';
  fitFontSize(ctx, 'CONNECT WITH US', COL_WIDTH, 96, 60);
  ctx.fillText('CONNECT WITH US', COL_X, 540);

  ctx.fillStyle = CKH_GOLD;
  ctx.fillRect(COL_X, 578, 200, 5);

  // Event name, then City, State
  ctx.fillStyle = '#FFFFFF';
  ctx.font = `600 40px ${FONT_STACK}`;
  const eventLines = wrapText(ctx, details.eventName, COL_WIDTH, 2);
  eventLines.forEach((line, i) => {
    ctx.fillText(line, COL_X, 660 + i * 50);
  });

  ctx.fillStyle = MUTED_BLUE;
  ctx.font = `400 32px ${FONT_STACK}`;
  ctx.fillText(
    `${details.city}, ${details.state}`,
    COL_X,
    660 + (eventLines.length - 1) * 50 + 48,
  );

  // Scan hint + spelled-out URL, bottom-anchored to the QR card's lower edge
  // so the event name wrapping to two lines can't push them around.
  const urlBaseline = QR_CARD.centerY + QR_CARD.size / 2;
  ctx.fillStyle = MUTED_BLUE;
  ctx.font = `400 28px ${FONT_STACK}`;
  ctx.fillText('Scan with your phone camera', COL_X, urlBaseline - 48);

  // Spelled out for anyone who can't scan.
  const urlText = details.intakeUrl.replace(/^https?:\/\//, '');
  ctx.fillStyle = '#FFFFFF';
  fitFontSize(ctx, urlText, COL_WIDTH, 34, 20);
  ctx.fillText(urlText, COL_X, urlBaseline);

  // QR card. The QR is drawn at its native pixel size so it stays crisp —
  // no resampling — which is what keeps it scannable from across an aisle.
  ctx.fillStyle = '#FFFFFF';
  roundedRect(
    ctx,
    QR_CARD.centerX - QR_CARD.size / 2,
    QR_CARD.centerY - QR_CARD.size / 2,
    QR_CARD.size,
    QR_CARD.size,
    28,
  );
  ctx.drawImage(
    qrCanvas,
    QR_CARD.centerX - QR_SIZE / 2,
    QR_CARD.centerY - QR_SIZE / 2,
    QR_SIZE,
    QR_SIZE,
  );

  return canvas;
}

// Builds the slide and triggers a browser download — this is the PNG a rep
// drops onto a PowerPoint slide or opens full-screen on a booth iPad,
// replacing the old printable table-top flyer.
export async function generateConnectSlidePng(details: ConnectSlideDetails): Promise<void> {
  const canvas = await renderConnectSlide(details);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Could not render the connect slide to a PNG.');

  // Same reasoning as the CSV export in ExportPage.vue — jsPDF's doc.save()
  // used to hide this step for us.
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `ckh-connect-slide-${details.city.toLowerCase().replace(/\s+/g, '-')}.png`;
  link.click();
  URL.revokeObjectURL(url);
}
